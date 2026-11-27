// Shared helpers for the UD suite scripts. Node 20+, no dependencies.
// The audited project's own `typescript` package is used for parsing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export const UD_DIR = ".ud";

export function projectRoot() {
  return process.cwd();
}

export function fail(message) {
  process.stderr.write(`ud: ${message}\n`);
  process.exit(1);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function loadSettings(root = projectRoot()) {
  const file = path.join(root, UD_DIR, "settings.json");
  if (!fs.existsSync(file)) fail(`no ${UD_DIR}/settings.json here. Run /ud-init first.`);
  return readJson(file);
}

export function loadTypeScript(root = projectRoot()) {
  try {
    const require = createRequire(path.join(root, "package.json"));
    return require("typescript");
  } catch {
    fail("the project has no `typescript` package installed; the scan needs it.");
  }
}

export function git(args, root = projectRoot()) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// ---- Runs -----------------------------------------------------------------

export function runsDir(root = projectRoot()) {
  return path.join(root, UD_DIR, "runs");
}

export function listRuns(root = projectRoot()) {
  const dir = runsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, "graph.json")))
    .sort();
}

// Resolves `--run <id>`; defaults to the latest run.
export function resolveRun(argv = process.argv.slice(2), root = projectRoot()) {
  const index = argv.indexOf("--run");
  const runs = listRuns(root);
  const id = index >= 0 ? argv[index + 1] : runs.at(-1);
  if (!id || !runs.includes(id)) fail("no run found. Run /ud-scan first.");
  return { id, dir: path.join(runsDir(root), id) };
}

export function argValue(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

// ---- Globs ----------------------------------------------------------------

const globCache = new Map();
export function globToRegExp(glob) {
  if (globCache.has(glob)) return globCache.get(glob);
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i += 1;
        if (glob[i + 1] === "/") i += 1;
      } else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else if (char === "{") out += "(?:";
    else if (char === "}") out += ")";
    else if (char === ",") out += "|";
    else out += char.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  const regexp = new RegExp(`^${out}$`);
  globCache.set(glob, regexp);
  return regexp;
}

export function matchesAny(file, globs = []) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

export function zoneOf(file, settings) {
  for (const zone of settings.zones ?? []) {
    if (matchesAny(file, zone.include)) return zone.name;
  }
  return "unzoned";
}

export function isReadOnly(file, settings) {
  return matchesAny(file, settings.readOnly ?? []);
}

// ---- Files ----------------------------------------------------------------

const ALWAYS_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", "storybook-static", UD_DIR]);

export function walk(root, dirs, exclude = []) {
  const found = [];
  const visit = (rel) => {
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (matchesAny(child, exclude)) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) found.push(child);
    }
  };
  for (const dir of dirs) visit(dir);
  return found.sort();
}

// ---- Findings -------------------------------------------------------------

// A finding id is stable across runs: it depends on the kind and the subject,
// never on counts or wording, so the decision ledger can refer to it.
export function findingId(kind, subject) {
  const key = `${kind}|${[].concat(subject).map(String).sort().join("|")}`;
  return `${kind}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}

export function finding({ kind, title, subject, zone, evidence = [], reach, options = [], data, confidence }) {
  return {
    id: findingId(kind, subject),
    kind,
    title,
    subject: [].concat(subject),
    zone: zone ?? "unzoned",
    reach: reach ?? { screens: 0, uses: 0 },
    effort: null, // XS | S | M | L, set by a judging agent
    confidence: confidence ?? null, // 0..1, set by a script signal or a judging agent
    evidence,
    options, // [{ key, label }]
    recommendation: null, // an option key, set by a judging agent
    judgement: null, // free text from a judging agent
    source: "script",
    data: data ?? {},
  };
}

export function writeFindings(runDir, name, findings, summary = {}) {
  writeJson(path.join(runDir, "findings", `${name}.json`), {
    generatedBy: `ud-${name}`,
    generatedAt: new Date().toISOString(),
    summary,
    findings,
  });
}

export function loadFindings(runDir) {
  const dir = path.join(runDir, "findings");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => readJson(path.join(dir, name)).findings ?? []);
}

// ---- Tailwind class helpers ------------------------------------------------

// "md:hover:bg-[#fff]/50" -> { variants: ["md","hover"], utility: "bg-[#fff]/50" }
export function splitClass(token) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of token) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  let utility = current;
  let important = false;
  if (utility.startsWith("!")) {
    utility = utility.slice(1);
    important = true;
  } else if (utility.endsWith("!")) {
    utility = utility.slice(0, -1);
    important = true;
  }
  return { variants: parts, utility, important };
}

export function tokenizeClasses(text) {
  const tokens = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function mdTable(headers, rows) {
  const escape = (cell) => String(cell ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

export function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
