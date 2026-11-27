# ud-blueprint

Proposes an overall structure (story tree, token levels, naming, prop conventions, folders) by comparing the audit with well-known public design systems, each proposal citing its precedent.

| | |
|---|---|
| **Reads** | The run, the findings, `ud-core/references/reference-systems.md` |
| **Writes** | `findings/blueprint.json`, `reports/blueprint.md` |
| **Run** | `/ud-blueprint [refresh | subject]` |
| **Sub-agents** | Up to five, one per subject |
| **Changes project code** | No |

**Limits.** Cites only what the reference file holds; `refresh` re-reads the public docs. Folder moves are a separate proposal.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
