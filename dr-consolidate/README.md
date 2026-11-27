# dr-consolidate

Works out what a large family of components really needs: which members are a frame, which only bring content, which draw the same frame again, where the frames differ, which inner pieces recur and what nothing uses. Proposes a target per family: a few frames, their variants, their pieces, and where each of today's components goes.

| | |
|---|---|
| **Reads** | The run's graph, `facts/elements.json`, `work/families.json` |
| **Writes** | `findings/consolidate.json`, `work/consolidate.json`, `work/targets/<Family>.json`, `reports/consolidate.md` |
| **Run** | `/dr-consolidate [family]` |
| **Sub-agents** | One per family, to read the members and write the target |
| **Changes project code** | No |

**Limits.** A frame is read from the classes of a component's outer element; one drawn by CSS files, inline styles, run-time classes or a library primitive is not seen. Families under four components are left to `dr-components`.

Instructions for Claude: [SKILL.md](./SKILL.md). Shared rules and formats: [dr-core](../dr-core/).
