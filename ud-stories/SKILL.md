---
name: ud-stories
description: Compares Storybook with the real app — components with no story, stories for things no screen uses, story args that no longer match the component, values the app uses that no story shows, and values only a story shows. Each gap between the two is a divergence for the owner to settle, never an automatic verdict. Read-only. Use when the owner types /ud-stories or asks which stories are missing, outdated or orphaned.
argument-hint: "[family or zone]"
---

# ud-stories

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/ud-scan`).

## Steps

1. **Count.**

   ```bash
   node ~/.claude/skills/ud-core/scripts/stories-report.mjs
   ```

   Writes `findings/stories.json` and `reports/stories.md`.

2. **Check the story count** once against Storybook's own index when one is at hand (a running Storybook serves `/index.json`; a static build has `index.json`). A large gap means the story globs in the settings are off. Do not start Storybook only for this.

3. **Judge**, highest **Reach** first, one agent per component or per small group of the same **Family**:
   - `story-outdated-arg`: read the component. Is the arg really gone (**Outdated story**), or does the prop come from an inherited type the scan could not expand (then confidence near 0 and `keep`)?
   - `story-value-unused` and `story-value-missing`: these are **Divergences**. The agent describes what the story shows and what the screens use, and does not pick a winner. It recommends an option only when the code gives a reason (a variant marked deprecated, a value used on one legacy screen).
   - `story-missing`: for the most reused components, list the states a first story should show, from the component's props, variants and call sites. This goes in `judgement`; no story is written here.
   - `story-orphan`: is the component reached in a way the scan cannot see?

4. **Report**: story coverage per **Zone**, the most reused components with no story, the divergences grouped by component, what stayed unjudged, the path of `reports/stories.md`. Next step: `/ud-decide stories`.

## Never

- Write, fix or delete a story. That is `ud-rework`, on a settled **Decision**.
- Say a story is "wrong" because the app differs, or the reverse.
