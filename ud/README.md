# ud

The orchestrator. Says where a project stands and runs the other skills in order: a full pass, a pass limited to what changed since the last run, or one step.

| | |
|---|---|
| **Reads** | `.ud/` (settings, runs, decisions, lots) |
| **Writes** | Nothing itself; each step writes its own files |
| **Run** | `/ud [status | full | changed | <skill>]` |
| **Sub-agents** | Those of the steps it runs; it announces the number and waits for a yes before a full pass |
| **Changes project code** | No |

**Limits.** `full` stops at arbitration: render, blueprint, plan and rework are offered, never run unasked.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
