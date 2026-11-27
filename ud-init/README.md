# ud-init

Sets up the suite in a project: detects the stack, asks what only the owner knows (zones, read-only folders, working rules, reference system) and writes the project settings.

| | |
|---|---|
| **Reads** | `package.json`, the Storybook config, CSS files, top-level folders |
| **Writes** | `.ud/settings.json`, one line in `.git/info/exclude` |
| **Run** | `/ud-init` |
| **Sub-agents** | None |
| **Changes project code** | No |

**Limits.** First supported stack is React with Tailwind and Storybook. Tokens are read from CSS custom properties only.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [ud-core](../ud-core/).
