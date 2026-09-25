---
"@preact/signals-core": patch
---

Fix `createModel` to also wrap class prototype methods as actions. Class methods live on the prototype and are non-enumerable, so `wrapInAction`'s `for...in` missed them entirely, leaving class-based models without batch/untracked action semantics. Also skip accessor properties (previously a getter returning a function crashed construction with a TypeError) and avoid wrapping inherited methods of built-in objects such as `Map` or `Date`.
