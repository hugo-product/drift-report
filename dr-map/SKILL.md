---
name: dr-map
description: Builds the map of the project's interface from the latest run — one self-contained interactive HTML page (explore components, screens, stories, tokens, findings and decisions, and how they connect) and a markdown map with Mermaid diagrams. No sub-agents. Use when the owner types /dr-map or asks for a map, a graph or a cartography of the UI or the design system.
---

# dr-map

Read `~/.claude/skills/dr-core/CONVENTIONS.md` first, then follow it. Needs a **Run** (`/dr-scan`). The map shows whatever findings exist: run it again after other skills to refresh it.

## Steps

1. **Build.**

   ```bash
   node ~/.claude/skills/dr-core/scripts/map.mjs
   ```

   Writes `map.html` in the run folder and `reports/map.md`. The page embeds the graph, the findings, the **Decision ledger** and the **Lots**; it works offline, with no server.

2. **Check it opens.** Open `map.html` in a browser tab of your own (never the owner's tab) and check: the overview counts match `run.json`, a search finds a known component, selecting it draws its neighbourhood, the findings table sorts. If the page is blank, read the browser console and report the error; do not hand over a broken map.

3. **Tell the owner** where the two files are and what each view is for:
   - Overview: the size of the system and story coverage per **Zone**;
   - Explorer: one component, who renders it, what it renders, its stories, its tokens, its findings;
   - Findings: everything found, sortable by **Reach** and **Effort**;
   - Tokens: every token with its value and use count;
   - Decisions: what is open, settled, applied, and the lots.

## Notes

- The page is a reading tool. Decisions are settled with `/dr-decide`, then the map is rebuilt to show them.
- `reports/map.md` renders in any markdown viewer that supports Mermaid. Its diagrams are capped so they stay readable; the HTML page holds everything.
- To compare two runs, use `/dr changed`, which writes `reports/changes.md`.
