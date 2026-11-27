---
name: dr-decide
description: Puts the audit's open findings to the owner, in groups of the same subject with the options and a recommendation each, and records every answer in the project's decision ledger so that later runs do not ask again. The owner settles; the skill never decides. Use when the owner types /dr-decide, or wants to arbitrate, settle or review audit findings.
argument-hint: "[kind, skill, family, component, zone | deferred]"
---

# dr-decide

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs findings from at least one audit skill. This skill writes only `.dr/decisions.json` (through the script) and `reports/decisions.md`.

## Steps

1. **What is open.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/decisions.mjs open [--kind <kind>] [--zone <zone>] [--focus <family, component, zone or path>]
   ```

   Narrow by the argument when one was given: `--focus` for a **Family**, a component, a **Zone** or a folder; `--kind` for a kind (a skill name means its kinds, listed in `~/.claude/skills/dr-core/FORMATS.md`). With no argument, do not start from the top of an alphabetical list of kinds: read `reports/brief.md` (run `brief.mjs` if it is missing) and propose the first component of "Where the open questions are". Tell the owner how many are open per kind and propose where to start: highest **Reach** first, and kinds whose answer unblocks others first (a scale before the raw values it would absorb, a duplicate before the stories of its members).

2. **Ask in rounds, one subject per round.** A round is 5 to 9 findings that belong together. The owner thinks in things on screen, so the default subject is one component or one **Family** with everything the audits found about it (its duplicates, its stories, its states), not one kind of finding across the whole project. System-wide subjects get their own rounds: one scale, the colours near one token. Within a round, put first the answers that make others moot: if two components merge, the stories of the one that goes need no answer. Findings that are the same question asked several times (five prop values of one component that no story shows) are asked as one line with one answer, then recorded one by one. For each finding give:
   - what was found, in one or two plain sentences, with the numbers from the finding;
   - for a **Divergence**: what each side shows, side by side, with no winner named;
   - the options, by their labels;
   - the recommendation and its reason when a judging agent gave one; when none did, say "no recommendation" instead of inventing one;
   - **Reach** and **Effort**.
   Number the findings. Accept short answers ("1 merge, 2 keep, 3 merge but keep the pink tone") and "same as recommended for all".

   A question about how two things look (a **Duplicate** candidate, a **Pattern**, a colour near a token) is hard to answer from a sentence. When its confidence is under 0.7 and nothing was measured, say so and offer `/dr-render` on it before asking; give the file and line of each side so the owner can open them.

3. **Record exactly what was said.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/decisions.mjs set <findingId> <optionKey> --note "<the owner's words>"
   ```

   or `set-many <file.json>` for a round, with the file written under the run's `work/` folder. Put the owner's own wording in `note` whenever they added a condition. An answer that fits no option is not forced into one: ask once, or record `keep` with the note if that is what they mean.

4. **"I have to ask someone" is an answer.** Much of what an interface audit finds is not the owner's to settle alone: a designer knows whether the pink tone is still wanted, a product owner whether a screen is being retired. Record it instead of leaving it open or forcing a `keep`:

   ```bash
   node ~/.claude/skills/dr-core/scripts/decisions.mjs defer <findingId> --note "<who or what is awaited, and the question>"
   ```

   A deferred **Decision** is not asked again in later rounds. `reports/decisions.md` lists them under "Waiting on someone", worded so the list can be sent to that person as it is. `/dr-decide deferred` goes through them (`decisions.mjs open --deferred`) once the answers are in.

5. **Never settle for the owner.** Silence is not `keep`. A finding the owner skipped stays open. "Decide for me" is answered with the recommendation and the question "shall I record these?", then recorded only on a yes.

6. **After each round**, say how many are settled, deferred and remaining, name the next subject and how many findings it holds, and ask before starting it. A person answers well for two or three rounds; past that, suggest stopping and planning what is settled. They can stop at any point: the ledger keeps everything.

7. **Close.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/decisions.mjs status
   ```

   Report the counts and the path of `reports/decisions.md`. Rebuild the map (`/dr-map`) so it shows the decisions. Next step: `/dr-plan`, which is worth running as soon as one subject is settled; it does not need every finding answered.

## Reopening

`decisions.mjs reopen <findingId>` puts a decision back to open. Do it when the owner changes their mind, or when `/dr changed` reports that the subject of a settled decision has changed.
