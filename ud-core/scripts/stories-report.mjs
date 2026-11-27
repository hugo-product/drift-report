#!/usr/bin/env node
// ud-stories: compares what the stories show with what the app really uses.
// Reads graph.json only; counts, never judges. Same input, same output.
//
//   node stories-report.mjs [--run <id>]     run from the project root
//
// Writes .ud/runs/<id>/findings/stories.json and reports/stories.md
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings, resolveRun, readJson, writeText, finding, writeFindings, mdTable, countBy } from "./lib.mjs";

const TABLE_CAP = 40;
const EVIDENCE_CAP = 10;

// Project settings override the suite defaults key by key.
function mergedSettings() {
  const defaults = readJson(fileURLToPath(new URL("../defaults.json", import.meta.url)), {});
  const settings = loadSettings();
  const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
  const merged = { ...settings };
  for (const [key, value] of Object.entries(defaults)) {
    if (isMap(value) && isMap(settings[key])) merged[key] = { ...value, ...settings[key] };
    else if (settings[key] === undefined) merged[key] = value;
  }
  return merged;
}

const settings = mergedSettings();
const run = resolveRun();
const graph = readJson(path.join(run.dir, "graph.json"));

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const components = graph.nodes.filter((node) => node.kind === "component").sort((a, b) => byText(a.id, b.id));
const storyNodes = graph.nodes.filter((node) => node.kind === "story").sort((a, b) => byText(a.id, b.id));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

const callSites = (component) => component.data.uses?.callSites ?? 0;
const reachOf = (component) => ({ screens: component?.data.screens ?? 0, uses: component ? callSites(component) : 0 });
const namedIn = (component) => component.data.stories ?? [];
const shownIn = (component) => component.data.shownIn ?? [];
const label = (component) => `${component.name} (${component.file})`;
const isLiteral = (value) => value !== "{…}" && value !== null && value !== undefined;

// Components each story file renders in its own JSX.
const renderedByStory = new Map();
for (const edge of graph.edges) {
  if (edge.kind !== "renders" || !edge.from.startsWith("y:")) continue;
  if (!renderedByStory.has(edge.from)) renderedByStory.set(edge.from, []);
  renderedByStory.get(edge.from).push(edge.to);
}

// What the stories that name a component show for each of its props.
function shownValues(component) {
  const values = new Map(); // prop -> Map(value -> [{ file, line, note }])
  const dynamicProps = new Set();
  let spreadArgs = false;
  let customRender = false;
  const note = (prop, value, entry) => {
    if (prop === "…") {
      spreadArgs = true;
      return;
    }
    if (!isLiteral(value)) {
      if (value === "{…}") dynamicProps.add(prop);
      return;
    }
    if (!values.has(prop)) values.set(prop, new Map());
    const slot = values.get(prop);
    const key = String(value);
    if (!slot.has(key)) slot.set(key, []);
    slot.get(key).push(entry);
  };
  for (const storyId of [...namedIn(component)].sort()) {
    const story = nodeById.get(storyId);
    if (!story) continue;
    for (const [prop, value] of Object.entries(story.data.metaArgs ?? {})) note(prop, value, { file: story.file, line: null, note: "shared args of the story file" });
    for (const entry of story.data.stories ?? []) {
      if (entry.hasRender) customRender = true;
      for (const [prop, value] of Object.entries(entry.args ?? {})) note(prop, value, { file: story.file, line: entry.line, note: `story ${entry.name}` });
    }
  }
  return { values, dynamicProps, spreadArgs, customRender };
}

const findings = [];

// ---- story-missing ----------------------------------------------------------

for (const component of components) {
  if (namedIn(component).length || shownIn(component).length || callSites(component) === 0) continue;
  const files = [...(component.data.uses.files ?? [])].sort();
  findings.push(finding({
    kind: "story-missing",
    title: `${component.name} has no story${component.readOnly ? " (read-only file)" : ""}`,
    subject: component.id,
    zone: component.zone,
    reach: reachOf(component),
    confidence: 0.9,
    evidence: [
      { file: component.file, line: component.line ?? null, note: "the component" },
      ...files.slice(0, EVIDENCE_CAP - 1).map((file) => ({ file, line: null, note: "uses it" })),
    ],
    options: [
      { key: "write-story", label: component.readOnly ? "Write a story (the component file itself is read-only and stays untouched)" : "Write a story for it" },
      { key: "keep", label: "Leave it without a story" },
    ],
    data: { component: component.id, readOnly: component.readOnly, screens: component.data.screens ?? 0, callSites: callSites(component), screenSample: component.data.screenSample ?? [] },
  }));
}

// ---- story-orphan -----------------------------------------------------------

for (const story of storyNodes) {
  const rendered = [...new Set(renderedByStory.get(story.id) ?? [])].sort().map((id) => nodeById.get(id)).filter(Boolean);
  const renderedUsed = rendered.filter((component) => callSites(component) > 0);
  const component = story.data.component ? nodeById.get(story.data.component) : null;
  let reason = null;
  let confidence = 0.8;
  let title = "";
  if (component) {
    if (callSites(component) > 0) continue;
    reason = "component-unused";
    title = `${story.file} documents ${component.name}, which no screen uses`;
  } else if (story.data.componentName) {
    reason = "component-unresolved";
    confidence = renderedUsed.length ? 0.4 : 0.6;
    title = `${story.file} names ${story.data.componentName}, which is not a scanned component`;
  } else {
    if (renderedUsed.length) continue; // no `component:` but it shows components the app uses
    reason = "no-component";
    confidence = 0.6;
    title = `${story.file} is not linked to any component`;
  }
  const firstLine = Math.min(...(story.data.stories ?? []).map((entry) => entry.line).filter(Boolean), Infinity);
  findings.push(finding({
    kind: "story-orphan",
    title,
    subject: story.id,
    zone: story.zone,
    reach: reachOf(component),
    confidence,
    evidence: [
      { file: story.file, line: Number.isFinite(firstLine) ? firstLine : null, note: `${(story.data.stories ?? []).length} stories` },
      ...(component ? [{ file: component.file, line: component.line ?? null, note: "0 call sites in the app" }] : []),
      ...renderedUsed.slice(0, 5).map((used) => ({ file: used.file, line: used.line ?? null, note: `the story file also renders ${used.name}, which the app uses` })),
    ].slice(0, EVIDENCE_CAP),
    options: [
      { key: "remove-story", label: "Remove the story file" },
      { key: "fix-link", label: component ? "Point the story at the component the app uses now" : "Set `component:` to the right component" },
      { key: "keep", label: "Leave it as it is" },
    ],
    data: {
      reason, story: story.id, title: story.data.title ?? null, componentName: story.data.componentName ?? null,
      component: component?.id ?? null, stories: (story.data.stories ?? []).length, readOnly: story.readOnly,
      rendersUsedComponents: renderedUsed.map((used) => used.id),
    },
  }));
}

// ---- story-outdated-arg -----------------------------------------------------

for (const story of storyNodes) {
  const component = story.data.component ? nodeById.get(story.data.component) : null;
  if (!component) continue;
  const props = new Set((component.data.props ?? []).map((prop) => prop.name));
  const inherited = component.data.extends ?? [];
  const propsUnknown = inherited.length === 0 && props.size === 0; // an untyped component: nothing to compare with
  const uses = new Map(); // arg -> evidence[]
  const note = (key, entry) => {
    if (key === "…" || props.has(key)) return;
    if (inherited.length && (key === "children" || key.startsWith("on"))) return;
    if (!uses.has(key)) uses.set(key, []);
    uses.get(key).push(entry);
  };
  for (const key of Object.keys(story.data.metaArgs ?? {})) note(key, { file: story.file, line: null, note: "shared args of the story file" });
  for (const entry of story.data.stories ?? []) for (const key of Object.keys(entry.args ?? {})) note(key, { file: story.file, line: entry.line, note: `story ${entry.name}` });
  for (const key of [...uses.keys()].sort()) {
    const sure = !inherited.length && !propsUnknown;
    findings.push(finding({
      kind: "story-outdated-arg",
      title: sure
        ? `${story.file} sets \`${key}\`, which is not a prop of ${component.name}`
        : `${story.file} sets \`${key}\`, which ${component.name} does not declare itself (it may come from an inherited type)`,
      subject: [story.id, `arg:${key}`],
      zone: story.zone,
      reach: reachOf(component),
      confidence: sure ? 0.9 : 0.4,
      evidence: uses.get(key).slice(0, EVIDENCE_CAP),
      options: [
        { key: "update-story", label: `Remove or rename \`${key}\` in the story` },
        { key: "keep", label: "Leave the story as it is" },
      ],
      data: {
        story: story.id, component: component.id, arg: key, usedIn: uses.get(key).length,
        declaredProps: [...props].sort(), inheritedTypes: inherited, propsFullyKnown: sure, readOnly: story.readOnly,
      },
    }));
  }
}

// ---- story-value-unused, story-value-missing, prop-value-unshown -------------

for (const component of components) {
  if (callSites(component) === 0) continue; // unused components belong to ud-components
  const shown = shownValues(component);
  const hasNamedStory = namedIn(component).length > 0;
  const spreads = component.data.uses.spreads ?? 0;
  for (const prop of component.data.props ?? []) {
    if (!prop.values?.length) continue;
    const declared = [...new Set(prop.values)];
    const app = component.data.uses.props?.[prop.name] ?? { count: 0, dynamic: 0, values: {} };
    const shownMap = shown.values.get(prop.name) ?? new Map();
    const appHidden = app.dynamic > 0 || spreads > 0; // the app may pass a value the scan cannot read
    const storyHidden = shown.dynamicProps.has(prop.name) || shown.spreadArgs || shown.customRender || shownIn(component).length > 0;
    const appValues = Object.entries(app.values ?? {}).sort((a, b) => b[1] - a[1] || byText(a[0], b[0]));
    const common = {
      component: component.id, prop: prop.name, declaredValues: declared,
      appValues: Object.fromEntries(appValues), appCallSitesWithProp: app.count, appDynamic: app.dynamic, appSpreads: spreads,
      storyValues: [...shownMap.keys()].sort(), readOnly: component.readOnly,
    };

    // A story shows a value the app never passes: a Divergence.
    if (app.count > 0) {
      for (const value of [...shownMap.keys()].sort()) {
        if (app.values?.[value]) continue;
        findings.push(finding({
          kind: "story-value-unused",
          title: `A story shows ${component.name} with ${prop.name}="${value}", which no screen uses`,
          subject: [component.id, `${prop.name}=${value}`],
          zone: component.zone,
          reach: reachOf(component),
          confidence: appHidden ? 0.5 : 0.8,
          evidence: shownMap.get(value).slice(0, EVIDENCE_CAP),
          options: [
            { key: "remove-story", label: "Remove this value from the stories" },
            { key: "keep", label: "Keep the story: it holds the intended design" },
          ],
          data: { ...common, value, divergence: true, declared: declared.includes(value), appMayPassItAtRunTime: appHidden },
        }));
      }
    }

    // The app passes a value no story shows.
    if (hasNamedStory) {
      for (const [value, count] of appValues) {
        if (shownMap.has(value)) continue;
        findings.push(finding({
          kind: "story-value-missing",
          title: `No story shows ${component.name} with ${prop.name}="${value}", used ${count} time${count === 1 ? "" : "s"} in the app`,
          subject: [component.id, `${prop.name}=${value}`],
          zone: component.zone,
          reach: { screens: component.data.screens ?? 0, uses: count },
          confidence: storyHidden ? 0.5 : 0.8,
          evidence: [
            { file: component.file, line: component.line ?? null, note: `${prop.name}="${value}" is passed at ${count} call site${count === 1 ? "" : "s"}` },
            ...[...(component.data.uses.files ?? [])].sort().slice(0, EVIDENCE_CAP - 1).map((file) => ({ file, line: null, note: `uses ${component.name}` })),
          ],
          options: [
            { key: "add-story", label: `Add a story with ${prop.name}="${value}"` },
            { key: "keep", label: "Leave it without a story" },
          ],
          data: { ...common, value, uses: count, divergence: true, declared: declared.includes(value), storyMayShowItAnotherWay: storyHidden },
        }));
      }
    }

    // A declared value nobody shows and nobody uses.
    for (const value of declared) {
      if (shownMap.has(value) || app.values?.[value]) continue;
      const looksDefault = value === "default";
      findings.push(finding({
        kind: "prop-value-unshown",
        title: `${component.name} declares ${prop.name}="${value}", which no story shows and no screen uses`,
        subject: [component.id, `${prop.name}=${value}`],
        zone: component.zone,
        reach: reachOf(component),
        confidence: looksDefault ? 0.3 : appHidden || storyHidden ? 0.4 : 0.7,
        evidence: [{ file: component.file, line: component.line ?? null, note: `${prop.name} accepts: ${declared.join(", ")}` }],
        options: [
          { key: "remove-value", label: `Remove "${value}" from ${prop.name}` },
          { key: "add-story", label: "Keep the value and add a story that shows it" },
          { key: "keep", label: "Leave it as it is" },
        ],
        data: { ...common, value, mayBeTheDefault: looksDefault, appMayPassItAtRunTime: appHidden, storyMayShowItAnotherWay: storyHidden },
      }));
    }
  }
}

// ---- Order and write --------------------------------------------------------

const KINDS = ["story-missing", "story-orphan", "story-outdated-arg", "story-value-unused", "story-value-missing", "prop-value-unshown"];
findings.sort((a, b) =>
  KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
  || b.reach.screens - a.reach.screens
  || b.reach.uses - a.reach.uses
  || byText(a.subject.join("|"), b.subject.join("|")));

const zoneNames = [...new Set(components.map((component) => component.zone))].sort();
const coverage = zoneNames.map((zone) => {
  const members = components.filter((component) => component.zone === zone);
  const named = members.filter((component) => namedIn(component).length);
  const renderedOnly = members.filter((component) => !namedIn(component).length && shownIn(component).length);
  const without = members.filter((component) => !namedIn(component).length && !shownIn(component).length);
  return {
    zone, components: members.length, used: members.filter((component) => callSites(component) > 0).length,
    named: named.length, renderedOnly: renderedOnly.length, without: without.length,
    withoutAndUsed: without.filter((component) => callSites(component) > 0).length,
  };
});
const total = (key) => coverage.reduce((sum, row) => sum + row[key], 0);
const byKind = Object.fromEntries(KINDS.map((kind) => [kind, findings.filter((item) => item.kind === kind).length]));
const summary = {
  run: run.id,
  components: components.length, storyFiles: storyNodes.length,
  stories: storyNodes.reduce((sum, story) => sum + (story.data.stories ?? []).length, 0),
  namedInStory: total("named"), onlyRenderedInStory: total("renderedOnly"), withoutStory: total("without"),
  withoutStoryAndUsed: total("withoutAndUsed"),
  findings: findings.length, byKind, coverage,
};
writeFindings(run.dir, "stories", findings, summary);

// ---- Report -----------------------------------------------------------------

const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
const confidenceText = (value) => (value === null ? "–" : value.toFixed(1));
const nameOf = (id) => {
  const node = nodeById.get(id);
  return node ? label(node) : id;
};
function section(title, intro, kind, headers, rowOf) {
  const items = findings.filter((item) => item.kind === kind);
  const lines = [`## ${title} (${items.length})`, "", intro, ""];
  if (!items.length) lines.push("Nothing found.");
  else {
    lines.push(mdTable(headers, items.slice(0, TABLE_CAP).map(rowOf)));
    if (items.length > TABLE_CAP) lines.push("", `${items.length - TABLE_CAP} more in \`findings/stories.json\`.`);
  }
  return lines.join("\n");
}
const zoneCounts = countBy(findings, (item) => item.zone).map(([zone, count]) => `${zone} ${count}`).join(", ");

const report = [
  `# Stories — Run ${run.id}`,
  "",
  "## Summary",
  "",
  `- ${components.length} components and ${storyNodes.length} story files (${summary.stories} stories) were read.`,
  `- Components named by a story (\`component:\`): ${summary.namedInStory}. Only rendered inside another story: ${summary.onlyRenderedInStory}. No story at all: ${summary.withoutStory}.`,
  `- **Missing story**: components the app uses with no story: ${byKind["story-missing"]}; prop values the app uses that no story shows: ${byKind["story-value-missing"]}.`,
  `- **Outdated story**: story files with no component the app uses behind them: ${byKind["story-orphan"]}; story args that are not props of their component: ${byKind["story-outdated-arg"]}; values shown in stories that no screen uses: ${byKind["story-value-unused"]}.`,
  `- Declared prop values that no story shows and no screen uses: ${byKind["prop-value-unshown"]}.`,
  `- A value that only one side has (the stories or the app) is a **Divergence**: neither side wins by default, each one waits for a **Decision**.`,
  `- ${findings.length} **Findings** in all${zoneCounts ? `, by **Zone**: ${zoneCounts}` : ""}. Every one offers "keep" as a choice.`,
  "",
  "## Story coverage by Zone",
  "",
  mdTable(
    ["Zone", "Components", "Used by the app", "Named by a story", "Only rendered in a story", "No story", "No story, and used"],
    [
      ...coverage.map((row) => [row.zone, row.components, row.used, `${row.named} (${percent(row.named, row.components)})`, row.renderedOnly, row.without, row.withoutAndUsed]),
      ["All", components.length, total("used"), `${total("named")} (${percent(total("named"), components.length)})`, total("renderedOnly"), total("without"), total("withoutAndUsed")],
    ],
  ),
  "",
  section(
    "Missing story: components",
    "Components the app uses that no story names or renders, by **Reach**. Components with no call site are left to ud-components. Options: write a story, or keep.",
    "story-missing",
    ["Component", "Zone", "Screens", "Call sites", "Read-only"],
    (item) => [nameOf(item.subject[0]), item.zone, item.reach.screens, item.reach.uses, item.data.readOnly ? "yes" : ""],
  ),
  "",
  section(
    "Outdated story: story files with nothing behind them",
    "Story files whose component could not be found, or whose component no screen uses. Options: remove the story, fix its link, or keep.",
    "story-orphan",
    ["Story file", "Zone", "Names", "Why", "Stories", "Confidence"],
    (item) => [
      item.subject[0].slice(2), item.zone, item.data.componentName ?? "(nothing)",
      { "component-unused": "its component has no call site in the app", "component-unresolved": "the named component was not found by the scan", "no-component": "no `component:` and it renders nothing the app uses" }[item.data.reason],
      item.data.stories, confidenceText(item.confidence),
    ],
  ),
  "",
  section(
    "Outdated story: args that are not props",
    "Story args whose name is not a prop of the component. Confidence 0.4 means the component inherits props from a type the scan does not open, so the arg may still be valid. Options: update the story, or keep.",
    "story-outdated-arg",
    ["Story file", "Component", "Arg", "Set in", "Confidence"],
    (item) => [item.data.story.slice(2), nodeById.get(item.data.component)?.name ?? "", `\`${item.data.arg}\``, `${item.data.usedIn} place${item.data.usedIn === 1 ? "" : "s"}`, confidenceText(item.confidence)],
  ),
  "",
  section(
    "Divergence: values shown in stories that no screen uses",
    "The story may hold the intended design, or be left over. Options: remove the value from the stories, or keep.",
    "story-value-unused",
    ["Component", "Zone", "Shown in a story", "The app uses", "Screens", "Call sites", "Confidence"],
    (item) => [
      nameOf(item.data.component), item.zone, `${item.data.prop}="${item.data.value}"`,
      Object.entries(item.data.appValues).map(([value, count]) => `${value} ×${count}`).join(", ") || "only values built at run time",
      item.reach.screens, item.reach.uses, confidenceText(item.confidence),
    ],
  ),
  "",
  section(
    "Missing story: values the app uses that no story shows",
    "Only for components that already have a story. Options: add a story, or keep.",
    "story-value-missing",
    ["Component", "Zone", "The app uses", "Times", "Stories show", "Screens", "Confidence"],
    (item) => [
      nameOf(item.data.component), item.zone, `${item.data.prop}="${item.data.value}"`, item.data.uses,
      item.data.storyValues.join(", ") || "no value for this prop", item.reach.screens, confidenceText(item.confidence),
    ],
  ),
  "",
  section(
    "Declared values nobody shows or uses",
    "A value a prop accepts that appears in no story and at no call site. It may be dead, or it may be the default applied when the prop is left out. Options: remove the value, add a story, or keep.",
    "prop-value-unshown",
    ["Component", "Zone", "Value", "All declared values", "Screens", "Call sites", "Confidence"],
    (item) => [nameOf(item.data.component), item.zone, `${item.data.prop}="${item.data.value}"`, item.data.declaredValues.join(", "), item.reach.screens, item.reach.uses, confidenceText(item.confidence)],
  ),
  "",
  "## Limits",
  "",
  "- Syntax only. Props that come from an imported type are listed as inherited, not opened: an arg can look outdated when it is not (confidence 0.4).",
  "- A prop passed through a spread or built at run time is counted, not resolved: a value can look unused when the app passes it that way (lower confidence).",
  "- Only args are read from stories. A value set inside a story's own render function, or through spread args, is not seen.",
  "- A prop left out at a call site takes its default value, which the scan does not know: a default can look unused.",
  "- Screens are counted per file through imports: every component in a reached file counts as reached.",
  "- A component with no call site is not listed here; ud-components reports it as unused.",
  "",
].join("\n");
writeText(path.join(run.dir, "reports", "stories.md"), report);

process.stdout.write(`${JSON.stringify({
  run: run.id, findings: findings.length, byKind,
  coverage: { components: components.length, namedInStory: summary.namedInStory, onlyRenderedInStory: summary.onlyRenderedInStory, withoutStory: summary.withoutStory },
  files: [path.join(".ud", "runs", run.id, "findings", "stories.json"), path.join(".ud", "runs", run.id, "reports", "stories.md")],
}, null, 1)}\n`);
