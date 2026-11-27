# dr-stories

Compares Storybook with the app: components with no story, stories for things no screen uses, args that no longer match, values the app uses that no story shows, and the reverse.

| | |
|---|---|
| **Reads** | The run's graph; then components and their stories |
| **Writes** | `findings/stories.json`, `reports/stories.md` |
| **Run** | `/dr-stories [family or zone]` |
| **Sub-agents** | One per component or small group, highest reach first |
| **Changes project code** | No |

**Limits.** A gap between a story and the app is reported as a divergence with both sides described; the skill names no winner and writes no story.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
