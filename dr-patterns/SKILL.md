---
name: dr-patterns
description: Finds pieces of interface that recur with nearly the same look across the project without being a component and without a story — matched by their styles, not by their name. Proposes to extract a component, make a variant of an existing one, or leave them. Read-only. Use when the owner types /dr-patterns or asks what is repeated in the UI but missing from the design system.
argument-hint: "[zone]"
---

# dr-patterns

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/dr-scan`).

## Steps

1. **Cluster.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/patterns-report.mjs
   ```

   Writes `findings/patterns.json`, `work/patterns.json` (every cluster with all its members) and `reports/patterns.md`. A cluster is a set of elements whose style classes are nearly the same, found in at least two files.

2. **Read the top of the list.** Many clusters are not **Patterns** worth a component: a centred flex row, a generic text style. Drop nothing; rank. What matters is a cluster with a distinct look (its own background, radius, border, padding and type together) and real **Reach**.

3. **Judge**, one agent per cluster or per group of related clusters, highest reach first. The agent reads five to eight member locations and answers:
   - is this one recognisable piece of interface (a list row, a stat tile, a section header) or a coincidence of utility classes;
   - what would its name and its props be, from what varies between the members (`varyingClasses`, different content);
   - is there already a component that does this (`nearestComponent`, or one the agent finds): then `variant-of-existing`, with what the existing component lacks;
   - otherwise `extract-component`, or `keep` when the repetition is small or the members are drifting apart on purpose.
   The proposed name and props go in `judgement`.

4. **Related clusters.** Two clusters that differ by one colour or one size are often one pattern with a variant. Say so and link their ids in `judgement`; do not merge findings by hand.

5. **Report**: the confirmed patterns by reach with a proposed name each, the ones covered by an existing component, what stayed unjudged, the path of `reports/patterns.md`. Say that the match is by classes: `/dr-render` can confirm on screen that the members really look alike. Next step: `/dr-decide patterns`.

## Limits to state

- Only static classes are seen. A look built from CSS files, inline styles or run-time class names is missed.
- Two elements with the same classes can still look different (different parents, different content), and the reverse.
