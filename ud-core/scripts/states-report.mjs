#!/usr/bin/env node
// ud-states: which Expected states each component of a Family shows evidence of,
// and where a component lacks a state the rest of its Family has.
// Static evidence only: props, class variants in the component's file, stories.
//
//   node states-report.mjs [--run <id>]     run from the project root
//
// Writes .ud/runs/<id>/findings/states.json, work/states.json and reports/states.md
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings, resolveRun, readJson, writeJson, writeText, finding, writeFindings, mdTable, countBy, splitClass } from "./lib.mjs";

const TABLE_CAP = 40;
const EVIDENCE_CAP = 10;
const FAMILY_CAP = 12;
const SHARE_NEEDED = 0.6; // share of a Family that must have a state before its absence is flagged
const MEMBERS_NEEDED = 3;

// Project settings override the suite defaults key by key.
function mergedSettings() {
  const defaults = readJson(fileURLToPath(new URL("../defaults.json", import.meta.url)), {});
  const settings = loadSettings();
  const isMap = (value) => value && typeof value === "object" && !Array.isArray(value);
  const merged = { ...settings };
  for (const [key, value] of Object.entries(defaults)) {
    if (isMap(value) && isMap(settings[key])) merged[key] = { ...value, ...settings[key] };
    else if (settings[key] === undefined) merged[key] = value;
  }
  return merged;
}

// What counts as evidence of each state.
//   props      a prop with this exact name
//   inherited  the component extends a native element that has the prop
//   variants   a Tailwind variant prefix in the component's file
//   utilities  a Tailwind utility in the component's file
//   story      a story whose name contains the word
//   args       a story arg that puts the component in the state
const NATIVE_DISABLED = /["'](button|input|select|textarea|fieldset)["']|(Button|Input|Select|TextArea)HTMLAttributes|HTML(Button|Input|Select|TextArea)Element/;
const NATIVE_VALUE = /["'](input|select|textarea)["']|(Input|Select|TextArea)HTMLAttributes|HTML(Input|Select|TextArea)Element/;
const RULES = {
  hover: { variants: [/^(group-|peer-)?hover(\/.+)?$/], story: /hover/i },
  focus: { variants: [/^(group-|peer-)?focus(-visible|-within)?(\/.+)?$/], story: /focus/i },
  pressed: {
    props: ["active", "selected", "pressed", "isActive", "isSelected", "isPressed", "checked"],
    variants: [/^(group-|peer-)?active(\/.+)?$/, /state=(active|on|checked)/, /aria-\[?(pressed|selected|checked)/, /data-\[?(active|selected|pressed|checked)/],
    story: /pressed|active|selected|checked/i,
  },
  disabled: {
    props: ["disabled", "isDisabled"], inherited: NATIVE_DISABLED,
    variants: [/^(group-|peer-)?disabled(\/.+)?$/, /aria-\[?disabled/, /data-\[?disabled/],
    story: /disabled/i,
  },
  loading: {
    props: ["loading", "isLoading", "pending", "isPending"],
    variants: [/aria-\[?busy/, /data-\[?(loading|pending)/],
    utilities: [/^animate-(spin|pulse)$/],
    story: /loading|pending|skeleton|busy/i,
  },
  error: {
    props: ["error", "invalid", "hasError", "isInvalid", "errorMessage"],
    variants: [/aria-\[?invalid/, /data-\[?invalid/, /^(group-|peer-)?(user-)?invalid$/],
    story: /error|invalid/i,
  },
  open: {
    props: ["open", "isOpen", "defaultOpen"],
    variants: [/state=open/, /data-\[?open/, /^(group-|peer-)?open$/, /aria-\[?expanded/],
    story: /open/i,
  },
  closed: {
    props: ["open", "isOpen", "onClose", "onOpenChange"], // a component that can be opened can be closed
    variants: [/state=closed/, /data-\[?closed/],
    story: /closed/i, argsFalse: ["open", "isOpen"],
  },
  empty: { props: ["empty", "isEmpty"], propPattern: /^empty[A-Z]/, variants: [/^(group-|peer-)?empty$/], story: /empty|nodata|noresults?/i },
  "long-text": { utilities: [/^truncate$/, /^line-clamp-/, /^break-(words|all)$/, /^text-ellipsis$/, /^wrap-(anywhere|break-word)$/], story: /long|truncat|overflow/i },
  filled: { props: ["value", "defaultValue"], inherited: NATIVE_VALUE, variants: [/placeholder-shown/], story: /filled|withvalue/i },
};
// A state a project adds in its settings gets the generic rule: a prop or a story named after it.
function ruleOf(state) {
  if (RULES[state]) return RULES[state];
  const word = state.replace(/-/g, "");
  const camel = state.replace(/-(\w)/g, (_, char) => char.toUpperCase());
  const escaped = state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    props: [camel, `is${camel[0].toUpperCase()}${camel.slice(1)}`],
    variants: [new RegExp(`(^|[-=\\[])${escaped}($|[\\]/])`)],
    story: new RegExp(word, "i"),
  };
}

const settings = mergedSettings();
const run = resolveRun();
const graph = readJson(path.join(run.dir, "graph.json"));
const classesByFile = readJson(path.join(run.dir, "facts", "classes.json"), { byFile: {} }).byFile ?? {};

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const components = graph.nodes.filter((node) => node.kind === "component").sort((a, b) => byText(a.id, b.id));
const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
const callSites = (component) => component.data.uses?.callSites ?? 0;

// Family: the last word of the name that is a family word ("ProfileCard" -> Card).
const familyWords = new Set(settings.familyWords ?? []);
function familyOf(name) {
  const words = name.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? [];
  for (let index = words.length - 1; index >= 0; index -= 1) if (familyWords.has(words[index])) return words[index];
  return null;
}
const kindOf = (family) => Object.keys(settings.stateKinds ?? {}).sort().find((kind) => (settings.stateKinds[kind] ?? []).includes(family)) ?? null;

// Class tokens of a file, split once.
const fileClassCache = new Map();
function classesOf(file) {
  if (!fileClassCache.has(file)) {
    fileClassCache.set(file, Object.entries(classesByFile[file] ?? {}).sort((a, b) => byText(a[0], b[0])).map(([token, count]) => ({ token, count, ...splitClass(token) })));
  }
  return fileClassCache.get(file);
}

// The stories that speak for a component: those naming it, and those rendering it without naming any component.
function storiesOf(component) {
  const ids = new Set(component.data.stories ?? []);
  for (const id of component.data.shownIn ?? []) if (!nodeById.get(id)?.data.component) ids.add(id);
  return [...ids].sort().map((id) => nodeById.get(id)).filter(Boolean);
}
const truthy = (value) => value !== false && value !== null && value !== undefined && value !== "" && value !== 0;

function evidenceFor(component, state, stories) {
  if (state === "rest") {
    const shown = stories.some((story) => (story.data.stories ?? []).length > 0);
    return { found: true, shown, evidence: [{ type: "always", detail: "every component has a rest state" }] };
  }
  const rule = ruleOf(state);
  const evidence = [];
  let shown = false;
  for (const prop of component.data.props ?? []) {
    if (rule.props?.includes(prop.name) || rule.propPattern?.test(prop.name)) evidence.push({ type: "prop", detail: prop.name });
  }
  if (rule.inherited) {
    const hit = (component.data.extends ?? []).find((text) => rule.inherited.test(text));
    if (hit) evidence.push({ type: "inherited", detail: hit });
  }
  for (const entry of classesOf(component.file)) {
    const hit = rule.variants?.some((pattern) => entry.variants.some((variant) => pattern.test(variant)))
      || rule.utilities?.some((pattern) => pattern.test(entry.utility));
    if (hit) evidence.push({ type: "class", detail: entry.token, count: entry.count });
  }
  const argProps = (rule.props ?? []).filter((name) => !/^on[A-Z]/.test(name) && !(rule.argsFalse ?? []).includes(name));
  for (const story of stories) {
    const metaArgs = story.data.metaArgs ?? {};
    for (const entry of story.data.stories ?? []) {
      const args = { ...metaArgs, ...(entry.args ?? {}) };
      const byName = rule.story?.test(entry.name);
      const byArg = argProps.find((name) => name in args && truthy(args[name])) ?? (rule.argsFalse ?? []).find((name) => args[name] === false);
      if (!byName && !byArg) continue;
      shown = true;
      evidence.push({ type: "story", detail: byName ? `story ${entry.name}` : `story ${entry.name} sets ${byArg}`, file: story.file, line: entry.line });
    }
  }
  return { found: evidence.length > 0, shown, evidence: evidence.slice(0, EVIDENCE_CAP) };
}

// ---- Evidence per component ---------------------------------------------------

const members = []; // { component, family, kind, expected, states }
let withoutFamily = 0;
let withoutKind = 0;
for (const component of components) {
  const family = familyOf(component.name);
  if (!family) {
    withoutFamily += 1;
    continue;
  }
  const kind = kindOf(family);
  if (!kind) {
    withoutKind += 1;
    continue;
  }
  const expected = settings.expectedStates?.[kind] ?? [];
  const stories = storiesOf(component);
  const states = Object.fromEntries(expected.map((state) => [state, evidenceFor(component, state, stories)]));
  members.push({ component, family, kind, expected, states });
}

writeJson(path.join(run.dir, "work", "states.json"), {
  run: run.id,
  note: "Static evidence per component and Expected state. found = any evidence; shown = a story shows it. A state handled by a child or a wrapper is not seen.",
  components: members.map(({ component, family, kind, states }) => ({
    id: component.id, name: component.name, file: component.file, line: component.line ?? null, zone: component.zone, readOnly: component.readOnly,
    family, kind, callSites: callSites(component), screens: component.data.screens ?? 0,
    sharesFileWith: components.filter((other) => other.file === component.file && other.id !== component.id).map((other) => other.id),
    states,
  })),
});

// ---- Findings -----------------------------------------------------------------

const findings = [];
const families = new Map(); // family -> members
for (const member of members) {
  if (!families.has(member.family)) families.set(member.family, []);
  families.get(member.family).push(member);
}
const familyNames = [...families.keys()].sort((a, b) => families.get(b).length - families.get(a).length || byText(a, b));
const plural = (word) => (/(s|x|ch|sh)$/.test(word) ? word : `${word}s`);
const listNames = (items, cap = 3) => {
  const names = items.slice(0, cap).map((member) => member.component.name).join(", ");
  return items.length > cap ? `${names} and ${items.length - cap} more` : names;
};

for (const family of familyNames) {
  const group = families.get(family);
  const { kind, expected } = group[0];
  for (const state of expected) {
    if (state === "rest") continue;
    const have = group.filter((member) => member.states[state].found);
    const lack = group.filter((member) => !member.states[state].found);
    if (have.length < MEMBERS_NEEDED || !lack.length || have.length / group.length < SHARE_NEEDED) continue;
    findings.push(finding({
      kind: "state-inconsistent",
      title: `${have.length} of ${group.length} ${plural(family)} handle "${state}"; ${listNames(lack)} ${lack.length === 1 ? "does" : "do"} not`,
      subject: [...lack.map((member) => member.component.id), `state:${state}`], // the state keeps two findings on the same members apart
      zone: countBy(lack, (member) => member.component.zone)[0][0],
      reach: {
        screens: Math.max(...lack.map((member) => member.component.data.screens ?? 0)),
        uses: lack.reduce((sum, member) => sum + callSites(member.component), 0),
      },
      confidence: 0.6,
      evidence: [
        ...lack.slice(0, 6).map((member) => ({ file: member.component.file, line: member.component.line ?? null, note: `${member.component.name}: no evidence of "${state}"` })),
        ...have.slice(0, 4).map((member) => ({ file: member.component.file, line: member.component.line ?? null, note: `${member.component.name} has it: ${member.states[state].evidence.map((item) => item.detail).slice(0, 3).join(", ")}` })),
      ].slice(0, EVIDENCE_CAP),
      options: [
        { key: "add-state", label: `Add "${state}" to the ${plural(family)} that lack it` },
        { key: "keep", label: "Leave them as they are" },
      ],
      data: {
        family, stateKind: kind, state, members: group.length, share: Math.round((have.length / group.length) * 100) / 100,
        have: have.map((member) => member.component.id), lack: lack.map((member) => member.component.id),
        readOnly: lack.filter((member) => member.component.readOnly).map((member) => member.component.id),
      },
    }));
  }
}

for (const member of members) {
  const { component, family, kind, expected, states } = member;
  if (callSites(component) === 0) continue;
  const missing = expected.filter((state) => !states[state].found);
  if (!missing.length) continue;
  const unshown = expected.filter((state) => states[state].found && !states[state].shown);
  findings.push(finding({
    kind: "state-missing",
    title: `${component.name} shows no sign of ${missing.map((state) => `"${state}"`).join(", ")}`,
    subject: component.id,
    zone: component.zone,
    reach: { screens: component.data.screens ?? 0, uses: callSites(component) },
    confidence: 0.5, // static evidence only
    evidence: [{ file: component.file, line: component.line ?? null, note: `${family} (${kind}): expected ${expected.join(", ")}; found ${expected.filter((state) => states[state].found).join(", ") || "none"}` }],
    options: [
      { key: "add-state", label: `Add the missing state${missing.length === 1 ? "" : "s"}` },
      { key: "not-applicable", label: "These states do not apply to this component" },
      { key: "keep", label: "Leave it as it is" },
    ],
    data: { component: component.id, family, stateKind: kind, expected, missing, found: expected.filter((state) => states[state].found), foundButNoStory: unshown, readOnly: component.readOnly },
  }));
}

const KINDS = ["state-inconsistent", "state-missing"];
findings.sort((a, b) =>
  KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
  || b.reach.screens - a.reach.screens
  || b.reach.uses - a.reach.uses
  || byText(a.subject.join("|"), b.subject.join("|")));

const byKind = Object.fromEntries(KINDS.map((kind) => [kind, findings.filter((item) => item.kind === kind).length]));
const cells = members.flatMap((member) => member.expected.map((state) => member.states[state]));
const summary = {
  run: run.id, components: components.length, inAFamilyWithExpectedStates: members.length,
  withoutFamily, familyWithoutStateKind: withoutKind, families: familyNames.length,
  cells: { total: cells.length, handledAndShown: cells.filter((cell) => cell.found && cell.shown).length, handledNoStory: cells.filter((cell) => cell.found && !cell.shown).length, noEvidence: cells.filter((cell) => !cell.found).length },
  findings: findings.length, byKind,
};
writeFindings(run.dir, "states", findings, summary);

// ---- Report -------------------------------------------------------------------

const cellOf = (cell) => (!cell.found ? "–" : cell.shown ? "✓" : "◐");
const capped = (rows, headers, file) => {
  const lines = [mdTable(headers, rows.slice(0, TABLE_CAP))];
  if (rows.length > TABLE_CAP) lines.push("", `${rows.length - TABLE_CAP} more in \`${file}\`.`);
  return lines.join("\n");
};
const matrices = familyNames.slice(0, FAMILY_CAP).map((family) => {
  const group = [...families.get(family)].sort((a, b) => callSites(b.component) - callSites(a.component) || byText(a.component.id, b.component.id));
  const { kind, expected } = group[0];
  return [
    `### ${family} — ${group.length} component${group.length === 1 ? "" : "s"}, kind: ${kind}`,
    "",
    capped(
      group.map((member) => [`${member.component.name} (${member.component.file})`, callSites(member.component), ...expected.map((state) => cellOf(member.states[state]))]),
      ["Component", "Call sites", ...expected],
      "work/states.json",
    ),
  ].join("\n");
});
const inconsistent = findings.filter((item) => item.kind === "state-inconsistent");
const missing = findings.filter((item) => item.kind === "state-missing");
const nameOf = (id) => nodeById.get(id)?.name ?? id;

const report = [
  `# States — Run ${run.id}`,
  "",
  "## Summary",
  "",
  `- ${members.length} of ${components.length} components belong to a **Family** that has **Expected states** (${familyNames.length} families). ${withoutFamily} have no family word in their name and ${withoutKind} are in a family with no expected states; they are not checked.`,
  `- ${summary.cells.total} component × state pairs were checked: ${summary.cells.handledAndShown} handled and shown by a story (✓), ${summary.cells.handledNoStory} handled but shown by no story (◐), ${summary.cells.noEvidence} with no evidence (–).`,
  `- **Findings** where most of a family has a state and some members lack it: ${byKind["state-inconsistent"]}.`,
  `- **Findings** where a component the app uses shows no sign of one or more expected states: ${byKind["state-missing"]}.`,
  `- Evidence is static: a prop named after the state, a class variant in the component's file, or a story. "No evidence" is a question, not a verdict; each finding offers "keep", and a missing state can be marked "not applicable".`,
  `- The expected states come from the **Project settings** (\`expectedStates\`, \`stateKinds\`, \`familyWords\`) and can be changed there.`,
  "",
  "## States by Family",
  "",
  `✓ handled and a story shows it · ◐ handled, but no story shows it · – no evidence. ${familyNames.length > FAMILY_CAP ? `The ${FAMILY_CAP} largest of ${familyNames.length} families are shown; the rest is in \`work/states.json\`.` : ""}`.trim(),
  "",
  matrices.length ? matrices.join("\n\n") : "No component belongs to a family with expected states.",
  "",
  `## A state most of the family has, and some lack (${inconsistent.length})`,
  "",
  `Raised when at least ${Math.round(SHARE_NEEDED * 100)}% of a family (and at least ${MEMBERS_NEEDED} members) have the state. Options: add the state, or keep.`,
  "",
  inconsistent.length
    ? capped(
      inconsistent.map((item) => [item.data.family, item.data.state, `${item.data.have.length} of ${item.data.members}`, item.data.lack.map(nameOf).join(", "), item.zone, item.reach.screens, item.reach.uses]),
      ["Family", "State", "Have it", "Lack it", "Zone", "Screens", "Call sites"],
      "findings/states.json",
    )
    : "Nothing found.",
  "",
  `## Expected states with no evidence (${missing.length})`,
  "",
  "One row per component the app uses, by **Reach**. Options: add the state, mark it not applicable, or keep.",
  "",
  missing.length
    ? capped(
      missing.map((item) => [`${nameOf(item.subject[0])} (${nodeById.get(item.subject[0])?.file ?? ""})`, item.data.family, item.zone, item.data.missing.join(", "), item.data.found.join(", ") || "none", item.reach.screens, item.reach.uses]),
      ["Component", "Family", "Zone", "No evidence of", "Found", "Screens", "Call sites"],
      "findings/states.json",
    )
    : "Nothing found.",
  "",
  "## Limits",
  "",
  "- Static evidence only. A state handled by a child component or by a wrapper is not seen, so a component can look as if it lacks a state it has (confidence 0.5).",
  "- Syntax only. Props that come from an imported type are not opened; only a native element type (`button`, `input`…) counts as bringing `disabled` or a value.",
  "- Class variants are read per file: components that share a file share that evidence.",
  "- A class string built at run time (`bg-${tone}`) is not seen, and neither are styles written in CSS files.",
  "- A prop passed through a spread or built at run time is counted, not resolved.",
  "- The Family comes from the component's name; a component named differently from what it is lands in the wrong family, or in none.",
  "- A story counts as showing a state when its name contains the state word or its args set the matching prop; what the story really renders is checked by ud-render.",
  "",
].join("\n");
writeText(path.join(run.dir, "reports", "states.md"), report);

process.stdout.write(`${JSON.stringify({
  run: run.id, components: components.length, checked: members.length, families: familyNames.length,
  findings: findings.length, byKind,
  files: ["findings/states.json", "work/states.json", "reports/states.md"].map((file) => path.join(".ud", "runs", run.id, file)),
}, null, 1)}\n`);
