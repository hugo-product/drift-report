#!/usr/bin/env node
// dr-tokens: reads the facts of a Run and reports on tokens and raw values:
// unused and undeclared tokens, hard-coded colours, recurring values that are not
// written down, the four scales (text size, spacing, radius, shadow) with a Scale
// suggestion, font aliases, one-off breakpoints and inline styles.
//
//   node tokens-report.mjs [--run <id>]     run from the project root
//
// Writes .dr/runs/<id>/findings/tokens.json and .dr/runs/<id>/reports/tokens.md
import path from "node:path";
import { loadSettings, resolveRun, readJson, writeText, finding, writeFindings, mdTable, splitClass, zoneOf } from "./lib.mjs";

const root = process.cwd();
const defaults = readJson(new URL("../defaults.json", import.meta.url));
const settings = mergeSettings(defaults, loadSettings(root));
const run = resolveRun();
const fact = (name, fallback) => readJson(path.join(run.dir, "facts", `${name}.json`), fallback);

const tokenFacts = fact("tokens", { tokens: [], undeclared: [] });
const classFacts = fact("classes", { byFile: {}, arbitrary: [] });
const rawFacts = fact("raw-values", { code: [], css: [], inlineStyles: [] });
const fileFacts = fact("files", { files: [], imports: {} });

const thresholds = settings.thresholds ?? {};
const RECURRING = thresholds.recurringValue ?? 5;
const ONE_OFF = thresholds.breakpointOneOff ?? 5;
const COVERAGE = thresholds.scaleCoverage ?? 0.8;
const MIN_SHARE = thresholds.scaleMinShare ?? 0.05;
const TABLE_CAP = 40;
const TAILWIND_V3 = /v3/.test(settings.stack?.styling ?? "");

// ---- Small helpers ----------------------------------------------------------

function mergeSettings(base, own) {
  const merged = { ...base, ...own };
  for (const [key, value] of Object.entries(base)) {
    const mine = own[key];
    if (value && typeof value === "object" && !Array.isArray(value) && mine && typeof mine === "object" && !Array.isArray(mine)) merged[key] = { ...value, ...mine };
  }
  return merged;
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const inc = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const round = (number, digits = 2) => Number(number.toFixed(digits));
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const code = (text) => `\`${String(text).replace(/`/g, "'")}\``;
const sortedCounts = (map) => [...map.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));

const fileInfo = new Map(fileFacts.files.map((entry) => [entry.file, entry]));
const screensOfFile = (file) => fileInfo.get(file)?.screens ?? 0;
const zoneOfFile = (file) => fileInfo.get(file)?.zone ?? zoneOf(file, settings);
const maxScreens = (files) => Math.max(0, ...[...files].map(screensOfFile));
// The Zone where most of the occurrences are.
function mainZone(fileCounts) {
  const zones = new Map();
  for (const [file, count] of fileCounts) inc(zones, zoneOfFile(file), count);
  return sortedCounts(zones)[0]?.[0] ?? "unzoned";
}

// "text-sm/6" -> "text-sm": drops a modifier written after the last top-level slash.
function stripModifier(utility) {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < utility.length; index += 1) {
    const char = utility[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === "/" && depth === 0) cut = index;
  }
  return cut > 0 ? utility.slice(0, cut) : utility;
}

// ---- Tokens -----------------------------------------------------------------

const tokens = [...tokenFacts.tokens].sort((a, b) => cmp(a.name, b.name));
const tokenByName = new Map(tokens.map((token) => [token.name, token]));
const firstValue = (name) => tokenByName.get(name)?.declarations[0]?.value ?? null;
const VAR_ONLY = /^var\(\s*(--[\w-]+)\s*\)$/;

function resolveValue(value, depth = 0) {
  const match = VAR_ONLY.exec(String(value ?? "").trim());
  if (!match || depth > 4) return value;
  const next = firstValue(match[1]);
  return next == null ? value : resolveValue(next, depth + 1);
}
function toPx(raw) {
  if (raw == null) return null;
  const value = String(resolveValue(String(raw).replace(/_/g, " ").trim())).trim();
  let match = /^(-?[\d.]+)px$/.exec(value);
  if (match) return Number(match[1]);
  match = /^(-?[\d.]+)rem$/.exec(value);
  if (match) return round(Number(match[1]) * 16, 3);
  if (/^-?0$/.test(value)) return 0;
  return null;
}
// Names of the theme tokens of one namespace: "--radius-card" -> "card".
function themeNames(namespace) {
  const names = new Map();
  for (const token of tokens) {
    if (!token.name.startsWith(`--${namespace}-`)) continue;
    const short = token.name.slice(namespace.length + 3);
    if (!short.includes("--")) names.set(short, token);
  }
  return names;
}
const textTokens = themeNames("text");
const radiusTokens = themeNames("radius");
const shadowTokens = themeNames("shadow");
const spacingTokens = themeNames("spacing");
const breakpointTokens = themeNames("breakpoint");
const containerTokens = themeNames("container");
const fontWeightTokens = themeNames("font-weight");
const fontTokens = new Map([...themeNames("font")].filter(([name]) => !name.startsWith("weight-")));
const spacingBase = toPx(firstValue("--spacing")) ?? 4;

// ---- Class uses -------------------------------------------------------------

const classUses = [];
for (const file of Object.keys(classFacts.byFile).sort()) {
  for (const token of Object.keys(classFacts.byFile[file]).sort()) {
    const { variants, utility } = splitClass(token);
    if (!utility) continue;
    classUses.push({ file, token, count: classFacts.byFile[file][token], variants, utility: stripModifier(utility) });
  }
}
const firstLine = new Map();
for (const entry of classFacts.arbitrary) {
  const key = `${entry.file}\n${entry.token}`;
  if (!firstLine.has(key) || entry.line < firstLine.get(key)) firstLine.set(key, entry.line);
}
function sampleOf(use) {
  const line = firstLine.get(`${use.file}\n${use.token}`);
  return line ? { file: use.file, line, note: use.token } : { file: use.file, note: use.token };
}
function bucket(map, key, init) {
  if (!map.has(key)) map.set(key, { ...init, count: 0, spellings: new Map(), files: new Map(), samples: [] });
  return map.get(key);
}
function addUse(entry, use, spelling) {
  entry.count += use.count;
  inc(entry.spellings, spelling, use.count);
  inc(entry.files, use.file, use.count);
  if (entry.samples.length < 10) entry.samples.push(sampleOf(use));
}

const findings = [];
const KEEP = { key: "keep", label: "Leave as it is" };

// ---- token-unused -----------------------------------------------------------

// The scan does not count spacing, breakpoint and container theme tokens through
// their utilities, so that use is counted here before calling a token unused.
const SPACING_ROOT = /^-?(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|w|h|size|min-[wh]|max-[wh]|inset(-[xy])?|top|right|bottom|left|start|end|basis|translate(-[xy])?|scroll-[mp][xytrblse]?|indent|border-spacing(-[xy])?)$/;
const extraUse = new Map();
for (const use of classUses) {
  for (const variant of use.variants) {
    const name = variant.replace(/^(max|min)-/, "");
    if (breakpointTokens.has(name)) inc(extraUse, breakpointTokens.get(name).name, use.count);
    const container = variant.replace(/^@(max-|min-)?/, "").replace(/\/.*$/, "");
    if (variant.startsWith("@") && containerTokens.has(container)) inc(extraUse, containerTokens.get(container).name, use.count);
  }
  const dash = use.utility.lastIndexOf("-");
  for (let index = use.utility.indexOf("-"); index > 0 && index <= dash; index = use.utility.indexOf("-", index + 1)) {
    const head = use.utility.slice(0, index);
    const tail = use.utility.slice(index + 1);
    if (spacingTokens.has(tail) && SPACING_ROOT.test(head)) inc(extraUse, spacingTokens.get(tail).name, use.count);
    if (containerTokens.has(tail) && /^(w|min-w|max-w|basis|columns)$/.test(head)) inc(extraUse, containerTokens.get(tail).name, use.count);
    if (index === -1) break;
  }
}
const totalUse = (token) => token.uses.total + (extraUse.get(token.name) ?? 0);
const isUsed = (token) => {
  if (totalUse(token) > 0) return true;
  const parent = /^(--[\w-]+?)--[\w-]+$/.exec(token.name); // --text-xs--line-height follows --text-xs
  if (parent && tokenByName.has(parent[1])) return totalUse(tokenByName.get(parent[1])) > 0;
  return false;
};
const FRAMEWORK_TOKEN = /^--(tw-|default-|spacing$)/;
const skippedFrameworkTokens = [];
for (const token of tokens) {
  if (isUsed(token)) continue;
  if (FRAMEWORK_TOKEN.test(token.name)) {
    skippedFrameworkTokens.push(token.name);
    continue;
  }
  const declaration = token.declarations[0];
  findings.push(finding({
    kind: "token-unused",
    title: `The token ${token.name} is declared but nothing uses it`,
    subject: `t:${token.name}`,
    zone: "tokens",
    reach: { screens: 0, uses: 0 },
    confidence: token.theme ? 0.9 : 0.7,
    evidence: token.declarations.slice(0, 10).map((entry) => ({ file: entry.file, line: entry.line, note: `${entry.scope}: ${entry.value}` })),
    options: [{ key: "remove", label: "Remove the token" }, KEEP],
    data: { name: token.name, category: token.category, theme: token.theme, value: declaration?.value ?? null, declarations: token.declarations.length },
  }));
}

// ---- token-undeclared -------------------------------------------------------

const FRAMEWORK_VAR = /^--(tw-|font-|radix-|next-|vaul-|sb-)/;
for (const entry of [...tokenFacts.undeclared].sort((a, b) => cmp(a.name, b.name))) {
  const likelyFramework = FRAMEWORK_VAR.test(entry.name);
  findings.push(finding({
    kind: "token-undeclared",
    title: `var(${entry.name}) is used but never declared in the scanned CSS`,
    subject: `t:${entry.name}`,
    zone: mainZone(entry.files.map((file) => [file, 1])),
    reach: { screens: maxScreens(entry.files), uses: entry.uses },
    confidence: likelyFramework ? 0.3 : 0.8,
    evidence: [
      ...entry.files.map((file) => ({ file, note: `uses var(${entry.name})` })),
      ...tokens.flatMap((token) => token.declarations.filter((declaration) => declaration.value.includes(`var(${entry.name}`)).map((declaration) => ({ file: declaration.file, line: declaration.line, note: `${token.name}: ${declaration.value}` }))),
    ].slice(0, 10),
    options: [
      { key: "declare", label: "Declare the token in the CSS" },
      { key: "fix-reference", label: "Point the reference to an existing token" },
      KEEP,
    ],
    data: {
      name: entry.name,
      likelyFramework,
      note: "A variable injected at run time by a framework or a library (for example a next/font variable such as --font-x, or a Radix or Tailwind internal variable) shows up here and is usually fine.",
    },
  }));
}

// ---- raw-color --------------------------------------------------------------

function normColor(raw) {
  let value = String(raw ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (!value) return null;
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) return `#${[...hex].map((char) => char + char).join("")}`;
    return hex.length === 6 || hex.length === 8 ? value : null;
  }
  if (!/^(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/.test(value)) return null;
  value = value.replace(/\s+/g, " ").replace(/\s*([(),/])\s*/g, "$1");
  const rgb = /^rgba?\((\d{1,3})[, ](\d{1,3})[, ](\d{1,3})(?:[,/](1|1\.0+|100%))?\)$/.exec(value);
  if (rgb && rgb.slice(1, 4).every((part) => Number(part) <= 255)) return `#${rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  return value;
}
const rgbOf = (hex) => (/^#[0-9a-f]{6}$/.test(hex) ? [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) : null);

const tokenColors = new Map(); // normalised colour -> Set(token name)
for (const token of tokens) {
  for (const declaration of token.declarations) {
    const direct = VAR_ONLY.exec(declaration.value.trim());
    const values = direct ? (tokenByName.get(direct[1])?.declarations ?? []).map((entry) => entry.value) : [declaration.value];
    for (const value of values) {
      const color = normColor(value);
      if (!color) continue;
      if (!tokenColors.has(color)) tokenColors.set(color, new Set());
      tokenColors.get(color).add(token.name);
    }
  }
}
const tokenOrder = (a, b) => Number(tokenByName.get(b)?.theme ?? false) - Number(tokenByName.get(a)?.theme ?? false) || cmp(a, b);
const hexTokens = [...tokenColors.entries()].map(([color, names]) => ({ color, rgb: rgbOf(color), name: [...names].sort(tokenOrder)[0] })).filter((entry) => entry.rgb).sort((a, b) => cmp(a.name, b.name));

const rawColors = new Map();
for (const entry of [...rawFacts.code, ...rawFacts.css]) {
  if (/var\(/.test(entry.value)) continue; // built from tokens, not hard-coded
  const color = normColor(entry.value);
  if (!color) continue;
  if (!rawColors.has(color)) rawColors.set(color, { color, count: 0, spellings: new Map(), files: new Map(), contexts: new Map(), occurrences: [] });
  const slot = rawColors.get(color);
  slot.count += 1;
  inc(slot.spellings, entry.value);
  inc(slot.files, entry.file);
  inc(slot.contexts, entry.context);
  slot.occurrences.push(entry);
}
for (const slot of [...rawColors.values()].sort((a, b) => b.count - a.count || cmp(a.color, b.color))) {
  const matching = [...(tokenColors.get(slot.color) ?? [])].sort(tokenOrder);
  const rgb = rgbOf(slot.color);
  let nearest = null;
  if (rgb) {
    for (const candidate of hexTokens) {
      const distance = Math.hypot(rgb[0] - candidate.rgb[0], rgb[1] - candidate.rgb[1], rgb[2] - candidate.rgb[2]);
      if (!nearest || distance < nearest.distance) nearest = { name: candidate.name, value: candidate.color, distance };
    }
    if (nearest) nearest.distance = round(nearest.distance, 1);
  }
  const occurrences = slot.occurrences.sort((a, b) => cmp(a.file, b.file) || a.line - b.line);
  // "#add" or "#face" inside a plain string may be a link anchor, not a colour.
  const maybeAnchor = [...slot.spellings.keys()].every((spelling) => /^#[a-f]{3,4}$/.test(spelling)) && [...slot.contexts.keys()].every((context) => context === "string");
  findings.push(finding({
    kind: "raw-color",
    title: matching.length
      ? `The colour ${slot.color} is hard-coded ${plural(slot.count, "time")} although the token ${matching[0]} holds it`
      : `The colour ${slot.color} is hard-coded ${plural(slot.count, "time")} and no token holds it`,
    subject: `color:${slot.color}`,
    zone: mainZone(slot.files),
    reach: { screens: maxScreens(slot.files.keys()), uses: slot.count },
    confidence: maybeAnchor ? 0.5 : 0.9,
    evidence: occurrences.slice(0, 10).map((entry) => ({ file: entry.file, line: entry.line, note: `${entry.value} in ${entry.context === "css" ? "CSS" : entry.context === "class" ? "a class" : "a string or style"}` })),
    options: [
      matching.length ? { key: "use-token", label: `Use the token ${matching[0]}` } : { key: "create-token", label: "Create a token for this colour" },
      KEEP,
    ],
    data: {
      value: slot.color,
      spellings: Object.fromEntries(sortedCounts(slot.spellings)),
      contexts: Object.fromEntries(sortedCounts(slot.contexts)),
      files: slot.files.size,
      matchingTokens: matching,
      nearestToken: nearest,
    },
  }));
}

// ---- Scales -----------------------------------------------------------------

const TEXT_STEPS = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36, "5xl": 48, "6xl": 60, "7xl": 72, "8xl": 96, "9xl": 128 };
const RADIUS_STEPS = TAILWIND_V3
  ? { none: 0, sm: 2, "": 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24 }
  : { none: 0, xs: 2, sm: 4, "": 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32 };
const SHADOW_STEPS = ["none", "2xs", "xs", "sm", "", "md", "lg", "xl", "2xl"];
const COLOR_START = /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color-mix\(|color:)/;
const SPACING_RE = /^-?(gap-x|gap-y|space-x|space-y|gap|p[xytrblse]?|m[xytrblse]?)-(.+)$/;
const RADIUS_RE = /^rounded(?:-(?:ss|se|ee|es|tl|tr|br|bl|[trblse]))?(?:-(.+))?$/;

function normValue(value) {
  return String(value).replace(/_/g, " ").replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim().toLowerCase();
}
const scales = { text: new Map(), spacing: new Map(), radius: new Map(), shadow: new Map() };
const recurring = new Map(); // arbitrary values, by group and value

function textSize(utility) {
  if (!utility.startsWith("text-")) return null;
  const rest = utility.slice(5);
  const bracket = /^\[(.+)\]$/.exec(rest);
  if (bracket) {
    const hinted = /^length:/.test(bracket[1]);
    const inner = bracket[1].replace(/^length:/, "");
    if (COLOR_START.test(inner)) return null;
    const px = toPx(inner);
    if (px == null && !hinted && !/^(clamp|calc|min|max)\(/.test(inner) && !/^-?[\d.]+(em|vw|vh|%)$/.test(inner)) return null;
    return { value: `text-[${inner}]`, num: px, kind: "arbitrary", raw: inner };
  }
  const paren = /^\(length:(--[\w-]+)\)$/.exec(rest);
  if (paren) return { value: `text-(${paren[1]})`, num: toPx(firstValue(paren[1])), kind: "token" };
  if (textTokens.has(rest)) return { value: `text-${rest}`, num: toPx(textTokens.get(rest).declarations[0].value), kind: rest in TEXT_STEPS ? "named" : "token" };
  if (rest in TEXT_STEPS) return { value: `text-${rest}`, num: TEXT_STEPS[rest], kind: "named" };
  return null;
}
function spacing(utility) {
  const match = SPACING_RE.exec(utility);
  if (!match) return null;
  const rest = match[2];
  const rootName = match[1];
  if (/^\d+(\.\d+)?$/.test(rest)) return { num: round(Number(rest) * spacingBase, 3), kind: "named", spelling: `${rootName}-${rest}` };
  if (rest === "px") return { num: 1, kind: "named", spelling: `${rootName}-px` };
  if (spacingTokens.has(rest)) return { num: toPx(spacingTokens.get(rest).declarations[0].value), kind: "token", spelling: `${rootName}-${rest}`, label: rest };
  const bracket = /^\[(.+)\]$/.exec(rest);
  if (bracket) {
    if (/var\(/.test(bracket[1]) && toPx(bracket[1]) == null) return null;
    return { num: toPx(bracket[1]), kind: "arbitrary", spelling: `${rootName}-[${bracket[1]}]`, label: `[${bracket[1]}]`, raw: bracket[1] };
  }
  return null; // auto, full, fractions…
}
function radius(utility) {
  const match = RADIUS_RE.exec(utility);
  if (!match) return null;
  const rest = match[1] ?? "";
  const bracket = /^\[(.+)\]$/.exec(rest);
  if (bracket) return { value: `rounded-[${bracket[1]}]`, num: toPx(bracket[1]), kind: "arbitrary", raw: bracket[1] };
  const paren = /^\((--[\w-]+)\)$/.exec(rest);
  if (paren) return { value: `rounded-(${paren[1]})`, num: toPx(firstValue(paren[1])), kind: "token" };
  const value = rest ? `rounded-${rest}` : "rounded";
  if (radiusTokens.has(rest)) return { value, num: toPx(radiusTokens.get(rest).declarations[0].value), kind: rest in RADIUS_STEPS ? "named" : "token" };
  if (rest === "full") return { value, num: null, kind: "named" };
  if (rest in RADIUS_STEPS) return { value, num: RADIUS_STEPS[rest], kind: "named" };
  return null;
}
function shadow(utility) {
  const match = /^shadow(?:-(.+))?$/.exec(utility);
  if (!match) return null;
  const rest = match[1] ?? "";
  const bracket = /^\[(.+)\]$/.exec(rest);
  if (bracket) {
    if (COLOR_START.test(bracket[1])) return null;
    const same = [...shadowTokens].find(([, token]) => token.declarations.some((declaration) => normValue(declaration.value) === normValue(bracket[1])));
    return { value: `shadow-[${bracket[1]}]`, num: null, kind: "arbitrary", raw: bracket[1], sameAs: same ? `shadow-${same[0]}` : null };
  }
  const value = rest ? `shadow-${rest}` : "shadow";
  if (shadowTokens.has(rest)) return { value, num: SHADOW_STEPS.includes(rest) ? SHADOW_STEPS.indexOf(rest) : null, kind: SHADOW_STEPS.includes(rest) ? "named" : "token" };
  if (SHADOW_STEPS.includes(rest)) return { value, num: SHADOW_STEPS.indexOf(rest), kind: "named" };
  if (rest === "inner") return { value, num: null, kind: "named" };
  return null; // a shadow colour
}

const ARBITRARY_RE = /^-?([a-z][a-z0-9-]*?)-\[(.+)\]$/;
const SIZE_ROOT = /^(w|h|size|min-w|max-w|min-h|max-h|basis)$/;
const POSITION_ROOT = /^(inset|inset-x|inset-y|top|right|bottom|left|start|end|translate-x|translate-y)$/;
function noteRecurring(use, group, value, spelling) {
  const entry = bucket(recurring, `${group}\n${value}`, { group, value });
  addUse(entry, use, spelling);
}

for (const use of classUses) {
  const utility = use.utility;
  const text = textSize(utility);
  const space = text ? null : spacing(utility);
  const round_ = text || space ? null : radius(utility);
  const shade = text || space || round_ ? null : shadow(utility);
  if (text) addUse(bucket(scales.text, text.value, text), use, text.value);
  if (space) {
    const key = space.num != null ? `${space.num}px` : space.label;
    const entry = bucket(scales.spacing, key, { value: key, num: space.num, kind: space.kind });
    if (space.kind !== "arbitrary") entry.kind = space.kind === "token" && entry.kind !== "named" ? "token" : "named";
    addUse(entry, use, space.spelling);
  }
  if (round_) addUse(bucket(scales.radius, round_.value, round_), use, round_.value);
  if (shade) addUse(bucket(scales.shadow, shade.value, shade), use, shade.value);

  // Arbitrary values, for `recurring-value`. Colours are reported as `raw-color`.
  const arbitrary = ARBITRARY_RE.exec(utility);
  if (!arbitrary) continue;
  const rootName = arbitrary[1];
  let inner = arbitrary[2];
  if (COLOR_START.test(inner) || /var\(|^--/.test(inner)) continue;
  let group = rootName;
  if (text) group = "text-size", inner = text.raw ?? inner;
  else if (rootName === "text") continue;
  else if (space) group = "spacing";
  else if (round_) group = "radius";
  else if (SIZE_ROOT.test(rootName)) group = "size";
  else if (POSITION_ROOT.test(rootName)) group = "position";
  noteRecurring(use, group, inner, `${rootName}-[${arbitrary[2]}]`);
}

const SCALE_INFO = {
  text: { kind: "scale-text-size", noun: "text size", unit: "px", subject: "scale:text-size" },
  spacing: { kind: "scale-spacing", noun: "spacing", unit: "px", subject: "scale:spacing" },
  radius: { kind: "scale-radius", noun: "radius", unit: "px", subject: "scale:radius" },
  shadow: { kind: "scale-shadow", noun: "shadow", unit: "rank", subject: "scale:shadow" },
};
// A value with a name (scale step or token) is preferred to one written by hand.
const kindRank = (kind) => (kind === "arbitrary" ? 1 : 0);

// A Scale suggestion: keep the values that carry most of the use, map each rarely
// used value to its nearest kept value. A proposal only; nothing is applied.
function propose(entries, unit) {
  const sized = entries.filter((entry) => entry.num != null);
  const groups = new Map();
  for (const entry of sized) {
    if (!groups.has(entry.num)) groups.set(entry.num, { num: entry.num, count: 0, members: [] });
    const group = groups.get(entry.num);
    group.count += entry.count;
    group.members.push(entry);
  }
  for (const group of groups.values()) {
    group.members.sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.count - a.count || cmp(a.kind, b.kind) || cmp(a.value, b.value));
    group.label = group.members[0].value;
  }
  const total = sized.reduce((sum, entry) => sum + entry.count, 0);
  const ordered = [...groups.values()].sort((a, b) => b.count - a.count || a.num - b.num);
  const kept = [];
  const rare = [];
  let carried = 0;
  for (const group of ordered) {
    if (carried < COVERAGE * total || group.count / total >= MIN_SHARE) {
      kept.push(group);
      carried += group.count;
    } else rare.push(group);
  }
  const merge = rare.map((group) => {
    const target = [...kept].sort((a, b) => Math.abs(a.num - group.num) - Math.abs(b.num - group.num) || b.count - a.count || a.num - b.num)[0];
    return { from: group.label, [`from${unit === "px" ? "Px" : "Rank"}`]: group.num, to: target.label, [`to${unit === "px" ? "Px" : "Rank"}`]: target.num, occurrences: group.count, difference: round(Math.abs(target.num - group.num), 3), spellings: group.members.map((member) => member.value) };
  }).sort((a, b) => b.occurrences - a.occurrences || cmp(a.from, b.from));
  const unify = [];
  for (const group of kept) for (const member of group.members.slice(1)) unify.push({ from: member.value, to: group.label, occurrences: member.count, [unit]: group.num });
  unify.sort((a, b) => b.occurrences - a.occurrences || cmp(a.from, b.from));
  const noSize = entries.filter((entry) => entry.num == null).map((entry) => ({ value: entry.value, count: entry.count, kind: entry.kind, ...(entry.sameAs ? { sameAs: entry.sameAs } : {}) })).sort((a, b) => b.count - a.count || cmp(a.value, b.value));
  return {
    method: `Keeps the most used values until they carry ${Math.round(COVERAGE * 100)}% of the use, plus any value with at least ${Math.round(MIN_SHARE * 100)}% of the use. Every other value is mapped to its nearest kept value. A proposal for the owner to settle; nothing is applied.`,
    keep: kept.sort((a, b) => a.num - b.num).map((group) => ({ value: group.label, [unit]: group.num, count: group.count, share: total ? round(group.count / total) : 0, spellings: group.members.map((member) => member.value) })),
    merge,
    unify,
    noSize,
    occurrencesTouched: merge.reduce((sum, entry) => sum + entry.occurrences, 0) + unify.reduce((sum, entry) => sum + entry.occurrences, 0),
    shareKept: total ? round(carried / total) : 1,
  };
}

const scaleResults = {};
for (const [name, info] of Object.entries(SCALE_INFO)) {
  const entries = [...scales[name].values()].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity) || cmp(a.value, b.value));
  if (!entries.length) continue;
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const files = new Map();
  for (const entry of entries) for (const [file, count] of entry.files) inc(files, file, count);
  const proposed = propose(entries, info.unit);
  const histogram = entries.map((entry) => ({ value: entry.value, [info.unit]: entry.num, count: entry.count, kind: entry.kind, files: entry.files.size, spellings: Object.fromEntries(sortedCounts(entry.spellings)) }));
  const moved = new Set([...proposed.merge.flatMap((entry) => entry.spellings), ...proposed.unify.map((entry) => entry.from)]);
  const evidence = entries.filter((entry) => moved.has(entry.value)).sort((a, b) => a.count - b.count || cmp(a.value, b.value)).map((entry) => ({ ...entry.samples[0], note: `${entry.value}, used ${plural(entry.count, "time")}` })).slice(0, 10);
  const hasProposal = proposed.merge.length + proposed.unify.length > 0;
  scaleResults[name] = { info, histogram, proposed, total };
  findings.push(finding({
    kind: info.kind,
    title: `The ${info.noun} scale has ${plural(entries.length, "distinct value")} over ${plural(total, "use")}${hasProposal ? `; the suggestion keeps ${proposed.keep.length}` : ""}`,
    subject: info.subject,
    zone: mainZone(files),
    reach: { screens: maxScreens(files.keys()), uses: total },
    evidence,
    options: hasProposal
      ? [{ key: "adopt-proposed", label: "Adopt the suggested scale" }, { key: "adjust", label: "Adjust the suggestion, then adopt it" }, KEEP]
      : [],
    data: { histogram, proposed },
  }));
}

// ---- recurring-value --------------------------------------------------------

const GROUP_TOKENS = { spacing: spacingTokens, size: spacingTokens, position: spacingTokens, radius: radiusTokens, "text-size": textTokens, shadow: shadowTokens, leading: themeNames("leading"), tracking: themeNames("tracking") };
function scaleStep(group, value) {
  const px = toPx(value);
  if (px == null) return null;
  if (group === "spacing" || group === "size" || group === "position") {
    const step = px / spacingBase;
    if (px === 1) return "px";
    return Number.isInteger(step * 2) ? String(step) : null;
  }
  const table = group === "radius" ? RADIUS_STEPS : group === "text-size" ? TEXT_STEPS : null;
  if (!table) return null;
  const hit = Object.entries(table).find(([, stepPx]) => stepPx === px);
  return hit ? hit[0] || "(default)" : null;
}
for (const entry of [...recurring.values()].sort((a, b) => b.count - a.count || cmp(a.group, b.group) || cmp(a.value, b.value))) {
  if (entry.count < RECURRING) continue;
  const px = toPx(entry.value);
  const matching = [...(GROUP_TOKENS[entry.group] ?? new Map()).values()].filter((token) => token.declarations.some((declaration) => (px != null && toPx(declaration.value) === px) || normValue(declaration.value) === normValue(entry.value))).map((token) => token.name).sort(cmp);
  const step = scaleStep(entry.group, entry.value);
  const spellings = sortedCounts(entry.spellings);
  const options = [];
  if (matching.length) options.push({ key: "use-token", label: `Use the token ${matching[0]}` });
  else options.push({ key: "create-token", label: "Create a token for this value" });
  if (step) options.push({ key: "use-scale-step", label: `Use the scale step ${step} (the same value)` });
  options.push(KEEP);
  findings.push(finding({
    kind: "recurring-value",
    title: matching.length
      ? `${entry.value} (${entry.group}) is written by hand ${plural(entry.count, "time")} although the token ${matching[0]} holds it`
      : `${entry.value} (${entry.group}) is a recurring value that is not written down: used ${plural(entry.count, "time")}`,
    subject: `value:${entry.group}:${entry.value}`,
    zone: mainZone(entry.files),
    reach: { screens: maxScreens(entry.files.keys()), uses: entry.count },
    evidence: entry.samples.slice(0, 10),
    options,
    data: { group: entry.group, value: entry.value, px, spellings: Object.fromEntries(spellings), files: entry.files.size, matchingTokens: matching, scaleStep: step },
  }));
}

// ---- font-alias -------------------------------------------------------------

const WEIGHTS = new Set(["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"]);
const normFamily = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");
function firstSegment(value) {
  let depth = 0;
  let out = "";
  for (const char of String(value)) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) break;
    out += char;
  }
  return out.trim();
}
// The family a font value leads to, as far as the CSS tells.
function familyOf(value, depth = 0) {
  const first = firstSegment(String(value).replace(/_/g, " "));
  const reference = /^var\(\s*(--[\w-]+)/.exec(first) ?? /^(--[\w-]+)$/.exec(first);
  if (reference) {
    const next = firstValue(reference[1]);
    if (next != null && depth < 5) return familyOf(next, depth + 1);
    const name = reference[1].replace(/^--(font-)?/, "");
    return { key: normFamily(name), label: name, via: `${reference[1]} (not declared in the scanned CSS, probably set at run time)` };
  }
  const literal = first.replace(/^['"]|['"]$/g, "");
  return literal ? { key: normFamily(literal), label: literal, via: null } : null;
}
const fonts = new Map();
for (const use of classUses) {
  if (!use.utility.startsWith("font-")) continue;
  const rest = use.utility.slice(5);
  if (WEIGHTS.has(rest) || fontWeightTokens.has(rest) || rest.startsWith("stretch-")) continue;
  let family = null;
  const bracket = /^\[(.+)\]$/.exec(rest);
  const paren = /^\((.+)\)$/.exec(rest);
  if (bracket || paren) {
    const inner = (bracket ?? paren)[1];
    if (/^(weight|number|font-weight):/.test(inner) || /^[\d.]+$/.test(inner)) continue;
    const hinted = /^(family-name|family|font-family):/.test(inner);
    const body = inner.replace(/^(family-name|family|font-family):/, "");
    if (!hinted && /weight/.test(body) && /^(var\()?--/.test(body)) continue;
    family = familyOf(body);
  } else if (fontTokens.has(rest)) {
    family = familyOf(fontTokens.get(rest).declarations[0].value);
    if (family && !family.via) family.via = `--font-${rest}`;
  } else if (["sans", "serif", "mono"].includes(rest)) family = { key: rest, label: `${rest} (Tailwind default stack)`, via: null };
  else if (/^[a-z][a-z0-9-]*$/.test(rest)) family = { key: normFamily(rest), label: rest, via: `no --font-${rest} token in the scanned CSS` };
  if (!family || !family.key) continue;
  const entry = bucket(fonts, family.key, { key: family.key, labels: new Map(), via: new Map() });
  inc(entry.labels, family.label, use.count);
  if (family.via) entry.via.set(use.utility, family.via);
  addUse(entry, use, use.utility);
}
for (const entry of [...fonts.values()].sort((a, b) => b.count - a.count || cmp(a.key, b.key))) {
  if (entry.spellings.size < 2) continue;
  const spellings = sortedCounts(entry.spellings);
  const label = sortedCounts(entry.labels)[0][0];
  findings.push(finding({
    kind: "font-alias",
    title: `The font ${label} is reached through ${spellings.length} different class spellings`,
    subject: `font:${entry.key}`,
    zone: mainZone(entry.files),
    reach: { screens: maxScreens(entry.files.keys()), uses: entry.count },
    confidence: 0.7,
    evidence: spellings.slice(0, 10).map(([spelling, count]) => {
      const sample = entry.samples.find((candidate) => splitClass(candidate.note).utility.startsWith(spelling)) ?? {};
      return { ...(sample.file ? { file: sample.file } : {}), ...(sample.line ? { line: sample.line } : {}), note: `${spelling}, used ${plural(count, "time")}` };
    }),
    options: [{ key: "unify", label: `Use one spelling everywhere (the most used is ${spellings[0][0]})` }, KEEP],
    data: { family: label, spellings: spellings.map(([spelling, count]) => ({ spelling, count, resolvedVia: entry.via.get(spelling) ?? null })), mostUsed: spellings[0][0], files: entry.files.size },
  }));
}

// ---- breakpoint-oneoff ------------------------------------------------------

const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };
for (const [name, token] of breakpointTokens) {
  const px = toPx(token.declarations[0].value);
  if (px != null) BREAKPOINTS[name] = px;
}
const namedBreakpoints = new Map();
const arbitraryBreakpoints = new Map();
for (const use of classUses) {
  for (const variant of use.variants) {
    const named = /^(?:(max|min)-)?(.+)$/.exec(variant);
    if (named && named[2] in BREAKPOINTS) {
      inc(namedBreakpoints, variant, use.count);
      continue;
    }
    const arbitrary = /^(min|max)-\[(.+)\]$/.exec(variant);
    if (!arbitrary) continue;
    addUse(bucket(arbitraryBreakpoints, variant, { variant, direction: arbitrary[1], value: arbitrary[2] }), use, use.token);
  }
}
const breakpointRows = [...arbitraryBreakpoints.values()].sort((a, b) => a.count - b.count || cmp(a.variant, b.variant)).map((entry) => {
  const px = toPx(entry.value);
  let nearest = null;
  if (px != null) for (const [name, namedPx] of Object.entries(BREAKPOINTS).sort((a, b) => a[1] - b[1])) {
    if (!nearest || Math.abs(namedPx - px) < Math.abs(nearest.px - px)) nearest = { name, px: namedPx };
  }
  return { variant: entry.variant, px, count: entry.count, files: entry.files.size, nearestNamed: nearest ? { ...nearest, difference: round(Math.abs(nearest.px - px), 3) } : null, entry };
});
const oneOffs = breakpointRows.filter((row) => row.count < ONE_OFF);
if (oneOffs.length) {
  const files = new Map();
  for (const row of oneOffs) for (const [file, count] of row.entry.files) inc(files, file, count);
  const strip = ({ entry, ...row }) => row;
  findings.push(finding({
    kind: "breakpoint-oneoff",
    title: `${plural(oneOffs.length, "one-off breakpoint")} used fewer than ${ONE_OFF} times each, next to the named ones`,
    subject: "breakpoints:one-off",
    zone: mainZone(files),
    reach: { screens: maxScreens(files.keys()), uses: oneOffs.reduce((sum, row) => sum + row.count, 0) },
    evidence: oneOffs.map((row) => ({ ...row.entry.samples[0], note: `${row.variant}, used ${plural(row.count, "time")}` })).slice(0, 10),
    options: [
      { key: "use-named", label: "Move each one to the nearest named breakpoint" },
      { key: "create-breakpoint", label: "Name the ones that matter as breakpoints" },
      KEEP,
    ],
    data: {
      named: Object.fromEntries([...namedBreakpoints.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))),
      namedValues: BREAKPOINTS,
      arbitrary: [...breakpointRows].sort((a, b) => b.count - a.count || cmp(a.variant, b.variant)).map(strip),
      oneOffs: oneOffs.map(strip),
    },
  }));
}

// ---- inline-style -----------------------------------------------------------

const stylesByFile = new Map();
for (const entry of rawFacts.inlineStyles) {
  const literal = Object.fromEntries(Object.entries(entry.props).filter(([, value]) => value !== "{…}"));
  const dynamic = Object.keys(entry.props).length - Object.keys(literal).length;
  if (!stylesByFile.has(entry.file)) stylesByFile.set(entry.file, { file: entry.file, styles: [], literal: 0, dynamic: 0 });
  const slot = stylesByFile.get(entry.file);
  slot.dynamic += dynamic;
  if (!Object.keys(literal).length) continue;
  slot.literal += Object.keys(literal).length;
  slot.styles.push({ line: entry.line, props: literal });
}
for (const slot of [...stylesByFile.values()].sort((a, b) => b.literal - a.literal || cmp(a.file, b.file))) {
  if (!slot.literal) continue;
  slot.styles.sort((a, b) => a.line - b.line);
  findings.push(finding({
    kind: "inline-style",
    title: `${slot.file} sets ${plural(slot.literal, "fixed value")} through inline styles`,
    subject: `file:${slot.file}`,
    zone: zoneOfFile(slot.file),
    reach: { screens: screensOfFile(slot.file), uses: slot.literal },
    evidence: slot.styles.slice(0, 10).map((style) => ({ file: slot.file, line: style.line, note: Object.entries(style.props).map(([name, value]) => `${name}: ${value}`).join("; ").slice(0, 160) })),
    options: [{ key: "move-to-classes", label: "Move these values to classes or tokens" }, KEEP],
    data: { file: slot.file, styles: slot.styles, literalValues: slot.literal, dynamicValues: slot.dynamic },
  }));
}

// ---- Write ------------------------------------------------------------------

const KIND_ORDER = ["token-unused", "token-undeclared", "raw-color", "recurring-value", "scale-text-size", "scale-spacing", "scale-radius", "scale-shadow", "font-alias", "breakpoint-oneoff", "inline-style"];
findings.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.reach.uses - a.reach.uses || cmp(a.subject.join("|"), b.subject.join("|")));
const byKind = Object.fromEntries(KIND_ORDER.map((kind) => [kind, findings.filter((entry) => entry.kind === kind).length]));
const of = (kind) => findings.filter((entry) => entry.kind === kind);
const summary = { run: run.id, tokens: tokens.length, findings: findings.length, byKind };
writeFindings(run.dir, "tokens", findings, summary);

// ---- Report -----------------------------------------------------------------

const lines = [];
const capped = (headers, rows, what) => {
  lines.push(mdTable(headers, rows.slice(0, TABLE_CAP)), "");
  if (rows.length > TABLE_CAP) lines.push(`${rows.length - TABLE_CAP} more ${what} are in \`findings/tokens.json\`.`, "");
};
const where = (entry) => {
  const first = entry.evidence[0];
  return first?.file ? `${first.file}${first.line ? `:${first.line}` : ""}` : "";
};
const rawWithToken = of("raw-color").filter((entry) => entry.data.matchingTokens.length);
const rawUses = of("raw-color").reduce((sum, entry) => sum + entry.reach.uses, 0);

lines.push(`# Tokens and raw values`, "", `Run ${run.id}. Every line below is a **Finding** for the owner to settle; nothing has been changed.`, "", "## Summary", "");
lines.push(`- ${plural(tokens.length, "token")} declared; ${byKind["token-unused"]} of them nothing uses.`);
lines.push(`- ${plural(byKind["token-undeclared"], "variable")} used but never declared in the scanned CSS (fonts set at run time are usually fine).`);
lines.push(`- ${plural(byKind["raw-color"], "hard-coded colour")} over ${plural(rawUses, "use")}; ${rawWithToken.length} of them already exist as a token.`);
lines.push(`- ${plural(byKind["recurring-value"], "recurring value")} written by hand at least ${RECURRING} times.`);
for (const [name, result] of Object.entries(scaleResults)) {
  const { proposed, histogram, info, total } = result;
  lines.push(`- ${info.noun[0].toUpperCase()}${info.noun.slice(1)}: ${plural(histogram.length, "distinct value")} over ${plural(total, "use")}; the **Scale suggestion** keeps ${proposed.keep.length}${proposed.noSize.length ? ` (+${proposed.noSize.length} without a comparable size)` : ""} and would touch ${plural(proposed.occurrencesTouched, "use")}.`);
}
lines.push(`- ${plural(byKind["font-alias"], "font")} reached through several class spellings; ${plural(oneOffs.length, "one-off breakpoint")}; ${plural(byKind["inline-style"], "file")} with fixed inline styles.`, "");

lines.push("## Tokens nothing uses", "");
if (!byKind["token-unused"]) lines.push("None.", "");
else {
  lines.push("Options for each: remove the token, or keep it.", "");
  capped(["Token", "Value", "Declared in", "In @theme"], of("token-unused").map((entry) => [code(entry.data.name), entry.data.value, where(entry), entry.data.theme ? "yes" : "no"]), "unused tokens");
}

lines.push("## Variables used but not declared", "");
if (!byKind["token-undeclared"]) lines.push("None.", "");
else {
  lines.push("A variable set at run time by a framework (a next/font variable such as `--font-x`, a Radix or Tailwind internal variable) shows up here and is usually fine. Options: declare it, fix the reference, or keep it.", "");
  capped(["Variable", "Uses", "Files", "Probably set at run time"], of("token-undeclared").map((entry) => [code(entry.data.name), entry.reach.uses, [...new Set(entry.evidence.map((item) => item.file))].slice(0, 3).join(", ") || "plain CSS rules", entry.data.likelyFramework ? "yes" : "no"]), "undeclared variables");
}

lines.push("## Hard-coded colours", "");
if (!byKind["raw-color"]) lines.push("None.", "");
else {
  lines.push("A colour written directly in a class, a string, an inline style or plain CSS. When a token holds exactly this colour, the option is to use it; otherwise to create one. The nearest token is given with its distance (0 is identical, about 440 is black against white).", "");
  capped(["Colour", "Uses", "Files", "Screens", "Same value as", "Nearest token", "First seen"], of("raw-color").map((entry) => [
    code(entry.data.value), entry.reach.uses, entry.data.files, entry.reach.screens,
    entry.data.matchingTokens.map(code).join(", ") || "none",
    entry.data.nearestToken ? `${code(entry.data.nearestToken.name)} (${entry.data.nearestToken.distance})` : "not compared",
    `${where(entry)}${entry.confidence < 0.9 ? " (may be a link anchor, not a colour)" : ""}`,
  ]), "colours");
}

lines.push("## Recurring values that are not written down", "");
if (!byKind["recurring-value"]) lines.push(`No value written by hand reaches ${RECURRING} uses.`, "");
else {
  lines.push(`A value written by hand in a class (\`rounded-[12px]\`) at least ${RECURRING} times. Options: create a token, use the scale step that has the same value, use the token that already holds it, or keep it.`, "");
  capped(["Value", "Used as", "Uses", "Files", "Written as", "Token with this value", "Same scale step"], of("recurring-value").map((entry) => [
    code(entry.data.value), entry.data.group, entry.reach.uses, entry.data.files,
    Object.entries(entry.data.spellings).slice(0, 4).map(([spelling, count]) => `${code(spelling)} ×${count}`).join(", "),
    entry.data.matchingTokens.map(code).join(", ") || "none", entry.data.scaleStep ?? "none",
  ]), "recurring values");
}

lines.push("## Scales", "", "For each scale: every value in use, then the **Scale suggestion**. The suggestion is a proposal to adopt, adjust or leave; nothing is applied.", "");
for (const result of Object.values(scaleResults)) {
  const { info, histogram, proposed, total } = result;
  const unit = info.unit;
  const size = (value) => (value == null ? "" : unit === "px" ? `${value}px` : `step ${value}`);
  lines.push(`### ${info.noun[0].toUpperCase()}${info.noun.slice(1)}`, "", `${plural(histogram.length, "distinct value")} over ${plural(total, "use")}.`, "");
  capped(["Value", "Size", "Uses", "Files", "Written as"], [...histogram].sort((a, b) => b.count - a.count || cmp(a.value, b.value)).map((entry) => [
    code(entry.value), size(entry[unit]), entry.count, entry.files,
    Object.keys(entry.spellings).length > 1 || Object.keys(entry.spellings)[0] !== entry.value ? Object.entries(entry.spellings).slice(0, 4).map(([spelling, count]) => `${code(spelling)} ×${count}`).join(", ") : "",
  ]), `${info.noun} values`);
  lines.push(`Suggested scale (${Math.round(proposed.shareKept * 100)}% of the sized uses): ${proposed.keep.map((entry) => code(entry.value)).join(", ") || "none"}.`, "");
  const moves = [
    ...proposed.merge.map((entry) => [code(entry.from), code(entry.to), entry.occurrences, unit === "px" ? `${entry.difference}px` : `${entry.difference} step(s)`]),
    ...proposed.unify.map((entry) => [code(entry.from), code(entry.to), entry.occurrences, "same value, other spelling"]),
  ];
  if (moves.length) capped(["Value to move", "Kept value", "Uses it would touch", "Difference"], moves, "mappings");
  else lines.push("Nothing to merge: every value carries a real share of the use.", "");
  if (proposed.noSize.length) lines.push(`Not compared by size, to review by eye: ${proposed.noSize.slice(0, 12).map((entry) => `${code(entry.value)} ×${entry.count}${entry.sameAs ? ` (same value as ${code(entry.sameAs)})` : ""}`).join(", ")}${proposed.noSize.length > 12 ? `, and ${proposed.noSize.length - 12} more in the JSON` : ""}.`, "");
}
if (!Object.keys(scaleResults).length) lines.push("No text size, spacing, radius or shadow class was found.", "");

lines.push("## Font aliases", "");
if (!byKind["font-alias"]) lines.push("Each font is reached through one class spelling.", "");
else {
  lines.push("The same font family reached through several class spellings. Options: use one spelling everywhere, or keep them.", "");
  capped(["Font", "Spellings", "Uses", "Files"], of("font-alias").map((entry) => [entry.data.family, entry.data.spellings.map((item) => `${code(item.spelling)} ×${item.count}`).join(", "), entry.reach.uses, entry.data.files]), "fonts");
}

lines.push("## Breakpoints", "");
const namedRows = [...namedBreakpoints.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
if (!namedRows.length && !breakpointRows.length) lines.push("No breakpoint variant was found.", "");
else {
  lines.push(`Named breakpoints in use: ${namedRows.map(([name, count]) => `${code(name)} ×${count}`).join(", ") || "none"}.`, "");
  if (breakpointRows.length) {
    lines.push(`Breakpoints written by hand (one-off means fewer than ${ONE_OFF} uses). Options: move each to the nearest named breakpoint, name the ones that matter, or keep them.`, "");
    capped(["Breakpoint", "Uses", "Files", "One-off", "Nearest named"], [...breakpointRows].sort((a, b) => b.count - a.count || cmp(a.variant, b.variant)).map((row) => [code(row.variant), row.count, row.files, row.count < ONE_OFF ? "yes" : "no", row.nearestNamed ? `${code(row.nearestNamed.name)} (${row.nearestNamed.px}px, ${row.nearestNamed.difference}px away)` : "not compared"]), "breakpoints");
  } else lines.push("No breakpoint is written by hand.", "");
}

lines.push("## Inline styles with fixed values", "");
if (!byKind["inline-style"]) lines.push("None.", "");
else {
  lines.push("Files where a style object holds fixed values (values computed at run time are not listed). Options: move them to classes or tokens, or keep them.", "");
  capped(["File", "Fixed values", "Screens", "Examples"], of("inline-style").map((entry) => [entry.data.file, entry.data.literalValues, entry.reach.screens, entry.evidence.slice(0, 2).map((item) => item.note).join(" / ")]), "files");
}

lines.push("## Limits", "");
lines.push("- Syntax only: the files are read, not run.");
lines.push("- A class string built at run time (`bg-${tone}`) is not seen, so a token or a value may be used more than counted, and a token called unused may be used that way. A token read or set from script (`getPropertyValue`, `setProperty`) is not seen either.");
lines.push("- Screens are counted per file through imports: every use in a reached file counts as reached.");
lines.push("- Sizes assume 1rem = 16px and the Tailwind default scale, unless the theme declares the step. Values in `em`, `%`, `calc()` or `clamp()` are listed but not compared.");
lines.push("- A font family is matched by name as far as the CSS tells; a font set at run time (next/font) is matched through its variable name.");
lines.push("- Only CSS variables declared in the scanned CSS count as tokens. Tailwind internal variables are left out" + (skippedFrameworkTokens.length ? ` (${skippedFrameworkTokens.length} skipped here).` : "."));
lines.push("- The **Scale suggestion** is drawn from counts only. It does not know which values are deliberate.", "");

writeText(path.join(run.dir, "reports", "tokens.md"), `${lines.join("\n")}\n`);

process.stdout.write(`${JSON.stringify({
  run: run.id,
  findings: findings.length,
  byKind,
  wrote: [path.relative(root, path.join(run.dir, "findings", "tokens.json")), path.relative(root, path.join(run.dir, "reports", "tokens.md"))],
}, null, 1)}\n`);
