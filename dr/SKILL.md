---
name: dr
description: Orchestrator of the DR suite, a UI and design-system audit. Says where a project stands and what to do next, and runs the right dr-* skills in order — a full pass, a look at one family, component or zone, a pass limited to what changed since the last run, or the rest of an interrupted pass. Use when the owner types /dr, or asks to audit the UI, the design system or Storybook of a project, or asks what is wrong with one component or one part of the interface.
argument-hint: "[status | full [zone] | focus <family, component, zone or path> | changed | resume | <skill name>]"
---

# dr

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. `DR_CORE` below is `~/.claude/skills/dr-core`.

The owner is a person with a design question, not an operator of fourteen skills. Three things follow, in every mode:

- **One page, not seven.** The owner is handed `reports/brief.md` and the map. The per-skill reports are where the brief sends them for detail, not what they are asked to read.
- **Never ask before the numbers exist.** The scan and the six counts are read-only, take seconds and use no sub-agent: run them without asking. The one question of a pass comes after, with real counts.
- **The owner can stop anywhere.** Every step leaves the **Run** usable and `/dr` says how to pick it up.

## What to do, by argument

### No argument, or `status`

```bash
node DR_CORE/scripts/status.mjs
```

It reads only and works before `/dr-init` and before the first **Run**. Do not rebuild its answer by listing folders or reading files. Say, in ten lines at most:

- the run it is talking about (date, how old, whether the interface code changed since);
- what waits: **Findings** open, with a recommendation, waiting on someone, settled but not planned; **Lots** ready and in progress;
- `next`: the command and its reason, as the script gives them, then the one or two entries of `then` as "or".

Then stop. Do not start `next` unasked.

### `full [zone]`

The complete pass. With a **Zone**, steps 3 to 6 are limited to it.

1. **Check where things stand** with `status.mjs`. If the latest **Run** is on the current code (`sinceRun.interfaceFilesChanged` is 0) and some of it is done, say so and continue it (see `resume`) instead of scanning again: a new scan starts a new **Run** and its judging would be paid for twice.

2. **Count, without asking.** `dr-scan` (its sanity check included), then the six report scripts (`tokens-report`, `components-report`, `stories-report`, `states-report`, `patterns-report`, then `consolidate-report`, which needs the Families of `components-report`), then, when an earlier **Run** exists, `carry.mjs`, then:

   ```bash
   node DR_CORE/scripts/brief.mjs [--focus <zone>]
   ```

3. **Show the counts and ask once.** From the brief's JSON, in a short message:
   - the size of the project and how many **Findings** wait for an answer;
   - the keyboard-focus gaps, when there are any, before anything else;
   - the five components where the open questions gather (`hotSpots`);
   - the **Families** worth consolidating, as `consolidate-report` printed them ("Modal: 11 components, 3 distinct Frames drawn"): for most projects this is where the largest simplification is;
   - the judging plan: `judging.groups` groups are unread. One sub-agent reads one group.

   Then offer, recommended first, and wait for the answer:
   - **The top of the list**: the first 5 groups of `judging.ranked` (5 sub-agents, a few minutes). Recommended whenever there are more than 8 groups: the list is ranked by **Reach**, so the first groups are the ones the owner will be asked about first anyway.
   - **One Zone or one Family**: name the two or three largest from `judging.perZone` and `hotSpots`.
   - **Everything**: all the groups, with the number of sub-agents said plainly.
   - **No judging**: the counts alone. The owner can still settle; nothing will carry a recommendation.

   With 5 groups or fewer, there is nothing to choose: say what will be read and go on.

4. **Judge** what was chosen. Each group belongs to one skill (`skill` in the plan): follow that skill's own file in `~/.claude/skills/<name>/SKILL.md` from its judging step on, for the listed finding ids only. Send independent agents together. After each wave, one line to the owner: what was read, what is left.

5. **Rebuild the two pages**: `brief.mjs` again (same `--focus`), then `dr-map`.

6. **Hand over**, then stop:
   - `reports/brief.md` and `map.html`, as the two things to open;
   - the three to five facts that matter most, each with its number: start with keyboard focus, then the largest **Family** consolidation with its proposed target, then the most reused component with the most open **Findings**, then the scales;
   - what was not read by an agent, in one line;
   - an offer of the first round, concrete and small: "Settle the Button family now? 7 Findings, about five minutes" (`/dr-decide <family>`). The pass does not walk into arbitration on its own: the owner may want to read the brief, look at the map or show it to a designer first.
   - when **Duplicate** candidates or **Patterns** sit between 0.4 and 0.7 confidence: offer `/dr-render` on them before they are settled, because a look at the screen is what changes those answers.

`dr-blueprint`, `dr-plan` and `dr-rework` are never part of `full`: name them at the end, do not run them.

### `focus <family, component, zone or path>`

The everyday mode: one part of the interface, end to end, in one conversation. "What is going on with our buttons", "audit the pricing page", "is the Card family consistent".

1. `status.mjs`. No **Run**, or interface files changed since: run step 2 of `full` first (scan, six scripts, carry). Otherwise use the latest **Run** as it is.
2. `node DR_CORE/scripts/brief.mjs --focus "<the word>"`. It writes `reports/brief-<word>.md`. If it finds nothing, list the **Families** and **Zones** that exist and ask which one was meant; do not guess.
3. Judge the focus's groups from `judging.ranked`. At 5 groups or fewer, no question (Cost guard); above, say the number and propose the first 5.
4. Rebuild the focus brief, then tell the owner what the audits see for this part, as a short story rather than five lists: which components it has and how reused they are, where they repeat each other, what the stories show and do not show, which states are missing, which hard-coded values and tokens they carry.
5. Offer to settle it now: `/dr-decide <the word>` asks only this part's **Findings**. For anything about how two things look, offer `/dr-render <the word>` first.

### `changed`

What moved since the last **Run**. If there is no earlier **Run**, say so and offer `full`.

1. `dr-scan` (always whole: it is fast and keeps the graph complete), then the six report scripts.
2. Bring the earlier answers forward. Never copy judging fields by hand:

   ```bash
   node DR_CORE/scripts/carry.mjs
   ```

   It copies the agents' answers for every **Finding** whose files did not change, and lists under `toReadAgain` the ones that must be read again.
3. `node DR_CORE/scripts/diff-runs.mjs`: new and gone **Findings**, changed files (uncommitted work included), settled **Decisions** to ask again.
4. Judge only what is new or listed in `toReadAgain`, under the Cost guard: 5 groups or fewer without a question, more with the number announced.
5. `brief.mjs`, `dr-map`, then report from `reports/changes.md`: what is new, what is gone, which settled **Decisions** may need asking again (offer `decisions.mjs reopen` for each, do not reopen unasked), and the next step from `status.mjs`.

### `resume`

Continue the latest **Run** where it stopped, without a new scan. `status.mjs` says what is missing: run the report scripts in `notRun`, then `brief.mjs`, then go on from step 3 of `full` with the groups still unread. If the interface code changed since the **Run**, say so and offer `changed` instead.

### A skill name (`tokens`, `dr-tokens`…)

Run that skill alone.

## Rules

- No sub-agent beyond the Cost guard's 5 without the owner's yes on a number that came from `brief.mjs`. Never estimate the number yourself.
- The scan failing stops the pass: nothing else can run. Any other step failing does not cancel the rest: finish what is independent, then report the failure plainly, with the script's message.
- Say numbers as the scripts give them. Say what a number means for the interface when it is not obvious ("9 of the 24 text sizes carry 90% of the uses"), never a bare table of kinds.
- Finish every mode with the two paths (brief, map) and the single next step. Give the other report paths only when asked.
- A long pass is told as it goes: one line when the counts are in, one per judging wave, one when the pages are rebuilt. Never several minutes of silence.
