# ud-rework

Applies one lot of the plan: the only skill that changes code and stories. One lot at a time, from settled decisions, under the project's own rules for branches, size and checks.

| | |
|---|---|
| **Reads** | The lot, its decisions and findings, the lot's files |
| **Writes** | Project code and stories in the lot; decision and lot status |
| **Run** | `/ud-rework <lot id>` |
| **Sub-agents** | None by default |
| **Changes project code** | **Yes**, the lot's files only |

**Limits.** Never picks a lot itself, never edits a read-only file, never pushes or opens a review on its own.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
