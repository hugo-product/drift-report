# dr-decide

Puts open findings to the owner in groups of the same subject, with options and a recommendation, and records each answer in the decision ledger so later runs do not ask again.

| | |
|---|---|
| **Reads** | All findings of the run, `.dr/decisions.json` |
| **Writes** | `.dr/decisions.json`, `reports/decisions.md` |
| **Run** | `/dr-decide [kind, skill, family, component, zone \| deferred]` |
| **Sub-agents** | None |
| **Changes project code** | No |

**Limits.** Records only what the owner said. Silence is not a decision.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
