# ud-states

Checks that components of one family handle and show the same states (rest, hover, focus, pressed, disabled, loading, empty, error, long text, open, closed).

| | |
|---|---|
| **Reads** | The run's graph and class facts; then the family's files |
| **Writes** | `findings/states.json`, `work/states.json`, `reports/states.md` |
| **Run** | `/ud-states [family]` |
| **Sub-agents** | One per family |
| **Changes project code** | No |

**Limits.** Evidence is static (a prop, a class variant, a story name). A state handled by a child or a library primitive is not seen until an agent reads the code.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
