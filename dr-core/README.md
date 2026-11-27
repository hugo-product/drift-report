# dr-core

Not a skill: the shared folder every `dr-*` skill relies on.

| File | What it holds |
|---|---|
| [CONVENTIONS.md](./CONVENTIONS.md) | The rules every skill follows: who may change code, no default source of truth, scripts count and agents judge, the cost guard |
| [FORMATS.md](./FORMATS.md) | The layout of `.dr/`, the settings, the graph, findings, the decision ledger and lots |
| [GLOSSARY.md](./GLOSSARY.md) | The vocabulary of the suite |
| [defaults.json](./defaults.json) | Default family words, expected states and thresholds, overridable per project |
| [references/reference-systems.md](./references/reference-systems.md) | How well-known design systems are organised, with sources, for `dr-blueprint` |
| [docs/adr/](./docs/adr/) | Decisions about the suite itself |
| `scripts/` | The Node scripts (no dependencies; they use the audited project's own `typescript`) |

## Scripts

| Script | Used by | Does |
|---|---|---|
| `detect.mjs` | dr-init | Proposes settings from the project; writes nothing |
| `scan.mjs` | dr-scan | Writes the graph and the raw facts of a run |
| `tokens-report.mjs` | dr-tokens | Token and raw-value findings, scale proposals |
| `components-report.mjs` | dr-components | Families, duplicate candidates, unused components |
| `stories-report.mjs` | dr-stories | Missing, orphan and outdated stories, value gaps |
| `states-report.mjs` | dr-states | State evidence per component, gaps within a family |
| `patterns-report.mjs` | dr-patterns | Clusters of look-alike elements |
| `consolidate-report.mjs` | dr-consolidate | Per large family: frames, content-only members, look-alike groups, axes, recurring pieces |
| `map.mjs` | dr-map | The HTML map and the Mermaid map |
| `status.mjs` | dr | Where the project stands and the one next step; reads only |
| `brief.mjs` | dr | The one page over every audit, whole or for one focus, and the judging plan |
| `carry.mjs` | dr | Brings the agents' answers of the earlier run into a new one, where no file changed |
| `diff-runs.mjs` | dr | What changed between two runs, uncommitted work included |
| `decisions.mjs` | dr-decide, dr-rework | The decision ledger |
| `plan.mjs` | dr-plan | First cut of the lots |
| `lib.mjs` | all | Shared helpers |

All run from the project root: `node ~/.claude/skills/dr-core/scripts/<name>.mjs [--run <id>]`.
