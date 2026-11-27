# UD formats

The contract between the scripts and the skills. Words in **bold** are defined in [GLOSSARY.md](./GLOSSARY.md). Every script runs from the project root, uses only Node built-ins plus the project's own `typescript`, and imports shared helpers from `scripts/lib.mjs`.

## Layout of `.ud/` in a project

```
.ud/
├── settings.json            Project settings (written by ud-init, edited by the owner)
├── decisions.json           Decision ledger (lasts across runs)
├── plan/
│   ├── lots.json            Lots (written by ud-plan)
│   └── plan.md
└── runs/<run id>/           One Run, id = YYYY-MM-DD-HHmmss
    ├── run.json             { id, scannerVersion, startedAt, commit, branch, dirty, dirtyFiles[], dirtyHashes{}, counts }
    ├── graph.json           { run, counts, nodes[], edges[] }
    ├── facts/               Raw facts from ud-scan (never edited by hand)
    │   ├── classes.json     { byFile: { file: { classToken: count } }, arbitrary: [{ file, line, token }] }
    │   ├── raw-values.json  { code: [{ file, line, value, kind: "hex"|"color-fn", context: "class"|"string" }], css: [...], inlineStyles: [{ file, line, props }] }
    │   ├── tokens.json      { tokens: [{ name, category, theme, declarations: [{ file, line, scope, value }], uses: { utility, var, css, total }, files[] }], undeclared: [{ name, uses, files[] }] }
    │   ├── elements.json    { elements: [{ file, line, tag, classes[], dynamic }] }   elements with 3+ static classes
    │   └── files.json       { files: [{ file, zone, screens }], imports: { file: [file] } }
    ├── findings/<skill>.json   { generatedBy, generatedAt, summary, findings[] }
    ├── work/                Briefs and intermediate data for judging agents
    ├── reports/<skill>.md   Reports for the owner, in the settings' report language
    ├── reports/brief.md     The one page to read first (brief.mjs); brief-<focus>.md for one part
    └── map.html             The interactive map (self-contained, works offline)
```

`.ud/` is excluded from Git through `.git/info/exclude`, so no tracked file changes.

## settings.json

```json
{
  "version": 1,
  "project": { "name": "…" },
  "stack": { "framework": "next", "styling": "tailwind-v4", "storybook": { "configDir": ".storybook", "storyGlobs": ["…"] } },
  "sourceDirs": ["app", "components"],
  "exclude": ["**/generated/**"],
  "tokenFiles": ["app/globals.css"],
  "screens": { "kind": "next-app", "dir": "app" },
  "zones": [{ "name": "product", "include": ["app/**"] }],
  "readOnly": ["slices/**"],
  "referenceSystem": "shadcn-radix",
  "reportLanguage": "en",
  "workingRules": "Free text: branch rules, lot size limits, checks to run before a commit.",
  "familyWords": ["…"], "expectedStates": {}, "stateKinds": {}, "thresholds": {}
}
```

`screens.kind` is `next-app` (with `dir`), `globs` (with `include`) or `none`. The last four keys are optional and override `ud-core/defaults.json` key by key. The first **Zone** whose `include` matches a file wins; a file matching none is `unzoned`.

## run.json

`dirtyFiles` lists the files that were uncommitted when the scan ran (untracked ones included), and `dirtyHashes` a short hash of each. With them, `diff-runs.mjs`, `carry.mjs` and `status.mjs` can tell what changed between two runs, or since the last one, even when nothing was committed in between: the usual case while an interface is being worked on.

## graph.json

Node: `{ id, kind, name, file, line?, zone, readOnly, data }`.

| kind | id | data |
|---|---|---|
| `component` | `c:<file>#<Name>` | `exportName`, `loc`, `props[{ name, optional, type, values[]\|null }]`, `extends[]`, `variants{ cvaName: { variant: [values] } }`, `uses{ callSites, files[], storyCallSites, spreads, props{ prop: { count, dynamic, values{ value: count } } } }`, `screens` (number of routes that reach its file), `screenSample[]`, `stories[]` (story node ids naming it in `component:`), `shownIn[]?` (story node ids rendering it) |
| `screen` | `s:<file>` | `route`, `screenKind` (`page`, `layout`, …), `files` |
| `story` | `y:<file>` | `title`, `componentName`, `component` (component id or null), `metaArgs`, `tags[]`, `stories[{ name, line, args, tags[], hasPlay, hasRender }]` |
| `token` | `t:<--name>` | `category`, `theme` (declared in `@theme`), `value`, `scopes[]`, `uses`, `files[]` |
| `module` | `m:<file>` | a non-component file that renders components |

Edge: `{ from, to, kind, count? }`, where kind is `renders` (from a component, screen, story or module to a component) or `documents` (story to the component it names).

Known limits of the scan, to repeat in reports where they matter:
- Syntax only. Props that come from an imported type are listed under `extends`, not expanded.
- `screens` is counted per file through imports: every component in a reached file counts as reached.
- A prop passed through a spread or built at run time is counted (`spreads`, `dynamic`), not resolved.
- A class string built at run time (`bg-${tone}`) is not seen.

## Finding

Made with `finding()` from `lib.mjs`. The `id` is stable across **Runs** (kind + subject), so the **Decision ledger** can refer to it.

```json
{
  "id": "duplicate-candidate-1a2b3c4d",
  "kind": "duplicate-candidate",
  "title": "Badge and StatusBadge look like the same component",
  "subject": ["c:components/ui/badge.tsx#Badge", "c:components/common/badge/status-badge.tsx#StatusBadge"],
  "zone": "product",
  "reach": { "screens": 12, "uses": 40 },
  "effort": null,
  "confidence": 0.7,
  "evidence": [{ "file": "…", "line": 3, "note": "…" }],
  "options": [{ "key": "merge", "label": "…" }, { "key": "keep", "label": "Keep both" }],
  "recommendation": null,
  "judgement": null,
  "source": "script",
  "data": {}
}
```

- `reach` is the **Reach**; `effort` is the **Effort** (`XS`, `S`, `M`, `L`).
- Scripts fill what can be counted. A judging agent may then set `effort`, `confidence`, `recommendation`, `judgement` and `source: "agent"`, and nothing else.
- `carriedFrom` (a run id) is set by `carry.mjs` when those fields were copied from an earlier **Run** because none of the **Finding**'s files changed. The counts are always the new run's.
- Every finding that offers a choice has at least two `options`, and one of them is always `keep` ("leave as it is"). A finding with no `options` is information only.

### Finding kinds

| Skill | Kinds |
|---|---|
| ud-tokens | `token-unused`, `token-undeclared`, `raw-color`, `recurring-value`, `scale-text-size`, `scale-spacing`, `scale-radius`, `scale-shadow`, `font-alias`, `breakpoint-oneoff`, `inline-style` |
| ud-components | `duplicate-candidate`, `same-name`, `component-unused`, `variant-candidate` |
| ud-stories | `story-missing`, `story-orphan`, `story-outdated-arg`, `story-value-unused`, `story-value-missing`, `prop-value-unshown` |
| ud-states | `state-missing`, `state-inconsistent` |
| ud-patterns | `pattern` |
| ud-render | `render-mismatch`, `render-confirmed-duplicate` |
| ud-blueprint | `blueprint-story-tree`, `blueprint-token-levels`, `blueprint-naming`, `blueprint-props`, `blueprint-folders` |

## decisions.json (Decision ledger)

```json
{
  "version": 1,
  "decisions": {
    "<finding id>": {
      "findingId": "…", "kind": "…", "title": "…", "subject": ["…"],
      "status": "settled",
      "choice": "merge",
      "note": "The owner's own words, if any",
      "decidedAt": "2026-11-27", "run": "2026-11-27-1601",
      "lot": null, "appliedAt": null
    }
  }
}
```

`status` is `open`, `deferred`, `settled` or `applied`. A finding with no entry is open. A `keep` choice is settled and never asked again unless its subject changes.

A `deferred` entry has no `choice`; its `note` says who or what is awaited ("Marie, design: is the pink tone still wanted?"). It is not asked again in the ordinary rounds, never goes into a **Lot**, and is listed in `reports/decisions.md` under "Waiting on someone" so the list can be sent as it is.

## plan/lots.json

```json
{
  "version": 1, "generatedAt": "…", "run": "…",
  "lots": [{
    "id": "lot-01", "title": "Merge the two Badge components",
    "decisions": ["<finding id>"], "files": ["…"], "readOnlyBlocked": [],
    "effort": "M", "estimatedLines": 180, "dependsOn": [], "order": 1,
    "check": "How to verify this lot on its own", "status": "planned"
  }]
}
```

`status` is `planned`, `in-progress` or `done`. A **Lot** never contains a file matched by `readOnly`; such a file goes to `readOnlyBlocked` with the decision left open.
