---
name: ud-rework
description: Applies one lot of the rework plan to the project — the only ud-* skill that changes code and stories. Works on one lot at a time, only from settled decisions, following the project's own working rules for branches, size and checks, and marks the decisions applied. Use only when the owner types /ud-rework with a lot id, or explicitly asks to apply a lot.
argument-hint: "<lot id>"
---

# ud-rework

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs `.ud/plan/lots.json` (`/ud-plan`). This is the one skill that edits project code and stories, and it does so one **Lot** at a time, on the owner's explicit request.

## Before touching a file

1. **A lot id is required.** With none, show the planned lots in order and ask which one. Never pick one yourself, never chain to the next lot without being asked.
2. **Read the lot**, its **Decisions** in `.ud/decisions.json` (including each `note`: the owner's conditions are part of the decision) and their findings.
3. **Check the lot is still true.** If the latest **Run**'s commit is behind the code, rescan (`node ~/.claude/skills/ud-core/scripts/scan.mjs`) and compare the lot's files with what is there now. If a file is gone, a component has changed shape, or a decision's finding has disappeared, stop and tell the owner what changed.
4. **Check its dependencies.** A lot whose `dependsOn` lots are not `done` is not started; say which are missing.
5. **Follow the project's working rules** (`workingRules` in the settings, and the project's own instruction files, which win over anything here): where the work goes (branch), how large one change may be, what to check, when to commit, when the owner reviews. If the lot is larger than the project allows, propose a split and wait.
6. **Say what will change** before changing it: the files, the visible result, the stories affected, the screens in the **Reach**. If the lot changes a shared component, name the screens that use it.

## Doing the lot

- Change only the lot's files. A file outside the lot that turns out to be needed is reported first; a `readOnly` file is never edited, whatever the lot says.
- Keep behaviour: a merge or a variant keeps every data source, handler and state the old components had. When two components differed in behaviour, the difference becomes an explicit prop, not a silent loss.
- Use existing tokens and components. A new token or shared component is created only when a settled decision says so, with the name the owner agreed.
- **Stories are part of the lot**: update the stories of every component touched, add one for each new variant or state, remove a story only when its decision says so. A story is never deleted to hide a difference.
- Apply the decision as settled, not a better idea. If doing it shows the decision was based on something untrue, stop and say so; the owner may reopen it (`decisions.mjs reopen`).

## Checking the lot

- Run the checks the project's rules ask for (types, lint, the tests that cover the files touched).
- Look at the result where it renders: the stories of each component touched and at least the most reused screen in its **Reach**, at each side of the breakpoints the change touches. Use your own browser tab.
- Follow the lot's `check`. Say exactly what was verified and what was not.

## Closing the lot

1. Mark each decision applied:

   ```bash
   node ~/.claude/skills/ud-core/scripts/decisions.mjs applied <findingId> --lot <lot id>
   ```

2. Set the lot's `status` to `done` in `.ud/plan/lots.json` (or leave `in-progress` and say what remains).
3. Rescan and run `/ud changed`, so the report shows which findings are gone and whether the change created new ones.
4. Report: what changed on screen, the files, the stories, the checks, what is left, and the next lot in order. Commit, push and review follow the project's rules; this skill never pushes or opens a review on its own.
