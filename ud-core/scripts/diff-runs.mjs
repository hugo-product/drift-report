#!/usr/bin/env node
// ud diff-runs: what changed between a Run and the one before it.
// Writes <run>/reports/changes.md and prints a JSON summary.
//
//   diff-runs.mjs [--run <id>] [--against <id>]
import fs from "node:fs";
import path from "node:path";
import {
  UD_DIR, projectRoot, loadSettings, resolveRun, listRuns, runsDir, readJson, writeText,
  loadFindings, mdTable, countBy, git, argValue,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
loadSettings(root);

const stop = (message) => {
  process.stderr.write(`ud diff-runs: ${message}\n`);
  process.exit(1);
};
const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 1)}\n`);
const LIST_CAP = 40;

// Which skill reports each kind of Finding (FORMATS.md, "Finding kinds").
const SKILL_OF_KIND = (kind) => {
  if (/^(token-|raw-color|recurring-value|scale-|font-alias|breakpoint-oneoff|inline-style)/.test(kind)) return "tokens";
  if (/^(duplicate-candidate|same-name|component-unused|variant-candidate)/.test(kind)) return "components";
  if (/^(story-|prop-value-unshown)/.test(kind)) return "stories";
  if (/^state-/.test(kind)) return "states";
  if (/^pattern/.test(kind)) return "patterns";
  if (/^render-/.test(kind)) return "render";
  if (/^blueprint-/.test(kind)) return "blueprint";
  return null;
};

const run = resolveRun(argv, root);
const runs = listRuns(root);
const againstArg = argValue("--against", argv);
if (argv.includes("--against") && !againstArg) stop("--against needs a run id.");
if (againstArg && !runs.includes(againstArg)) stop(`no run "${againstArg}". Runs here: ${runs.join(", ")}.`);
if (againstArg === run.id) stop("--against names the same run; pick another one.");
const againstId = againstArg ?? runs[runs.indexOf(run.id) - 1] ?? null;
const reportFile = path.join(run.dir, "reports", "changes.md");
const reportRel = path.relative(root, reportFile);

if (!againstId) {
  writeText(reportFile, [
    "# Changes since the previous run",
    "",
    `Run ${run.id} is the first run of this project, so there is nothing to compare it with yet.`,
    "Run the audit again after some work and this report will list what is new, what is gone and which Decisions to look at again.",
    "",
  ].join("\n"));
  print({
    run: run.id, against: null, firstRun: true, changedFiles: [], changedFilesNote: "First run, nothing to compare.",
    newFindings: 0, goneFindings: 0, stillFindings: 0, nodesAdded: {}, nodesRemoved: {},
    decisionsFindingGone: [], decisionsToAskAgain: [], report: reportRel,
  });
  process.exit(0);
}

const load = (id) => {
  const dir = path.join(runsDir(root), id);
  const findingsDir = path.join(dir, "findings");
  return {
    id,
    dir,
    meta: readJson(path.join(dir, "run.json"), {}),
    graph: readJson(path.join(dir, "graph.json")),
    findings: loadFindings(dir),
    skills: fs.existsSync(findingsDir)
      ? fs.readdirSync(findingsDir).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, "")).sort()
      : [],
  };
};
const now = load(run.id);
const before = load(againstId);

// ---- Findings --------------------------------------------------------------

const beforeIds = new Map(before.findings.map((finding) => [finding.id, finding]));
const nowIds = new Map(now.findings.map((finding) => [finding.id, finding]));
const byKindTitle = (a, b) => a.kind.localeCompare(b.kind) || String(a.title).localeCompare(String(b.title)) || a.id.localeCompare(b.id);
const newFindings = now.findings.filter((finding) => !beforeIds.has(finding.id)).sort(byKindTitle);
const goneFindings = before.findings.filter((finding) => !nowIds.has(finding.id)).sort(byKindTitle);
const stillFindings = now.findings.filter((finding) => beforeIds.has(finding.id));
const skillsOnlyNow = now.skills.filter((skill) => !before.skills.includes(skill));
const skillsOnlyBefore = before.skills.filter((skill) => !now.skills.includes(skill));

// ---- Nodes -----------------------------------------------------------------

const beforeNodes = new Map(before.graph.nodes.map((node) => [node.id, node]));
const nowNodes = new Map(now.graph.nodes.map((node) => [node.id, node]));
const byKindName = (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
const added = now.graph.nodes.filter((node) => !beforeNodes.has(node.id)).sort(byKindName);
const removed = before.graph.nodes.filter((node) => !nowNodes.has(node.id)).sort(byKindName);
const perKind = (nodes) => Object.fromEntries(countBy(nodes, (node) => node.kind).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

// ---- Files changed between the two commits ---------------------------------

const commitA = before.meta.commit || "";
const commitB = now.meta.commit || "";
let changedFiles = [];
let filesKnown = false;
let changedFilesNote;
if (!commitA || !commitB) {
  changedFilesNote = "At least one of the two runs has no commit recorded (the project was not a Git repository then), so the changed files are not known.";
} else if (commitA === commitB) {
  filesKnown = true;
  changedFilesNote = "Both runs were made on the same commit, so no committed file changed between them.";
} else if (!git(["cat-file", "-t", commitA], root) || !git(["cat-file", "-t", commitB], root)) {
  changedFilesNote = "One of the two commits is no longer in this repository, so the changed files are not known.";
} else {
  filesKnown = true;
  changedFiles = git(["diff", "--name-only", commitA, commitB], root).split("\n").filter(Boolean).sort();
  changedFilesNote = `${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed between ${commitA.slice(0, 7)} and ${commitB.slice(0, 7)}.`;
}
const dirtyNote = before.meta.dirty || now.meta.dirty
  ? "At least one run was made with uncommitted changes; those are not in the list."
  : null;

// ---- Decisions to look at again --------------------------------------------

const ledger = readJson(path.join(root, UD_DIR, "decisions.json"), { decisions: {} });
const decisions = Object.values(ledger.decisions ?? {}).sort((a, b) => a.findingId.localeCompare(b.findingId));
const fileOfSubject = (subject) => {
  const text = String(subject);
  const node = nowNodes.get(text) ?? beforeNodes.get(text);
  if (node?.file) return node.file;
  const match = /^(?:[cysm]|file):([^#]+)/.exec(text);
  return match ? match[1] : null;
};
const changedSet = new Set(changedFiles);
const decisionsFindingGone = [];
const decisionsNotChecked = [];
const decisionsToAskAgain = [];
for (const entry of decisions) {
  if (entry.status !== "settled" && entry.status !== "applied") continue;
  if (!nowIds.has(entry.findingId)) {
    const skill = SKILL_OF_KIND(entry.kind ?? "");
    const checked = skill
      ? now.skills.includes(skill) || now.findings.some((finding) => SKILL_OF_KIND(finding.kind) === skill)
      : now.skills.length > 0;
    (checked ? decisionsFindingGone : decisionsNotChecked).push(entry);
  }
  if (entry.status === "settled" && nowIds.has(entry.findingId)) {
    const files = [...new Set((entry.subject ?? []).map(fileOfSubject).filter(Boolean))].filter((file) => changedSet.has(file)).sort();
    if (files.length) decisionsToAskAgain.push({ entry, files });
  }
}

// ---- Report ----------------------------------------------------------------

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const reachText = (finding) => `${count(finding.reach?.screens ?? 0, "screen")}, ${count(finding.reach?.uses ?? 0, "use")}`;
const capped = (rows, total) => (total > rows.length ? `\n\n…and ${total - rows.length} more.` : "");
const findingRows = (list) => list.slice(0, LIST_CAP).map((finding) => [finding.kind, finding.title, finding.zone, reachText(finding), finding.id]);
const findingTable = (list, empty) => (list.length
  ? mdTable(["Kind", "Finding", "Zone", "Reach", "Id"], findingRows(list)) + capped(findingRows(list), list.length)
  : empty);
const nodeTable = (list, empty) => {
  if (!list.length) return empty;
  const rows = list.slice(0, LIST_CAP).map((node) => [node.kind, node.name, node.file ?? "", node.zone ?? ""]);
  return mdTable(["Kind", "Name", "File", "Zone"], rows) + capped(rows, list.length);
};
const kindCounts = (list) => countBy(list, (item) => item.kind).map(([kind, count]) => `${count} ${kind}`).join(", ");
const commitLabel = (meta) => (meta.commit ? `commit ${meta.commit.slice(0, 7)}${meta.branch ? ` on ${meta.branch}` : ""}` : "no commit recorded");

const lines = [
  "# Changes since the previous run",
  "",
  `Run **${now.id}** (${commitLabel(now.meta)}) compared with run **${before.id}** (${commitLabel(before.meta)}).`,
  "",
  mdTable(["", "Count"], [
    ["New Findings", newFindings.length],
    ["Findings gone", goneFindings.length],
    ["Findings still there", stillFindings.length],
    ["Added to the map", added.length],
    ["Removed from the map", removed.length],
    ["Files changed", filesKnown ? changedFiles.length : "not known"],
    ["Decisions whose Finding is gone", decisionsFindingGone.length],
    ["Settled Decisions to ask again", decisionsToAskAgain.length],
  ]),
  "",
];
if (skillsOnlyNow.length || skillsOnlyBefore.length) {
  lines.push(
    "> The two runs do not hold the same reports, so part of the difference below is only a report that was produced in one run and not the other."
    + (skillsOnlyNow.length ? ` Only in ${now.id}: ${skillsOnlyNow.join(", ")}.` : "")
    + (skillsOnlyBefore.length ? ` Only in ${before.id}: ${skillsOnlyBefore.join(", ")}.` : ""),
    "",
  );
}
lines.push(
  "## Decisions to look at",
  "",
  "### Decisions whose Finding is gone",
  "",
  decisionsFindingGone.length
    ? `The audit no longer sees these. A settled one may already be reworked (mark it applied) or no longer be needed.\n\n${mdTable(["Finding", "Kind", "Status", "Choice", "Id"], decisionsFindingGone.map((entry) => [entry.title, entry.kind, entry.status, entry.choice ?? "", entry.findingId]))}`
    : "None.",
  "",
  "### Settled Decisions whose files changed",
  "",
  decisionsToAskAgain.length
    ? `The files these Decisions are about changed between the two runs, so the answer may need asking again.\n\n${mdTable(["Finding", "Kind", "Choice", "Changed files", "Id"], decisionsToAskAgain.map(({ entry, files }) => [entry.title, entry.kind, entry.choice ?? "", files.join(", "), entry.findingId]))}`
    : filesKnown ? "None." : "Not known: the changed files could not be listed (see below).",
  "",
);
if (decisionsNotChecked.length) {
  lines.push(`${decisionsNotChecked.length} other recorded Decision${decisionsNotChecked.length === 1 ? "" : "s"} could not be checked, because the report that produces ${decisionsNotChecked.length === 1 ? "its Finding" : "their Findings"} was not made in run ${now.id}.`, "");
}
lines.push(
  "## New Findings",
  "",
  newFindings.length ? `${kindCounts(newFindings)}.\n` : "",
  findingTable(newFindings, "No new Finding."),
  "",
  "## Findings gone",
  "",
  goneFindings.length ? `${kindCounts(goneFindings)}.\n` : "",
  findingTable(goneFindings, "No Finding went away."),
  "",
  "## Still there",
  "",
  stillFindings.length ? `${stillFindings.length} Findings are in both runs: ${kindCounts(stillFindings)}.` : "No Finding is in both runs.",
  "",
  "## Added to the map",
  "",
  added.length ? `${kindCounts(added)}.\n` : "",
  nodeTable(added, "Nothing was added."),
  "",
  "## Removed from the map",
  "",
  removed.length ? `${kindCounts(removed)}.\n` : "",
  nodeTable(removed, "Nothing was removed."),
  "",
  "## Files changed between the two runs",
  "",
  changedFilesNote,
  dirtyNote ?? "",
  "",
  changedFiles.length ? changedFiles.slice(0, 200).map((file) => `- \`${file}\``).join("\n") + (changedFiles.length > 200 ? `\n- …and ${changedFiles.length - 200} more.` : "") : "",
  "",
);
writeText(reportFile, `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);

print({
  run: now.id,
  against: before.id,
  firstRun: false,
  commits: { run: commitB || null, against: commitA || null },
  changedFiles,
  changedFilesNote: [changedFilesNote, dirtyNote].filter(Boolean).join(" "),
  newFindings: newFindings.length,
  goneFindings: goneFindings.length,
  stillFindings: stillFindings.length,
  newFindingIds: newFindings.slice(0, 200).map((finding) => finding.id),
  goneFindingIds: goneFindings.slice(0, 200).map((finding) => finding.id),
  nodesAdded: perKind(added),
  nodesRemoved: perKind(removed),
  reportsOnlyInRun: skillsOnlyNow,
  reportsOnlyInAgainst: skillsOnlyBefore,
  decisionsFindingGone: decisionsFindingGone.map((entry) => entry.findingId),
  decisionsNotChecked: decisionsNotChecked.map((entry) => entry.findingId),
  decisionsToAskAgain: decisionsToAskAgain.map(({ entry, files }) => ({ findingId: entry.findingId, files })),
  report: reportRel,
});
