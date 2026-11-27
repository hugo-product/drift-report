# dr-components

Groups components into families and finds duplicates by role, same-name components and unused components, with a confidence level and a merge or variant proposal.

| | |
|---|---|
| **Reads** | The run's graph and class facts; then the candidate files |
| **Writes** | `findings/components.json`, `work/families.json`, `reports/components.md` |
| **Run** | `/dr-components [family or zone]` |
| **Sub-agents** | One per duplicate cluster or family, to read the candidates side by side |
| **Changes project code** | No |

**Limits.** The script's score only says two components look alike in code; a duplicate is confirmed by reading them.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
