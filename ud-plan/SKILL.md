---
name: ud-plan
description: Turns the owner's settled decisions into a rework plan cut into lots — each lot a set of changes that can be done, checked and understood on its own, with its files, estimated size, order and dependencies, following the project's own working rules. Writes the plan; changes no code. Use when the owner types /ud-plan or asks how to split, order or schedule the design-system rework.
---

# ud-plan

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs settled **Decisions** (`/ud-decide`). Writes only `.ud/plan/`.

## Steps

1. **First cut.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/plan.mjs
   ```

   Writes `.ud/plan/lots.json` and `.ud/plan/plan.md`. The script groups settled decisions (other than `keep`) by kind, **Family** or token category, and **Zone**, and splits groups that touch too many files. Its titles, order and checks are generic.

2. **Read the project's working rules** (`workingRules` in the settings, and the files it points to). They set the real limits: how large one change may be, what must not be mixed in one change, what must be checked before it is proposed. The plan follows them; where a lot cannot, say so.

3. **Refine the lots.** For each lot, read the decisions and the files, then edit `lots.json`:
   - a title that says the result ("One Badge component with three tones"), not the activity;
   - **what is in and what is out**, so the lot can be reviewed on its own;
   - `check`: how the owner verifies it (which stories, which screens from the **Reach**, which states);
   - `effort` and `estimatedLines` from the files actually read, replacing the script's guess;
   - `dependsOn` and `order`: foundations before what uses them (a scale before the components that adopt it, a merged component before its stories), independent lots marked as such so they can be done in any order;
   - split a lot that is over the project's size limit along a line where each half is still useful alone; never split into "components", then "wiring", then "tests".
   Keep the ids and the status of lots that already exist.

   A settled `family-consolidation` is never one lot. Read its target (`work/targets/<Family>.json` in the run) and cut it so that the interface works after each lot: first the **Frames**, variants and pieces with their stories, touching no call site; then the members moved onto them, one look-alike group per lot, each with the call sites it changes; last the removal of what nothing uses any more. A member listed as `unread` in the target is read before it is put in a lot.

4. **What is left out, and why.** List decisions that could not be planned: a subject in a `readOnly` folder (`readOnlyBlocked`), a decision whose finding is gone, a choice whose note needs a design answer first.

5. **Rewrite `plan.md`** from the refined `lots.json`: a summary (number of lots, total estimated size, what the system gains), the ordered table, then one section per lot.

6. **Report**: the ordered table, the first lot you would start with and why, and what is left out. Then stop. The owner chooses whether and when to run `/ud-rework <lot id>`, or to do a lot by hand.

## Never

- Plan a change for a finding with no settled decision, or with the choice `keep`.
- Start the rework from this skill.
