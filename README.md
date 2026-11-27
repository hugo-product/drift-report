# dr-skills

A personal suite of Claude Code skills that audits a project's interface: the app code and its Storybook. It maps every component, story, token and screen, finds what is duplicated, missing, outdated or inconsistent, asks the owner to settle each finding, and plans the rework of the design system in lots.

It is built to be carried from one project to the next. Nothing of a project lives here: each project keeps its own settings, runs and decisions in a local `.dr/` folder, outside Git.

## Principles

- **The owner settles.** When the app and Storybook disagree, the suite describes both sides and asks. It never declares a winner ([why](./dr-core/docs/adr/0001-no-default-source-of-truth.md)).
- **Scripts count, agents judge.** Numbers come from scripts, so two runs can be compared. Sub-agents are used only where files must be read to judge.
- **One page first.** A pass ends on a brief that ranks what was found, by component and by **Reach**; the per-skill reports are the detail behind it.
- **Audit and rework are separate.** Fourteen skills only read. One, `dr-rework`, changes code, one lot at a time, on request.
- **Every report states its limits.**

## The skills

| Skill | What it does | Changes code |
|---|---|---|
| [`dr`](./dr/) | Orchestrator: status, full pass, one part in focus, changed-only pass, resume | No |
| [`dr-init`](./dr-init/) | Detects the stack and writes the project settings | No |
| [`dr-scan`](./dr-scan/) | Reads the project and writes the graph and raw facts | No |
| [`dr-tokens`](./dr-tokens/) | Tokens, hard-coded values, scale proposals | No |
| [`dr-components`](./dr-components/) | Families, duplicates by role, unused components | No |
| [`dr-stories`](./dr-stories/) | Storybook compared with the app | No |
| [`dr-states`](./dr-states/) | UI states compared within a family | No |
| [`dr-patterns`](./dr-patterns/) | Look-alike pieces of interface that are not components | No |
| [`dr-consolidate`](./dr-consolidate/) | What a large family really needs: frames, variants, pieces, and what is only content | No |
| [`dr-map`](./dr-map/) | Interactive HTML map and Mermaid map | No |
| [`dr-decide`](./dr-decide/) | Arbitration and the decision ledger | No |
| [`dr-plan`](./dr-plan/) | The rework plan, in lots | No |
| [`dr-render`](./dr-render/) | Real rendering measured in a browser | No |
| [`dr-blueprint`](./dr-blueprint/) | Overall structure compared with known design systems | No |
| [`dr-rework`](./dr-rework/) | Applies one lot | **Yes** |

[`dr-core`](./dr-core/) is not a skill: it holds the scripts, the formats, the conventions, the glossary and the reference file the skills share.

## The usual order

```
/dr-init                      once per project
/dr full                      scan and count (no question), choose how much is judged, get the brief and the map
/dr-consolidate Modal         "11 modals: 1 frame, a size variant, 2 pieces; 8 are only content"
/dr-decide Button             settle findings, a component or family at a time; "ask design" is an answer
/dr-plan                      cut the settled decisions into lots
/dr-rework lot-01             apply a lot, when you choose to
/dr changed                   later: what moved since the last run
/dr                           any time: where things stand and the one next step
```

Day to day, most of the use is smaller than a full pass:

```
/dr focus Button              everything the audits see about one family, component, zone or folder
/dr focus marketing
/dr resume                    finish a pass that was interrupted
```

`/dr-render` and `/dr-blueprint` are run on demand. Each skill can also be run alone.

## What a project gets

```
.dr/
├── settings.json        zones, read-only folders, working rules, reference system
├── decisions.json       every decision, kept across runs: settled, applied, or waiting on someone
├── plan/                the lots
└── runs/<date>/
    ├── graph.json       components, screens, stories, tokens and their links
    ├── facts/           raw facts from the scan
    ├── findings/        what each skill found
    ├── reports/         brief.md, the page to read first, then one report per skill
    └── map.html         the interactive map
```

Formats are described in [dr-core/FORMATS.md](./dr-core/FORMATS.md).

## Install

```bash
git clone <this repository> ~/Documents/dr-skills
```

```bash
~/Documents/dr-skills/install.sh
```

The script links every folder into `~/.claude/skills`. Use `./install.sh --copy` if your Claude Code does not load linked skills (run it again after each update), and `./install.sh --remove` to uninstall.

Requirements: Node 20 or later, and a project that has `typescript` installed (the scan uses the project's own copy). No other dependency is added anywhere.

## Supported projects

First supported stack: React (JSX or TSX), Tailwind classes, CSS custom properties as tokens, Storybook with CSF stories, and the Next.js app router or a list of globs for screens. Other stacks are added when a project needs them.

## Status

Written on 2026-11-27. The scripts were checked on a small made-up project only; they have not yet been run on a real one. Expect adjustments after the first real pass.
