# ud-scan

Reads the whole project once with a script and writes the graph and raw facts every other skill works from: components, props, variants, call sites, stories, tokens, classes, hard-coded values, screens.

| | |
|---|---|
| **Reads** | Every source file in the settings' folders |
| **Writes** | `.ud/runs/<id>/run.json`, `graph.json`, `facts/*.json` |
| **Run** | `/ud-scan` |
| **Sub-agents** | None |
| **Changes project code** | No |

**Limits.** Syntax only: props from imported types, run-time class names and spread props are counted, not resolved. Reach is counted per file.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
