// @ts-expect-error
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement, Component, Suspense } from "react";
import type { ReactNode } from "react";
import { signal } from "@preact/signals-core";
import { useAsyncComputed, useSignals } from "@preact/signals-react/runtime";
import {
	Root,
	createRoot,
	act,
	checkHangingAct,
	getConsoleErrorSpy,
} from "../../../test/shared/utils";
import { beforeEach, afterEach, describe, it, expect } from "vitest";

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

class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};
	static getDerivedStateFromError(error: Error) {
		return { error };
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
	let root: Root;

	async function render(element: Parameters<Root["render"]>[0]) {
		await act(() => root.render(element));
	}

	beforeEach(async () => {
		scratch = document.createElement("div");
		document.body.appendChild(scratch);
		root = await createRoot(scratch);
		getConsoleErrorSpy().mockClear();
	});

	afterEach(async () => {
		await act(() => root.unmount());
		scratch.remove();
		checkHangingAct();
	});

	it("renders undefined until the first value settles", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		await render(<App />);
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("throws errors to an error boundary", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		await render(
			<Boundary>
				<App />
			</Boundary>
		);
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("caught:boom");
	});

	it("exposes errors on the signal when throwOnError is turned off", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
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

		await render(<App />);
		expect(scratch.textContent).to.equal("ok");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("err:boom");
	});

	it("shows the previous value while a new run is in flight", async () => {
		const id = signal(1);
		let d = defer();
		function App() {
			useSignals();
			const s = useAsyncComputed(function* () {
				const current = id.value;
				yield d.promise;
				return `story ${current}`;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		await render(<App />);
		expect(scratch.textContent).to.equal("none");

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

	it("shows the Suspense fallback while unsettled when suspend is enabled", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed(
				function* () {
					return (yield d.promise) as string;
				},
				{ suspend: true }
			);
			return <p>{s.value}</p>;
		}

		await render(
			<Suspense fallback={<span>loading</span>}>
				<App />
			</Suspense>
		);
		expect(scratch.textContent).to.equal("loading");
	});

	it("suspends only before the first settlement", async () => {
		const dep = signal(1);
		const d = defer();
		function App() {
			useSignals();
			const s = useAsyncComputed(
				function* () {
					const id = dep.value;
					if (id === 1) return "sync 1";
					yield d.promise;
					return `async ${id}`;
				},
				{ suspend: true }
			);
			return <p>{s.value}</p>;
		}

		await render(
			<Suspense fallback={<span>loading</span>}>
				<App />
			</Suspense>
		);
		// The first run settled synchronously, so no fallback was shown.
		expect(scratch.textContent).to.equal("sync 1");

		await act(async () => {
			dep.value = 2;
			await sleep(1);
		});
		// Revalidation holds the previous value instead of re-suspending.
		expect(scratch.textContent).to.equal("sync 1");

		await act(async () => {
			d.resolve();
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("async 2");
	});

	it("disposes the instance on unmount", async () => {
		const dep = signal(1);
		let runs = 0;
		let d = defer();
		function App() {
			useSignals();
			const s = useAsyncComputed(function* () {
				runs++;
				const current = dep.value;
				yield d.promise;
				return current;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		await render(<App />);
		await act(async () => {
			d.resolve();
			await sleep(1);
		});
		expect(runs).to.equal(1);

		await act(() => root.unmount());
		d = defer();
		dep.value = 2;
		await sleep(1);
		expect(runs).to.equal(1);
	});
});
