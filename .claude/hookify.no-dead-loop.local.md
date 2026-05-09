---
name: no-dead-loop
enabled: false
event: bash
pattern: ^(npx tsc|tsc|cat |sed -n|grep )
action: block
---

This rule is disabled. The hook approach is wrong for preventing verification loops.

Hooks are for blocking DANGEROUS operations (rm -rf, force push, etc.).
Behavioral guidance belongs in memory rules, not hooks.

The actual loop command was "git log && git status && npx tsc" which starts with "git"
and bypasses the ^ anchor pattern entirely — making this hook completely ineffective.
