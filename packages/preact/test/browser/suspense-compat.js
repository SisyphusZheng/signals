// Untyped re-export: preact/compat's types declare `export as namespace React`,
// which collides with the real React typings elsewhere in this monorepo's
// single tsconfig. Keeping this file plain JS keeps those types out of tsc.
export { Suspense } from "preact/compat";
