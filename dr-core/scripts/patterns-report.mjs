#!/usr/bin/env node
// dr-patterns: finds Patterns, pieces of interface that recur with nearly the
// same look without being a component. Works on the static classes of elements
// (facts/elements.json): look-alike by classes, not by pixels.
//
//   node patterns-report.mjs [--run <id>]     run from the project root
//
// Writes .dr/runs/<id>/findings/patterns.json, work/patterns.json and reports/patterns.md
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings, resolveRun, readJson, writeJson, writeText, finding, writeFindings, mdTable, countBy, splitClass, zoneOf } from "./lib.mjs";

const TABLE_CAP = 40;
const EVIDENCE_CAP = 10;
const SUBJECT_CAP = 30;
const MEMBER_CAP = 50;
const NEAREST_MIN = 0.5;
const STORY_RE = /\.stories\.(tsx?|jsx?|mjs)$/;

// Layout-neutral noise: utilities that say nothing about how an element looks.
// They are dropped from the signature, whatever their variant prefix.
const NOISE = new Set([
  "relative", "static", "isolate", "block", "inline-block", "contents",
  "w-full", "h-full", "size-full", "min-w-0", "min-h-0", "max-w-full", "w-auto", "h-auto",
  "shrink-0", "shrink", "grow", "grow-0", "flex-1", "flex-none", "flex-auto", "flex-shrink-0", "flex-grow",
  "mx-auto", "overflow-hidden", "overflow-visible",
  "group", "peer", "cursor-pointer", "select-none", "pointer-events-none", "pointer-events-auto",
  "transition", "transition-all", "transition-colors", "transition-opacity", "transition-transform", "transition-shadow",
  "will-change-transform", "transform", "transform-gpu", "antialiased", "sr-only", "not-sr-only",
]);
const NOISE_PREFIXES = ["z-", "duration-", "ease-", "delay-", "order-"];

// "Look" utilities weigh more than pure layout ones in the similarity.
const LOOK_WEIGHT = 3;
const LAYOUT_WEIGHT = 1;
const LOOK_RE = /^-?(bg|text|border|rounded|shadow|inset-shadow|drop-shadow|font|ring|outline|from|via|to|fill|stroke|divide|decoration|tracking|leading|opacity|backdrop|blur|p|px|py|pt|pr|pb|pl|ps|pe|gap|gap-x|gap-y|space-x|space-y)(-|$)/;
const LOOK_EXACT = new Set(["uppercase", "lowercase", "capitalize", "italic", "underline", "line-through"]);
const NOT_LOOK_RE = /^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;

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
const thresholds = settings.thresholds ?? {};
const MIN_CLASSES = thresholds.patternMinClasses ?? 5;
const MIN_MEMBERS = thresholds.patternMinMembers ?? 3;
const SIMILARITY = thresholds.patternSimilarity ?? 0.8;

const run = resolveRun();
const graph = readJson(path.join(run.dir, "graph.json"));
const allElements = readJson(path.join(run.dir, "facts", "elements.json"), { elements: [] }).elements ?? [];
const fileFacts = readJson(path.join(run.dir, "facts", "files.json"), { files: [] }).files ?? [];
const classesByFile = readJson(path.join(run.dir, "facts", "classes.json"), { byFile: {} }).byFile ?? {};

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (value) => Math.round(value * 100) / 100;
const screensOfFile = new Map(fileFacts.map((entry) => [entry.file, entry.screens ?? 0]));

// ---- Signatures ---------------------------------------------------------------

const classInfo = new Map(); // token -> { noise, look, weight }
function infoOf(token) {
  if (!classInfo.has(token)) {
    const { utility } = splitClass(token);
    const noise = NOISE.has(utility) || NOISE_PREFIXES.some((prefix) => utility.startsWith(prefix));
    const look = !noise && !NOT_LOOK_RE.test(utility) && (LOOK_RE.test(utility) || LOOK_EXACT.has(utility));
    classInfo.set(token, { noise, look, weight: look ? LOOK_WEIGHT : LAYOUT_WEIGHT });
  }
  return classInfo.get(token);
}
const weightOf = (token) => infoOf(token).weight;
const isLook = (token) => infoOf(token).look;
// The set of an element's classes, variant prefixes kept, noise removed, order ignored.
const signatureOf = (classes) => [...new Set(classes.filter((token) => !infoOf(token).noise))].sort();
const totalWeight = (tokens) => tokens.reduce((sum, token) => sum + weightOf(token), 0);
function similarity(aTokens, bSet, bWeight) {
  let shared = 0;
  let aWeight = 0;
  for (const token of aTokens) {
    const weight = weightOf(token);
    aWeight += weight;
    if (bSet.has(token)) shared += weight;
  }
  const union = aWeight + bWeight - shared;
  return union ? shared / union : 0;
}

const elements = allElements
  .filter((element) => !STORY_RE.test(element.file))
  .map((element) => ({ ...element, signature: signatureOf(element.classes) }))
  .filter((element) => element.signature.length >= MIN_CLASSES)
  .sort((a, b) => byText(a.file, b.file) || a.line - b.line || byText(a.tag, b.tag));

// How many elements carry each class: a rare class tells more than a common one.
const frequency = new Map();
for (const element of elements) for (const token of element.signature) frequency.set(token, (frequency.get(token) ?? 0) + 1);
const byRarity = (a, b) => frequency.get(a) - frequency.get(b) || byText(a, b);

// ---- Clustering ---------------------------------------------------------------
// 1. Elements with exactly the same signature form a group.
// 2. Groups are taken from the largest to the smallest (ties: by signature text).
//    Each group joins the existing cluster whose representative (the signature of
//    the cluster's first, largest group) is most similar, if the weighted Jaccard
//    reaches the threshold; otherwise it starts a new cluster.
// To avoid comparing every group with every cluster (too slow on ~20k elements),
// candidates come from an index of class -> clusters, probed with the group's
// rarest classes only. This loses nothing: if J(A, B) >= t then the classes of A
// missing from B weigh at most (1 - t) * weight(A), so any set of A's classes
// weighing more than that must contain a class of B. Comparing with
// representatives only keeps the result independent of merge order inside a cluster.

const groups = new Map();
for (const element of elements) {
  const key = element.signature.join(" ");
  if (!groups.has(key)) groups.set(key, { key, signature: element.signature, members: [] });
  groups.get(key).members.push(element);
}
const orderedGroups = [...groups.values()].sort((a, b) => b.members.length - a.members.length || byText(a.key, b.key));

const clusters = []; // { representative, set, weight, members: [{ element, similarity }] }
const clustersByClass = new Map(); // token -> [cluster index]
for (const group of orderedGroups) {
  const weight = totalWeight(group.signature);
  const budget = (1 - SIMILARITY) * weight;
  const candidates = new Set();
  let probed = 0;
  for (const token of [...group.signature].sort(byRarity)) {
    for (const index of clustersByClass.get(token) ?? []) candidates.add(index);
    probed += weightOf(token);
    if (probed > budget + 1e-9) break;
  }
  let best = -1;
  let bestScore = 0;
  for (const index of [...candidates].sort((a, b) => a - b)) {
    const score = similarity(group.signature, clusters[index].set, clusters[index].weight);
    if (score >= SIMILARITY && score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  if (best < 0) {
    best = clusters.length;
    bestScore = 1;
    clusters.push({ representative: group.signature, set: new Set(group.signature), weight, members: [] });
    for (const token of group.signature) {
      if (!clustersByClass.has(token)) clustersByClass.set(token, []);
      clustersByClass.get(token).push(best);
    }
  }
  for (const element of group.members) clusters[best].members.push({ element, similarity: bestScore });
}

// ---- Existing components ------------------------------------------------------

const components = graph.nodes.filter((node) => node.kind === "component").sort((a, b) => byText(a.id, b.id));
const componentsByFile = new Map();
for (const component of components) {
  if (!componentsByFile.has(component.file)) componentsByFile.set(component.file, []);
  componentsByFile.get(component.file).push(component);
}
for (const list of componentsByFile.values()) list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || byText(a.id, b.id));
const componentAt = (file, line) => {
  const list = componentsByFile.get(file) ?? [];
  return [...list].reverse().find((component) => (component.line ?? 0) <= line) ?? list[0] ?? null;
};
// What each component file looks like: every element in it, and all its classes together.
const componentFileLooks = [...componentsByFile.keys()].sort().map((file) => {
  const fileSignature = signatureOf(Object.keys(classesByFile[file] ?? {}));
  return {
    file,
    whole: { set: new Set(fileSignature), weight: totalWeight(fileSignature) },
    elements: allElements.filter((element) => element.file === file).map((element) => {
      const signature = signatureOf(element.classes);
      return { line: element.line, set: new Set(signature), weight: totalWeight(signature) };
    }),
  };
});
// The component whose file holds the element (or, failing that, the class set) most like the pattern.
function nearestComponent(representative) {
  let best = null;
  for (const look of componentFileLooks) {
    let score = similarity(representative, look.whole.set, look.whole.weight);
    let line = 0;
    for (const element of look.elements) {
      const elementScore = similarity(representative, element.set, element.weight);
      if (elementScore > score) {
        score = elementScore;
        line = element.line;
      }
    }
    if (score >= NEAREST_MIN && (!best || score > best.score)) best = { score, file: look.file, line };
  }
  if (!best) return null;
  const component = componentAt(best.file, best.line);
  return component ? { id: component.id, name: component.name, file: component.file, similarity: round(best.score), callSites: component.data.uses?.callSites ?? 0 } : null;
}

// ---- Patterns -----------------------------------------------------------------

const patterns = [];
for (const cluster of clusters) {
  const members = [...cluster.members].sort((a, b) => byText(a.element.file, b.element.file) || a.element.line - b.element.line);
  const files = [...new Set(members.map((member) => member.element.file))].sort();
  if (members.length < MIN_MEMBERS || files.length < 2) continue; // all in one file: nothing to extract across files
  const counts = new Map();
  for (const member of members) for (const token of member.element.signature) counts.set(token, (counts.get(token) ?? 0) + 1);
  const shared = [...counts.keys()].filter((token) => counts.get(token) === members.length).sort();
  const varying = [...counts.keys()].filter((token) => counts.get(token) < members.length).sort((a, b) => counts.get(b) - counts.get(a) || byText(a, b));
  const tag = countBy(members, (member) => member.element.tag)[0][0];
  const sharedLook = shared.filter(isLook).sort(byRarity);
  const telling = (sharedLook.length ? sharedLook : cluster.representative.filter(isLook).sort(byRarity)).slice(0, 4);
  const tellingOrAny = telling.length ? telling : [...shared].sort(byRarity).slice(0, 4);
  // Members that sit in a component file that is itself reused: there the look is already a component.
  const inReused = files
    .map((file) => ({ file, components: (componentsByFile.get(file) ?? []).filter((component) => (component.data.uses?.callSites ?? 0) > 0) }))
    .filter((entry) => entry.components.length)
    .map((entry) => ({
      file: entry.file, components: entry.components.map((component) => component.id),
      callSites: entry.components.reduce((sum, component) => sum + component.data.uses.callSites, 0),
      members: members.filter((member) => member.element.file === entry.file).length,
    }));
  patterns.push({
    tag, telling: tellingOrAny, representative: cluster.representative, members, files, shared, varying,
    screens: Math.max(...files.map((file) => screensOfFile.get(file) ?? 0)),
    confidence: round(members.reduce((sum, member) => sum + member.similarity, 0) / members.length),
    zone: countBy(files, (file) => zoneOf(file, settings))[0][0],
    dynamicMembers: members.filter((member) => member.element.dynamic).length,
    inReused,
    membersInReusedComponents: inReused.reduce((sum, entry) => sum + entry.members, 0),
    nearest: nearestComponent(cluster.representative),
  });
}
patterns.sort((a, b) =>
  b.screens - a.screens || b.members.length - a.members.length || b.files.length - a.files.length
  || byText(a.files.join("|"), b.files.join("|")) || byText(a.representative.join(" "), b.representative.join(" ")));

// The id of a finding comes from its subject, the list of files. Two patterns
// spread over exactly the same files would collide, so the later one also carries
// its most telling classes.
const subjectsSeen = new Set();
const findings = patterns.map((pattern) => {
  let subject = pattern.files.slice(0, SUBJECT_CAP);
  if (subjectsSeen.has(subject.join("|"))) subject = [...subject, `look:${pattern.telling.join(" ")}`];
  for (let extra = 2; subjectsSeen.has(subject.join("|")); extra += 1) subject = [...pattern.files.slice(0, SUBJECT_CAP), `look:${pattern.representative.join(" ")}`, `n:${extra}`];
  subjectsSeen.add(subject.join("|"));
  const firstPerFile = pattern.files.map((file) => pattern.members.find((member) => member.element.file === file));
  const evidence = [...firstPerFile, ...pattern.members.filter((member) => !firstPerFile.includes(member))].slice(0, EVIDENCE_CAP).map((member) => ({
    file: member.element.file, line: member.element.line,
    note: `<${member.element.tag}> ${member.similarity === 1 ? "same classes as the most common form" : `${Math.round(member.similarity * 100)}% like the most common form`}`,
  }));
  const options = [{ key: "extract-component", label: "Make it a component and use it in these places" }];
  if (pattern.nearest) options.push({ key: "variant-of-existing", label: `Use ${pattern.nearest.name}, or add a variant to it` });
  options.push({ key: "keep", label: "Leave these places as they are" });
  const item = finding({
    kind: "pattern",
    title: `<${pattern.tag}> with ${pattern.telling.join(", ")} recurs in ${pattern.members.length} places over ${pattern.files.length} files`,
    subject,
    zone: pattern.zone,
    reach: { screens: pattern.screens, uses: pattern.members.length },
    confidence: pattern.confidence,
    evidence,
    options,
    data: {
      members: pattern.members.slice(0, MEMBER_CAP).map((member) => ({ file: member.element.file, line: member.element.line, tag: member.element.tag })),
      count: pattern.members.length,
      files: pattern.files,
      sharedClasses: pattern.shared,
      varyingClasses: pattern.varying.slice(0, 30),
      nearestComponent: pattern.nearest ? { id: pattern.nearest.id, similarity: pattern.nearest.similarity } : null,
      tag: pattern.tag,
      tellingClasses: pattern.telling,
      membersInReusedComponents: pattern.membersInReusedComponents,
      reusedComponentFiles: pattern.inReused,
      membersWithRunTimeClasses: pattern.dynamicMembers,
    },
  });
  pattern.id = item.id;
  return item;
});

const summary = {
  run: run.id,
  elementsRead: allElements.length, elementsConsidered: elements.length, distinctSignatures: orderedGroups.length,
  patterns: patterns.length, places: patterns.reduce((sum, pattern) => sum + pattern.members.length, 0),
  withNearestComponent: patterns.filter((pattern) => pattern.nearest).length,
  thresholds: { patternSimilarity: SIMILARITY, patternMinMembers: MIN_MEMBERS, patternMinClasses: MIN_CLASSES },
};
writeFindings(run.dir, "patterns", findings, summary);

writeJson(path.join(run.dir, "work", "patterns.json"), {
  run: run.id,
  note: "Clusters of elements that look alike by their static classes. Brief for judging agents and for the visual check (dr-render).",
  thresholds: summary.thresholds,
  weights: { look: LOOK_WEIGHT, layout: LAYOUT_WEIGHT },
  clusters: patterns.map((pattern) => ({
    findingId: pattern.id, tag: pattern.tag, tellingClasses: pattern.telling,
    representative: pattern.representative, sharedClasses: pattern.shared, varyingClasses: pattern.varying,
    count: pattern.members.length, files: pattern.files, screens: pattern.screens, zone: pattern.zone, meanSimilarity: pattern.confidence,
    nearestComponent: pattern.nearest, reusedComponentFiles: pattern.inReused,
    members: pattern.members.map((member) => ({
      file: member.element.file, line: member.element.line, tag: member.element.tag, similarity: round(member.similarity),
      classes: member.element.classes, runTimeClasses: Boolean(member.element.dynamic),
      zone: zoneOf(member.element.file, settings), screens: screensOfFile.get(member.element.file) ?? 0,
    })),
  })),
});

// ---- Report -------------------------------------------------------------------

const shortList = (items, cap) => (items.length > cap ? `${items.slice(0, cap).join(" ")} … (+${items.length - cap})` : items.join(" "));
const rows = patterns.slice(0, TABLE_CAP).map((pattern, index) => [
  index + 1,
  `<${pattern.tag}> ${pattern.telling.join(" ")}`,
  pattern.members.length,
  pattern.files.length,
  pattern.screens,
  pattern.zone,
  shortList(pattern.shared, 12),
  pattern.files.slice(0, 2).map((file) => {
    const member = pattern.members.find((candidate) => candidate.element.file === file);
    return `${file}:${member.element.line}`;
  }).join(", "),
  pattern.nearest ? `${pattern.nearest.name} (${Math.round(pattern.nearest.similarity * 100)}%)` : "",
]);
const alreadyComponent = patterns.filter((pattern) => pattern.membersInReusedComponents > 0).length;

const report = [
  `# Patterns — Run ${run.id}`,
  "",
  "## Summary",
  "",
  `- ${allElements.length} elements with static classes were read; ${elements.length} have at least ${MIN_CLASSES} telling classes and sit outside story files.`,
  `- **Patterns** found: ${patterns.length}. A pattern is the same look written by hand in at least ${MIN_MEMBERS} places over at least 2 files (${summary.places} places in all).`,
  `- Two elements count as the same pattern when their classes are at least ${Math.round(SIMILARITY * 100)}% alike; colour, radius, shadow, font, text size, padding and gap weigh ${LOOK_WEIGHT} times more than layout classes.`,
  `- Patterns that look like an existing component: ${summary.withNearestComponent} (the "Nearest component" column). Using it, or adding a variant to it, may be enough.`,
  `- Patterns with at least one place inside a component file that is already reused: ${alreadyComponent}. There the other places repeat the component by hand.`,
  `- Each pattern is one **Finding**. Options: make it a component, use or extend the nearest component when there is one, or keep.`,
  `- The look-alike is by classes only; dr-render does the visual check.`,
  "",
  `## Patterns by Reach (${patterns.length})`,
  "",
  patterns.length
    ? mdTable(["#", "Pattern", "Places", "Files", "Screens", "Zone", "Shared classes", "Examples", "Nearest component"], rows)
    : "Nothing found.",
  ...(patterns.length > TABLE_CAP ? ["", `${patterns.length - TABLE_CAP} more in \`findings/patterns.json\`. Full member lists are in \`work/patterns.json\`.`] : patterns.length ? ["", "Full member lists are in `work/patterns.json`."] : []),
  "",
  "## Limits",
  "",
  "- Static classes only. A class string built at run time (`bg-${tone}`) is not seen, and neither are styles that come from CSS files or inline styles.",
  "- Look-alike is by classes, not by what is drawn: two elements with the same classes can still look different through their children, and two with different classes can look the same. The visual check comes from dr-render.",
  "- Only elements with 3 or more static classes are recorded by the scan, one element at a time: a pattern made of several nested elements shows up as its most distinctive element, not as a whole block.",
  "- Screens are counted per file through imports: every element in a reached file counts as reached.",
  "- The nearest component is the one whose file holds the most similar element or class set; it is a lead, not a match.",
  "",
].join("\n");
writeText(path.join(run.dir, "reports", "patterns.md"), report);

process.stdout.write(`${JSON.stringify({
  run: run.id, elements: allElements.length, considered: elements.length, signatures: orderedGroups.length,
  patterns: patterns.length, withNearestComponent: summary.withNearestComponent,
  files: ["findings/patterns.json", "work/patterns.json", "reports/patterns.md"].map((file) => path.join(".dr", "runs", run.id, file)),
}, null, 1)}\n`);
