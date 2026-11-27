---
name: dr-states
description: Checks that components of the same family handle and show the same UI states — rest, hover, focus, pressed, disabled, loading, empty, error, long text, open and closed. Flags a component lacking a state its siblings have, and states handled in code that no story shows. Read-only. Use when the owner types /dr-states or asks about inconsistent or missing UI states.
argument-hint: "[family]"
---

# dr-states

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/dr-scan`).

## Steps

1. **Count.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/states-report.mjs
   ```

   Writes `findings/states.json`, `work/states.json` (the evidence per component and state) and `reports/states.md` (one matrix per **Family**).

2. **Know what the evidence is.** The script marks a state as handled when it finds a prop named after it, a class variant for it (`hover:`, `focus-visible:`, `disabled:`…) or a story named after it. It cannot see a state handled by a child, a wrapper or a library primitive. Every "no evidence" cell is a question, not a fact.

3. **Judge**, one agent per family, largest and most reused first. The agent reads the members and answers for each `state-inconsistent` and `state-missing` finding:
   - is the state really missing, or handled where the scan cannot see (then `not-applicable` or `keep`, with the place it is handled);
   - does the state make sense for this component at all (a static badge has no loading state);
   - when it is missing and makes sense: what would adding it take (**Effort**).
   For keyboard focus, a missing visible focus on an interactive component is worth saying plainly: it is an accessibility gap, whatever the siblings do.

4. **Handled but not shown.** List the states that code handles and no story shows (the ◐ cells). They are candidates for `/dr-stories`; mention the count and the top ten, do not duplicate the findings.

5. **Report**: the matrices of the largest families, the confirmed gaps by **Reach**, what stayed unjudged, the path of `reports/states.md`. Next step: `/dr-decide states`.

## Settings that shape this skill

`expectedStates` (the states expected per kind of component) and `stateKinds` (which **Family** is which kind) come from the settings, falling back to `~/.claude/skills/dr-core/defaults.json`. If the owner disagrees with an expectation, change the settings, not the findings.
