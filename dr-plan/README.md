# dr-plan

Turns settled decisions into a rework plan cut into lots, each doable and checkable on its own, with files, size, order and dependencies, following the project's working rules.

| | |
|---|---|
| **Reads** | `.dr/decisions.json`, the findings, the files concerned |
| **Writes** | `.dr/plan/lots.json`, `.dr/plan/plan.md` |
| **Run** | `/dr-plan` |
| **Sub-agents** | None by default |
| **Changes project code** | No |

**Limits.** Plans only settled decisions other than keep. Files in read-only folders are listed as blocked, never planned.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
