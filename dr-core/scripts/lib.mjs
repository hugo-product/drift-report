// Shared helpers for the DR suite scripts. Node 20+, no dependencies.
// The audited project's own `typescript` package is used for parsing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export const DR_DIR = ".dr";

export function projectRoot() {
  return process.cwd();
}

export function fail(message) {
  process.stderr.write(`dr: ${message}\n`);
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
  const file = path.join(root, DR_DIR, "settings.json");
  if (!fs.existsSync(file)) fail(`no ${DR_DIR}/settings.json here. Run /dr-init first.`);
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
  return path.join(root, DR_DIR, "runs");
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
  if (!id || !runs.includes(id)) fail("no run found. Run /dr-scan first.");
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

const ALWAYS_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", "storybook-static", DR_DIR]);

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
    generatedBy: `dr-${name}`,
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

// ---- What changed between two runs -------------------------------------------

// Files changed in the working tree at the time of a call (tracked and untracked).
export function dirtyFilesNow(root = projectRoot()) {
  return git(["status", "--porcelain", "--untracked-files=all"], root)
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^\s*[A-Z?!]{1,2}\s+/, "").split(" -> ").pop().replace(/^"|"$/g, ""))
    .filter((file) => !file.startsWith(`${DR_DIR}/`))
    .sort();
}

// The uncommitted files with a hash of what each holds, so that two runs made on the
// same uncommitted work are not told apart. A deleted file has the hash null.
export function dirtyState(root = projectRoot()) {
  const dirtyFiles = dirtyFilesNow(root);
  const dirtyHashes = {};
  for (const file of dirtyFiles) {
    try {
      dirtyHashes[file] = crypto.createHash("sha1").update(fs.readFileSync(path.join(root, file))).digest("hex").slice(0, 12);
    } catch {
      dirtyHashes[file] = null;
    }
  }
  return { dirty: dirtyFiles.length > 0, dirtyFiles, dirtyHashes };
}

// Files that differ between two runs: the commits' diff plus what was uncommitted
// when each run was made. `known` is false when that cannot be worked out.
export function changedBetween(beforeMeta = {}, nowMeta = {}, root = projectRoot()) {
  const a = beforeMeta.commit || "";
  const b = nowMeta.commit || "";
  if (!a || !b) return { known: false, files: [], note: "At least one of the two runs has no commit recorded (the project was not a Git repository then), so the changed files are not known." };
  let files = [];
  let note;
  if (a === b) note = "Both runs were made on the same commit.";
  else if (!git(["cat-file", "-t", a], root) || !git(["cat-file", "-t", b], root)) {
    return { known: false, files: [], note: "One of the two commits is no longer in this repository, so the changed files are not known." };
  } else {
    files = git(["diff", "--name-only", a, b], root).split("\n").filter(Boolean);
    note = `${files.length} file${files.length === 1 ? "" : "s"} changed between ${a.slice(0, 7)} and ${b.slice(0, 7)}.`;
  }
  const unlisted = [beforeMeta, nowMeta].filter((meta) => meta.dirty && !Array.isArray(meta.dirtyFiles));
  if (unlisted.length) {
    return { known: false, files: [...new Set(files)].sort(), note: `${note} At least one run was made with uncommitted changes that were not listed (a run made before the scan recorded them), so the full list is not known.` };
  }
  const hashOf = (meta, file) => ((meta.dirtyFiles ?? []).includes(file) ? meta.dirtyHashes?.[file] ?? "?" : "clean");
  const uncommitted = [...new Set([...(beforeMeta.dirtyFiles ?? []), ...(nowMeta.dirtyFiles ?? [])])]
    .filter((file) => a !== b || hashOf(beforeMeta, file) === "?" || hashOf(beforeMeta, file) !== hashOf(nowMeta, file));
  if (uncommitted.length) note += ` ${uncommitted.length} more file${uncommitted.length === 1 ? " was" : "s were"} uncommitted and differed between the two.`;
  return { known: true, files: [...new Set([...files, ...uncommitted])].sort(), note };
}

// ---- Findings, their files and their components -------------------------------

const FILE_LIKE = /^[^:#]+\.(tsx?|jsx?|mjs|cjs|css|scss|mdx?|json|svg)$/i;

// The files a Finding is about: its subject's files, then its evidence.
export function filesOfFinding(finding, nodesById = new Map()) {
  const files = new Set();
  const add = (file) => {
    if (typeof file === "string" && FILE_LIKE.test(file)) files.add(file);
  };
  for (const subject of finding.subject ?? []) {
    const text = String(subject);
    const node = nodesById.get(text);
    if (node?.file) add(node.file);
    else if (/^[cysm]:/.test(text)) add(text.slice(2).split("#")[0]);
    else if (text.startsWith("file:")) add(text.slice(5));
    else add(text);
  }
  for (const item of finding.evidence ?? []) add(item?.file);
  for (const item of Array.isArray(finding.data?.files) ? finding.data.files : []) add(typeof item === "string" ? item : item?.file);
  return [...files].sort();
}

// The component nodes a Finding is about (a story stands for the component it names).
export function componentsOfFinding(finding, nodesById) {
  const out = [];
  for (const subject of finding.subject ?? []) {
    const node = nodesById.get(String(subject));
    if (node?.kind === "component") out.push(node);
    else if (node?.kind === "story" && node.data?.component && nodesById.get(node.data.component)) out.push(nodesById.get(node.data.component));
  }
  return [...new Set(out)];
}

// Component id -> Family name: from the components report when it ran, else from the family words.
export function familyIndex(runDir, graph, settings) {
  const index = new Map();
  const families = readJson(path.join(runDir, "work", "families.json"), { families: [] }).families ?? [];
  for (const family of families) for (const member of family.members ?? []) index.set(member.id, family.name);
  if (index.size) return index;
  const defaults = readJson(new URL("../defaults.json", import.meta.url), {});
  const words = new Set(settings.familyWords ?? defaults.familyWords ?? []);
  for (const node of graph.nodes ?? []) {
    if (node.kind !== "component") continue;
    const parts = String(node.name ?? "").match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*/g) ?? [];
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (words.has(parts[i])) {
        index.set(node.id, parts[i]);
        break;
      }
    }
  }
  return index;
}

// Does a Finding belong to a focus? The focus is one word or path from the owner:
// a Zone, a Family, a component name, or part of a file path. Case does not matter.
export function inFocus(finding, focus, { nodesById, families }) {
  const want = String(focus ?? "").trim().toLowerCase();
  if (!want) return true;
  if (String(finding.zone ?? "").toLowerCase() === want) return true;
  for (const node of componentsOfFinding(finding, nodesById)) {
    if (String(node.name).toLowerCase() === want) return true;
    if (String(families.get(node.id) ?? "").toLowerCase() === want) return true;
  }
  if (String(finding.data?.family ?? "").toLowerCase() === want) return true;
  if (want.length < 3) return false;
  return filesOfFinding(finding, nodesById).some((file) => file.toLowerCase().includes(want));
}

export const offersChoice = (finding) => (finding.options ?? []).length >= 2;
export const isJudged = (finding) => finding.source === "agent" || Boolean(finding.recommendation);

// ---- Classes that draw the same thing ------------------------------------------

// Token name -> its value, written the same way whatever the spelling.
export function loadTokenValues(runDir) {
  const values = new Map();
  for (const token of readJson(path.join(runDir, "facts", "tokens.json"), { tokens: [] }).tokens ?? []) {
    const value = token.declarations?.[0]?.value;
    if (typeof value === "string") values.set(token.name, value.trim().toLowerCase().replace(/\s+/g, ""));
  }
  return values;
}

// `bg-[#dbeafe]` and `bg-brand-soft` (when --color-brand-soft is #dbeafe) both become
// `bg=#dbeafe`; `text-[11px]` and `text-tiny` both become `text=11px`.
const TOKEN_SPACES = { text: ["color", "text", "font-size"], rounded: ["radius"], shadow: ["shadow"], font: ["font", "font-weight"] };
export function sameLook(utility, tokenValues = new Map()) {
  const arbitrary = /^(.+?)-\[(.+)\]$/.exec(utility);
  if (arbitrary) return `${arbitrary[1]}=${arbitrary[2].toLowerCase().replace(/[\s_]+/g, "")}`;
  const dash = utility.indexOf("-");
  if (dash < 1) return utility;
  const prefix = utility.slice(0, dash);
  const rest = utility.slice(dash + 1);
  for (const space of TOKEN_SPACES[prefix] ?? ["color", "spacing"]) {
    const value = tokenValues.get(`--${space}-${rest}`);
    if (value) return `${prefix}=${value}`;
  }
  return utility;
}
