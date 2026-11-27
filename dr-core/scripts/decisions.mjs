#!/usr/bin/env node
// dr decisions: the Decision ledger CLI (.dr/decisions.json).
// It only records what it is given; it never invents a decision.
//
//   decisions.mjs open [--kind k] [--zone z] [--focus text] [--limit n] [--deferred]
//   decisions.mjs set <findingId> <optionKey> [--note "text"]
//   decisions.mjs set-many <file.json>          [{ findingId, choice, note }]
//   decisions.mjs applied <findingId> [--lot id]
//   decisions.mjs defer <findingId> --note "who or what is awaited"
//   decisions.mjs reopen <findingId>
//   decisions.mjs status
// Every sub-command accepts --run <id> (default: the latest run).
import fs from "node:fs";
import path from "node:path";
import {
  DR_DIR, projectRoot, loadSettings, resolveRun, readJson, writeJson, writeText,
  loadFindings, mdTable, countBy, argValue, familyIndex, inFocus,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--run", "--kind", "--zone", "--focus", "--limit", "--note", "--lot"]);
const LEDGER_FILE = path.join(root, DR_DIR, "decisions.json");
const LOTS_FILE = path.join(root, DR_DIR, "plan", "lots.json");

function stop(message) {
  process.stderr.write(`dr decisions: ${message}\n`);
  process.exit(1);
}

function positionals() {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (VALUE_FLAGS.has(argv[i])) i += 1;
    else if (!argv[i].startsWith("--")) out.push(argv[i]);
  }
  return out;
}

function today() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return { version: 1, decisions: {} };
  let ledger;
  try {
    ledger = readJson(LEDGER_FILE);
  } catch (error) {
    stop(`${DR_DIR}/decisions.json cannot be read (${error.message}). Fix or remove it; nothing was changed.`);
  }
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) stop(`${DR_DIR}/decisions.json is not a Decision ledger. Nothing was changed.`);
  ledger.version ??= 1;
  ledger.decisions ??= {};
  return ledger;
}

function saveLedger(ledger) {
  const sorted = {};
  for (const id of Object.keys(ledger.decisions).sort()) sorted[id] = ledger.decisions[id];
  writeJson(LEDGER_FILE, { version: ledger.version ?? 1, decisions: sorted });
}

const print = (data) => process.stdout.write(`${JSON.stringify(data, null, 1)}\n`);
const offersChoice = (finding) => (finding.options ?? []).length >= 2;
const isClosed = (entry) => entry?.status === "settled" || entry?.status === "applied";
const byReach = (a, b) =>
  (b.reach?.screens ?? 0) - (a.reach?.screens ?? 0) || (b.reach?.uses ?? 0) - (a.reach?.uses ?? 0) || a.id.localeCompare(b.id);

function runFindings() {
  const run = resolveRun(argv, root);
  const findings = loadFindings(run.dir);
  return { run, findings, byId: new Map(findings.map((finding) => [finding.id, finding])) };
}

// Returns the ledger entry for one request, or an error sentence.
function buildEntry(request, context, previous) {
  const { findingId, choice, note } = request ?? {};
  if (typeof findingId !== "string" || !findingId) return { error: "a finding id is missing." };
  if (typeof choice !== "string" || !choice) return { error: `${findingId}: the chosen option is missing.` };
  const finding = context.byId.get(findingId);
  if (!finding) return { error: `${findingId}: no such Finding in run ${context.run.id}.` };
  const keys = (finding.options ?? []).map((option) => option.key);
  if (!keys.length) return { error: `${findingId}: this Finding is information only, it offers no choice.` };
  if (!keys.includes(choice)) return { error: `${findingId}: "${choice}" is not one of its options (${keys.join(", ")}).` };
  if (note !== undefined && note !== null && typeof note !== "string") return { error: `${findingId}: the note must be text.` };
  return {
    entry: {
      findingId,
      kind: finding.kind,
      title: finding.title,
      subject: finding.subject ?? [],
      status: "settled",
      choice,
      note: note ?? (previous?.status === "deferred" ? null : previous?.note) ?? null,
      decidedAt: today(),
      run: context.run.id,
      lot: null,
      appliedAt: null,
    },
  };
}

// ---- Sub-commands ----------------------------------------------------------

function commandOpen() {
  const context = runFindings();
  const ledger = loadLedger();
  const kind = argValue("--kind", argv);
  const zone = argValue("--zone", argv);
  const limitText = argValue("--limit", argv);
  const limit = limitText === undefined ? Infinity : Number(limitText);
  if (!(limit > 0)) stop(`--limit needs a number above 0, got "${limitText}".`);

  // A deferred Decision waits on someone: it is not asked again until it is reopened
  // or settled, and --deferred lists those instead of the open ones.
  const focus = argValue("--focus", argv);
  if (argv.includes("--focus") && !focus) stop("--focus needs a Zone, a Family, a component name or part of a path.");
  const wantDeferred = argv.includes("--deferred");
  const isDeferred = (finding) => ledger.decisions[finding.id]?.status === "deferred";
  let scope = null;
  if (focus) {
    const graph = readJson(path.join(context.run.dir, "graph.json"));
    scope = { nodesById: new Map(graph.nodes.map((node) => [node.id, node])), families: familyIndex(context.run.dir, graph, loadSettings(root)) };
  }
  const candidates = context.findings
    .filter(offersChoice)
    .filter((finding) => !isClosed(ledger.decisions[finding.id]))
    .filter((finding) => (kind ? finding.kind === kind : true))
    .filter((finding) => (zone ? finding.zone === zone : true))
    .filter((finding) => (scope ? inFocus(finding, focus, scope) : true));
  const deferredCount = candidates.filter(isDeferred).length;
  const open = candidates.filter((finding) => isDeferred(finding) === wantDeferred);
  const groups = countBy(open, (finding) => finding.kind)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([groupKind, count]) => ({
      kind: groupKind,
      count,
      findings: open
        .filter((finding) => finding.kind === groupKind)
        .sort(byReach)
        .slice(0, limit)
        .map((finding) => ({
          id: finding.id,
          title: finding.title,
          subject: finding.subject,
          zone: finding.zone,
          reach: finding.reach,
          effort: finding.effort,
          confidence: finding.confidence,
          options: finding.options,
          recommendation: finding.recommendation,
          judgement: finding.judgement,
          evidence: (finding.evidence ?? []).slice(0, 3),
          ...(wantDeferred ? { waitingOn: ledger.decisions[finding.id]?.note ?? null, deferredAt: ledger.decisions[finding.id]?.decidedAt ?? null } : {}),
        })),
    }));
  print(wantDeferred
    ? { run: context.run.id, deferred: open.length, groups }
    : { run: context.run.id, open: open.length, deferred: deferredCount, groups });
}

function commandSet(requests, single) {
  const context = runFindings();
  const ledger = loadLedger();
  if (!requests.length) stop("nothing to record.");
  const seen = new Set();
  const errors = [];
  const entries = [];
  for (const request of requests) {
    const result = buildEntry(request, context, ledger.decisions[request?.findingId]);
    if (result.error) errors.push(result.error);
    else if (seen.has(result.entry.findingId)) errors.push(`${result.entry.findingId}: listed twice.`);
    else {
      seen.add(result.entry.findingId);
      entries.push(result.entry);
    }
  }
  if (errors.length) {
    stop(`${single ? "" : `${errors.length} of ${requests.length} entries are not valid. `}Nothing was recorded.\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
  for (const entry of entries) ledger.decisions[entry.findingId] = entry;
  saveLedger(ledger);
  print({
    recorded: entries.length,
    run: context.run.id,
    decisions: entries.map((entry) => ({ findingId: entry.findingId, kind: entry.kind, choice: entry.choice, status: entry.status })),
  });
}

function commandApplied(findingId) {
  if (!findingId) stop("usage: decisions.mjs applied <findingId> [--lot id]");
  const ledger = loadLedger();
  const entry = ledger.decisions[findingId];
  if (!entry) stop(`${findingId}: no Decision in the ledger. Settle it first with "set".`);
  if (entry.status === "open") stop(`${findingId}: this Decision is open. Settle it first with "set".`);
  const lot = argValue("--lot", argv);
  if (argv.includes("--lot") && !lot) stop("--lot needs a Lot id.");
  if (lot) {
    const lots = readJson(LOTS_FILE, { lots: [] }).lots ?? [];
    if (lots.length && !lots.some((item) => item.id === lot)) stop(`${lot}: no such Lot in ${DR_DIR}/plan/lots.json.`);
  }
  entry.status = "applied";
  entry.appliedAt = today();
  if (lot) entry.lot = lot;
  saveLedger(ledger);
  print({ findingId, status: entry.status, choice: entry.choice, lot: entry.lot ?? null, appliedAt: entry.appliedAt });
}

// Deferred: the owner cannot answer yet (a designer, a product owner or a measurement
// is awaited). The note says who or what; the Finding is not asked again meanwhile.
function commandDefer(findingId) {
  const note = argValue("--note", argv);
  if (!findingId || !note) stop('usage: decisions.mjs defer <findingId> --note "who or what is awaited"');
  const context = runFindings();
  const ledger = loadLedger();
  const finding = context.byId.get(findingId);
  const previous = ledger.decisions[findingId];
  if (!finding && !previous) stop(`${findingId}: no such Finding in run ${context.run.id}.`);
  if (finding && !offersChoice(finding)) stop(`${findingId}: this Finding is information only, it offers no choice.`);
  if (previous?.status === "applied") stop(`${findingId}: this Decision is applied. Reopen it first if it must be asked again.`);
  ledger.decisions[findingId] = {
    findingId,
    kind: finding?.kind ?? previous.kind,
    title: finding?.title ?? previous.title,
    subject: finding?.subject ?? previous.subject ?? [],
    status: "deferred",
    choice: null,
    note,
    decidedAt: today(),
    run: context.run.id,
    lot: null,
    appliedAt: null,
  };
  saveLedger(ledger);
  print({ findingId, status: "deferred", waitingOn: note });
}

function commandReopen(findingId) {
  if (!findingId) stop("usage: decisions.mjs reopen <findingId>");
  const ledger = loadLedger();
  const entry = ledger.decisions[findingId];
  if (!entry) stop(`${findingId}: no Decision in the ledger, so it is already open.`);
  entry.status = "open";
  entry.choice = null;
  entry.lot = null;
  entry.appliedAt = null;
  saveLedger(ledger);
  print({ findingId, status: entry.status });
}

function commandStatus() {
  const context = runFindings();
  const ledger = loadLedger();
  loadSettings(root);
  const entries = Object.values(ledger.decisions);
  const deferred = entries.filter((entry) => entry.status === "deferred");
  const deferredIds = new Set(deferred.map((entry) => entry.findingId));
  const open = context.findings.filter(offersChoice).filter((finding) => !isClosed(ledger.decisions[finding.id]) && !deferredIds.has(finding.id));
  const settled = entries.filter((entry) => entry.status === "settled");
  const applied = entries.filter((entry) => entry.status === "applied");
  const notInRun = entries.filter((entry) => isClosed(entry) && !context.byId.has(entry.findingId));

  const kinds = new Map();
  const bump = (kind, status) => {
    if (!kinds.has(kind)) kinds.set(kind, { kind, open: 0, deferred: 0, settled: 0, applied: 0 });
    kinds.get(kind)[status] += 1;
  };
  for (const finding of open) bump(finding.kind, "open");
  for (const entry of deferred) bump(entry.kind, "deferred");
  for (const entry of settled) bump(entry.kind, "settled");
  for (const entry of applied) bump(entry.kind, "applied");
  const byKind = [...kinds.values()].sort((a, b) => a.kind.localeCompare(b.kind));

  const sortEntries = (list) => [...list].sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title) || a.findingId.localeCompare(b.findingId));
  const flag = (entry) => (context.byId.has(entry.findingId) ? "" : " (not in this run)");
  const lines = [
    "# Decisions",
    "",
    `Run ${context.run.id}. The Decision ledger is \`${DR_DIR}/decisions.json\`; it lasts across Runs.`,
    "",
    `- Open: **${open.length}**`,
    `- Waiting on someone: **${deferred.length}**`,
    `- Settled, not applied yet: **${settled.length}** (${settled.filter((entry) => entry.choice === "keep").length} of them "keep", nothing to rework)`,
    `- Applied: **${applied.length}**`,
    "",
    "## Open, per kind",
    "",
    open.length
      ? mdTable(["Kind", "Open", "Largest reach (screens)"], countBy(open, (finding) => finding.kind)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([kind, count]) => [kind, count, Math.max(...open.filter((finding) => finding.kind === kind).map((finding) => finding.reach?.screens ?? 0))]))
      : "No open Decision in this run.",
    "",
    "## Waiting on someone",
    "",
    deferred.length
      ? `These cannot be answered by the owner alone. Each note says who or what is awaited; the list can be sent as it is.\n\n${mdTable(["Question", "Kind", "Waiting on", "Since", "Id"], sortEntries(deferred).map((entry) => [`${entry.title}${flag(entry)}`, entry.kind, entry.note ?? "", entry.decidedAt, entry.findingId]))}`
      : "Nothing is waiting on anyone.",
    "",
    "## Settled",
    "",
    settled.length
      ? mdTable(["Finding", "Kind", "Choice", "Note", "Date", "Id"], sortEntries(settled).map((entry) => [`${entry.title}${flag(entry)}`, entry.kind, entry.choice, entry.note ?? "", entry.decidedAt, entry.findingId]))
      : "Nothing settled yet.",
    "",
    "## Applied",
    "",
    applied.length
      ? mdTable(["Finding", "Kind", "Choice", "Note", "Settled", "Applied", "Lot", "Id"], sortEntries(applied).map((entry) => [`${entry.title}${flag(entry)}`, entry.kind, entry.choice, entry.note ?? "", entry.decidedAt, entry.appliedAt ?? "", entry.lot ?? "", entry.findingId]))
      : "Nothing applied yet.",
    "",
  ];
  if (notInRun.length) {
    lines.push(`${notInRun.length} recorded Decision${notInRun.length === 1 ? " has" : "s have"} no Finding in this run: the rework may be done, or the Finding's report was not produced in this run.`, "");
  }
  const report = path.join(context.run.dir, "reports", "decisions.md");
  writeText(report, lines.join("\n"));
  print({
    run: context.run.id,
    counts: { open: open.length, deferred: deferred.length, settled: settled.length, applied: applied.length },
    byKind,
    notInRun: notInRun.map((entry) => entry.findingId).sort(),
    report: path.relative(root, report),
  });
}

// ---- Dispatch --------------------------------------------------------------

const [command, ...rest] = positionals();
switch (command) {
  case "open":
    commandOpen();
    break;
  case "set": {
    if (rest.length < 2) stop('usage: decisions.mjs set <findingId> <optionKey> [--note "text"]');
    if (argv.includes("--note") && argValue("--note", argv) === undefined) stop("--note needs a text.");
    commandSet([{ findingId: rest[0], choice: rest[1], note: argValue("--note", argv) }], true);
    break;
  }
  case "set-many": {
    if (!rest[0]) stop("usage: decisions.mjs set-many <file.json>");
    let requests;
    try {
      requests = readJson(path.resolve(root, rest[0]));
    } catch (error) {
      stop(`${rest[0]} cannot be read as JSON (${error.message}). Nothing was recorded.`);
    }
    if (!Array.isArray(requests)) stop(`${rest[0]} must hold a JSON array of { findingId, choice, note }. Nothing was recorded.`);
    commandSet(requests, false);
    break;
  }
  case "applied":
    commandApplied(rest[0]);
    break;
  case "defer":
    commandDefer(rest[0]);
    break;
  case "reopen":
    commandReopen(rest[0]);
    break;
  case "status":
    commandStatus();
    break;
  default:
    stop(`${command ? `unknown sub-command "${command}". ` : ""}Use one of: open, set, set-many, defer, applied, reopen, status.`);
}
