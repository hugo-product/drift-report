#!/usr/bin/env node
// ud plan: groups settled Decisions into Lots.
// Writes .ud/plan/lots.json and .ud/plan/plan.md, prints a JSON summary.
// This is a first, deterministic cut: an agent refines titles, order and checks afterwards.
//
//   plan.mjs [--run <id>]
import path from "node:path";
import {
  UD_DIR, projectRoot, loadSettings, resolveRun, readJson, writeJson, writeText,
  loadFindings, mdTable, isReadOnly,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const settings = loadSettings(root);
const defaults = readJson(new URL("../defaults.json", import.meta.url), {});
const familyWords = new Set(settings.familyWords ?? defaults.familyWords ?? []);
const lotMaxFiles = Number({ ...defaults.thresholds, ...settings.thresholds }.lotMaxFiles) || 25;
const LINES_PER_FILE = 12;

const run = resolveRun(argv, root);
const graph = readJson(path.join(run.dir, "graph.json"));
const tokenFacts = readJson(path.join(run.dir, "facts", "tokens.json"), { tokens: [] }).tokens ?? [];
const findings = new Map(loadFindings(run.dir).map((finding) => [finding.id, finding]));
const ledger = readJson(path.join(root, UD_DIR, "decisions.json"), { version: 1, decisions: {} });
const lotsFile = path.join(root, UD_DIR, "plan", "lots.json");
const planFile = path.join(root, UD_DIR, "plan", "plan.md");
const previous = readJson(lotsFile, { lots: [] }).lots ?? [];

const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const tokenFile = new Map(tokenFacts.map((token) => [`t:${token.name}`, token.declarations?.[0]?.file]));

// ---- Vocabulary of the first cut --------------------------------------------

const GROUPS = ["tokens", "components", "patterns", "states", "stories", "render", "blueprint", "other"];
function groupOf(kind) {
  if (/^(token-|raw-color|recurring-value|scale-|font-alias|breakpoint-oneoff|inline-style)/.test(kind)) return "tokens";
  if (/^(duplicate-candidate|same-name|component-unused|variant-candidate|render-confirmed-duplicate)/.test(kind)) return "components";
  if (/^pattern/.test(kind)) return "patterns";
  if (/^state-/.test(kind)) return "states";
  if (/^(story-|prop-value-unshown)/.test(kind)) return "stories";
  if (/^render-/.test(kind)) return "render";
  if (/^blueprint-/.test(kind)) return "blueprint";
  return "other";
}
// Each Finding of these kinds is a cluster of its own: one Lot per Finding.
const OWN_LOT = /^(duplicate-candidate|same-name|render-confirmed-duplicate|pattern|blueprint-)/;
const KIND_LABEL = {
  "token-unused": "Unused tokens",
  "token-undeclared": "Undeclared tokens",
  "raw-color": "Raw colours",
  "recurring-value": "Recurring values",
  "scale-text-size": "Text size scale",
  "scale-spacing": "Spacing scale",
  "scale-radius": "Radius scale",
  "scale-shadow": "Shadow scale",
  "font-alias": "Font aliases",
  "breakpoint-oneoff": "One-off breakpoints",
  "inline-style": "Inline styles",
  "component-unused": "Unused components",
  "variant-candidate": "Variant candidates",
  "story-missing": "Missing stories",
  "story-orphan": "Orphan stories",
  "story-outdated-arg": "Outdated stories (args)",
  "story-value-unused": "Outdated stories (unused values)",
  "story-value-missing": "Missing stories (values)",
  "prop-value-unshown": "Missing stories (prop values)",
  "state-missing": "Missing states",
  "state-inconsistent": "Inconsistent states",
  "render-mismatch": "Render divergences",
};
const CHECKS = {
  tokens: "Open the screens and stories that use these values, in light and dark themes, and compare them with before: nothing should look different unless the Decision says so.",
  components: "Open the stories of the merged or changed component and each screen in its Reach. Check every variant and state the old components offered.",
  patterns: "Open each place where the Pattern appeared and compare it with before, at phone and desktop widths.",
  states: "Open the component's stories and go through each of its Expected states (rest, focus, disabled, loading, error…).",
  stories: "Open Storybook: each story named here renders without error and shows what its Decision says.",
  render: "Open the story and the screen side by side and confirm they now show the same thing.",
  blueprint: "Check that Storybook still builds, that its tree matches the Blueprint, and that no screen changed.",
  other: "Open the screens and stories this Lot touches and compare them with before.",
};
const EFFORTS = ["XS", "S", "M", "L"];
const CHANGES_API = /(merge|variant|remove|delete|rename)/i;

function familyOfName(name) {
  const words = String(name ?? "").match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*/g) ?? [];
  for (let i = words.length - 1; i >= 0; i -= 1) if (familyWords.has(words[i])) return words[i];
  return null;
}
function familyOfFinding(finding) {
  for (const subject of finding.subject ?? []) {
    const node = nodes.get(String(subject));
    const name = node?.kind === "component" ? node.name : node?.kind === "story" ? node.data?.componentName : /^c:[^#]+#(.+)$/.exec(String(subject))?.[1];
    const family = familyOfName(name);
    if (family) return family;
  }
  return null;
}
function categoryOfFinding(finding) {
  const scale = /^scale-(.+)$/.exec(finding.kind);
  if (scale) return scale[1];
  for (const subject of finding.subject ?? []) {
    const node = nodes.get(String(subject));
    if (node?.kind === "token" && node.data?.category) return node.data.category;
  }
  return typeof finding.data?.category === "string" ? finding.data.category : null;
}

const looksLikeFile = (value) => typeof value === "string" && /^[^:#]+\.(tsx?|jsx?|mjs|cjs|css|scss|mdx?|json|svg)$/i.test(value);
function filesOfFinding(finding, choice) {
  const files = new Set();
  const add = (file) => {
    if (looksLikeFile(file)) files.add(file);
  };
  for (const subject of finding.subject ?? []) {
    const text = String(subject);
    const node = nodes.get(text);
    if (node?.file) add(node.file);
    else if (tokenFile.get(text)) add(tokenFile.get(text));
    else if (/^[cysm]:/.test(text)) add(text.slice(2).split("#")[0]);
    else if (text.startsWith("file:")) add(text.slice(5));
    else add(text);
    if (node?.kind === "component" && CHANGES_API.test(choice)) for (const file of node.data?.uses?.files ?? []) add(file);
  }
  for (const item of finding.evidence ?? []) add(item?.file);
  for (const item of Array.isArray(finding.data?.files) ? finding.data.files : []) add(typeof item === "string" ? item : item?.file);
  for (const item of Array.isArray(finding.data?.evidence) ? finding.data.evidence : []) add(typeof item === "string" ? item : item?.file);
  return [...files].sort();
}

// ---- Which Decisions are planned --------------------------------------------

const frozen = previous.filter((lot) => lot.status === "in-progress" || lot.status === "done");
const frozenDecisions = new Set(frozen.flatMap((lot) => lot.decisions ?? []));
const skipped = []; // { findingId, reason }
const items = []; // { entry, finding, files, blocked }
for (const entry of Object.values(ledger.decisions ?? {}).sort((a, b) => a.findingId.localeCompare(b.findingId))) {
  if (entry.status !== "settled" || entry.choice === "keep" || frozenDecisions.has(entry.findingId)) continue;
  const finding = findings.get(entry.findingId);
  if (!finding) {
    skipped.push({ findingId: entry.findingId, title: entry.title, reason: `Its Finding is not in run ${run.id}: it may already be reworked, or its report was not produced in this run.` });
    continue;
  }
  const all = filesOfFinding(finding, entry.choice);
  const files = all.filter((file) => !isReadOnly(file, settings));
  const blocked = all.filter((file) => isReadOnly(file, settings));
  if (!files.length) {
    skipped.push({
      findingId: entry.findingId,
      title: entry.title,
      reason: blocked.length ? `Every file it touches is read-only (${blocked.join(", ")}).` : "No file could be worked out for it.",
    });
    continue;
  }
  items.push({ entry, finding, files, blocked });
}

// ---- Grouping ---------------------------------------------------------------

const reachOf = (finding) => (finding.reach?.screens ?? 0) * 1000 + (finding.reach?.uses ?? 0);
const byReach = (a, b) => reachOf(b.finding) - reachOf(a.finding) || a.finding.id.localeCompare(b.finding.id);

const buckets = new Map();
for (const item of items) {
  const { finding, entry } = item;
  const group = groupOf(finding.kind);
  let key;
  let title;
  if (OWN_LOT.test(finding.kind)) {
    key = `${finding.kind}|${finding.id}`;
    title = `${finding.title} (${entry.choice})`;
  } else if (group === "tokens") {
    const category = finding.kind === "raw-color" ? null : categoryOfFinding(finding);
    key = `${finding.kind}|${category ?? "-"}|${finding.zone}`;
    title = `${KIND_LABEL[finding.kind] ?? finding.kind}${category && !finding.kind.startsWith("scale-") ? ` (${category})` : ""} in ${finding.zone}`;
  } else {
    const family = familyOfFinding(finding);
    key = `${finding.kind}|${family ?? "-"}|${finding.zone}`;
    title = `${KIND_LABEL[finding.kind] ?? finding.kind}: ${family ? `${family} family` : "components without a Family"} in ${finding.zone}`;
  }
  if (!buckets.has(key)) buckets.set(key, { key, group, title, items: [] });
  buckets.get(key).items.push(item);
}

// Split a bucket that touches too many files. A single Decision is never cut in two.
const drafts = [];
for (const bucket of [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  const parts = [];
  let current = null;
  for (const item of bucket.items.sort(byReach)) {
    const merged = current ? new Set([...current.files, ...item.files]) : null;
    if (!current || merged.size > lotMaxFiles) {
      current = { items: [], files: new Set() };
      parts.push(current);
    }
    current.items.push(item);
    for (const file of item.files) current.files.add(file);
  }
  parts.forEach((part, index) => {
    drafts.push({
      group: bucket.group,
      key: bucket.key,
      title: parts.length > 1 ? `${bucket.title} (part ${index + 1} of ${parts.length})` : bucket.title,
      items: part.items,
      files: [...part.files].sort(),
      part: index,
    });
  });
}
drafts.sort((a, b) =>
  GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)
  || Math.max(...b.items.map((item) => reachOf(item.finding))) - Math.max(...a.items.map((item) => reachOf(item.finding)))
  || a.key.localeCompare(b.key)
  || a.part - b.part);

// ---- Lots -------------------------------------------------------------------

const setKey = (ids) => [...ids].sort().join("|");
const previousBySet = new Map(previous.map((lot) => [setKey(lot.decisions ?? []), lot]));
let nextNumber = Math.max(0, ...previous.map((lot) => Number(/(\d+)$/.exec(lot.id ?? "")?.[1] ?? 0))) + 1;
const newId = () => {
  const id = `lot-${String(nextNumber).padStart(2, "0")}`;
  nextNumber += 1;
  return id;
};

const lots = frozen.map((lot) => ({ ...lot }));
const details = new Map(); // lot id -> draft, for plan.md
for (const draft of drafts) {
  const decisions = draft.items.map((item) => item.entry.findingId).sort();
  const kept = previousBySet.get(setKey(decisions));
  const efforts = draft.items.map((item) => EFFORTS.indexOf(item.finding.effort)).filter((index) => index >= 0);
  const lot = {
    id: kept?.id ?? newId(),
    title: kept?.title ?? draft.title,
    decisions,
    files: draft.files,
    readOnlyBlocked: [...new Set(draft.items.flatMap((item) => item.blocked))].sort(),
    effort: efforts.length ? EFFORTS[Math.max(...efforts)] : null,
    estimatedLines: draft.files.length * LINES_PER_FILE,
    dependsOn: [],
    order: 0,
    check: kept?.check ?? CHECKS[draft.group],
    status: kept?.status ?? "planned",
  };
  lots.push(lot);
  details.set(lot.id, draft);
}

// A Lot depends on the nearest earlier Lot that touches one of its files.
const lastTouch = new Map(); // file -> lot id
const newIds = new Set(details.keys());
lots.forEach((lot, index) => {
  lot.order = index + 1;
  if (newIds.has(lot.id)) {
    const known = new Set(lots.map((item) => item.id));
    lot.dependsOn = [...new Set((lot.files ?? []).map((file) => lastTouch.get(file)).filter((id) => id && id !== lot.id && known.has(id)))].sort();
  }
  for (const file of lot.files ?? []) lastTouch.set(file, lot.id);
});

writeJson(lotsFile, { version: 1, generatedAt: new Date().toISOString(), run: run.id, lots });

// ---- plan.md ----------------------------------------------------------------

const entryOf = (id) => ledger.decisions?.[id];
const oversized = lots.filter((lot) => (lot.files ?? []).length > lotMaxFiles);
const lines = [
  "# Plan",
  "",
  "> First cut, made by a script from the Decision ledger. An agent refines the titles, the order and the checks afterwards.",
  "",
  `Run ${run.id}. ${lots.length} Lot${lots.length === 1 ? "" : "s"} for ${lots.reduce((sum, lot) => sum + (lot.decisions ?? []).length, 0)} settled Decisions, touching ${new Set(lots.flatMap((lot) => lot.files ?? [])).size} files.`,
  `A Lot holds at most ${lotMaxFiles} files (Project settings, \`thresholds.lotMaxFiles\`). Decisions settled as "keep" need no rework and are left out.`,
  `The line counts are a guess (${LINES_PER_FILE} lines per file), only there to compare Lots with each other.`,
  "",
];
if (!lots.length) lines.push("Nothing to plan yet: no settled Decision asks for a change.", "");
else {
  lines.push(
    mdTable(
      ["Order", "Lot", "Title", "Decisions", "Files", "Effort", "Lines (guess)", "Depends on", "Status"],
      lots.map((lot) => [lot.order, lot.id, lot.title, (lot.decisions ?? []).length, (lot.files ?? []).length, lot.effort ?? "not set", lot.estimatedLines ?? "", (lot.dependsOn ?? []).join(", ") || "none", lot.status]),
    ),
    "",
  );
}
if (oversized.length) {
  lines.push(`${oversized.map((lot) => lot.id).join(", ")}: more than ${lotMaxFiles} files, because a single Decision reaches that many. Consider reworking ${oversized.length === 1 ? "it" : "them"} in stages.`, "");
}
if (skipped.length) {
  lines.push("## Left out", "", "These settled Decisions are in no Lot and stay as they are.", "", mdTable(["Finding", "Why", "Id"], skipped.map((item) => [item.title ?? "", item.reason, item.findingId])), "");
}
for (const lot of lots) {
  lines.push(`## ${lot.order}. ${lot.title}`, "", `\`${lot.id}\` · status ${lot.status} · effort ${lot.effort ?? "not set"} · about ${lot.estimatedLines ?? "?"} lines (guess) · depends on ${(lot.dependsOn ?? []).join(", ") || "nothing"}`, "");
  if (!details.has(lot.id)) lines.push(`Kept as it was: this Lot is ${lot.status}.`, "");
  lines.push("### Decisions", "");
  lines.push(mdTable(["Finding", "Kind", "Choice", "Note", "Id"], (lot.decisions ?? []).map((id) => {
    const entry = entryOf(id);
    return [entry?.title ?? "", entry?.kind ?? "", entry?.choice ?? "", entry?.note ?? "", id];
  })), "");
  lines.push(`### Files (${(lot.files ?? []).length})`, "", ...(lot.files ?? []).map((file) => `- \`${file}\``), "");
  if ((lot.readOnlyBlocked ?? []).length) {
    lines.push("### Blocked, read-only", "", "These files must not be touched (Project settings, `readOnly`). The part of the Decision that needs them stays open.", "", ...lot.readOnlyBlocked.map((file) => `- \`${file}\``), "");
  }
  lines.push("### Check", "", lot.check ?? "", "");
}
writeText(planFile, `${lines.join("\n").trimEnd()}\n`);

process.stdout.write(`${JSON.stringify({
  run: run.id,
  lots: lots.length,
  decisions: lots.reduce((sum, lot) => sum + (lot.decisions ?? []).length, 0),
  files: new Set(lots.flatMap((lot) => lot.files ?? [])).size,
  kept: lots.filter((lot) => previous.some((item) => item.id === lot.id)).map((lot) => lot.id),
  oversized: oversized.map((lot) => lot.id),
  leftOut: skipped.map((item) => ({ findingId: item.findingId, reason: item.reason })),
  order: lots.map((lot) => ({ id: lot.id, title: lot.title, decisions: (lot.decisions ?? []).length, files: (lot.files ?? []).length, dependsOn: lot.dependsOn ?? [], status: lot.status })),
  out: [path.relative(root, lotsFile), path.relative(root, planFile)],
}, null, 1)}\n`);
