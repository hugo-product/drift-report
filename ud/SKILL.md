---
name: ud
description: Orchestrator of the UD suite, a UI and design-system audit. Says where a project stands (settings, last run, open decisions, lots) and runs the right ud-* skills in order — a full pass, a pass limited to what changed since the last run, or one named step. Use when the owner types /ud, or asks to audit the UI, the design system or Storybook of a project.
argument-hint: "[status | full | changed | <skill name>]"
---

# ud

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it.

## What to do, by argument

**No argument or `status`** — say where the project stands and stop:

1. Is there a `.ud/settings.json`? If not: "run `/ud-init`".
2. List the runs (`ls .ud/runs`), read the latest `run.json`: date, commit, counts. Compare its commit with `git rev-parse HEAD`.
3. Which finding files and reports exist in the latest run (which skills have run).
4. `node ~/.claude/skills/ud-core/scripts/decisions.mjs status` for open, settled and applied counts.
5. Lots in `.ud/plan/lots.json`, by status.
6. Recommend one next step and say why.

**`full`** — the complete pass. Announce the plan and the cost first (see Cost guard), wait for a yes, then run in this order, each step following its own skill file in `~/.claude/skills/<name>/SKILL.md`:

| Step | Skill | Sub-agents |
|---|---|---|
| 1 | `ud-scan` | none |
| 2 | `ud-tokens`, `ud-components`, `ud-stories`, `ud-states`, `ud-patterns` | scripts first, all five; then their judging agents, sent together |
| 3 | `ud-map` | none |
| 4 | `ud-decide` | none; this is where the owner answers |

Run the five scripts of step 2 before any judging, so the owner sees the counts and can narrow the judging (one **Zone**, the largest **Families**) before agents start. `ud-render`, `ud-blueprint`, `ud-plan` and `ud-rework` are never part of `full`: offer them at the end.

**`changed`** — the pass limited to what changed since the last **Run**:

1. `ud-scan` (always whole: it is fast and keeps the graph complete).
2. Re-run the five report scripts.
3. `node ~/.claude/skills/ud-core/scripts/diff-runs.mjs`: read `changedFiles`, new and gone findings.
4. Send judging agents only for new findings, or findings whose subject files are in `changedFiles`. Copy the agent fields (`effort`, `confidence`, `recommendation`, `judgement`, `source`) from the previous run for findings whose id and subject files did not change.
5. `ud-map`, then report from `reports/changes.md`: what is new, what is gone, which settled **Decisions** may need asking again.

**A skill name** (`tokens`, `ud-tokens`…) — run that skill alone.

## Rules

- Never start `full` without the owner's yes on the announced number of sub-agents.
- One step failing does not cancel the others: finish what is independent, then report the failure plainly.
- Finish with the path of `map.html` and of each report, and the single next step you recommend.
