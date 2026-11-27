#!/usr/bin/env node
// ud-components: reads the graph of a Run, sorts the components into Families and
// reports same-name components, Duplicate candidates and unused components.
//
//   node components-report.mjs [--run <id>]     run from the project root
//
// Writes .ud/runs/<id>/findings/components.json, work/families.json (the brief for
// the judging agents) and reports/components.md
import fs from "node:fs";
import path from "node:path";
import { loadSettings, resolveRun, readJson, writeJson, writeText, finding, writeFindings, mdTable, splitClass } from "./lib.mjs";

const root = process.cwd();
const defaults = readJson(new URL("../defaults.json", import.meta.url));
const settings = mergeSettings(defaults, loadSettings(root));
const run = resolveRun();

const graph = readJson(path.join(run.dir, "graph.json"));
const classFacts = readJson(path.join(run.dir, "facts", "classes.json"), { byFile: {} });
const fileFacts = readJson(path.join(run.dir, "facts", "files.json"), { files: [], imports: {} });

const thresholds = settings.thresholds ?? {};
const DUPLICATE_SCORE = thresholds.duplicateScore ?? 0.55;
const AUTO_FAMILY_MIN = thresholds.autoFamilyMembers ?? 4;
const WEIGHTS = { name: 0.3, props: 0.3, classes: 0.4 };
const TABLE_CAP = 40;
const NONE = "(none)";

// ---- Small helpers ----------------------------------------------------------

function mergeSettings(base, own) {
  const merged = { ...base, ...own };
  for (const [key, value] of Object.entries(base)) {
    const mine = own[key];
    if (value && typeof value === "object" && !Array.isArray(value) && mine && typeof mine === "object" && !Array.isArray(mine)) merged[key] = { ...value, ...mine };
  }
  return merged;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (number, digits = 2) => Number(number.toFixed(digits));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;
const sum = (list, valueOf) => list.reduce((total, item) => total + valueOf(item), 0);
function jaccard(a, b) {
  if (!a.size && !b.size) return null; // no signal either way
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}
function listNames(names) {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
function mainZone(members) {
  const zones = new Map();
  for (const member of members) zones.set(member.zone, (zones.get(member.zone) ?? 0) + 1);
  return [...zones.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0] ?? "unzoned";
}

// "GetTokensModal" -> ["Get", "Tokens", "Modal"]; "profile-card" -> ["Profile", "Card"]
function wordsOf(name) {
  return String(name)
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [])
    .map((word) => word[0].toUpperCase() + word.slice(1));
}

// ---- Components -------------------------------------------------------------

const IGNORED_PROPS = new Set(["children", "className"]);
const classSets = new Map();
function classSetOf(file) {
  if (!classSets.has(file)) {
    const set = new Set();
    for (const token of Object.keys(classFacts.byFile[file] ?? {})) {
      const { utility } = splitClass(token);
      if (utility) set.add(utility);
    }
    classSets.set(file, set);
  }
  return classSets.get(file);
}

const components = graph.nodes
  .filter((node) => node.kind === "component")
  .map((node) => {
    const data = node.data ?? {};
    const words = wordsOf(node.name);
    const stories = data.stories ?? [];
    const shownIn = data.shownIn ?? [];
    return {
      id: node.id, name: node.name, file: node.file, line: node.line ?? null, zone: node.zone, readOnly: Boolean(node.readOnly),
      exportName: data.exportName ?? null,
      callSites: data.uses?.callSites ?? 0,
      storyCallSites: data.uses?.storyCallSites ?? 0,
      screens: data.screens ?? 0,
      props: (data.props ?? []).map((prop) => prop.name),
      variants: data.variants ?? {},
      stories, shownIn,
      hasStory: stories.length > 0 || shownIn.length > 0,
      words,
      wordSet: new Set(words.map((word) => word.toLowerCase())),
      propSet: new Set((data.props ?? []).map((prop) => prop.name).filter((name) => !IGNORED_PROPS.has(name))),
    };
  })
  .sort((a, b) => cmp(a.id, b.id));
const byId = new Map(components.map((component) => [component.id, component]));

const rendersPairs = new Set();
for (const edge of graph.edges ?? []) if (edge.kind === "renders") rendersPairs.add(`${edge.from}>${edge.to}`);

// ---- Families ---------------------------------------------------------------

const familyWords = new Map(); // lower-case word -> family name
for (const word of settings.familyWords ?? []) familyWords.set(word.toLowerCase(), word);
const listed = (word) => familyWords.get(word.toLowerCase()) ?? (word.length > 3 && /s$/i.test(word) ? familyWords.get(word.toLowerCase().slice(0, -1)) : undefined);

// Extra families: a final word that 4+ components share and the list does not have.
const finalWords = new Map();
for (const component of components) {
  const last = component.words.at(-1);
  if (!last || component.words.length < 2 || listed(last)) continue;
  finalWords.set(last, (finalWords.get(last) ?? 0) + 1);
}
const autoFamilies = new Set();
for (const [word, count] of [...finalWords.entries()].sort((a, b) => cmp(a[0], b[0]))) {
  if (count < AUTO_FAMILY_MIN) continue;
  autoFamilies.add(word);
  familyWords.set(word.toLowerCase(), word);
}
function familyOf(component) {
  for (let index = component.words.length - 1; index >= 0; index -= 1) {
    const family = listed(component.words[index]);
    if (family) return family;
  }
  return NONE;
}
const familyMembers = new Map();
for (const component of components) {
  component.family = familyOf(component);
  if (!familyMembers.has(component.family)) familyMembers.set(component.family, []);
  familyMembers.get(component.family).push(component);
}
const families = [...familyMembers.entries()]
  .map(([name, members]) => ({ name, auto: autoFamilies.has(name), members: members.sort((a, b) => b.callSites - a.callSites || cmp(a.id, b.id)) }))
  .sort((a, b) => Number(a.name === NONE) - Number(b.name === NONE) || b.members.length - a.members.length || cmp(a.name, b.name));

writeJson(path.join(run.dir, "work", "families.json"), {
  run: run.id,
  families: families.map((family) => ({
    name: family.name,
    auto: family.auto,
    members: family.members.map((member) => ({
      id: member.id, name: member.name, file: member.file, zone: member.zone, readOnly: member.readOnly,
      callSites: member.callSites, screens: member.screens, props: member.props, variants: member.variants, hasStory: member.hasStory,
    })),
  })),
});

const findings = [];
const KEEP = { key: "keep", label: "Leave as it is" };
const reachOf = (members) => ({ screens: Math.max(0, ...members.map((member) => member.screens)), uses: sum(members, (member) => member.callSites) });
const memberEvidence = (members) => members.slice(0, 10).map((member) => ({
  file: member.file, ...(member.line ? { line: member.line } : {}),
  note: `${member.name}: ${plural(member.callSites, "call site")}, ${plural(member.screens, "screen")}${member.hasStory ? ", has a story" : ", no story"}${member.readOnly ? ", read-only" : ""}`,
}));
const memberData = (members) => members.map((member) => ({ id: member.id, name: member.name, file: member.file, zone: member.zone, readOnly: member.readOnly, callSites: member.callSites, screens: member.screens, hasStory: member.hasStory }));

// ---- same-name --------------------------------------------------------------

const sameNameKeys = new Set();
function sameNameFinding(members, match, label) {
  const ordered = [...members].sort((a, b) => cmp(a.id, b.id));
  const key = ordered.map((member) => member.id).join("|");
  if (sameNameKeys.has(key)) return;
  sameNameKeys.add(key);
  const folders = [...new Set(ordered.map((member) => path.posix.dirname(member.file)))].sort(cmp);
  findings.push(finding({
    kind: "same-name",
    title: match === "name"
      ? `${plural(ordered.length, "component")} are named ${label}, in ${plural(folders.length, "folder")}`
      : `${plural(folders.length, "folder")} each have a file named ${label}`,
    subject: ordered.map((member) => member.id),
    zone: mainZone(ordered),
    reach: reachOf(ordered),
    confidence: 1,
    evidence: memberEvidence(ordered),
    options: [
      { key: "rename", label: "Rename so that each name says what it is" },
      { key: "merge", label: "Merge them into one component" },
      KEEP,
    ],
    data: { match, name: label, folders, members: memberData(ordered) },
  }));
}
const byName = new Map();
const byBase = new Map();
for (const component of components) {
  const nameKey = component.name.toLowerCase();
  if (!byName.has(nameKey)) byName.set(nameKey, []);
  byName.get(nameKey).push(component);
  const base = path.posix.basename(component.file).replace(/\.[^.]+$/, "").toLowerCase();
  if (base === "index") continue;
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(component);
}
for (const [, members] of [...byName.entries()].sort((a, b) => cmp(a[0], b[0]))) {
  if (members.length >= 2) sameNameFinding(members, "name", members[0].name);
}
for (const [, members] of [...byBase.entries()].sort((a, b) => cmp(a[0], b[0]))) {
  const folders = new Set(members.map((member) => path.posix.dirname(member.file)));
  if (folders.size >= 2) sameNameFinding(members, "file-name", path.posix.basename(members[0].file));
}

// ---- duplicate-candidate ----------------------------------------------------

function scorePair(a, b) {
  const sameFile = a.file === b.file;
  const signals = {
    name: jaccard(a.wordSet, b.wordSet) ?? 0,
    props: jaccard(a.propSet, b.propSet),
    // Classes are counted per file, so two components of one file cannot be told apart.
    classes: sameFile ? null : jaccard(classSetOf(a.file), classSetOf(b.file)),
  };
  let weight = 0;
  let total = 0;
  let available = 0;
  for (const [key, value] of Object.entries(signals)) {
    if (value == null) continue;
    weight += WEIGHTS[key];
    total += WEIGHTS[key] * value;
    available += 1;
  }
  // A name alone is not a signal: with fewer than two signals the missing ones count as 0.
  const score = available >= 2 ? total / weight : total;
  return { score, signals, sameFile };
}

const parent = new Map();
const find = (id) => {
  while (parent.get(id) !== id) {
    parent.set(id, parent.get(parent.get(id)));
    id = parent.get(id);
  }
  return id;
};
const keptPairs = [];
let pairsScored = 0;
for (const family of families) {
  if (family.name === NONE) continue;
  const members = [...family.members].sort((a, b) => cmp(a.id, b.id));
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i];
      const b = members[j];
      pairsScored += 1;
      const { score, signals, sameFile } = scorePair(a, b);
      if (score < DUPLICATE_SCORE) continue;
      const sharedProps = [...a.propSet].filter((name) => b.propSet.has(name)).sort(cmp);
      const classesA = sameFile ? new Set() : classSetOf(a.file);
      const classesB = sameFile ? new Set() : classSetOf(b.file);
      keptPairs.push({
        a: a.id, b: b.id, family: family.name, score: round(score),
        name: round(signals.name), props: signals.props == null ? null : round(signals.props), classes: signals.classes == null ? null : round(signals.classes),
        sharedProps: sharedProps.slice(0, 20),
        sharedClasses: [...classesA].filter((item) => classesB.has(item)).length,
        sameFile,
        oneRendersTheOther: rendersPairs.has(`${a.id}>${b.id}`) || rendersPairs.has(`${b.id}>${a.id}`),
      });
      for (const id of [a.id, b.id]) if (!parent.has(id)) parent.set(id, id);
      parent.set(find(a.id), find(b.id));
    }
  }
}
const clusters = new Map();
for (const pair of keptPairs) {
  const key = find(pair.a);
  if (!clusters.has(key)) clusters.set(key, { pairs: [], ids: new Set() });
  const cluster = clusters.get(key);
  cluster.pairs.push(pair);
  cluster.ids.add(pair.a).add(pair.b);
}
for (const cluster of clusters.values()) {
  const members = [...cluster.ids].sort(cmp).map((id) => byId.get(id)).sort((a, b) => b.callSites - a.callSites || cmp(a.id, b.id));
  const pairs = cluster.pairs.sort((a, b) => b.score - a.score || cmp(a.a, b.a) || cmp(a.b, b.b));
  const confidence = round(sum(pairs, (pair) => pair.score) / pairs.length);
  const names = members.map((member) => member.name);
  const readOnly = members.filter((member) => member.readOnly).map((member) => member.id);
  findings.push(finding({
    kind: "duplicate-candidate",
    title: `${listNames(names)} look like the same component`,
    subject: members.map((member) => member.id).sort(cmp),
    zone: mainZone(members),
    reach: reachOf(members),
    confidence,
    evidence: memberEvidence(members),
    options: [
      { key: "merge", label: "Merge into one component; the others become variants" },
      { key: "variant", label: "Keep one as the base and add explicit variants" },
      { key: "keep", label: members.length === 2 ? "Keep both" : "Keep them all" },
    ],
    data: {
      family: pairs[0].family,
      members: memberData(members),
      pairs,
      readOnly,
      note: "A candidate from names, prop names and classes. A judging agent then reads the files to confirm the components play the same role.",
    },
  }));
}

// ---- component-unused -------------------------------------------------------

const importers = new Map(); // file -> files that import it
for (const [from, targets] of Object.entries(fileFacts.imports ?? {})) for (const target of targets) {
  if (!importers.has(target)) importers.set(target, []);
  importers.get(target).push(from);
}
const routingDir = settings.screens?.kind === "next-app" && settings.screens.dir ? `${settings.screens.dir.replace(/\/$/, "")}/` : null;
const sourceCache = new Map();
function sourceOf(file) {
  if (!sourceCache.has(file)) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      text = "";
    }
    sourceCache.set(file, text);
  }
  return sourceCache.get(file);
}
const mentions = (text, name) => (text.match(new RegExp(`(?<![\\w$.])${name.replace(/[^\w$]/g, "\\$&")}(?![\\w$])`, "g")) ?? []).length;
const STORY_FILE = /\.stories\.[a-z]+$/;
const componentsPerFile = new Map();
for (const component of components) componentsPerFile.set(component.file, (componentsPerFile.get(component.file) ?? 0) + 1);

for (const component of components) {
  if (component.callSites > 0 || component.storyCallSites > 0 || component.stories.length > 0 || component.shownIn.length > 0) continue;
  const reasons = [];
  const routingDefault = Boolean(routingDir) && component.file.startsWith(routingDir) && component.exportName === "default";
  if (routingDefault) reasons.push("It is the default export of a file under the routing directory, which the framework may load by convention.");
  // The name is mentioned without being rendered as a tag: passed as a value, kept in a map, loaded lazily…
  const isDefault = component.exportName === "default";
  const namedBy = (importers.get(component.file) ?? []).filter((file) => !STORY_FILE.test(file)).sort(cmp).filter((file) => {
    const text = sourceOf(file);
    // A default export has no name to look for: an importer counts when the file holds this component only.
    return isDefault ? componentsPerFile.get(component.file) === 1 : mentions(text, component.name) > 0;
  });
  if (namedBy.length) reasons.push(`Its name is mentioned in ${plural(namedBy.length, "file")} that import${namedBy.length === 1 ? "s" : ""} its file, without being rendered as a tag: it may be used dynamically.`);
  const own = sourceOf(component.file);
  const ownMentions = isDefault ? 0 : mentions(own.replace(new RegExp(`${component.name}\\.displayName`, "g"), ""), component.name);
  if (ownMentions > 1) reasons.push("Its name appears again in its own file, so it may be used there as a value.");
  const confidence = routingDefault ? 0.3 : namedBy.length ? 0.4 : ownMentions > 1 ? 0.6 : 0.85;
  findings.push(finding({
    kind: "component-unused",
    title: `${component.name} has no call site and no story`,
    subject: component.id,
    zone: component.zone,
    reach: { screens: component.screens, uses: 0 },
    confidence,
    evidence: [
      { file: component.file, ...(component.line ? { line: component.line } : {}), note: `${component.name} is declared here; no tag renders it in the scanned code or stories` },
      ...namedBy.slice(0, 9).map((file) => ({ file, note: `mentions ${isDefault ? "a default import of its file" : component.name} without rendering it as a tag` })),
    ],
    options: [{ key: "remove", label: "Remove the component" }, KEEP],
    data: {
      name: component.name, file: component.file, family: component.family, readOnly: component.readOnly,
      lowerConfidence: reasons.length > 0, reasons, namedBy: namedBy.slice(0, 20),
    },
  }));
}

// ---- Write ------------------------------------------------------------------

const KIND_ORDER = ["duplicate-candidate", "same-name", "component-unused", "variant-candidate"];
const weightOf = (entry) => entry.reach.uses * (entry.confidence ?? 0);
findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || weightOf(b) - weightOf(a) || (b.confidence ?? 0) - (a.confidence ?? 0) || cmp(a.subject.join("|"), b.subject.join("|")));
const of = (kind) => findings.filter((entry) => entry.kind === kind);
const byKind = Object.fromEntries(KIND_ORDER.map((kind) => [kind, of(kind).length]));
const summary = {
  run: run.id, components: components.length, families: families.filter((family) => family.name !== NONE).length,
  autoFamilies: [...autoFamilies].sort(cmp), withoutFamily: familyMembers.get(NONE)?.length ?? 0,
  pairsScored, findings: findings.length, byKind,
};
writeFindings(run.dir, "components", findings, summary);

// ---- Report -----------------------------------------------------------------

const lines = [];
const capped = (headers, rows, what, file = "findings/components.json") => {
  lines.push(mdTable(headers, rows.slice(0, TABLE_CAP)), "");
  if (rows.length > TABLE_CAP) lines.push(`${rows.length - TABLE_CAP} more ${what} are in \`${file}\`.`, "");
};
const duplicates = of("duplicate-candidate");
const unused = of("component-unused");
const sameNames = of("same-name");
const withStory = components.filter((component) => component.hasStory).length;
const none = familyMembers.get(NONE)?.length ?? 0;
const inDuplicates = new Set(duplicates.flatMap((entry) => entry.subject)).size;

lines.push("# Components", "", `Run ${run.id}. Every line below is a **Finding** for the owner to settle; nothing has been changed.`, "", "## Summary", "");
lines.push(`- ${plural(components.length, "component")}; ${withStory} shown in a story, ${components.length - withStory} not.`);
lines.push(`- ${summary.families} ${summary.families === 1 ? "**Family**" : "**Families**"} (${autoFamilies.size} found from shared final words: ${[...autoFamilies].sort(cmp).join(", ") || "none"}); ${plural(none, "component")} in no **Family**.`);
lines.push(`- ${plural(duplicates.length, "Duplicate candidate")} covering ${plural(inDuplicates, "component")} (score of ${DUPLICATE_SCORE} or more). They are candidates: a judging agent then reads the files to confirm they play the same role.`);
lines.push(`- ${plural(sameNames.length, "name")} shared by components or files in different folders.`);
lines.push(`- ${plural(unused.length, "component")} with no call site and no story; ${unused.filter((entry) => entry.data.lowerConfidence).length} of them with a lower confidence (routing file or possible dynamic use).`);
lines.push("- Variant candidates are not reported in this pass (see Limits).", "");

lines.push("## Families", "", "A component joins the **Family** of the last family word in its name (`PricingCard` is a Card).", "");
capped(["Family", "Members", "With a story", "Call sites", "Read-only", "Found automatically"], families.map((family) => [
  family.name, family.members.length, family.members.filter((member) => member.hasStory).length, sum(family.members, (member) => member.callSites),
  family.members.filter((member) => member.readOnly).length || "", family.auto ? "yes" : "",
]), "families", "work/families.json");

lines.push("## Same name in different places", "");
if (!sameNames.length) lines.push("None.", "");
else {
  lines.push("Options for each: rename, merge, or keep.", "");
  capped(["Name", "What matches", "Where", "Call sites", "Screens"], sameNames.map((entry) => [
    entry.data.name, entry.data.match === "name" ? "component name" : "file name",
    entry.data.members.map((member) => `${member.name} in ${member.file}`).slice(0, 4).join("; ") + (entry.data.members.length > 4 ? `; and ${entry.data.members.length - 4} more` : ""),
    entry.reach.uses, entry.reach.screens,
  ]), "shared names");
}

lines.push("## Duplicate candidates", "");
if (!duplicates.length) lines.push(`No pair inside a **Family** reaches the score of ${DUPLICATE_SCORE}.`, "");
else {
  lines.push(
    "Components of one **Family** that look alike by name, prop names and classes. These are candidates, not confirmed **Duplicates**: a judging agent then reads the files to confirm they play the same role for the person using the interface.",
    "",
    "Options for each: merge into one component (the others become variants), keep one base and add explicit variants, or keep them. Ordered by call sites × confidence. The three signals go from 0 (nothing shared) to 1 (identical); a dash means there was nothing to compare.",
    "",
  );
  const signal = (value) => (value == null ? "–" : value.toFixed(2));
  capped(["Components", "Family", "Confidence", "Call sites", "Screens", "Name", "Props", "Classes", "Files"], duplicates.map((entry) => {
    const best = entry.data.pairs[0];
    return [
      entry.data.members.map((member) => member.name).join(", "), entry.data.family, entry.confidence.toFixed(2), entry.reach.uses, entry.reach.screens,
      signal(best.name), signal(best.props), signal(best.classes),
      entry.data.members.map((member) => member.file).slice(0, 3).join(", ") + (entry.data.members.length > 3 ? `, and ${entry.data.members.length - 3} more` : ""),
    ];
  }), "candidates");
  lines.push("For a group of three or more, the signals shown are those of its closest pair; every pair is in the JSON.", "");
}

lines.push("## Components nothing uses", "");
if (!unused.length) lines.push("None.", "");
else {
  lines.push("No tag renders these components in the scanned code, and no story shows them. Options: remove, or keep. The confidence is lower when the component is the default export of a routing file, or when its name is mentioned without being rendered (it may be used dynamically).", "");
  capped(["Component", "File", "Family", "Confidence", "Why the confidence is lower"], [...unused].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || cmp(a.subject[0], b.subject[0])).map((entry) => [
    entry.data.name, entry.data.file, entry.data.family, entry.confidence.toFixed(2), entry.data.reasons.join(" "),
  ]), "unused components");
}

lines.push("## Limits", "");
lines.push("- Syntax only: the files are read, not run. Props that come from an imported type are listed under `extends`, not expanded, so they do not count in the prop comparison.");
lines.push("- Screens are counted per file through imports: every component in a reached file counts as reached.");
lines.push("- A prop passed through a spread or built at run time is counted, not resolved.");
lines.push("- A class string built at run time (`bg-${tone}`) is not seen. Classes are counted per file, so two components in the same file are compared by name and props only.");
lines.push("- A **Duplicate** candidate is a score, not a judgement: two components can share classes and props and still play different roles, and two real **Duplicates** with unlike code can be missed. Only components of the same **Family** are compared; the ones in no **Family** are not.");
lines.push("- A component rendered only through a value (a map of components, a prop, a lazy import the scan cannot follow) has no call site here. It is listed as unused with a lower confidence when its name is mentioned elsewhere.");
lines.push("- Variant candidates (call sites that often pass the same override) are skipped: the scan drops `className` at call sites and counts each prop on its own, not the combinations, so this cannot be drawn soundly from the data.", "");

writeText(path.join(run.dir, "reports", "components.md"), `${lines.join("\n")}\n`);

process.stdout.write(`${JSON.stringify({
  ...summary,
  wrote: ["findings/components.json", "work/families.json", "reports/components.md"].map((file) => path.relative(root, path.join(run.dir, file))),
}, null, 1)}\n`);
