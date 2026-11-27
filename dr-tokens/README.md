# dr-tokens

Audits tokens and raw values: hard-coded colours, unused and undeclared tokens, recurring values with no token, and scale proposals for text size, spacing, radius and shadow drawn from real usage.

| | |
|---|---|
| **Reads** | The run's facts |
| **Writes** | `findings/tokens.json`, `reports/tokens.md` |
| **Run** | `/dr-tokens [zone or category]` |
| **Sub-agents** | A few, to judge scales, near-miss colours and font spellings |
| **Changes project code** | No |

**Limits.** Proposes only; never creates or removes a token. Tokens in a JavaScript Tailwind config are not read.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
