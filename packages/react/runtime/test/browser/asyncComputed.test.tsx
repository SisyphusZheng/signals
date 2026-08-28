// @ts-expect-error
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { createElement, Component, Suspense } from "react";
import type { ReactNode } from "react";
import { signal, asyncComputed } from "@preact/signals-core";
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

	it("suspends until the first value settles", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			useSignals();
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		await render(
			<Suspense fallback={<span>loading</span>}>
				<App />
			</Suspense>
		);
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("never suspends hook-created instances", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed<string>(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		await render(
			<Suspense fallback={<span>loading</span>}>
				<App />
			</Suspense>
		);
		expect(scratch.textContent).to.equal("none");

		await act(async () => {
			d.resolve("hello");
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("hello");
	});

	it("throws errors to an error boundary", async () => {
		const d = defer<string>();
		const s = asyncComputed(function* () {
			return (yield d.promise) as string;
		});
		function App() {
			useSignals();
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		await render(
			<Boundary>
				<Suspense fallback={<span>loading</span>}>
					<App />
				</Suspense>
			</Boundary>
		);
		expect(scratch.textContent).to.equal("loading");

		await act(async () => {
			d.reject(new Error("boom"));
			await sleep(1);
		});
		expect(scratch.textContent).to.equal("caught:boom");
	});

	it("does not suspend when suspend is turned off", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed<string>(
				function* () {
					return (yield d.promise) as string;
				},
				{ suspend: false }
			);
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

	it("exposes errors on the signal when throwOnError is turned off", async () => {
		const d = defer<string>();
		function App() {
			useSignals();
			const s = useAsyncComputed<string>(
				function* () {
					return (yield d.promise) as string;
				},
				{ suspend: false, throwOnError: false }
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

	it("shows the previous value instead of re-suspending on revalidation", async () => {
		const id = signal(1);
		let d = defer();
		const s = asyncComputed(function* () {
			const current = id.value;
			yield d.promise;
			return `story ${current}`;
		});
		function App() {
			useSignals();
			const value = useAsyncComputed(s);
			return <p>{value.value}</p>;
		}

		await render(
			<Suspense fallback={<span>loading</span>}>
				<App />
			</Suspense>
		);
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
});
