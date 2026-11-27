#!/usr/bin/env node
// ud-consolidate: for each large Family, what its members really are. Which ones are
// a Frame others are built on, which ones only put content into a Frame, which ones
// draw a Frame of their own and which of those look alike, where the Frames differ
// (the axes a variant could carry), which inner pieces recur, and what nothing uses.
// It counts and groups; the target (how many Frames, which variants) is an agent's
// proposal and the owner's Decision.
//
//   node consolidate-report.mjs [--run <id>] [--family <name>]
//
// Writes .ud/runs/<id>/findings/consolidate.json, work/consolidate.json and reports/consolidate.md
import path from "node:path";
import {
  projectRoot, loadSettings, resolveRun, readJson, writeJson, writeText, finding, writeFindings, mdTable,
  splitClass, loadTokenValues, sameLook, argValue, fail,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const settings = loadSettings(root);
const defaults = readJson(new URL("../defaults.json", import.meta.url), {});
const thresholds = { ...defaults.thresholds, ...settings.thresholds };
const MIN_MEMBERS = Number(thresholds.consolidateMinMembers) || 4;
const FRAME_SIMILARITY = Number(thresholds.frameSimilarity) || 0.6;
const PIECE_MIN_MEMBERS = Number(thresholds.pieceMinMembers) || 3;
const TABLE_CAP = 60;

const run = resolveRun(argv, root);
const graph = readJson(path.join(run.dir, "graph.json"));
const familiesFile = path.join(run.dir, "work", "families.json");
const families = readJson(familiesFile, null)?.families;
if (!families) fail("the Families are not known for this run. Run /ud-components first (it writes work/families.json).");
const only = argValue("--family", argv);
const elements = readJson(path.join(run.dir, "facts", "elements.json"), { elements: [] }).elements ?? [];
const tokenValues = loadTokenValues(run.dir);

const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const rendersOut = new Map(); // id -> [{ to, count }]
const renderedBy = new Map(); // id -> [from]
for (const edge of graph.edges ?? []) {
  if (edge.kind !== "renders") continue;
  if (!rendersOut.has(edge.from)) rendersOut.set(edge.from, []);
  rendersOut.get(edge.from).push(edge);
  if (!renderedBy.has(edge.to)) renderedBy.set(edge.to, []);
  renderedBy.get(edge.to).push(edge.from);
}

// The elements each component draws: those of its file between its line and the next component's.
const componentsByFile = new Map();
for (const node of graph.nodes) {
  if (node.kind !== "component") continue;
  if (!componentsByFile.has(node.file)) componentsByFile.set(node.file, []);
  componentsByFile.get(node.file).push(node);
}
for (const list of componentsByFile.values()) list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
const elementsByFile = new Map();
for (const element of elements) {
  if (!elementsByFile.has(element.file)) elementsByFile.set(element.file, []);
  elementsByFile.get(element.file).push(element);
}
function elementsOf(node) {
  const siblings = componentsByFile.get(node.file) ?? [];
  const next = siblings[siblings.indexOf(node) + 1];
  const from = node.line ?? 0;
  const to = next?.line ?? Infinity;
  return (elementsByFile.get(node.file) ?? []).filter((element) => element.line >= from && element.line < to).sort((a, b) => a.line - b.line);
}
// The look of an element: its classes without state or breakpoint prefixes, tokens and raw values made alike.
const lookOf = (element) => [...new Set(element.classes.map((token) => splitClass(token)).filter((part) => !part.variants.length && part.utility).map((part) => sameLook(part.utility, tokenValues)))].sort();
const jaccard = (a, b) => {
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]).size;
  return union ? [...setA].filter((item) => setB.has(item)).length / union : 0;
};
// "max-w-md" -> ["max-w", "md"], "rounded=12px" -> ["rounded", "12px"], "flex" -> ["flex", ""].
// A value is a size word, a number, or a raw value; anything else is part of the property.
const VALUE = /^(\d[\w./%]*|px|full|screen|auto|none|xs|sm|md|lg|xl|\dxl|[a-z]+\/\d+|.*=.*)$/;
function axisOf(utility) {
  const equals = utility.indexOf("=");
  if (equals > 0) return [utility.slice(0, equals), utility.slice(equals + 1)];
  const dash = utility.lastIndexOf("-");
  if (dash > 0 && VALUE.test(utility.slice(dash + 1))) return [utility.slice(0, dash), utility.slice(dash + 1)];
  return [utility, ""];
}
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const round = (value) => Math.round(value * 100) / 100;

const findings = [];
const work = [];
const skipped = [];
for (const family of families) {
  if (only && family.name.toLowerCase() !== only.toLowerCase()) continue;
  if (!family.name || /^\(/.test(family.name)) continue;
  if ((family.members ?? []).length < MIN_MEMBERS) {
    skipped.push({ family: family.name, members: (family.members ?? []).length });
    continue;
  }
  const ids = new Set(family.members.map((member) => member.id));
  const members = family.members.map((member) => {
    const node = nodes.get(member.id);
    const own = node ? elementsOf(node) : [];
    const looks = own.map((element) => ({ line: element.line, tag: element.tag, look: lookOf(element) })).filter((item) => item.look.length >= 3);
    // The Frame is drawn by the outer elements: the first one, and the second when the first is a full-screen layer.
    const isLayer = (item) => item.look.includes("fixed") || item.look.includes("inset-0");
    const frame = looks.length ? (isLayer(looks[0]) && looks[1] ? looks[1] : looks[0]) : null;
    const out = rendersOut.get(member.id) ?? [];
    const builtOn = out.map((edge) => edge.to).filter((id) => ids.has(id));
    const primitives = out.map((edge) => nodes.get(edge.to)).filter((target) => target && !ids.has(target.id)).map((target) => target.name).sort();
    const usedBy = (renderedBy.get(member.id) ?? []).filter((id) => !id.startsWith("y:"));
    return {
      id: member.id, name: member.name, file: member.file, line: node?.line ?? null, zone: member.zone, readOnly: member.readOnly,
      callSites: member.callSites, screens: member.screens, hasStory: member.hasStory, loc: node?.data?.loc ?? null,
      props: (member.props ?? []).filter((name) => !["children", "className"].includes(name)),
      builtOn, usedByMembers: usedBy.filter((id) => ids.has(id)), usedBy: usedBy.length, primitives,
      frame, inner: looks.filter((item) => item !== frame && !(isLayer(item) && item === looks[0])), styledElements: looks.length,
    };
  });

  // ---- Roles ---------------------------------------------------------------
  // A member that renders three members or more is not built on them: it gathers them
  // (a registry, a provider that mounts every modal). It makes none of them a Frame.
  const gatherers = new Set(members.filter((member) => new Set(member.builtOn).size >= 3).map((member) => member.id));
  for (const member of members) {
    member.usedByMembers = member.usedByMembers.filter((id) => !gatherers.has(id));
    if (gatherers.has(member.id)) member.role = "gathers";
    else if (member.usedByMembers.length) member.role = "frame";
    else if (!member.usedBy && !member.callSites && !member.hasStory) member.role = "unused";
    else if (member.builtOn.length) member.role = "built-on";
    else member.role = "own-frame";
    // Built on a Frame and drawing no styled element of its own: it only brings content.
    member.contentOnly = member.role === "built-on" && member.styledElements === 0;
  }
  const frames = members.filter((member) => member.role === "frame");
  const builtOn = members.filter((member) => member.role === "built-on");
  const ownFrame = members.filter((member) => member.role === "own-frame");
  const unused = members.filter((member) => member.role === "unused");

  // ---- Look-alike groups among the members that draw their own Frame ---------
  const parent = new Map(ownFrame.map((member) => [member.id, member.id]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const alike = (a, b) => {
    if (a.frame && b.frame) return jaccard(a.frame.look, b.frame.look) >= FRAME_SIMILARITY;
    if (!a.frame && !b.frame) return a.primitives.length > 0 && a.primitives.join("|") === b.primitives.join("|");
    return false;
  };
  for (let i = 0; i < ownFrame.length; i += 1) for (let j = i + 1; j < ownFrame.length; j += 1) if (alike(ownFrame[i], ownFrame[j])) parent.set(find(ownFrame[i].id), find(ownFrame[j].id));
  // A member that draws its own Frame may look like an existing Frame of the Family.
  const nearestFrame = (member) => frames
    .filter((item) => item.frame && member.frame)
    .map((item) => ({ name: item.name, similarity: round(jaccard(item.frame.look, member.frame.look)) }))
    .sort((a, b) => b.similarity - a.similarity)[0] ?? null;
  const groupMap = new Map();
  for (const member of ownFrame) {
    const key = find(member.id);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(member);
  }
  const groups = [...groupMap.values()]
    .map((list) => {
      const looks = list.filter((member) => member.frame).map((member) => member.frame.look);
      const shared = looks.length ? looks.reduce((common, look) => common.filter((item) => look.includes(item))) : [];
      const near = list.map(nearestFrame).filter(Boolean).sort((a, b) => b.similarity - a.similarity)[0] ?? null;
      return {
        members: list.map((member) => member.name).sort(),
        ids: list.map((member) => member.id).sort(),
        callSites: list.reduce((sum, member) => sum + member.callSites, 0),
        sharedClasses: shared,
        varying: [...new Set(looks.flat())].filter((item) => !shared.includes(item)).sort(),
        frameSeen: looks.length > 0,
        looksLikeFrame: near && near.similarity >= FRAME_SIMILARITY ? near : null,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || b.callSites - a.callSites || a.members[0].localeCompare(b.members[0]))
    .map((group, index) => ({ group: index + 1, ...group }));

  // ---- Axes: where the Frames differ ------------------------------------------
  const framed = members.filter((member) => member.frame && (member.role === "frame" || member.role === "own-frame"));
  const axisMap = new Map(); // property -> value -> [member names]
  for (const member of framed) {
    for (const utility of member.frame.look) {
      const [property, value] = axisOf(utility);
      if (!axisMap.has(property)) axisMap.set(property, new Map());
      if (!axisMap.get(property).has(value)) axisMap.get(property).set(value, []);
      axisMap.get(property).get(value).push(member.name);
    }
  }
  const axes = [...axisMap.entries()]
    .map(([property, values]) => ({
      property,
      members: new Set([...values.values()].flat()).size,
      values: [...values.entries()].map(([value, names]) => ({ value: value || "(set)", members: names.length, sample: names.slice(0, 3) })).sort((a, b) => b.members - a.members || a.value.localeCompare(b.value)),
    }))
    .filter((axis) => axis.values.length >= 2 && axis.members >= Math.max(2, Math.ceil(framed.length / 2)))
    .map((axis) => ({ ...axis, reading: axis.values.length <= 5 ? "few values: a variant could carry it" : "many values: to bring closer first" }))
    .sort((a, b) => b.members - a.members || a.property.localeCompare(b.property));

  // ---- Pieces: inner elements that recur across members -------------------------
  const pieceMap = new Map();
  for (const member of members) {
    const seen = new Set();
    for (const item of member.inner) {
      const key = `${item.look.join(" ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!pieceMap.has(key)) pieceMap.set(key, { classes: item.look, tags: new Set(), members: [], sample: { file: member.file, line: item.line } });
      pieceMap.get(key).tags.add(item.tag);
      pieceMap.get(key).members.push(member.name);
    }
  }
  const pieces = [...pieceMap.values()]
    .filter((piece) => piece.members.length >= PIECE_MIN_MEMBERS)
    .map((piece) => ({ classes: piece.classes, tags: [...piece.tags].sort(), members: piece.members.length, in: piece.members.sort().slice(0, 12), sample: piece.sample }))
    .sort((a, b) => b.members - a.members || b.classes.length - a.classes.length);

  // ---- The Finding ---------------------------------------------------------------
  const drawnToday = frames.length + groups.length;
  const contentOnly = builtOn.filter((member) => member.contentOnly);
  const title = `${family.name}: ${plural(members.length, "component")}, ${plural(drawnToday, "distinct Frame")} drawn among them`;
  const summary = [
    `${plural(frames.length, "member is a Frame", "members are Frames")} others are built on`,
    `${builtOn.length} built on one (${contentOnly.length} bringing content only)`,
    `${ownFrame.length} draw a Frame of their own, in ${plural(groups.length, "look-alike group")}`,
    `${unused.length} used nowhere`,
    ...(gatherers.size ? [`${gatherers.size} only gather${gatherers.size === 1 ? "s" : ""} other members`] : []),
  ].join("; ");
  const files = [...new Set(members.map((member) => member.file))].sort();
  findings.push(finding({
    kind: "family-consolidation",
    title,
    subject: [`family:${family.name}`],
    zone: [...new Set(members.map((member) => member.zone))].length === 1 ? members[0].zone : "several",
    reach: { screens: Math.max(0, ...members.map((member) => member.screens)), uses: members.reduce((sum, member) => sum + member.callSites, 0) },
    evidence: [
      ...frames.slice(0, 3).map((member) => ({ file: member.file, line: member.line, note: `${member.name}: a Frame, ${plural(member.usedByMembers.length, "member")} built on it` })),
      ...groups.slice(0, 5).map((group) => {
        const first = members.find((member) => member.id === group.ids[0]);
        return { file: first.file, line: first.line, note: `group ${group.group}: ${group.members.slice(0, 5).join(", ")}${group.members.length > 5 ? "…" : ""} draw the same Frame${group.looksLikeFrame ? `, close to ${group.looksLikeFrame.name}` : ""}` };
      }),
    ],
    options: [
      { key: "rebuild", label: "Rebuild the Family on the proposed Frames, variants and pieces" },
      { key: "rebuild-partly", label: "Rebuild part of it (say which in the note)" },
      { key: "keep", label: "Leave the Family as it is" },
    ],
    data: {
      family: family.name, members: members.length, summary,
      frames: frames.map((member) => member.name), builtOn: builtOn.length, contentOnly: contentOnly.length,
      ownFrame: ownFrame.length, groups: groups.length, unused: unused.map((member) => member.name),
      distinctFramesDrawn: drawnToday, axes: axes.length, pieces: pieces.length,
      files, readOnly: members.filter((member) => member.readOnly).map((member) => member.name),
    },
  }));
  work.push({
    family: family.name, summary,
    members: members.map(({ frame, inner, ...member }) => ({ ...member, frame: frame ? { line: frame.line, tag: frame.tag, classes: frame.look } : null, group: groups.find((group) => group.ids.includes(member.id))?.group ?? null })),
    groups, axes, pieces,
  });
}
findings.sort((a, b) => b.data.members - a.data.members || a.title.localeCompare(b.title));

writeFindings(run.dir, "consolidate", findings, { families: findings.length, minMembers: MIN_MEMBERS, tooSmall: skipped.length });
writeJson(path.join(run.dir, "work", "consolidate.json"), { run: run.id, thresholds: { minMembers: MIN_MEMBERS, frameSimilarity: FRAME_SIMILARITY, pieceMinMembers: PIECE_MIN_MEMBERS }, families: work });

// ---- Report ------------------------------------------------------------------------

const ROLE = { gathers: "Gathers other members", frame: "Frame", "built-on": "Built on a Frame", "own-frame": "Draws its own Frame", unused: "Used nowhere" };
const lines = [
  "# Consolidation",
  "",
  `Run ${run.id}. For each **Family** of ${MIN_MEMBERS} components or more: what its members really are. Nothing has been changed, and the numbers below are what the code draws today, not what the **Family** should become: that is a proposal for the owner to settle.`,
  "",
  findings.length
    ? mdTable(["Family", "Components", "Frames others build on", "Built on one", "Content only", "Own Frame", "Look-alike groups", "Distinct Frames drawn", "Used nowhere", "Call sites"], findings.map((item) => [
      item.data.family, item.data.members, item.data.frames.length, item.data.builtOn, item.data.contentOnly, item.data.ownFrame, item.data.groups, item.data.distinctFramesDrawn, item.data.unused.length, item.reach.uses,
    ]))
    : `No **Family** has ${MIN_MEMBERS} components or more.`,
  "",
  "How to read it. A **Frame** is the part of a component that is the same whatever it holds. \"Content only\" members are built on a Frame and draw nothing styled of their own: they are content with a name. \"Distinct Frames drawn\" is the number of different Frames the code draws today (Frames others build on, plus one per look-alike group); the Family needs that many at most, and usually fewer once close groups are told apart by a variant.",
  "",
];
for (const item of work) {
  lines.push(`## ${item.family}`, "", `${item.summary}.`, "");
  lines.push("### Members", "", mdTable(["Component", "What it is", "Built on", "Group", "Call sites", "Screens", "Story", "Lines", "File"], item.members.slice(0, TABLE_CAP).map((member) => [
    member.name, `${ROLE[member.role]}${member.contentOnly ? ", content only" : ""}`, member.builtOn.map((id) => nodes.get(id)?.name ?? id).join(", "), member.group ?? "", member.callSites, member.screens, member.hasStory ? "yes" : "no", member.loc ?? "", member.file,
  ])), item.members.length > TABLE_CAP ? `\n…and ${item.members.length - TABLE_CAP} more in work/consolidate.json.` : "", "");
  if (item.groups.length) {
    lines.push("### Look-alike groups", "", "Members that draw their own **Frame** and whose Frames share most of their classes. Each group is one Frame written several times.", "", mdTable(["Group", "Members", "Call sites", "Where they differ", "Close to an existing Frame"], item.groups.map((group) => [
      group.group, group.members.join(", "), group.callSites, group.frameSeen ? group.varying.join(", ") || "nowhere" : "no Frame seen by the scan", group.looksLikeFrame ? `${group.looksLikeFrame.name} (${group.looksLikeFrame.similarity})` : "",
    ])), "");
  }
  if (item.axes.length) {
    lines.push("### Where the Frames differ", "", "One line per property that takes several values across the Frames. A property with a few values is what a variant carries; one with many close values is a candidate for bringing closer first.", "", mdTable(["Property", "Values (members)", "Reading"], item.axes.slice(0, 20).map((axis) => [
      axis.property, axis.values.map((value) => `${value.value} (${value.members})`).join(", "), axis.reading,
    ])), "");
  }
  if (item.pieces.length) {
    lines.push("### Pieces that recur inside the members", "", `The same styled element, written in ${PIECE_MIN_MEMBERS} members or more. Each is a candidate for a small component of the **Family** (a header, a footer, a row of actions).`, "", mdTable(["Element", "Classes", "In how many members", "For example"], item.pieces.slice(0, 15).map((piece) => [
      `<${piece.tags.join("|")}>`, piece.classes.join(" "), piece.members, `${piece.sample.file}:${piece.sample.line}`,
    ])), "");
  }
}
lines.push(
  "## Limits",
  "",
  "- A **Frame** is read from the classes of a component's outer element (the second one when the first is a full-screen layer). A Frame drawn by a CSS file, an inline style, a class built at run time or a library primitive is not seen: such members are grouped by the primitives they render, or left alone.",
  "- Only elements with three static classes or more are compared.",
  "- Two members of a look-alike group draw the same Frame; whether they behave alike (focus trap, closing, scroll) is for the judging agent to read.",
  "- \"Content only\" says a member draws no styled element of its own. It can still hold logic (a form, a request) that must live somewhere after a rebuild.",
  `- Families under ${MIN_MEMBERS} components are left to \`/ud-components\` (Project settings, \`thresholds.consolidateMinMembers\`).`,
  "",
);
const reportFile = path.join(run.dir, "reports", "consolidate.md");
writeText(reportFile, `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);

process.stdout.write(`${JSON.stringify({
  run: run.id,
  families: findings.map((item) => ({
    family: item.data.family, components: item.data.members, framesOthersBuildOn: item.data.frames.length, builtOn: item.data.builtOn, contentOnly: item.data.contentOnly,
    ownFrame: item.data.ownFrame, lookAlikeGroups: item.data.groups, distinctFramesDrawn: item.data.distinctFramesDrawn, usedNowhere: item.data.unused.length, axes: item.data.axes, pieces: item.data.pieces, id: item.id,
  })),
  tooSmall: skipped.length,
  files: [path.relative(root, path.join(run.dir, "findings", "consolidate.json")), path.relative(root, path.join(run.dir, "work", "consolidate.json")), path.relative(root, reportFile)],
}, null, 1)}\n`);
