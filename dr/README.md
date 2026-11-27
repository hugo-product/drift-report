# dr

The orchestrator. Says where a project stands and what to do next, and runs the other skills in order: a full pass, a look at one part of the interface, a pass limited to what changed since the last run, or the rest of an interrupted pass.

| | |
|---|---|
| **Reads** | `.dr/` (settings, runs, decisions, lots) |
| **Writes** | `reports/brief.md` in the run, through `brief.mjs`; each step writes its own files |
| **Run** | `/dr [status | full [zone] | focus <family, component, zone or path> | changed | resume | <skill>]` |
| **Sub-agents** | Those of the steps it runs. It counts first, then announces the number from the brief's judging plan and waits for a yes above 5 |
| **Changes project code** | No |

| Mode | For |
|---|---|
| `status` | "Where was I?" One script, one recommended next step |
| `full` | The first audit of a project, or of one zone |
| `focus Button` | One family, component, zone or folder, end to end in one conversation |
| `changed` | After some work: what is new, what is gone, which decisions to ask again |
| `resume` | A pass that was interrupted |

**Limits.** `full` stops at the brief and offers the first round of decisions; it does not start arbitration, render, blueprint, plan or rework unasked.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
