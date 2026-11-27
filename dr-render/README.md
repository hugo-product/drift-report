# dr-render

Measures the real rendering in a browser for a chosen target: computed styles and captures per state, to confirm or refute what the code-only audit suspected.

| | |
|---|---|
| **Reads** | Storybook stories (and local screens when the owner says they are available) |
| **Writes** | `render/*.json`, `render/shots/`, `findings/render.json` |
| **Run** | `/dr-render <finding, component, family or pattern>` |
| **Sub-agents** | Optional, one per target group |
| **Changes project code** | No |

**Limits.** Slow, so it needs a narrowed target. A story shows a component alone; a parent on a real screen can change its look.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
