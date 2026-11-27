#!/usr/bin/env node
// dr carry: brings the judging agents' answers of an earlier Run into a new one,
// for every Finding whose files did not change in between. A new scan starts with
// script-only Findings; without this, every recommendation would be paid for again.
// It copies; it never judges. Prints a JSON summary.
//
//   carry.mjs [--run <id>] [--from <id>]
import fs from "node:fs";
import path from "node:path";
import {
  projectRoot, loadSettings, resolveRun, listRuns, runsDir, readJson, writeJson, argValue,
  changedBetween, filesOfFinding, countBy, familyIndex,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const settings = loadSettings(root);
const stop = (message) => {
  process.stderr.write(`dr carry: ${message}\n`);
  process.exit(1);
};
const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 1)}\n`);
const AGENT_FIELDS = ["effort", "confidence", "recommendation", "judgement"];

const run = resolveRun(argv, root);
const runs = listRuns(root);
const fromArg = argValue("--from", argv);
if (argv.includes("--from") && !fromArg) stop("--from needs a run id.");
if (fromArg && !runs.includes(fromArg)) stop(`no run "${fromArg}". Runs here: ${runs.join(", ")}.`);
if (fromArg === run.id) stop("--from names the same run; pick an earlier one.");
const fromId = fromArg ?? runs[runs.indexOf(run.id) - 1] ?? null;
if (!fromId) {
  print({ run: run.id, from: null, carried: 0, note: "This is the first run of the project: there is nothing to carry." });
  process.exit(0);
}
const fromDir = path.join(runsDir(root), fromId);
const changed = changedBetween(readJson(path.join(fromDir, "run.json"), {}), readJson(path.join(run.dir, "run.json"), {}), root);
if (!changed.known) {
  print({ run: run.id, from: fromId, carried: 0, filesKnown: false, note: `Nothing was carried: ${changed.note} Every Finding has to be read again, or left without a recommendation.` });
  process.exit(0);
}
const changedSet = new Set(changed.files);

const loadDir = (dir) => {
  const out = new Map(); // skill -> file content
  const findingsDir = path.join(dir, "findings");
  if (!fs.existsSync(findingsDir)) return out;
  for (const name of fs.readdirSync(findingsDir).filter((file) => file.endsWith(".json")).sort()) out.set(name.replace(/\.json$/, ""), readJson(path.join(findingsDir, name)));
  return out;
};
const before = loadDir(fromDir);
const now = loadDir(run.dir);
const nowNodes = new Map(readJson(path.join(run.dir, "graph.json")).nodes.map((node) => [node.id, node]));
const beforeNodes = new Map(readJson(path.join(fromDir, "graph.json")).nodes.map((node) => [node.id, node]));
const nowById = new Map([...now.values()].flatMap((file) => file.findings ?? []).map((finding) => [finding.id, finding]));

const families = familyIndex(run.dir, { nodes: [...nowNodes.values()] }, settings);
const onlyAnAgentWrites = (finding) => {
  if (/^render-/.test(finding.kind)) return true;
  if (finding.kind !== "duplicate-candidate") return false;
  const names = new Set((finding.subject ?? []).map((subject) => families.get(String(subject)) ?? `none:${subject}`));
  return names.size > 1; // the script only pairs components inside one Family
};

const carried = [];
const readded = [];
const skipped = { filesChanged: [], alreadyJudged: [], optionGone: [], subjectGone: [], noFileToCompare: [] };
const touched = new Set();
for (const [skill, file] of before) {
  for (const old of file.findings ?? []) {
    if (old.source !== "agent") continue;
    const current = nowById.get(old.id);
    const files = filesOfFinding(old, beforeNodes);
    if (!files.length) {
      // A Finding about no file (a Blueprint subject, a scale): nothing says whether it still holds.
      if (!current || current.source !== "agent") skipped.noFileToCompare.push(old.id);
      continue;
    }
    if (files.some((item) => changedSet.has(item))) {
      skipped.filesChanged.push(old.id);
      continue;
    }
    if (current) {
      if (current.source === "agent") {
        skipped.alreadyJudged.push(old.id);
        continue;
      }
      const keys = (current.options ?? []).map((option) => option.key);
      if (old.recommendation && !keys.includes(old.recommendation)) {
        skipped.optionGone.push(old.id);
        continue;
      }
      for (const field of AGENT_FIELDS) current[field] = old[field];
      current.source = "agent";
      current.carriedFrom = old.carriedFrom ?? fromId;
      carried.push(old.id);
      touched.add(current);
      continue;
    }
    // Absent from the new run. When a script writes this kind of Finding, its absence
    // is the script's answer (a story was added elsewhere, a token found a use) and
    // nothing is brought back. Only what an agent alone can write is brought back:
    // a render Finding, or a Duplicate across two Families, when none of its files
    // changed and everything it names is still in the graph.
    if (!onlyAnAgentWrites(old)) continue;
    const subjects = (old.subject ?? []).map(String).filter((subject) => /^[cystm]:/.test(subject));
    if (subjects.some((subject) => !nowNodes.has(subject))) {
      skipped.subjectGone.push(old.id);
      continue;
    }
    if (!now.has(skill)) now.set(skill, { generatedBy: `dr-${skill}`, generatedAt: new Date().toISOString(), summary: {}, findings: [] });
    now.get(skill).findings.push({ ...old, carriedFrom: old.carriedFrom ?? fromId });
    now.get(skill).carried = true;
    readded.push(old.id);
  }
}
for (const [skill, file] of now) {
  if (file.carried || (file.findings ?? []).some((finding) => touched.has(finding))) {
    delete file.carried;
    writeJson(path.join(run.dir, "findings", `${skill}.json`), file);
  }
}

const kindOf = (id) => id.replace(/-[0-9a-f]{8}$/, "");
print({
  run: run.id,
  from: fromId,
  filesKnown: true,
  changedFiles: changed.files.length,
  carried: carried.length,
  broughtBack: readded.length,
  carriedByKind: Object.fromEntries(countBy([...carried, ...readded], kindOf)),
  toReadAgain: {
    filesChanged: skipped.filesChanged,
    optionGone: skipped.optionGone,
    subjectGone: skipped.subjectGone,
    noFileToCompare: skipped.noFileToCompare,
  },
  note: "A carried Finding keeps the recommendation an agent gave on the earlier run and says so in `carriedFrom`. Its counts (Reach, evidence) are the new run's.",
});
