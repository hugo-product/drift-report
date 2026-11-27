---
name: dr-render
description: Measures what is really rendered, in a browser — opens the stories (and screens when available) of chosen components or patterns, reads computed styles and takes captures per state, to confirm or refute what the code-only audit suspected (look-alike duplicates, patterns, raw values that match a token on screen, missing states). Slower than the other skills; run it on a narrowed target. Use when the owner types /dr-render or asks to check the real rendering.
argument-hint: "<finding id, component, family or pattern>"
---

# dr-render

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** and a target. This skill writes under the run's `render/` folder and `findings/render.json`.

## Before starting

- **A target is required**: finding ids, a component, a **Family** or a **Pattern**. With no argument, propose the ten findings where a look at the screen would change the recommendation most (duplicate candidates and patterns with confidence between 0.4 and 0.7, highest **Reach** first) and wait for the owner's pick.
- **A way to render.** Use the project's Storybook if it is already running (find the port in the project's launch configuration or its `storybook` script). If it is not running, ask before starting it, and stop it afterwards if you started it. Screens of the real app are used only when the owner says the local app is running and logged in as needed; never sign in, create data or act in an account for this.
- **Your own browser tab.** Never navigate a tab the owner is using.

## Steps

1. **List what to open.** For each target component: its stories, from the graph (`stories`, `shownIn`) and Storybook's `/index.json` for the story ids. For a pattern: the stories or screens that contain its members; if none renders a member, say that this member cannot be checked.

2. **Measure, do not eyeball.** For each story, in the story's iframe (`iframe.html?id=<story id>&viewMode=story`), at one phone width and one desktop width (take the breakpoints from the project's code):
   - computed styles of the component's root and its main parts: colour, background, border, radius, shadow, padding, gap, font family, size, weight, line height;
   - its size on screen;
   - each state that can be forced without acting on real data: hover, focus-visible (keyboard focus), disabled, and whatever the story's args expose.
   Save the numbers to `render/<target>.json` and one capture per story and width to `render/shots/`.

3. **Compare.**
   - Duplicate candidates and patterns: put the members' measurements side by side. Same measurements within a pixel or two and the same colours means they look the same on screen; list every difference otherwise.
   - Raw values: does the hard-coded value compute to the same colour or size as a token?
   - States: does the focus ring exist and is it visible against its background? Does disabled look different from rest?

4. **Write findings** (`findings/render.json`, the shape of `~/.claude/skills/dr-core/FORMATS.md`, `source: "agent"`):
   - `render-confirmed-duplicate`: subject = the same ids as the candidate it confirms, with the measurements as evidence;
   - `render-mismatch`: the code suggested a match that the screen refutes, or a story renders differently from the same component on a screen (a **Divergence**: describe both, name no winner).
   Then update the original finding's `confidence` and `judgement` with what was measured.

5. **Report**: for each target, confirmed, refuted or could not be checked, with the capture paths; then the next step (`/dr-decide`).

## Limits to state

- A story renders a component alone; on a real screen its parent can change how it looks. Say which of the two was measured.
- Animated, time-based or data-dependent states are only checked when a story freezes them.
- Captures are evidence for the owner, not a pixel-diff test.
