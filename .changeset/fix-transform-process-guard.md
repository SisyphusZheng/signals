---
"@preact/signals-react-transform": patch
---

Fix an always-true `typeof process` check in the debug logger, which provided no protection in environments without a global `process` and could throw when debug logging was enabled there
