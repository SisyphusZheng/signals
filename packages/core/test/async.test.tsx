import { describe, it, expect } from "vitest";
import {
	signal,
	computed,
	effect,
	asyncComputed,
	awaited,
} from "@preact/signals-core";

function defer<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// A macrotask, so all pending microtasks (promise resolutions and the
// generator segments they drive) have drained by the time it resolves.
const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe("asyncComputed", () => {
	it("settles synchronously when the generator never yields", () => {
		const a = signal(2);
		const c = asyncComputed(function* () {
			return a.value * 2;
		});
		expect(c.value).to.equal(4);
		expect(c.pending.value).to.equal(false);

		a.value = 3;
		expect(c.value).to.equal(6);
	});

	it("does not flip pending for runs that complete without suspending", () => {
		const a = signal(1);
		const pendingStates: boolean[] = [];
		const c = asyncComputed(function* () {
			return a.value;
		});
		effect(() => {
			pendingStates.push(c.pending.value);
		});
		a.value = 2;
		expect(pendingStates).to.deep.equal([false]);
	});

	it("passes non-promise yields back into the generator", async () => {
		const c = asyncComputed(function* () {
			const x = yield 42;
			return x as number;
		});
		await tick();
		expect(c.value).to.equal(42);
	});

	it("tracks dependencies read before the first yield", async () => {
		const a = signal(1);
		let d = defer();
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			return av;
		});
		d.resolve();
		await tick();
		expect(c.value).to.equal(1);

		d = defer();
		a.value = 5;
		expect(c.pending.value).to.equal(true);
		d.resolve();
		await tick();
		expect(c.value).to.equal(5);
	});

	it("tracks dependencies read after a yield", async () => {
		const a = signal(1);
		const b = signal(10);
		let d = defer();
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			// This read happens after the suspension point. An async/await
			// implementation would not register it as a dependency.
			return av + b.value;
		});
		expect(c.value).to.equal(undefined);
		expect(c.pending.value).to.equal(true);
		d.resolve();
		await tick();
		expect(c.value).to.equal(11);
		expect(c.pending.value).to.equal(false);

		d = defer();
		b.value = 20;
		expect(c.pending.value).to.equal(true);
		d.resolve();
		await tick();
		expect(c.value).to.equal(21);
	});

	it("holds the last settled value while a new run is in flight", async () => {
		const a = signal(1);
		let d = defer();
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			return av;
		});
		d.resolve();
		await tick();
		expect(c.value).to.equal(1);

		d = defer();
		a.value = 2;
		expect(c.value).to.equal(1);
		expect(c.pending.value).to.equal(true);
		d.resolve();
		await tick();
		expect(c.value).to.equal(2);
	});

	it("restarts when a dependency changes mid-flight and ignores stale resolutions", async () => {
		const src = signal(0);
		const deferreds: ReturnType<typeof defer<number>>[] = [];
		const c = asyncComputed(function* () {
			src.value;
			const d = defer<number>();
			deferreds.push(d);
			const v = yield d.promise;
			return v as number;
		});
		expect(deferreds.length).to.equal(1);

		src.value = 1;
		expect(deferreds.length).to.equal(2);

		// The newer run settles first…
		deferreds[1].resolve(200);
		await tick();
		expect(c.value).to.equal(200);
		expect(c.pending.value).to.equal(false);

		// …and the superseded run's late resolution must not clobber it.
		deferreds[0].resolve(100);
		await tick();
		expect(c.value).to.equal(200);
	});

	it("runs finally blocks when a run is aborted by a restart", async () => {
		const src = signal(0);
		let finallyRuns = 0;
		let d = defer();
		const c = asyncComputed(function* () {
			const v = src.value;
			try {
				yield d.promise;
			} finally {
				finallyRuns++;
			}
			return v;
		});
		src.value = 1;
		expect(finallyRuns).to.equal(1);

		d.resolve();
		await tick();
		// The second run completed normally; its finally also ran on exit.
		expect(finallyRuns).to.equal(2);
		expect(c.value).to.equal(1);
	});

	it("throws rejections back into the generator so try/catch works", async () => {
		const d = defer<number>();
		const c = asyncComputed(function* () {
			try {
				return (yield d.promise) as number;
			} catch (err) {
				return -1;
			}
		});
		d.reject(new Error("nope"));
		await tick();
		expect(c.value).to.equal(-1);
		expect(c.error.value).to.equal(undefined);
	});

	it("surfaces uncaught errors on the error signal and keeps the last value", async () => {
		const a = signal(1);
		let d = defer();
		let fail = false;
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			if (fail) throw new Error("boom");
			return av;
		});
		d.resolve();
		await tick();
		expect(c.value).to.equal(1);

		d = defer();
		fail = true;
		a.value = 2;
		d.resolve();
		await tick();
		expect(c.value).to.equal(1);
		expect((c.error.value as Error).message).to.equal("boom");
		expect(c.pending.value).to.equal(false);

		// A successful re-run heals the error state.
		d = defer();
		fail = false;
		a.value = 3;
		d.resolve();
		await tick();
		expect(c.value).to.equal(3);
		expect(c.error.value).to.equal(undefined);
	});

	it("drops dependencies that are no longer read", async () => {
		const useB = signal(true);
		const b = signal(1);
		let runs = 0;
		const c = asyncComputed(function* () {
			runs++;
			if (useB.value) {
				yield null;
				return b.value;
			}
			return -1;
		});
		await tick();
		expect(c.value).to.equal(1);

		useB.value = false;
		await tick();
		expect(c.value).to.equal(-1);

		const runsBefore = runs;
		b.value = 5;
		await tick();
		expect(runs).to.equal(runsBefore);
	});

	it("does not track reads made via peek()", async () => {
		const a = signal(1);
		const b = signal(10);
		let d = defer();
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			return av + b.peek();
		});
		d.resolve();
		await tick();
		expect(c.value).to.equal(11);

		b.value = 20;
		await tick();
		expect(c.pending.value).to.equal(false);
		expect(c.value).to.equal(11);
	});

	it("composes with downstream computeds and effects", async () => {
		const a = signal(1);
		let d = defer();
		const c = asyncComputed(function* () {
			const av = a.value;
			yield d.promise;
			return av * 10;
		});
		const plus = computed(() => (c.value ?? 0) + 1);
		const seen: number[] = [];
		effect(() => {
			seen.push(plus.value);
		});
		expect(seen).to.deep.equal([1]);

		d.resolve();
		await tick();
		expect(seen).to.deep.equal([1, 11]);

		d = defer();
		a.value = 2;
		d.resolve();
		await tick();
		expect(seen).to.deep.equal([1, 11, 21]);
	});

	it("tracks dependencies of delegated generators via yield*", async () => {
		const a = signal(1);
		let d = defer();
		function* fetchDouble(): Generator<unknown, number, unknown> {
			yield d.promise;
			// Read inside a sub-generator, after its own suspension point.
			return a.value * 2;
		}
		const c = asyncComputed(function* () {
			const doubled = yield* fetchDouble();
			return doubled + 1;
		});
		d.resolve();
		await tick();
		expect(c.value).to.equal(3);

		d = defer();
		a.value = 10;
		d.resolve();
		await tick();
		expect(c.value).to.equal(21);
	});

	it("supports typed awaits via the awaited helper", async () => {
		const c = asyncComputed(function* () {
			const n = yield* awaited(Promise.resolve(7));
			return n + 1;
		});
		await tick();
		expect(c.value).to.equal(8);
	});

	it("keeps interleaved instances' dependencies separate", async () => {
		const a = signal(1);
		const b = signal(100);
		let da = defer();
		let db = defer();
		const ca = asyncComputed(function* () {
			yield da.promise;
			return a.value;
		});
		const cb = asyncComputed(function* () {
			yield db.promise;
			return b.value;
		});

		// Resolve in reverse creation order to interleave their segments.
		db.resolve();
		da.resolve();
		await tick();
		expect(ca.value).to.equal(1);
		expect(cb.value).to.equal(100);

		da = defer();
		a.value = 2;
		expect(ca.pending.value).to.equal(true);
		expect(cb.pending.value).to.equal(false);
		da.resolve();
		await tick();
		expect(ca.value).to.equal(2);
		expect(cb.value).to.equal(100);

		db = defer();
		b.value = 200;
		expect(ca.pending.value).to.equal(false);
		db.resolve();
		await tick();
		expect(cb.value).to.equal(200);
	});

	it("restarts synchronously when a segment writes its own dependency", async () => {
		const a = signal(0);
		let starts = 0;
		const d = defer();
		const c = asyncComputed(function* () {
			starts++;
			const av = a.value;
			if (av === 0) {
				// Writing a dependency of this very run aborts it and starts a
				// fresh run during the batch flush, while the aborted run's
				// driver is still on the stack.
				a.value = 1;
			}
			yield d.promise;
			return av;
		});
		expect(starts).to.equal(2);

		d.resolve();
		await tick();
		expect(c.value).to.equal(1);
		expect(starts).to.equal(2);
	});

	it("stops reacting after dispose and runs pending finally blocks", async () => {
		const a = signal(1);
		let finallyRan = false;
		const d = defer<number>();
		const c = asyncComputed(function* () {
			const av = a.value;
			try {
				yield d.promise;
			} finally {
				finallyRan = true;
			}
			return av;
		});
		expect(c.pending.value).to.equal(true);

		c.dispose();
		expect(finallyRan).to.equal(true);
		expect(c.pending.value).to.equal(false);

		// Neither a late resolution nor a dependency change restarts it.
		d.resolve(0);
		a.value = 2;
		await tick();
		expect(c.value).to.equal(undefined);
		expect(c.pending.value).to.equal(false);
	});
});
