# ud-decide

Puts open findings to the owner in groups of the same subject, with options and a recommendation, and records each answer in the decision ledger so later runs do not ask again.

| | |
|---|---|
| **Reads** | All findings of the run, `.ud/decisions.json` |
| **Writes** | `.ud/decisions.json`, `reports/decisions.md` |
| **Run** | `/ud-decide [kind, skill, family, component, zone \| deferred]` |
| **Sub-agents** | None |
| **Changes project code** | No |

**Limits.** Records only what the owner said. Silence is not a decision.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
