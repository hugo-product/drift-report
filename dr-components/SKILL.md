---
name: dr-components
description: Audits components — groups them into families, finds duplicates by role (not only by name or code), same-name components, unused components, and proposes what to merge or turn into variants, with a confidence level. Script first, then sub-agents read the candidates side by side. Read-only. Use when the owner types /dr-components or asks about duplicate, redundant or unused components.
argument-hint: "[family or zone]"
---

# dr-components

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/dr-scan`).

## Steps

1. **Count.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/components-report.mjs
   ```

   Writes `findings/components.json`, `work/families.json` and `reports/components.md`.

2. **Read `work/families.json`.** Fix obvious misfiling before judging: a component the script put in the wrong **Family** because of its name (a `CardSkeleton` is a skeleton, not a card). Note the corrections in the report; if the same mistake will recur, propose a `familyWords` change in the settings.

3. **Judge the duplicate candidates.** The script's score says two components look alike; only reading them says whether they are **Duplicates**, meaning they play the same role for the person using the interface. One agent per cluster (or per family when a family has several clusters), highest **Reach** first. Each agent:
   - reads every member file and two or three call sites of each;
   - answers: what is each one for, where do they really differ (behaviour, content, look), could one replace the other with a prop;
   - recommends `merge`, `variant` or `keep`, with **Effort** and confidence.
   Same role with different looks is still a duplicate; identical code serving two different roles is not.

   The score only decides what is read first, never what is read at all. A **Family** of six members or fewer is read whole by its agent even when no pair reaches the score: two components with unlike names, unlike props and the same job (a `Badge` taking `tone`, a `StatusBadge` taking `status`) are exactly what a score misses. For each pair the agent confirms, add a `duplicate-candidate` finding as in step 4.

4. **Look beyond the script.** The script only pairs components inside one family. Ask one agent to read the family table and name cross-family overlaps worth a look (a `Pill` and a `Badge`, a `Sheet` and a `Drawer`, a `Dialog` and a `Modal`). For each overlap it confirms by reading the files, add a `duplicate-candidate` finding with `source: "agent"`, using `finding()`'s shape and a subject made of the component ids.

5. **Unused components.** For the `component-unused` findings, check the ones with the largest files: is the component reached in a way the scan cannot see (lazy import by string, a registry, a route convention)? Lower the confidence and say why, rather than deleting the finding.

6. **Report**: the family table, the confirmed duplicates with what each merge would touch (call sites, screens, stories), what stayed unjudged, the path of `reports/components.md`. Next step: `/dr-decide components`.

## Never

- Recommend a merge from the score alone.
- Count a component kit's base component and the project's wrapper around it as duplicates without reading the wrapper: a thin wrapper is often the intended single entry point. Say what the wrapper adds.
