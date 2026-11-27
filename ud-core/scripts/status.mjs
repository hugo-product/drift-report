#!/usr/bin/env node
// ud status: where a project stands, and the one next step that makes sense.
// Reads only; writes nothing. Works before ud-init and before the first run.
//
//   status.mjs
import fs from "node:fs";
import path from "node:path";
import {
  UD_DIR, projectRoot, listRuns, runsDir, readJson, git, dirtyState, changedBetween,
  matchesAny, offersChoice, isJudged,
} from "./lib.mjs";

const root = projectRoot();
const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 1)}\n`);
const AUDITS = ["tokens", "components", "stories", "states", "patterns"];

const settingsFile = path.join(root, UD_DIR, "settings.json");
if (!fs.existsSync(settingsFile)) {
  print({
    stage: "no-settings",
    settings: false,
    next: { command: "/ud-init", why: "This project has no .ud/settings.json yet. Setting it up takes a few questions and changes no tracked file." },
    then: [],
  });
  process.exit(0);
}
const settings = readJson(settingsFile, {});
const runs = listRuns(root);
if (!runs.length) {
  print({
    stage: "no-run",
    settings: true,
    project: settings.project?.name ?? null,
    zones: (settings.zones ?? []).map((zone) => zone.name),
    next: { command: "/ud full", why: "No run yet. The scan and the five counts take seconds and ask nothing; you choose how much gets judged once the counts are known." },
    then: [{ command: "/ud focus <family or zone>", why: "To look at one part only, such as the buttons." }],
  });
  process.exit(0);
}

// ---- The latest run -----------------------------------------------------------

const runId = runs.at(-1);
const runDir = path.join(runsDir(root), runId);
const meta = readJson(path.join(runDir, "run.json"), {});
const head = git(["rev-parse", "HEAD"], root);
const interfaceFile = (file) =>
  (settings.sourceDirs ?? []).some((dir) => file === dir || file.startsWith(`${dir}/`))
  || (settings.tokenFiles ?? []).includes(file)
  || matchesAny(file, settings.stack?.storybook?.storyGlobs ?? []);
const since = changedBetween(meta, { commit: head, ...dirtyState(root) }, root);
const changedInterface = since.files.filter(interfaceFile);
const startedAt = meta.startedAt ? new Date(meta.startedAt) : null;
const ageDays = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 86400000) : null;

const findingsDir = path.join(runDir, "findings");
const steps = [];
const all = [];
for (const name of fs.existsSync(findingsDir) ? fs.readdirSync(findingsDir).filter((file) => file.endsWith(".json")).sort() : []) {
  const findings = readJson(path.join(findingsDir, name), {}).findings ?? [];
  const choices = findings.filter(offersChoice);
  steps.push({
    skill: `ud-${name.replace(/\.json$/, "")}`,
    findings: findings.length,
    choices: choices.length,
    judged: choices.filter(isJudged).length,
  });
  all.push(...findings);
}
const ran = new Set(steps.map((step) => step.skill.slice(3)));
const missing = AUDITS.filter((name) => !ran.has(name));
const hasMap = fs.existsSync(path.join(runDir, "map.html"));
const hasBrief = fs.existsSync(path.join(runDir, "reports", "brief.md"));

// ---- Decisions and lots ---------------------------------------------------------

const ledger = readJson(path.join(root, UD_DIR, "decisions.json"), { decisions: {} }).decisions ?? {};
const entries = Object.values(ledger);
const statusOf = (id) => ledger[id]?.status ?? "open";
const choices = all.filter(offersChoice);
const open = choices.filter((finding) => !["settled", "applied", "deferred"].includes(statusOf(finding.id)));
const lots = readJson(path.join(root, UD_DIR, "plan", "lots.json"), { lots: [] }).lots ?? [];
const inLot = new Set(lots.flatMap((lot) => lot.decisions ?? []));
const toPlan = entries.filter((entry) => entry.status === "settled" && entry.choice !== "keep" && !inLot.has(entry.findingId));
const done = new Set(lots.filter((lot) => lot.status === "done").map((lot) => lot.id));
const inProgress = lots.filter((lot) => lot.status === "in-progress");
const ready = lots
  .filter((lot) => lot.status === "planned" && (lot.dependsOn ?? []).every((id) => done.has(id)))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const decisions = {
  open: open.length,
  openJudged: open.filter(isJudged).length,
  deferred: entries.filter((entry) => entry.status === "deferred").length,
  settled: entries.filter((entry) => entry.status === "settled").length,
  settledNotPlanned: toPlan.length,
  applied: entries.filter((entry) => entry.status === "applied").length,
};

// ---- The next step: the first rule that applies ----------------------------------

const options = [];
const offer = (stage, command, why) => options.push({ stage, command, why });
const s = (n) => (n === 1 ? "" : "s");
if (inProgress.length) offer("lot-in-progress", `/ud-rework ${inProgress[0].id}`, `Lot ${inProgress[0].id} ("${inProgress[0].title}") was started and is not closed.`);
if (missing.length) offer("audit-incomplete", "/ud resume", `Run ${runId} stopped early: ${missing.map((name) => `ud-${name}`).join(", ")} ${missing.length === 1 ? "has" : "have"} not run.`);
if (changedInterface.length) offer("stale", "/ud changed", `${changedInterface.length} interface file${s(changedInterface.length)} changed since run ${runId}; what follows would rest on old counts.`);
else if (!since.known) offer("stale", "/ud changed", `It cannot be told whether the code changed since run ${runId}. ${since.note}`);
if (ready.length) offer("lot-ready", `/ud-rework ${ready[0].id}`, `Lot ${ready[0].id} ("${ready[0].title}") is planned and nothing blocks it.${ready.length > 1 ? ` ${ready.length - 1} more ${ready.length === 2 ? "is" : "are"} ready after it.` : ""}`);
if (toPlan.length) offer("to-plan", "/ud-plan", `${toPlan.length} settled Decision${s(toPlan.length)} ask${toPlan.length === 1 ? "s" : ""} for a change and ${toPlan.length === 1 ? "is" : "are"} in no Lot yet.`);
if (open.length && !decisions.openJudged && !missing.length) offer("to-judge", "/ud resume", `${open.length} Finding${s(open.length)} wait for an answer and none has been read by a judging agent, so none carries a recommendation.`);
if (open.length) offer("to-decide", "/ud-decide", `${open.length} Finding${s(open.length)} wait for your answer${decisions.openJudged ? `, ${decisions.openJudged} with a recommendation` : ""}. A round is 5 to 9 of them; you can stop after any round.`);
if (decisions.deferred) offer("waiting", "/ud-decide deferred", `${decisions.deferred} Decision${s(decisions.deferred)} wait${decisions.deferred === 1 ? "s" : ""} on someone else. Ask them, then settle.`);
if (!options.length) offer("up-to-date", "/ud changed", "Nothing is open, planned or stale. Run this again after the next piece of interface work.");

print({
  stage: options[0].stage,
  settings: true,
  project: settings.project?.name ?? null,
  zones: (settings.zones ?? []).map((zone) => zone.name),
  run: { id: runId, ageDays, commit: meta.commit || null, branch: meta.branch || null, counts: meta.counts ?? {} },
  runs: runs.length,
  sinceRun: { known: since.known, interfaceFilesChanged: changedInterface.length, sample: changedInterface.slice(0, 8), ...(since.known ? {} : { note: since.note }) },
  steps,
  notRun: missing.map((name) => `ud-${name}`),
  map: hasMap ? path.relative(root, path.join(runDir, "map.html")) : null,
  brief: hasBrief ? path.relative(root, path.join(runDir, "reports", "brief.md")) : null,
  decisions,
  lots: {
    planned: lots.filter((lot) => lot.status === "planned").length,
    inProgress: inProgress.map((lot) => lot.id),
    done: done.size,
    ready: ready.map((lot) => lot.id),
  },
  next: { command: options[0].command, why: options[0].why },
  then: options.slice(1, 4).map(({ command, why }) => ({ command, why })),
});
