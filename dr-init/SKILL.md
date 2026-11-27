---
name: dr-init
description: Sets up the DR suite in a project — detects the stack (framework, styling, Storybook, token files, screens), asks the owner what is specific to this project (zones, read-only folders, working rules, reference system) and writes .dr/settings.json. Use when the owner types /dr-init, before the first audit of a project, or to change the project settings.
---

# dr-init

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. This skill writes only `.dr/settings.json` and one line in `.git/info/exclude`.

## Steps

1. **Detect.** From the project root:

   ```bash
   node ~/.claude/skills/dr-core/scripts/detect.mjs
   ```

   It prints `{ proposal, detected, notes }` and writes nothing. If `.dr/settings.json` already exists, read it: this is an update, keep what the owner set and only propose changes.

2. **Check the proposal against the project.** Open the Storybook main file and the largest token file to confirm `storyGlobs` and `tokenFiles`. Look at the top-level folders to see whether the proposed `sourceDirs` miss interface code. Fix the proposal; do not ask the owner for facts you can read.

3. **Show the stack in a short table** (framework, styling, Storybook, token files, screens, source folders) with every note from `notes`. If the stack is not React with Tailwind, say plainly which skills will find little.

4. **Ask what only the owner knows**, in one round, each with a recommended answer:
   - **Zones**: the parts of the project a **Finding** should be filed under (for example product app, marketing, admin). Propose names and folders from the detected groups; order matters, the first match wins.
   - **Read-only**: folders the audit may read but the rework must never touch (generated code, content-managed sections, vendored code). Start from `detected.readOnlyHints`.
   - **Excluded**: folders to skip entirely.
   - **Reference system**: which known design system is closest, from the keys in `~/.claude/skills/dr-core/references/reference-systems.md`. Propose the detected one.
   - **Working rules**: how changes are made here (branch rules, size limits per change, checks before a commit). Read the project's `CLAUDE.md`, `AGENTS.md` or contributing guide first and propose a three-line summary instead of asking from nothing.
   - **Report language**, default English.
   - Optional overrides of `familyWords`, `expectedStates`, `stateKinds`, `thresholds` (defaults in `~/.claude/skills/dr-core/defaults.json`). Offer them; do not insist.

5. **Write `.dr/settings.json`** in the format of `~/.claude/skills/dr-core/FORMATS.md`.

6. **Exclude `.dr/` from Git** without touching a tracked file: if `detected.drExcluded` is false, append `.dr/` to the file `$(git rev-parse --git-dir)/info/exclude`. Never edit `.gitignore`. If the project is not a Git repository, say that changed-only passes will not be available.

7. **Report**: the settings in a short table, what the audit will not see on this stack, and the next step (`/dr-scan`, or `/dr full`).

## Limits to state

- First supported stack: React (JSX/TSX) with Tailwind classes and Storybook CSF stories. Tokens are read from CSS custom properties only; a JavaScript Tailwind config is not read.
- Screens are found for the Next.js app router, or from globs the owner gives.
