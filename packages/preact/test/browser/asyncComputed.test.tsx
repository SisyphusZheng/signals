import { signal, asyncComputed, useAsyncComputed } from "@preact/signals";
import { createElement, render, Component } from "preact";
import type { ComponentChildren, FunctionComponent } from "preact";
// @ts-ignore untyped shim — see the comment inside it
import { Suspense as CompatSuspense } from "./suspense-compat.js";
import { act } from "preact/test-utils";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const sleep = (ms?: number) => new Promise(r => setTimeout(r, ms));

function defer<T = void>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const Suspense = CompatSuspense as FunctionComponent<{
	fallback?: ComponentChildren;
	children?: ComponentChildren;
}>;

class Boundary extends Component<
	{ children: ComponentChildren },
	{ error?: Error }
> {
	state: { error?: Error } = {};
	componentDidCatch(error: Error) {
		this.setState({ error });
	}
	render() {
		return this.state.error ? (
			<p>caught:{this.state.error.message}</p>
		) : (
			this.props.children
		);
	}
}

describe("useAsyncComputed", () => {
	let scratch: HTMLDivElement;

	beforeEach(() => {
		scratch = document.createElement("div");
	});

	afterEach(() => {
		render(null, scratch);
	});

	it("suspends until an external instance first settles", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		act(() => {
			render(
				<Suspense fallback={<span>loading</span>}>
					<App />
				</Suspense>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("throws errors from an external instance to an error boundary", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		act(() => {
			render(
				<Boundary>
					<Suspense fallback={<span>loading</span>}>
						<App />
					</Suspense>
				</Boundary>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("caught:boom");
	});

	it("never suspends hook-created instances", async () => {
		const d = defer<string>();
		function App() {
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		act(() => {
			render(
				<Suspense fallback={<span>loading</span>}>
					<App />
				</Suspense>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("throws errors from hook-created instances to an error boundary", async () => {
		const d = defer<string>();
		function App() {
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		act(() => {
			render(
				<Boundary>
					<App />
				</Boundary>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("caught:boom");
	});

	it("does not suspend when suspend is turned off", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			const value = useAsyncComputed(s, { suspend: false });
			return <p>{value.value ?? "none"}</p>;
		}

		render(<App />, scratch);
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("exposes errors on the signal when throwOnError is turned off", async () => {
		const d = defer<string>();
		function App() {
			const s = useAsyncComputed(
				function* () {
					return (yield d.promise) as string;
				},
				{ throwOnError: false }
			);
			return (
				<p>
					{s.error.value ? `err:${(s.error.value as Error).message}` : "ok"}
				</p>
			);
		}

		render(<App />, scratch);
		expect(scratch.textContent).to.equal("ok");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("err:boom");
	});

	it("shows the previous value instead of re-suspending on revalidation", async () => {
		const id = signal(1);
		let d = defer();
		const s = asyncComputed(function* () {
			const current = id.value;
			yield d.promise;
			return `story ${current}`;
		});
		function App() {
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		act(() => {
			render(
				<Suspense fallback={<span>loading</span>}>
					<App />
				</Suspense>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.resolve();
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("story 1");

		d = defer();
		await act(async () => {
			id.value = 2;
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("story 1");

		await act(async () => {
			d.resolve();
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("story 2");
	});

	it("does not dispose external instances on unmount", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		act(() => {
			render(
				<Suspense fallback={<span>loading</span>}>
					<App />
				</Suspense>,
				scratch
			);
		});
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.resolve("shared");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("shared");

		render(null, scratch);
		expect(s.value).to.equal("shared");
		expect(s.pending.value).to.equal(false);
	});
});
