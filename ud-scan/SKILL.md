---
name: ud-scan
description: Reads the whole project once with a script — every component, its props and variants, every call site, every story and its args, every token, every class and hard-coded value, every screen and what it reaches — and writes the graph and raw facts that all other ud-* skills work from. No sub-agents. Use when the owner types /ud-scan, before any other audit step, or after the code changed.
---

# ud-scan

Read `~/.claude/skills/ud-core/CONVENTIONS.md` first, then follow it. This skill starts a new **Run**. It uses no sub-agent and makes no judgement.

## Steps

1. From the project root:

   ```bash
   node ~/.claude/skills/ud-core/scripts/scan.mjs
   ```

   It writes `.ud/runs/<id>/run.json`, `graph.json` and `facts/*.json` and prints the run id and the counts. Lines on stderr starting with `ud-scan: skipped` name files it could not parse: list them.

2. **Sanity-check the counts** against the project, without recounting everything:
   - story files: compare with the number of files matching the Storybook globs;
   - screens: compare with the number of route files;
   - tokens: compare with a count of `--name:` lines in the token files.
   A gap larger than about 5% means a setting is off (a missing source folder, an excluded folder that holds stories). Say which, propose the settings change, and rescan after the owner agrees. Never patch the numbers.

3. **Report**: the counts in one table, the skipped files, the limits below, and the next step (`/ud-tokens`, `/ud-components`, `/ud-stories`, or `/ud full`).

## What the scan sees, and what it does not

Sees: exported components that render JSX, their props (when typed in the same file) and `cva`/`tv` variants; every JSX call site with its literal prop values; stories, their `component`, args and tags; CSS custom properties and where they are used (utility classes, `var()`); every class string; hard-coded colours; inline styles; screens and the files they import.

Does not see, and reports should say so where it matters:
- props that come from an imported type (listed as `extends`);
- anything built at run time: `bg-${tone}`, spread props, computed class names;
- which component of a file a screen really uses: **Reach** is counted per file;
- tokens defined in a JavaScript Tailwind config;
- rendered pixels. That is `ud-render`.
