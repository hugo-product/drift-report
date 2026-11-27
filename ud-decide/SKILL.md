---
name: ud-decide
description: Puts the audit's open findings to the owner, in groups of the same subject with the options and a recommendation each, and records every answer in the project's decision ledger so that later runs do not ask again. The owner settles; the skill never decides. Use when the owner types /ud-decide, or wants to arbitrate, settle or review audit findings.
argument-hint: "[kind, skill, family or zone]"
---

# ud-decide

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs findings from at least one audit skill. This skill writes only `.ud/decisions.json` (through the script) and `reports/decisions.md`.

## Steps

1. **What is open.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/decisions.mjs open [--kind <kind>] [--zone <zone>]
   ```

   Narrow by the argument when one was given (a skill name means its kinds, listed in `~/.claude/skills/ud-core/FORMATS.md`). Tell the owner how many are open per kind and propose where to start: highest **Reach** first, and kinds whose answer unblocks others first (a scale before the raw values it would absorb, a duplicate before the stories of its members).

2. **Ask in rounds, one subject per round.** A round is 5 to 9 findings that belong together: one **Family**'s duplicates, one scale, the colours near one token. For each finding give:
   - what was found, in one or two plain sentences, with the numbers from the finding;
   - for a **Divergence**: what each side shows, side by side, with no winner named;
   - the options, by their labels;
   - the recommendation and its reason when a judging agent gave one; when none did, say "no recommendation" instead of inventing one;
   - **Reach** and **Effort**.
   Number the findings. Accept short answers ("1 merge, 2 keep, 3 merge but keep the pink tone") and "same as recommended for all".

3. **Record exactly what was said.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/decisions.mjs set <findingId> <optionKey> --note "<the owner's words>"
   ```

   or `set-many <file.json>` for a round, with the file written under the run's `work/` folder. Put the owner's own wording in `note` whenever they added a condition. An answer that fits no option is not forced into one: ask once, or record `keep` with the note if that is what they mean.

4. **Never settle for the owner.** Silence is not `keep`. A finding the owner skipped stays open. "Decide for me" is answered with the recommendation and the question "shall I record these?", then recorded only on a yes.

5. **After each round**, say how many are settled and how many remain, and go on to the next subject unless the owner stops. They can stop at any point: the ledger keeps everything.

6. **Close.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/decisions.mjs status
   ```

   Report the counts and the path of `reports/decisions.md`. Rebuild the map (`/ud-map`) so it shows the decisions. Next step: `/ud-plan` once enough is settled.

## Reopening

`decisions.mjs reopen <findingId>` puts a decision back to open. Do it when the owner changes their mind, or when `/ud changed` reports that the subject of a settled decision has changed.
