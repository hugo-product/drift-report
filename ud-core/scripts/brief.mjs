#!/usr/bin/env node
// ud brief: one page over every audit of a Run, for a person to read first.
// It counts and ranks what the other scripts found; it finds nothing new.
// Writes <run>/reports/brief.md (brief-<focus>.md with --focus) and prints a JSON
// summary that also holds the judging plan: the groups a judging agent would read,
// ranked by Reach, so the cost can be announced with real numbers.
//
//   brief.mjs [--run <id>] [--focus <zone | family | component | part of a path>] [--top <n>]
import fs from "node:fs";
import path from "node:path";
import {
  UD_DIR, projectRoot, loadSettings, resolveRun, readJson, writeText, mdTable, countBy, argValue,
  familyIndex, inFocus, componentsOfFinding, offersChoice, isJudged,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const settings = loadSettings(root);
const run = resolveRun(argv, root);
const focus = argValue("--focus", argv) ?? null;
if (argv.includes("--focus") && !focus) {
  process.stderr.write("ud brief: --focus needs a Zone, a Family, a component name or part of a path.\n");
  process.exit(1);
}
const top = Number(argValue("--top", argv) ?? 10);
if (!(top > 0)) {
  process.stderr.write("ud brief: --top needs a number above 0.\n");
  process.exit(1);
}

const meta = readJson(path.join(run.dir, "run.json"), {});
const graph = readJson(path.join(run.dir, "graph.json"));
const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
const families = familyIndex(run.dir, graph, settings);
const scope = { nodesById, families };
const ledger = readJson(path.join(root, UD_DIR, "decisions.json"), { decisions: {} }).decisions ?? {};

// ---- Findings, per audit ------------------------------------------------------

const findingsDir = path.join(run.dir, "findings");
const bySkill = new Map();
for (const name of fs.existsSync(findingsDir) ? fs.readdirSync(findingsDir).filter((file) => file.endsWith(".json")).sort() : []) {
  const skill = name.replace(/\.json$/, "");
  const list = (readJson(path.join(findingsDir, name), {}).findings ?? []).filter((finding) => inFocus(finding, focus, scope));
  for (const finding of list) finding.skill = skill;
  bySkill.set(skill, list);
}
const all = [...bySkill.values()].flat();
const statusOf = (finding) => (offersChoice(finding) ? ledger[finding.id]?.status ?? "open" : "info");
const isOpen = (finding) => statusOf(finding) === "open";
const open = all.filter(isOpen);
const screensOf = (finding) => finding.reach?.screens ?? 0;
const usesOf = (finding) => finding.reach?.uses ?? 0;
const byReach = (a, b) => screensOf(b) - screensOf(a) || usesOf(b) - usesOf(a) || a.id.localeCompare(b.id);
const count = (n, word, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`;
const kindsText = (list) => countBy(list, (finding) => finding.kind).map(([kind, n]) => `${n} ${kind}`).join(", ");

// ---- Keyboard focus: said first, whatever the Reach ------------------------------

const focusGaps = open
  .filter((finding) => /^state-/.test(finding.kind) && (finding.data?.missing ?? []).includes("focus") && ["interactive", "input"].includes(finding.data?.stateKind))
  .sort(byReach);

// ---- Where the open questions are: per component ---------------------------------

const perComponent = new Map();
for (const finding of open) {
  for (const node of componentsOfFinding(finding, nodesById)) {
    if (!perComponent.has(node.id)) perComponent.set(node.id, { node, findings: [] });
    perComponent.get(node.id).findings.push(finding);
  }
}
const hotSpots = [...perComponent.values()]
  .map(({ node, findings }) => ({
    id: node.id,
    name: node.name,
    file: node.file,
    family: families.get(node.id) ?? null,
    zone: node.zone,
    screens: node.data?.screens ?? 0,
    callSites: node.data?.uses?.callSites ?? 0,
    open: findings.length,
    judged: findings.filter(isJudged).length,
    kinds: kindsText(findings),
    findingIds: findings.map((finding) => finding.id).sort(),
  }))
  .sort((a, b) => b.screens - a.screens || b.callSites - a.callSites || b.open - a.open || a.id.localeCompare(b.id));
const perFamily = countBy(hotSpots.filter((spot) => spot.family).flatMap((spot) => spot.findingIds.map((id) => `${spot.family}|${id}`)).filter((key, index, list) => list.indexOf(key) === index), (key) => key.split("|")[0]);

// ---- The judging plan: who would read what -------------------------------------

function groupOf(finding) {
  const family = finding.data?.family ?? componentsOfFinding(finding, nodesById).map((node) => families.get(node.id)).find(Boolean) ?? null;
  const component = componentsOfFinding(finding, nodesById)[0]?.name ?? null;
  switch (finding.skill) {
    case "tokens":
      if (/^scale-/.test(finding.kind)) return "the scales";
      if (/^(raw-color|recurring-value)$/.test(finding.kind)) return "colours and recurring values";
      if (finding.kind === "font-alias") return "fonts";
      return null; // the options are clear from the counts
    case "components":
      if (finding.kind === "component-unused") return "components nothing uses";
      return family ? `${family} family` : component ?? "components without a Family";
    case "stories":
    case "states":
      return family ? `${family} family` : component ?? "components without a Family";
    case "consolidate":
      return `${finding.data?.family} family, as a whole`;
    case "patterns":
      return finding.title;
    default:
      return null; // ud-render and ud-blueprint judge as they go
  }
}
const groups = new Map();
for (const finding of open.filter((item) => !isJudged(item))) {
  const label = groupOf(finding);
  if (!label) continue;
  const key = `${finding.skill}|${label}`;
  if (!groups.has(key)) groups.set(key, { skill: `ud-${finding.skill}`, group: label, findings: 0, screens: 0, uses: 0, zones: new Set(), findingIds: [] });
  const group = groups.get(key);
  group.findings += 1;
  group.screens = Math.max(group.screens, screensOf(finding));
  group.uses += usesOf(finding);
  group.zones.add(finding.zone);
  group.findingIds.push(finding.id);
}
const judgingGroups = [...groups.values()]
  .map((group) => ({ ...group, zones: [...group.zones].sort(), findingIds: group.findingIds.sort() }))
  .sort((a, b) => b.screens - a.screens || b.uses - a.uses || b.findings - a.findings || a.group.localeCompare(b.group));
const noAgentNeeded = open.filter((finding) => !isJudged(finding) && !groupOf(finding)).length;

// ---- The report ---------------------------------------------------------------

const counts = meta.counts ?? {};
const components = graph.nodes.filter((node) => node.kind === "component");
const withStory = components.filter((node) => (node.data?.stories ?? []).length || (node.data?.shownIn ?? []).length).length;
const statuses = countBy(all.filter(offersChoice), statusOf);
const statusCount = (status) => statuses.find(([key]) => key === status)?.[1] ?? 0;
const slug = focus ? String(focus).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "focus" : null;
const reportFile = path.join(run.dir, "reports", slug ? `brief-${slug}.md` : "brief.md");
const link = (name) => (fs.existsSync(path.join(run.dir, "reports", `${name}.md`)) ? `[${name}.md](./${name}.md)` : null);
const scales = all.filter((finding) => /^scale-/.test(finding.kind)).sort((a, b) => a.kind.localeCompare(b.kind));
const patterns = open.filter((finding) => finding.kind === "pattern").sort(byReach);
const rawColours = open.filter((finding) => finding.kind === "raw-color").sort(byReach);
const unusedTokens = open.filter((finding) => finding.kind === "token-unused");
const duplicates = open.filter((finding) => /^(duplicate-candidate|same-name|render-confirmed-duplicate)$/.test(finding.kind)).sort(byReach);

const lines = [
  focus ? `# Brief: ${focus}` : "# Brief",
  "",
  `Run **${run.id}**${meta.commit ? `, commit ${meta.commit.slice(0, 7)}${meta.branch ? ` on ${meta.branch}` : ""}` : ""}${meta.dirty ? ", with uncommitted changes" : ""}.`
    + (focus ? ` Only the **Findings** that belong to "${focus}" (a **Zone**, a **Family**, a component or a path) are counted below.` : ""),
  "This page ranks what the audits found. Nothing has been changed, and every line is a question for the owner, not a verdict.",
  "",
  "## In short",
  "",
  ...(focus ? [] : [`- The project: ${count(counts.components ?? components.length, "component")}, ${count(counts.screens ?? 0, "screen")}, ${count(counts.stories ?? 0, "story", "stories")} in ${count(counts.storyFiles ?? 0, "file")}, ${count(counts.tokens ?? 0, "token")}. ${withStory} of ${components.length} components appear in a story.`]),
  `- ${count(all.length, "Finding")}: ${statusCount("open")} wait for an answer, ${statusCount("deferred")} wait on someone else, ${statusCount("settled")} settled, ${statusCount("applied")} applied, ${all.length - all.filter(offersChoice).length} for information only.`,
  `- Of the ${statusCount("open")} that wait for an answer, ${open.filter(isJudged).length} carry a recommendation from a judging agent.`,
  hotSpots.length
    ? `- They gather on ${count(hotSpots.length, "component")}; the ${Math.min(5, hotSpots.length)} most reused hold ${new Set(hotSpots.slice(0, 5).flatMap((spot) => spot.findingIds)).size} of them.`
    : "- None of them is about a single component.",
  focusGaps.length ? `- ${count(focusGaps.length, "interactive component")} ${focusGaps.length === 1 ? "shows" : "show"} no sign of a visible keyboard focus (see below).` : null,
  "",
].filter((line) => line !== null);

if (focusGaps.length) {
  lines.push(
    "## Keyboard focus",
    "",
    "These interactive components show no sign of a visible focus in their own code or stories. It is listed first because it is an accessibility gap whatever the **Reach**. The scan cannot see a focus style set by a child, a wrapper or a library primitive, so each line is a question until someone has read the file.",
    "",
    mdTable(["Component", "File", "Screens", "Uses", "Read by an agent", "Id"], focusGaps.slice(0, top).map((finding) => [
      componentsOfFinding(finding, nodesById)[0]?.name ?? finding.title, (finding.evidence ?? [])[0]?.file ?? "", screensOf(finding), usesOf(finding), isJudged(finding) ? "yes" : "no", finding.id,
    ])),
    focusGaps.length > top ? `\n…and ${focusGaps.length - top} more in ${link("states") ?? "the states report"}.` : "",
    "",
  );
}

lines.push("## Where the open questions are", "");
if (hotSpots.length) {
  lines.push(
    "One line per component, most reused first. Settling a component at a time (`/ud focus <name>`) keeps its duplicates, stories and states in one conversation.",
    "",
    mdTable(["Component", "Family", "Zone", "Screens", "Call sites", "Open", "What", "File"], hotSpots.slice(0, top).map((spot) => [
      spot.name, spot.family ?? "", spot.zone ?? "", spot.screens, spot.callSites, spot.open, spot.kinds, spot.file,
    ])),
    hotSpots.length > top ? `\n…and ${hotSpots.length - top} more components with open **Findings**.` : "",
    "",
  );
  if (perFamily.length > 1) lines.push(`Per **Family**: ${perFamily.slice(0, 12).map(([family, n]) => `${family} ${n}`).join(", ")}.`, "");
} else lines.push("No open **Finding** is about a single component.", "");

lines.push("## Across the system", "");
const across = [];
for (const finding of scales) across.push(`- ${finding.title}.${offersChoice(finding) ? "" : " No suggestion: information only."}`);
if (rawColours.length) across.push(`- ${count(rawColours.length, "hard-coded colour")} with no settled answer; the most used: ${rawColours.slice(0, 5).map((finding) => `${finding.data?.value ?? finding.title} (${count(usesOf(finding), "use")})`).join(", ")}.`);
if (unusedTokens.length) across.push(`- ${count(unusedTokens.length, "token")} declared and used nowhere the scan can see.`);
for (const finding of all.filter((item) => item.kind === "family-consolidation").sort(byReach).slice(0, 8)) {
  across.push(`- ${finding.title}: ${finding.data?.summary}.${finding.judgement ? ` Proposed: ${finding.judgement}` : ""}`);
}
if (duplicates.length) across.push(`- ${count(duplicates.length, "possible **Duplicate**")}: ${duplicates.slice(0, 5).map((finding) => finding.title).join("; ")}.`);
if (patterns.length) across.push(`- ${count(patterns.length, "recurring **Pattern**")} with no component behind ${patterns.length === 1 ? "it" : "them"}; the widest: ${patterns.slice(0, 3).map((finding) => finding.title).join("; ")}.`);
lines.push(...(across.length ? across : ["Nothing to report across the system in this scope."]), "");

lines.push(
  "## By audit",
  "",
  bySkill.size
    ? mdTable(["Audit", "Findings", "Wait for an answer", "With a recommendation", "Mostly", "Report"], [...bySkill.entries()].map(([skill, list]) => {
      const waiting = list.filter(isOpen);
      return [`ud-${skill}`, list.length, waiting.length, waiting.filter(isJudged).length, countBy(list, (finding) => finding.kind).slice(0, 3).map(([kind, n]) => `${n} ${kind}`).join(", "), link(skill) ?? ""];
    }))
    : "No audit has run on this Run yet.",
  "",
);

lines.push("## Not read by an agent yet", "");
if (judgingGroups.length) {
  lines.push(
    `${count(judgingGroups.reduce((sum, group) => sum + group.findings, 0), "open Finding")} in ${count(judgingGroups.length, "group")} have only a script's count behind them: no one has read the files, so they carry no recommendation and no **Effort**. One judging agent reads one group. Highest **Reach** first:`,
    "",
    mdTable(["#", "Audit", "Group", "Findings", "Screens", "Uses", "Zones"], judgingGroups.slice(0, Math.max(top, 10)).map((group, index) => [index + 1, group.skill, group.group, group.findings, group.screens, group.uses, group.zones.join(", ")])),
    judgingGroups.length > Math.max(top, 10) ? `\n…and ${judgingGroups.length - Math.max(top, 10)} more groups.` : "",
    "",
  );
} else lines.push("Every open **Finding** that needs reading has been read.", "");
if (noAgentNeeded) lines.push(`${count(noAgentNeeded, "more open Finding")} (unused or undeclared tokens, one-off breakpoints, inline styles) can be answered from the counts alone.`, "");

lines.push(
  "## Read next",
  "",
  ...[
    fs.existsSync(path.join(run.dir, "map.html")) ? "- [map.html](../map.html): the interactive map; search a component to see who renders it, its stories, its tokens and its **Findings**." : null,
    ...[...bySkill.keys()].map((skill) => (link(skill) ? `- ${link(skill)}` : null)),
    link("decisions") ? `- ${link("decisions")}: what is settled, applied, and waiting on someone.` : null,
    link("changes") ? `- ${link("changes")}: what moved since the previous run.` : null,
  ].filter(Boolean),
  "",
  "## Limits",
  "",
  "- This page adds no check of its own: it counts and ranks the **Findings** of the other reports, whose limits apply.",
  "- **Reach** is counted per file: every component in a file a screen imports counts as reached, so a component nothing renders can still show screens.",
  "- A count comes from reading the code, not the screen. `/ud-render` measures what is really drawn.",
  "",
);
writeText(reportFile, `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`);

process.stdout.write(`${JSON.stringify({
  run: run.id,
  focus,
  findings: all.length,
  open: statusCount("open"),
  openWithRecommendation: open.filter(isJudged).length,
  deferred: statusCount("deferred"),
  settled: statusCount("settled"),
  applied: statusCount("applied"),
  keyboardFocusGaps: focusGaps.map((finding) => finding.id),
  hotSpots: hotSpots.slice(0, top).map(({ findingIds, ...spot }) => ({ ...spot, findingIds: findingIds.slice(0, 20) })),
  judging: {
    groups: judgingGroups.length,
    findings: judgingGroups.reduce((sum, group) => sum + group.findings, 0),
    answerableFromCounts: noAgentNeeded,
    perSkill: Object.fromEntries(countBy(judgingGroups, (group) => group.skill)),
    perZone: Object.fromEntries(countBy(judgingGroups.flatMap((group) => group.zones), (zone) => zone)),
    ranked: judgingGroups.slice(0, 40).map((group) => ({ ...group, findingIds: group.findingIds.slice(0, 30) })),
  },
  report: path.relative(root, reportFile),
}, null, 1)}\n`);
