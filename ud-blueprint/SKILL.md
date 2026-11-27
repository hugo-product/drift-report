---
name: ud-blueprint
description: Proposes an overall structure for the project's design system — story tree, token levels, naming rules, component prop conventions, folder layout — by comparing what the audit found with well-known public design systems, each proposal citing its precedent. Every proposal is a decision for the owner, never applied. Use when the owner types /ud-blueprint, or asks for a restructuring proposal, best practices, or how known design systems would organise this.
argument-hint: "[refresh | story-tree | tokens | naming | props | folders]"
---

# ud-blueprint

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs a **Run**, and is far more useful after `ud-tokens`, `ud-components` and `ud-stories` have run. Writes `findings/blueprint.json` and `reports/blueprint.md`.

## The reference file

`~/.claude/skills/ud-core/references/reference-systems.md` describes how each **Reference system** is organised, with its sources and the date it was written. Read it whole before proposing anything.

- Cite only what the file states. A precedent you remember but the file does not hold is not cited; say "not in the reference file" and offer a refresh.
- **`refresh`**: re-read the public documentation of each system, update the file's facts and date, and list what changed. Ask before starting (it is slow and uses the web), and write to the suite's repository, not the project.

## Steps

1. **Describe what exists**, from the run, without judging:
   - the story tree: top-level groups from story titles, how many stories under each, groups that mix kinds of things;
   - token levels: which tokens hold raw values, which point to other tokens, whether component-level tokens exist, which measures have no tokens at all (from `findings/tokens.json`);
   - naming: the patterns in token names, component names, file names, and where they are inconsistent;
   - prop conventions: across components, the names used for size, variant or tone, and states, and the values of each (from the graph's `props` and `variants`): for example how many components say `size="sm"` and how many `size="small"`;
   - folders: where components live, and how that maps to **Zones** and **Families**.

2. **Compare with the references.** Start with the project's `referenceSystem` from the settings, then the others. For each of the five subjects: what the closest reference does, what most references agree on ("Cross-system patterns" in the file), and how the project differs. A difference is not a defect: say what it costs and what it buys.

3. **Propose a Blueprint**, one finding per subject (`blueprint-story-tree`, `blueprint-token-levels`, `blueprint-naming`, `blueprint-props`, `blueprint-folders`), each with:
   - the proposed structure, concrete: the actual tree, the actual level names, the actual prop vocabulary, with the project's own components and tokens placed in it;
   - the precedent, with the reference system's key and the source from the file;
   - what would change (how many stories retitled, tokens renamed, props renamed, files moved) and the **Effort**;
   - options: `adopt`, `adopt-partly` (the owner says which part), `keep`.
   `blueprint-folders` is always a separate finding and usually the largest effort: it can be declined without losing the rest. Use `finding()`'s shape with `source: "agent"`; the subject is the list of top-level groups, levels or folders concerned, so the id stays stable.

4. **One agent per subject** is reasonable when the project is large (five agents: see the Cost guard). Each gets the run's data for its subject and the reference file.

5. **Write `reports/blueprint.md`**: current state, proposal and precedent per subject, a before-and-after tree for the story tree and the folders, and a short "what known systems disagree on" so the owner sees where there is no single practice.

6. **Report** the five proposals in a short table (subject, what changes, effort, precedent). Next step: `/ud-decide blueprint`.

## Never

- Present a personal preference as a best practice. A practice is named with the systems that follow it.
- Propose moving or renaming files in a `readOnly` folder.
- Recommend adopting a reference system wholesale: the proposal fits this project's components and tokens.
