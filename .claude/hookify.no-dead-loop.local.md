---
name: no-dead-loop
enabled: true
event: bash
pattern: ^(npx tsc|tsc|cat |sed -n|grep )
action: warn
---

⚠️ **LOOP GUARD**: You are about to run a read/check command.

Before proceeding, ask yourself:
1. Have you run this exact command in the last 2 turns WITHOUT making any code changes in between?
2. If YES — STOP. Running the same check again will not fix anything.

**Rule**: After any failing `tsc` or `cat`, you MUST edit a file before running `tsc` again.
If you don't know what to change, STOP and tell the user what the error is and ask for guidance.
