# ud-patterns

Finds pieces of interface that recur with nearly the same look without being a component, matched by their styles and not by their name, and proposes a component, a variant of an existing one, or nothing.

| | |
|---|---|
| **Reads** | The run's element facts; then member locations |
| **Writes** | `findings/patterns.json`, `work/patterns.json`, `reports/patterns.md` |
| **Run** | `/ud-patterns [zone]` |
| **Sub-agents** | One per cluster or group of related clusters |
| **Changes project code** | No |

**Limits.** Matches static classes only. Whether members really look alike on screen is checked by ud-render.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
