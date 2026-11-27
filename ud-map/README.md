# ud-map

Builds the map: one self-contained interactive HTML page (overview, explorer with each component's neighbourhood, findings, tokens, decisions) and a markdown map with Mermaid diagrams.

| | |
|---|---|
| **Reads** | The run's graph, all findings, the decision ledger, the lots |
| **Writes** | `map.html`, `reports/map.md` |
| **Run** | `/ud-map` |
| **Sub-agents** | None |
| **Changes project code** | No |

**Limits.** A reading tool: decisions are settled with ud-decide, then the map is rebuilt.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
