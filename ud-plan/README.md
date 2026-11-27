# ud-plan

Turns settled decisions into a rework plan cut into lots, each doable and checkable on its own, with files, size, order and dependencies, following the project's working rules.

| | |
|---|---|
| **Reads** | `.ud/decisions.json`, the findings, the files concerned |
| **Writes** | `.ud/plan/lots.json`, `.ud/plan/plan.md` |
| **Run** | `/ud-plan` |
| **Sub-agents** | None by default |
| **Changes project code** | No |

**Limits.** Plans only settled decisions other than keep. Files in read-only folders are listed as blocked, never planned.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
