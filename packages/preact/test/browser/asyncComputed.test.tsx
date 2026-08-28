import { signal, useAsyncComputed } from "@preact/signals";
import { createElement, render, Component } from "preact";
import type { ComponentChildren } from "preact";
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

	it("renders undefined until the first value settles", async () => {
		const d = defer<string>();
		function App() {
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		render(<App />, scratch);
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
			const s = useAsyncComputed(function* () {
				return (yield d.promise) as string;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		render(
			<Boundary>
				<App />
			</Boundary>,
			scratch
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

	it("shows the previous value while a new run is in flight", async () => {
		const id = signal(1);
		let d = defer();
		function App() {
			const s = useAsyncComputed(function* () {
				const current = id.value;
				yield d.promise;
				return `story ${current}`;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		render(<App />, scratch);
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

	it("disposes the instance on unmount", async () => {
		const dep = signal(1);
		let runs = 0;
		let d = defer();
		function App() {
			const s = useAsyncComputed(function* () {
				runs++;
				const current = dep.value;
				yield d.promise;
				return current;
			});
			return <p>{s.value ?? "none"}</p>;
		}

		render(<App />, scratch);
		await act(async () => {
			d.resolve();
			await sleep(1);
		});
		expect(runs).to.equal(1);

		render(null, scratch);
		d = defer();
		dep.value = 2;
		await sleep(1);
		expect(runs).to.equal(1);
	});
});
