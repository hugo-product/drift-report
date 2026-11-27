# UD conventions

Every `ud-*` skill reads this file first. `UD_CORE` below means this folder: `~/.claude/skills/ud-core`.

## The rules that never bend

1. **Only `ud-rework` changes project code or stories.** Every other skill reads the project and writes inside `.ud/` only. At the end of any other skill, `git status` must show nothing new outside `.ud/`.
2. **No source wins by default.** When the app and Storybook disagree, or a token and the values really used, record a **Divergence** with its options and let the owner settle it. Never write "Storybook is wrong" or "the app is wrong"; write what each side shows. See [docs/adr/0001](./docs/adr/0001-no-default-source-of-truth.md).
3. **Scripts count, agents judge.** Numbers come from the scripts in `UD_CORE/scripts`. Never recount by hand or with grep and never correct a script's number in a report: if a number looks wrong, say so and name the script. Sub-agents are used only for judgement (same role? missing state? which option to recommend?).
4. **Read-only means read-only.** A file matched by `readOnly` in the **Project settings** is read and reported, never edited, and never put in a **Lot**.
5. **Nothing of one project goes into the suite.** Paths, **Zones**, team rules and names belong in `.ud/settings.json`. The skills and scripts stay project-neutral.
6. **Say what was checked and what was not.** Every report ends with its limits. A count from a syntax scan is exact for what the scan sees and silent about the rest (see "Known limits" in [FORMATS.md](./FORMATS.md)).

## Before any skill runs

- Work from the project root (the folder that holds `package.json`).
- If `.ud/settings.json` is missing, stop and say to run `/ud-init`.
- If the skill needs a **Run** and none exists, stop and say to run `/ud-scan`. If the latest run's commit differs from `git rev-parse HEAD`, say so in one line and offer to rescan; do not rescan unasked.
- Use the vocabulary of [GLOSSARY.md](./GLOSSARY.md) in every file written and every message. Talk to the owner in their language; write files in `reportLanguage` (default English).

## Running a script

```bash
node ~/.claude/skills/ud-core/scripts/<name>.mjs [--run <id>]
```

Scripts print a short JSON summary. Quote its numbers; do not paraphrase them into different numbers. A script that exits non-zero has failed: show its message and stop that step. Do not work around it by doing its job by hand.

## Judging with sub-agents

Use sub-agents when a judgement needs files to be read (two components side by side, a component and its stories). One agent per group that can be judged alone (a **Family**, a **Pattern**, a set of findings on one component). Send independent agents in one message so they run together.

Each brief gives: the finding ids and their data from `findings/*.json` or `work/*.json`, the file paths to read, the question, the allowed answers, and this instruction block:

> Read the files named. Do not edit anything. For each finding, answer only these fields: `effort` (XS, S, M or L), `confidence` (0 to 1), `recommendation` (one of the finding's option keys), `judgement` (two or three plain sentences: what each side shows, why you recommend this; no claim that one side is "right"). If you cannot tell, set confidence below 0.4 and say what is missing. Return a JSON array `[{ id, effort, confidence, recommendation, judgement }]` and nothing else.

Then merge the answers into the findings file: set those four fields and `source: "agent"`, leave everything else as the script wrote it. Drop an answer whose `recommendation` is not one of the finding's option keys, and say how many were dropped.

**Effort** scale: XS = one file, a few lines. S = a few files, no behaviour change. M = one component and its call sites. L = several components or a change to how screens are built.

## Cost guard

Before sending more than 5 sub-agents, tell the owner how many, what each group covers and roughly how long, and wait for a yes. A skill run alone on a narrowed target (one **Family**, one **Zone**) needs no question when it stays at 5 or fewer. Rank by **Reach** and judge the top of the list first; say what was left unjudged.

The number comes from a script, like every other number: `brief.mjs` prints the judging plan (`judging.ranked`: one line per group an agent would read, highest **Reach** first). Ask after the counts exist, never before: scripts are free and need no permission, agents are not.

A new **Run** starts with script-only **Findings**. Before judging anything on it, run `carry.mjs`: it brings forward the answers agents gave on the earlier **Run** for every **Finding** whose files did not change. Never copy those fields by hand, and never pay twice for the same reading.

## Reporting back

End each skill with: what was written and where (paths under `.ud/`), the three to five facts that matter most, what was not checked, and the next skill that makes sense. Keep it short; the report file holds the detail.

Write for a person who designs and builds interfaces. A fact names the thing on screen and what the number means for it ("Button is on 31 screens and no story shows its loading state"), not the kind of **Finding** and a count ("14 story-value-missing"). Kinds and ids are for the files and for the commands.
