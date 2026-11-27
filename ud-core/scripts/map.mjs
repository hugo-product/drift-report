#!/usr/bin/env node
// ud map: the interactive map of a Run.
// Writes <run>/map.html (one self-contained file, works offline) and
// <run>/reports/map.md (a text map with small Mermaid diagrams).
//
//   map.mjs [--run <id>]
import fs from "node:fs";
import path from "node:path";
import {
  UD_DIR, projectRoot, loadSettings, resolveRun, readJson, writeText,
  loadFindings, mdTable, countBy,
} from "./lib.mjs";

const root = projectRoot();
const argv = process.argv.slice(2);
const settings = loadSettings(root);
const defaults = readJson(new URL("../defaults.json", import.meta.url), {});
const familyWords = settings.familyWords ?? defaults.familyWords ?? [];
const familySet = new Set(familyWords);

const run = resolveRun(argv, root);
const graph = readJson(path.join(run.dir, "graph.json"));
const runMeta = readJson(path.join(run.dir, "run.json"), { id: run.id });
const findings = loadFindings(run.dir);
const ledger = readJson(path.join(root, UD_DIR, "decisions.json"), { decisions: {} });
const lots = readJson(path.join(root, UD_DIR, "plan", "lots.json"), { lots: [] }).lots ?? [];

function familyOf(name) {
  const words = String(name ?? "").match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*/g) ?? [];
  for (let i = words.length - 1; i >= 0; i -= 1) if (familySet.has(words[i])) return words[i];
  return null;
}
const clip = (text, max) => {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// ---- Data embedded in map.html (trimmed to what is shown) --------------------

const files = [];
const fileIndex = new Map();
const fileRef = (file) => {
  if (file === undefined || file === null) return -1;
  if (!fileIndex.has(file)) {
    fileIndex.set(file, files.length);
    files.push(file);
  }
  return fileIndex.get(file);
};

function trimData(node) {
  const data = node.data ?? {};
  if (node.kind === "component") {
    const uses = data.uses ?? {};
    return {
      props: (data.props ?? []).slice(0, 80).map((prop) => ({ name: prop.name, optional: prop.optional ? 1 : 0, type: clip(prop.type, 120), values: prop.values ? prop.values.slice(0, 30).map((value) => clip(value, 40)) : null })),
      extends: (data.extends ?? []).slice(0, 10).map((item) => clip(item, 80)),
      variants: data.variants ?? {},
      callSites: uses.callSites ?? 0,
      storyCallSites: uses.storyCallSites ?? 0,
      spreads: uses.spreads ?? 0,
      useFiles: (uses.files ?? []).length,
      used: Object.fromEntries(Object.entries(uses.props ?? {}).slice(0, 80).map(([name, use]) => [name, {
        count: use.count ?? 0,
        dynamic: use.dynamic ?? 0,
        values: Object.entries(use.values ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30).map(([value, count]) => [clip(value, 40), count]),
      }])),
      screens: data.screens ?? 0,
      screenSample: (data.screenSample ?? []).slice(0, 8),
      stories: data.stories ?? [],
    };
  }
  if (node.kind === "screen") return { route: data.route, screenKind: data.screenKind, files: data.files ?? null };
  if (node.kind === "story") {
    return {
      title: data.title,
      componentName: data.componentName,
      component: data.component ?? null,
      tags: data.tags ?? [],
      stories: (data.stories ?? []).slice(0, 80).map((story) => ({ name: story.name, line: story.line, args: story.args && Object.keys(story.args).length ? clip(JSON.stringify(story.args), 160) : "" })),
    };
  }
  if (node.kind === "token") {
    return { category: data.category ?? "other", theme: data.theme ? 1 : 0, value: clip(data.value, 160), scopes: (data.scopes ?? []).slice(0, 8), uses: data.uses ?? { total: 0 }, files: (data.files ?? []).slice(0, 200).map(fileRef) };
  }
  return {};
}

const nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
const outNodes = graph.nodes.map((node) => ({
  i: node.id,
  k: node.kind,
  n: node.name,
  f: fileRef(node.file),
  l: node.line ?? 0,
  z: node.zone ?? "unzoned",
  r: node.readOnly ? 1 : 0,
  m: node.kind === "component" ? familyOf(node.name) : node.kind === "story" ? familyOf(node.data?.componentName) : null,
  d: trimData(node),
}));
const outEdges = graph.edges
  .filter((edge) => nodeIndex.has(edge.from) && nodeIndex.has(edge.to))
  .map((edge) => [nodeIndex.get(edge.from), nodeIndex.get(edge.to), edge.kind === "documents" ? 1 : 0, edge.count ?? 1]);
const outFindings = findings.map((finding) => ({
  id: finding.id,
  kind: finding.kind,
  title: clip(finding.title, 200),
  subject: (finding.subject ?? []).slice(0, 20).map(String),
  zone: finding.zone ?? "unzoned",
  reach: { screens: finding.reach?.screens ?? 0, uses: finding.reach?.uses ?? 0 },
  effort: finding.effort ?? null,
  confidence: finding.confidence ?? null,
  evidence: (finding.evidence ?? []).slice(0, 5).map((item) => ({ file: item.file, line: item.line, note: clip(item.note, 200) })),
  more: Math.max(0, (finding.evidence ?? []).length - 5),
  options: (finding.options ?? []).map((option) => ({ key: option.key, label: clip(option.label, 200) })),
  recommendation: finding.recommendation ?? null,
  judgement: finding.judgement ? clip(finding.judgement, 600) : null,
}));
const outDecisions = Object.fromEntries(Object.entries(ledger.decisions ?? {}).sort((a, b) => a[0].localeCompare(b[0])).map(([id, entry]) => [id, {
  kind: entry.kind, title: clip(entry.title, 200), subject: (entry.subject ?? []).slice(0, 5), status: entry.status, choice: entry.choice ?? null, note: entry.note ?? null,
  decidedAt: entry.decidedAt ?? null, appliedAt: entry.appliedAt ?? null, lot: entry.lot ?? null,
}]));

const embedded = {
  project: settings.project?.name ?? path.basename(root),
  run: { id: runMeta.id ?? run.id, commit: runMeta.commit ?? "", branch: runMeta.branch ?? "", dirty: Boolean(runMeta.dirty), startedAt: runMeta.startedAt ?? "" },
  familyWords,
  zones: (settings.zones ?? []).map((zone) => zone.name),
  files,
  nodes: outNodes,
  edges: outEdges,
  findings: outFindings,
  decisions: outDecisions,
  lots,
};

// ---- map.html: styles --------------------------------------------------------

const css = String.raw`
:root{color-scheme:light dark;--bg:#f6f6f4;--panel:#fff;--line:#dcdcd6;--text:#1c1c1a;--muted:#62625c;--soft:#ecece8;--focus:#0b57d0;
--component:#2f6fd0;--screen:#7a4fc4;--story:#1f8a4c;--token:#b26a00;--module:#77776f;--finding:#c0392b;
--open:#b26a00;--settled:#2f6fd0;--applied:#1f8a4c;--info:#77776f}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--panel:#1f1f1d;--line:#3a3a36;--text:#ececE6;--muted:#a3a39b;--soft:#2a2a27;--focus:#8ab4f8;
--component:#7fb0ff;--screen:#b99bf2;--story:#62c98a;--token:#e6a743;--module:#a3a39b;--finding:#ff8a7a;
--open:#e6a743;--settled:#7fb0ff;--applied:#62c98a;--info:#a3a39b}}
*{box-sizing:border-box}
html{font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text)}
button,input,select{font:inherit;color:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;border-radius:4px}
header.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 16px;padding:12px 16px 0}
header.top h1{font-size:1.15rem;margin:0}
header.top p{margin:0;color:var(--muted);font-size:.87rem}
nav.tabs{display:flex;gap:4px;padding:10px 16px 0;border-bottom:1px solid var(--line);overflow-x:auto}
nav.tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:8px 12px;min-height:44px;cursor:pointer;color:var(--muted);white-space:nowrap}
nav.tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text);font-weight:600}
main{padding:16px}
section.tab[hidden]{display:none}
h2{font-size:1.05rem;margin:0 0 8px}
h3{font-size:.8rem;margin:16px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}
.muted{color:var(--muted)}
.small{font-size:.87rem}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;overflow-wrap:anywhere}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.card b{display:block;font-size:1.5rem;font-weight:600;line-height:1.2}
.card span{color:var(--muted);font-size:.87rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.barrow{display:grid;grid-template-columns:minmax(90px,150px) 1fr auto;gap:10px;align-items:center;width:100%;background:none;border:0;padding:3px 2px;text-align:left;font-size:.9rem}
button.barrow{cursor:pointer;min-height:32px}
button.barrow:hover{background:var(--soft)}
.bar{height:10px;background:var(--soft);border-radius:5px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--muted);border-radius:5px}
.chip{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 8px;font-size:.78rem;line-height:1.6;white-space:nowrap;color:var(--muted)}
.chip.k-component,.chip.k-screen,.chip.k-story,.chip.k-token,.chip.k-module,.chip.s-open,.chip.s-deferred,.chip.s-settled,.chip.s-applied{color:var(--c);border-color:var(--c)}
.k-component{--c:var(--component)}.k-screen{--c:var(--screen)}.k-story{--c:var(--story)}.k-token{--c:var(--token)}.k-module{--c:var(--module)}.k-finding{--c:var(--finding)}.k-more{--c:var(--line)}
.s-open{--c:var(--open)}.s-deferred{--c:var(--info)}.s-settled{--c:var(--settled)}.s-applied{--c:var(--applied)}.s-info{--c:var(--info)}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.filters label{display:grid;gap:2px;font-size:.78rem;color:var(--muted);flex:1 1 120px;min-width:0}
.filters label.wide{flex:1 1 100%}
.filters input,.filters select{width:100%;min-height:36px;padding:4px 8px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font-size:.93rem}
.filters input[type="checkbox"]{width:22px;min-height:22px;height:22px;margin:7px 0}
.count{font-size:.87rem;color:var(--muted);margin:4px 0 8px}
.more{display:block;width:100%;margin-top:8px;min-height:40px;background:var(--soft);border:1px solid var(--line);border-radius:6px;cursor:pointer}
.explorer{display:grid;grid-template-columns:300px minmax(0,1fr) 350px;gap:14px;align-items:start}
.ex-list,.ex-detail{max-height:calc(100vh - 150px);overflow:auto}
.results{list-style:none;margin:0;padding:0}
.results button{display:grid;grid-template-columns:1fr auto;gap:2px 8px;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);border-left:4px solid var(--c);padding:6px 8px;cursor:pointer;min-height:44px}
.results button:hover,.results button[aria-current="true"]{background:var(--soft)}
.results .nm{grid-column:1/-1;font-weight:600;overflow-wrap:anywhere}
.results .sub{color:var(--muted);font-size:.8rem;overflow-wrap:anywhere}
.results .rc{color:var(--muted);font-size:.8rem;white-space:nowrap}
.graphwrap{overflow-x:auto}
svg.ego{display:block;width:100%;min-width:640px;height:auto}
svg.ego .edge{fill:none;stroke:var(--line);stroke-width:1.5}
svg.ego .gn{cursor:pointer}
svg.ego .gn rect.box{fill:var(--panel);stroke:var(--line)}
svg.ego .gn rect.stripe{fill:var(--c)}
svg.ego .gn text{fill:var(--text);font-size:12px}
svg.ego .gn.centre rect.box{stroke:var(--c);stroke-width:2}
svg.ego .gn.centre text{font-size:14px;font-weight:600}
svg.ego .gn:hover rect.box{fill:var(--soft)}
svg.ego .gn:focus{outline:none}
svg.ego .gn:focus-visible rect.box{stroke:var(--focus);stroke-width:3}
svg.ego .lbl{fill:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;font-size:.8rem;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--c);margin-right:5px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.8rem;white-space:nowrap}
th button{background:none;border:0;padding:4px 0;cursor:pointer;font-weight:600;color:inherit;min-height:32px}
td.num,th.num{text-align:right;white-space:nowrap}
td.mono:first-child{overflow-wrap:normal}
.tablewrap{overflow-x:auto}
tr.click{cursor:pointer}
tr.click:hover{background:var(--soft)}
.link{background:none;border:0;padding:0;color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left;overflow-wrap:anywhere}
.fcard{border:1px solid var(--line);border-left:4px solid var(--c);border-radius:6px;padding:8px 10px;margin:8px 0}
.fcard.hit{background:var(--soft)}
.fcard ul{margin:4px 0;padding-left:18px}
.fcard p{margin:4px 0}
.kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:6px 0;font-size:.9rem}
.kv dt{color:var(--muted)}
.kv dd{margin:0;overflow-wrap:anywhere}
.swatch{display:inline-block;width:18px;height:18px;border-radius:4px;border:1px solid var(--line);vertical-align:middle;margin-right:8px;background:repeating-linear-gradient(45deg,var(--soft) 0 4px,var(--panel) 4px 8px)}
details.group{border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:10px}
details.group>summary{padding:10px 12px;cursor:pointer;font-weight:600;min-height:44px}
details.group>div{padding:0 12px 12px}
.plain{list-style:none;margin:0;padding:0}
.plain li{padding:2px 0}
.note{margin:12px 0 0;font-size:.85rem;color:var(--muted)}
[role="status"]{min-height:1.4em;font-size:.87rem;color:var(--muted)}
@media (max-width:1100px){.explorer{grid-template-columns:280px minmax(0,1fr)}.ex-detail{grid-column:1/-1;max-height:none}}
@media (max-width:760px){main{padding:12px}.explorer{grid-template-columns:minmax(0,1fr)}.ex-list{max-height:50vh}.ex-detail{grid-column:auto}.barrow{grid-template-columns:minmax(70px,110px) 1fr auto}}
`;

// ---- map.html: the page script (kept as a real function so Node checks it) ----

function client() {
  "use strict";
  const D = JSON.parse(document.getElementById("ud-data").textContent);
  const SVGNS = "http://www.w3.org/2000/svg";
  const KINDS = ["component", "screen", "story", "token", "module"];
  const KIND_LABEL = { component: "Component", screen: "Screen", story: "Story file", token: "Token", module: "Module" };
  const STATUS_LABEL = { open: "Open", deferred: "Waiting on someone", settled: "Settled", applied: "Applied", info: "Information only" };
  const EFFORTS = ["XS", "S", "M", "L"];
  const CAP = 200;

  // ---- Small DOM helpers (text only, never HTML strings) ----
  function fill(el, attrs, kids) {
    for (const key in attrs || {}) {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === "text") el.textContent = value;
      else if (key.slice(0, 2) === "on") el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    const add = (kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) kid.forEach(add);
      else el.appendChild(typeof kid === "object" ? kid : document.createTextNode(String(kid)));
    };
    add(kids);
    return el;
  }
  const h = (tag, attrs, ...kids) => fill(document.createElement(tag), attrs, kids);
  const s = (tag, attrs, ...kids) => fill(document.createElementNS(SVGNS, tag), attrs, kids);
  const clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  const $ = (id) => document.getElementById(id);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");
  const clip = (text, max) => (String(text).length > max ? String(text).slice(0, max - 1) + "…" : String(text));
  const chip = (text, cls) => h("span", { class: "chip " + (cls || ""), text });

  // ---- Indexes ----
  const N = D.nodes;
  const byId = new Map();
  const byFile = new Map();
  N.forEach((node, index) => {
    node.x = index;
    node.file = node.f >= 0 ? D.files[node.f] : "";
    node.inc = [];
    node.out = [];
    node.sto = [];
    node.fnd = [];
    byId.set(node.i, node);
    if (node.k !== "token" && node.file) {
      if (!byFile.has(node.file)) byFile.set(node.file, []);
      byFile.get(node.file).push(node);
    }
  });
  for (const edge of D.edges) {
    const from = N[edge[0]];
    const to = N[edge[1]];
    if (from.k === "story") {
      if (to.sto.indexOf(from) < 0) to.sto.push(from);
      if (from.out.indexOf(to) < 0) from.out.push(to);
    } else if (edge[2] === 0) {
      from.out.push(to);
      to.inc.push(from);
    }
  }
  const tokensOfFile = new Map();
  for (const node of N) {
    if (node.k !== "token") continue;
    node.users = [];
    for (const ref of node.d.files || []) {
      const file = D.files[ref];
      if (!tokensOfFile.has(file)) tokensOfFile.set(file, []);
      tokensOfFile.get(file).push(node);
      for (const user of byFile.get(file) || []) if (user.k !== "story") node.users.push(user);
    }
  }
  const statusOf = (finding) => {
    const entry = D.decisions[finding.id];
    if (entry && (entry.status === "settled" || entry.status === "applied")) return entry.status;
    if (entry && entry.status === "deferred" && finding.options.length >= 2) return "deferred";
    return finding.options.length >= 2 ? "open" : "info";
  };
  const findingById = new Map();
  for (const finding of D.findings) {
    findingById.set(finding.id, finding);
    finding.status = statusOf(finding);
    finding.nodes = [];
    for (const subject of finding.subject) {
      const hits = byId.has(subject) ? [byId.get(subject)] : byFile.get(subject.replace(/^file:/, "")) || [];
      for (const node of hits) {
        if (finding.nodes.indexOf(node) < 0) finding.nodes.push(node);
        if (node.fnd.indexOf(finding) < 0) node.fnd.push(finding);
      }
    }
  }
  const hasStory = (node) => node.k === "component" && (node.d.stories.length > 0 || node.sto.length > 0);
  const weight = (node) => {
    if (node.k === "component") return node.d.screens * 1e6 + node.d.callSites * 1e3 + node.inc.length;
    if (node.k === "token") return (node.d.uses.total || 0) * 1e3;
    return node.out.length * 1e3 + node.inc.length;
  };
  const byWeight = (a, b) => weight(b) - weight(a) || a.n.localeCompare(b.n) || a.i.localeCompare(b.i);
  const reachText = (node) => {
    if (node.k === "component") return plural(node.d.screens, "screen") + " · " + plural(node.d.callSites, "use");
    if (node.k === "token") return plural(node.d.uses.total || 0, "use");
    if (node.k === "story") return plural(node.d.stories.length, "story", "stories");
    return plural(node.out.length, "component");
  };
  const components = N.filter((node) => node.k === "component");
  const zones = Array.from(new Set(N.filter((node) => node.k !== "token").map((node) => node.z).concat(D.findings.map((finding) => finding.zone)))).sort();
  const families = Array.from(new Set(components.map((node) => node.m).filter(Boolean))).sort();
  const findingKinds = Array.from(new Set(D.findings.map((finding) => finding.kind))).sort();

  // ---- State, kept in the URL hash ----
  const DEFAULTS = { tab: "overview", node: "", f: "", q: "", kind: "", zone: "", fam: "", story: "", fnd: "", ro: "", fq: "", fkind: "", fzone: "", fstatus: "", sort: "screens", dir: "desc", tq: "", tun: "" };
  const TABS = ["overview", "explorer", "findings", "tokens", "decisions"];
  const state = Object.assign({}, DEFAULTS);
  const caps = { list: CAP, findings: CAP, decisions: 100 };
  function readHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    for (const key in DEFAULTS) state[key] = params.has(key) ? params.get(key) : DEFAULTS[key];
    if (TABS.indexOf(state.tab) < 0) state.tab = "overview";
  }
  function hashText() {
    const params = new URLSearchParams();
    for (const key in DEFAULTS) if (state[key] !== DEFAULTS[key]) params.set(key, state[key]);
    const text = params.toString();
    return text ? "#" + text : "#tab=overview";
  }
  let lastHash = "";
  function go(patch, push) {
    Object.assign(state, patch);
    lastHash = hashText();
    try {
      if (push) history.pushState(null, "", lastHash);
      else history.replaceState(null, "", lastHash);
    } catch (error) {
      location.hash = lastHash;
    }
    render();
  }
  const select = (node, finding) => go({ tab: "explorer", node: node.i, f: finding ? finding.id : "" }, true);
  const nodeLink = (node, label) => h("button", { class: "link", type: "button", onclick: () => select(node), title: KIND_LABEL[node.k] + " · " + node.file }, label || node.n);

  // ---- Shell ----
  const main = $("main");
  const panels = {};
  const tabButtons = {};
  const TAB_LABEL = { overview: "Overview", explorer: "Explorer", findings: "Findings (" + D.findings.length + ")", tokens: "Tokens", decisions: "Decisions" };
  const nav = $("tabs");
  TABS.forEach((tab) => {
    tabButtons[tab] = h("button", { type: "button", role: "tab", id: "tab-" + tab, "aria-controls": "panel-" + tab, onclick: () => go({ tab }, true), text: TAB_LABEL[tab] });
    nav.appendChild(tabButtons[tab]);
    panels[tab] = h("section", { class: "tab", role: "tabpanel", id: "panel-" + tab, "aria-labelledby": "tab-" + tab, hidden: true });
    main.appendChild(panels[tab]);
  });
  nav.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.indexOf(state.tab) + step + TABS.length) % TABS.length];
    go({ tab: next }, true);
    tabButtons[next].focus();
  });
  $("meta").textContent = "Run " + D.run.id + (D.run.commit ? " · commit " + D.run.commit.slice(0, 7) : "") + (D.run.branch ? " on " + D.run.branch : "") + (D.run.dirty ? " · with uncommitted changes" : "");

  const built = {};
  const controls = {}; // state key -> input or select
  function control(key, label, options, wide) {
    let input;
    if (options) {
      input = h("select", { onchange: () => change(key, input.value) }, options.map((option) => h("option", { value: option[0], text: option[1] })));
    } else {
      input = h("input", { type: "search", placeholder: label, oninput: () => change(key, input.value) });
    }
    controls[key] = input;
    return h("label", { class: wide ? "wide" : "" }, label, input);
  }
  function change(key, value) {
    const patch = {};
    patch[key] = value;
    caps.list = CAP;
    caps.findings = CAP;
    go(patch, false);
  }
  const anyOf = (label, values) => [["", label]].concat(values.map((value) => [value, value]));
  const YESNO = (label) => [["", label + ": any"], ["yes", label + ": yes"], ["no", label + ": no"]];
  const moreButton = (shown, total, onclick) => (total > shown ? h("button", { class: "more", type: "button", onclick, text: "Show " + Math.min(CAP, total - shown) + " more (" + (total - shown) + " hidden)" }) : null);

  // ---- Overview ----
  function buildOverview(panel) {
    const count = (kind) => N.filter((node) => node.k === kind).length;
    const stories = N.filter((node) => node.k === "story").reduce((sum, node) => sum + node.d.stories.length, 0);
    const withChoice = D.findings.filter((finding) => finding.status !== "info");
    const entries = Object.keys(D.decisions).map((id) => D.decisions[id]);
    const st = { open: withChoice.filter((finding) => finding.status === "open").length, settled: entries.filter((entry) => entry.status === "settled").length, applied: entries.filter((entry) => entry.status === "applied").length };
    const card = (value, label, tab) => h("div", { class: "card" }, h("b", { text: value }), h("span", { text: label }));
    panel.appendChild(h("div", { class: "cards" },
      card(components.length, "components"), card(count("screen"), "screens"), card(count("story"), "story files"), card(stories, "stories"),
      card(count("token"), "tokens"), card(D.findings.length, "Findings"), card(st.open, "Decisions open"), card(st.settled, "Decisions settled"), card(st.applied, "Decisions applied")));

    const coverage = zones.map((zone) => {
      const members = components.filter((node) => node.z === zone);
      return { zone, total: members.length, storied: members.filter(hasStory).length };
    }).filter((row) => row.total);
    const famRows = families.map((family) => {
      const members = components.filter((node) => node.m === family);
      return { family, total: members.length, storied: members.filter(hasStory).length };
    }).sort((a, b) => b.total - a.total || a.family.localeCompare(b.family));
    const maxFam = famRows.length ? famRows[0].total : 1;
    const noFamily = components.filter((node) => !node.m).length;
    const kindRows = findingKinds.map((kind) => {
      const list = D.findings.filter((finding) => finding.kind === kind);
      return { kind, total: list.length, open: list.filter((finding) => finding.status === "open").length };
    }).sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind));

    panel.appendChild(h("div", { class: "cols" },
      h("div", { class: "panel" },
        h("h2", { text: "Story coverage per Zone" }),
        h("p", { class: "muted small", text: "Components that have a story, out of all components of the Zone." }),
        coverage.length ? h("ul", { class: "bars" }, coverage.map((row) => h("li", null, h("button", { class: "barrow", type: "button", onclick: () => go({ tab: "explorer", kind: "component", zone: row.zone, fam: "", story: "", q: "" }, true) },
          h("span", { text: row.zone }),
          h("span", { class: "bar" }, h("i", { style: "width:" + Math.round((row.storied / row.total) * 100) + "%" })),
          h("span", { class: "muted", text: row.storied + " of " + row.total + " (" + Math.round((row.storied / row.total) * 100) + "%)" }))))) : h("p", { class: "muted", text: "No component found." })),
      h("div", { class: "panel" },
        h("h2", { text: "Largest Families" }),
        h("p", { class: "muted small", text: "Components grouped by the last family word of their name." + (noFamily ? " " + plural(noFamily, "component") + " match no Family." : "") }),
        famRows.length ? h("ul", { class: "bars" }, famRows.slice(0, 16).map((row) => h("li", null, h("button", { class: "barrow", type: "button", onclick: () => go({ tab: "explorer", kind: "component", fam: row.family, zone: "", story: "", q: "" }, true) },
          h("span", { text: row.family }),
          h("span", { class: "bar" }, h("i", { style: "width:" + Math.round((row.total / maxFam) * 100) + "%" })),
          h("span", { class: "muted", text: row.total + " · " + row.storied + " with a story" }))))) : h("p", { class: "muted", text: "No Family found." })),
      h("div", { class: "panel" },
        h("h2", { text: "Findings by kind" }),
        kindRows.length ? h("div", { class: "tablewrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", { text: "Kind" }), h("th", { class: "num", text: "Findings" }), h("th", { class: "num", text: "Open" }))),
          h("tbody", null, kindRows.map((row) => h("tr", null,
            h("td", null, h("button", { class: "link", type: "button", onclick: () => go({ tab: "findings", fkind: row.kind, fq: "", fzone: "", fstatus: "" }, true), text: row.kind })),
            h("td", { class: "num", text: row.total }), h("td", { class: "num", text: row.open })))))) : h("p", { class: "muted", text: "No Finding in this run yet. Run the reports, then build the map again." }))));
    panel.appendChild(h("p", { class: "note", text: "The map reads the code's syntax only. A component counts as reached by a screen when its file is; props passed through a spread, and class names built at run time, are not seen." }));
  }

  // ---- Explorer ----
  function buildExplorer(panel) {
    panel.appendChild(h("div", { class: "explorer" },
      h("div", { class: "panel ex-list" },
        h("div", { class: "filters" },
          control("q", "Search by name or file", null, true),
          control("kind", "Kind", [["", "All kinds"]].concat(KINDS.map((kind) => [kind, KIND_LABEL[kind]]))),
          control("zone", "Zone", anyOf("All Zones", zones.concat(N.some((node) => node.k === "token") ? ["tokens"] : []).filter((zone, index, all) => all.indexOf(zone) === index))),
          control("fam", "Family", anyOf("All Families", families)),
          control("story", "Has a story", YESNO("Story")),
          control("fnd", "Has Findings", YESNO("Findings")),
          control("ro", "Read-only", YESNO("Read-only"))),
        h("p", { class: "count", id: "ex-count", role: "status" }),
        h("ul", { class: "results", id: "ex-results" }),
        h("div", { id: "ex-more" })),
      h("div", { class: "panel", id: "ex-graph" }),
      h("div", { class: "panel ex-detail", id: "ex-detail" })));
  }
  function explorerMatches() {
    const q = state.q.trim().toLowerCase();
    const yes = (value, test) => !value || (value === "yes") === Boolean(test);
    return N.filter((node) =>
      (!state.kind || node.k === state.kind) && (!state.zone || node.z === state.zone) && (!state.fam || node.m === state.fam)
      && yes(state.story, hasStory(node)) && (!state.story || node.k === "component")
      && yes(state.fnd, node.fnd.length) && yes(state.ro, node.r)
      && (!q || node.n.toLowerCase().indexOf(q) >= 0 || node.file.toLowerCase().indexOf(q) >= 0)).sort(byWeight);
  }
  function renderExplorer() {
    const list = explorerMatches();
    $("ex-count").textContent = plural(list.length, "result") + ", most reused first";
    const results = clear($("ex-results"));
    list.slice(0, caps.list).forEach((node) => {
      results.appendChild(h("li", null, h("button", { type: "button", class: "k-" + node.k, "aria-current": node.i === state.node ? "true" : null, onclick: () => select(node) },
        h("span", { class: "nm", text: node.n }),
        h("span", { class: "sub", text: KIND_LABEL[node.k] + " · " + (node.k === "token" ? node.d.category : node.z) + (node.fnd.length ? " · " + plural(node.fnd.length, "Finding") : "") + (node.r ? " · read-only" : "") }),
        h("span", { class: "rc", text: reachText(node) }))));
    });
    const more = clear($("ex-more"));
    const button = moreButton(caps.list, list.length, () => {
      caps.list += CAP;
      renderExplorer();
    });
    if (button) more.appendChild(button);
    const node = byId.get(state.node) || null;
    renderGraph(node);
    renderDetail(node);
  }

  function neighbours(node) {
    if (node.k === "token") return { left: node.users.slice().sort(byWeight), right: [], top: [], tokens: [], leftLabel: "Used in", rightLabel: "" };
    const top = node.k === "component" ? node.sto.slice().sort(byWeight) : [];
    return {
      left: node.inc.slice().sort(byWeight), right: node.out.slice().sort(byWeight), top,
      tokens: (tokensOfFile.get(node.file) || []).slice().sort(byWeight),
      leftLabel: node.k === "component" ? "Rendered by" : "", rightLabel: node.k === "story" ? "Shows" : "Renders",
    };
  }
  function renderGraph(node) {
    const box = clear($("ex-graph"));
    if (!node) {
      box.appendChild(h("h2", { text: state.node ? "This item is not on the map of this run" : "Pick something on the left" }));
      box.appendChild(h("p", { class: "muted", text: "The map shows one component, screen, story file or token at a time, with what is around it: who renders it, what it renders, its stories, its tokens and its Findings." }));
      return;
    }
    const W = 920, H = 600, BW = 172, BH = 26, CX = W / 2, CY = H / 2, CW = 220, CH = 40;
    const near = neighbours(node);
    const svg = s("svg", { class: "ego", viewBox: "0 0 " + W + " " + H, role: "group", "aria-label": "What is around " + node.n });
    const edgeLayer = s("g", null);
    const nodeLayer = s("g", null);
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);
    const activate = (el, action) => {
      el.addEventListener("click", action);
      el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          action();
        }
      });
    };
    const drawBox = (x, y, w, bh, cls, label, title, action) => {
      const g = s("g", { class: "gn " + cls, transform: "translate(" + x + "," + y + ")", tabindex: action ? "0" : null, role: action ? "button" : "img", "aria-label": title },
        s("title", { text: title }),
        s("rect", { class: "box", width: w, height: bh, rx: 5 }),
        s("rect", { class: "stripe", width: 5, height: bh, rx: 2 }),
        s("text", { x: 12, y: bh / 2 + 4, text: clip(label, Math.floor((w - 16) / 6.6)) }));
      if (action) activate(g, action);
      nodeLayer.appendChild(g);
    };
    const link = (x1, y1, x2, y2, vertical) => {
      const d = vertical
        ? "M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + y2) / 2 + " " + x2 + "," + (y1 + y2) / 2 + " " + x2 + "," + y2
        : "M" + x1 + "," + y1 + " C" + (x1 + x2) / 2 + "," + y1 + " " + (x1 + x2) / 2 + "," + y2 + " " + x2 + "," + y2;
      edgeLayer.appendChild(s("path", { class: "edge", d }));
    };
    const scrollTo = (id) => () => {
      const target = $(id);
      if (target) {
        target.scrollIntoView({ block: "start" });
        target.focus();
      }
    };
    // items: [{ cls, label, title, action }]
    const cap = (list, max, make, moreId, what) => {
      const items = list.slice(0, max).map(make);
      if (list.length > max) items.push({ cls: "k-more", label: "+" + (list.length - max) + " more", title: (list.length - max) + " more " + what + ", listed in the details", action: scrollTo(moreId) });
      return items;
    };
    const asNode = (other) => ({ cls: "k-" + other.k, label: other.n, title: KIND_LABEL[other.k] + ": " + other.n + " · " + other.file, action: () => select(other) });
    const asFinding = (finding) => ({ cls: "k-finding", label: finding.title, title: "Finding (" + STATUS_LABEL[finding.status] + "): " + finding.title, action: () => go({ f: finding.id }, false) });
    const column = (items, x, label, leftSide) => {
      if (!items.length) return;
      const gap = 32;
      const y0 = CY - (items.length * gap) / 2 + (gap - BH) / 2;
      nodeLayer.appendChild(s("text", { class: "lbl", x, y: Math.max(12, y0 - 8), text: label }));
      items.forEach((item, index) => {
        const y = y0 + index * gap;
        drawBox(x, y, BW, BH, item.cls, item.label, item.title, item.action);
        if (leftSide) link(x + BW, y + BH / 2, CX - CW / 2, CY, false);
        else link(CX + CW / 2, CY, x, y + BH / 2, false);
      });
    };
    const grid = (items, yStart, label, above) => {
      if (!items.length) return;
      const perRow = 3, gapX = 6, rowH = 31;
      const x0 = CX - (perRow * BW + (perRow - 1) * gapX) / 2;
      const rows = Math.ceil(items.length / perRow);
      const top = above ? yStart : yStart;
      nodeLayer.appendChild(s("text", { class: "lbl", x: x0, y: above ? top - 6 : top - 6, text: label }));
      items.forEach((item, index) => {
        const row = Math.floor(index / perRow);
        const inRow = Math.min(perRow, items.length - row * perRow);
        const x = CX - (inRow * BW + (inRow - 1) * gapX) / 2 + (index % perRow) * (BW + gapX);
        const y = top + row * rowH;
        drawBox(x, y, BW, BH, item.cls, item.label, item.title, item.action);
        if (above) link(x + BW / 2, y + BH, CX, CY - CH / 2, true);
        else link(CX, CY + CH / 2, x + BW / 2, y, true);
      });
      return rows;
    };
    column(cap(near.left, 12, asNode, "d-left", near.leftLabel.toLowerCase() || "items"), 8, near.leftLabel, true);
    column(cap(near.right, 12, asNode, "d-right", "components"), W - 8 - BW, near.rightLabel, false);
    const topItems = cap(near.top, 11, asNode, "d-stories", "story files");
    grid(topItems, 22, "Stories", true);
    const bottomItems = cap(near.tokens, 5, asNode, "d-tokens", "tokens").concat(cap(node.fnd, 5, asFinding, "d-findings", "Findings"));
    grid(bottomItems, H - Math.ceil(bottomItems.length / 3) * 31 - 2, "Tokens and Findings", false);
    const centre = s("g", { class: "gn centre k-" + node.k, transform: "translate(" + (CX - CW / 2) + "," + (CY - CH / 2) + ")", role: "img", "aria-label": KIND_LABEL[node.k] + ": " + node.n },
      s("title", { text: KIND_LABEL[node.k] + ": " + node.n }),
      s("rect", { class: "box", width: CW, height: CH, rx: 6 }), s("rect", { class: "stripe", width: 6, height: CH, rx: 3 }),
      s("text", { x: 16, y: CH / 2 + 5, text: clip(node.n, 26) }));
    nodeLayer.appendChild(centre);
    box.appendChild(h("h2", null, node.n, " ", chip(KIND_LABEL[node.k], "k-" + node.k)));
    box.appendChild(h("div", { class: "graphwrap" }, svg));
    const alone = !near.left.length && !near.right.length && !near.top.length && !bottomItems.length;
    if (alone) box.appendChild(h("p", { class: "muted", text: "Nothing is linked to it: nothing renders it, it renders no component, and it has no story, token or Finding." }));
    box.appendChild(h("div", { class: "legend" }, KINDS.concat(["finding"]).map((kind) => h("span", { class: "k-" + kind }, h("i"), kind === "finding" ? "Finding" : KIND_LABEL[kind]))));
  }

  function findingCard(finding, withSubjects) {
    const entry = D.decisions[finding.id];
    const chosen = entry && finding.status !== "open" ? entry.choice : null;
    return h("div", { class: "fcard s-" + finding.status + (finding.id === state.f ? " hit" : ""), id: "f-" + finding.id, tabindex: "-1" },
      h("p", null, h("strong", { text: finding.title })),
      h("p", { class: "small" }, chip(STATUS_LABEL[finding.status], "s-" + finding.status), " ", chip(finding.kind), " ",
        h("span", { class: "muted", text: "Reach: " + plural(finding.reach.screens, "screen") + ", " + plural(finding.reach.uses, "use") + " · Effort: " + (finding.effort || "not set") + " · Confidence: " + (finding.confidence === null ? "not set" : Math.round(finding.confidence * 100) + "%") })),
      withSubjects && finding.nodes.length ? h("p", { class: "small" }, "About: ", finding.nodes.slice(0, 6).map((node, index) => [index ? ", " : "", nodeLink(node)])) : null,
      finding.options.length ? h("ul", { class: "small" }, finding.options.map((option) => h("li", null, option.label + " ", h("span", { class: "mono muted", text: "(" + option.key + ")" }),
        option.key === chosen ? [" ", chip("chosen", "s-" + finding.status)] : null, option.key === finding.recommendation ? [" ", chip("recommended")] : null))) : h("p", { class: "small muted", text: "Information only: no choice to make." }),
      finding.judgement ? h("p", { class: "small", text: finding.judgement }) : null,
      entry && entry.note ? h("p", { class: "small" }, h("span", { class: "muted", text: "Note: " }), entry.note) : null,
      entry && chosen ? h("p", { class: "small muted", text: "Settled on " + (entry.decidedAt || "?") + (entry.appliedAt ? ", applied on " + entry.appliedAt : "") + (entry.lot ? ", Lot " + entry.lot : "") }) : null,
      finding.evidence.length ? h("ul", { class: "small" }, finding.evidence.slice(0, 3).map((item) => h("li", null, h("span", { class: "mono", text: (item.file || "") + (item.line ? ":" + item.line : "") }), item.note ? " " + item.note : "")),
        finding.evidence.length + finding.more > 3 ? h("li", { class: "muted", text: "…and " + (finding.evidence.length + finding.more - 3) + " more in the report" }) : null) : null);
  }
  function nodeList(id, title, list) {
    if (!list.length) return null;
    return [h("h3", { id, tabindex: "-1", text: title + " (" + list.length + ")" }), h("ul", { class: "plain small" }, list.slice(0, 60).map((node) => h("li", null, nodeLink(node), " ", h("span", { class: "muted", text: node.k === "token" ? node.d.value : node.z }))),
      list.length > 60 ? h("li", { class: "muted", text: "…and " + (list.length - 60) + " more. Use the search to find them." }) : null)];
  }
  function renderDetail(node) {
    const box = clear($("ex-detail"));
    if (!node) {
      box.appendChild(h("p", { class: "muted", text: "Details of the selected item appear here." }));
      return;
    }
    const d = node.d;
    const near = neighbours(node);
    const kv = (rows) => h("dl", { class: "kv" }, rows.filter(Boolean).map((row) => [h("dt", { text: row[0] }), h("dd", null, row[1])]));
    box.appendChild(h("h2", null, node.n));
    box.appendChild(h("p", { class: "small" }, chip(KIND_LABEL[node.k], "k-" + node.k), " ", node.k !== "token" ? chip("Zone: " + node.z) : null, " ", node.m ? chip("Family: " + node.m) : null, " ", node.r ? chip("read-only") : null));
    box.appendChild(h("p", { class: "mono", text: node.file + (node.l ? ":" + node.l : "") }));
    if (node.k === "component") {
      box.appendChild(kv([["Used", plural(d.callSites, "call site") + " in " + plural(d.useFiles, "file") + (d.storyCallSites ? ", plus " + d.storyCallSites + " in stories" : "")],
        ["Reach", plural(d.screens, "screen")], ["Stories", hasStory(node) ? plural(node.sto.length, "story file") : "none"],
        d.spreads ? ["Spreads", d.spreads + " call sites pass props through a spread (not resolved)"] : null,
        d.extends.length ? ["Also accepts", h("span", { class: "mono", text: d.extends.join(", ") })] : null]));
      if (d.props.length || Object.keys(d.used).length) {
        box.appendChild(h("h3", { text: "Props: declared and really used" }));
        const usedText = (use) => {
          if (!use) return h("span", { class: "muted", text: "never passed" });
          const parts = use.values.map((pair) => pair[0] + " ×" + pair[1]);
          if (use.dynamic) parts.push("computed ×" + use.dynamic);
          return parts.length ? parts.join(", ") : "passed ×" + use.count;
        };
        const declared = d.props.map((prop) => prop.name);
        const extra = Object.keys(d.used).filter((name) => declared.indexOf(name) < 0).sort();
        box.appendChild(h("div", { class: "tablewrap" }, h("table", null,
          h("thead", null, h("tr", null, h("th", { text: "Prop" }), h("th", { text: "Declared" }), h("th", { text: "Used by call sites" }))),
          h("tbody", null,
            d.props.map((prop) => h("tr", null, h("td", { class: "mono", text: prop.name + (prop.optional ? "?" : "") }), h("td", { class: "mono", text: prop.values ? prop.values.join(" | ") : prop.type }), h("td", { class: "small" }, usedText(d.used[prop.name])))),
            extra.map((name) => h("tr", null, h("td", { class: "mono", text: name }), h("td", { class: "small muted", text: "not declared here" }), h("td", { class: "small" }, usedText(d.used[name]))))))));
      }
      const variantNames = Object.keys(d.variants);
      if (variantNames.length) {
        box.appendChild(h("h3", { text: "Variants" }));
        variantNames.forEach((name) => box.appendChild(kv([[h("span", { class: "mono", text: name }), ""]].concat(Object.keys(d.variants[name]).map((variant) => [variant, h("span", { class: "mono", text: (d.variants[name][variant] || []).join(" | ") })])))));
      }
      if (d.screenSample.length) box.appendChild(h("div", null, h("h3", { text: "Screens (sample of " + d.screens + ")" }), h("ul", { class: "plain mono" }, d.screenSample.map((route) => h("li", { text: route })))));
    } else if (node.k === "screen") {
      box.appendChild(kv([["Route", h("span", { class: "mono", text: d.route })], ["Kind", d.screenKind], d.files !== null ? ["Files reached", d.files] : null]));
    } else if (node.k === "story") {
      const target = d.component ? byId.get(d.component) : null;
      box.appendChild(kv([["Title", d.title || "none"], ["Component", target ? nodeLink(target) : (d.componentName || "none") + " (not found on the map)"], d.tags.length ? ["Tags", d.tags.join(", ")] : null]));
      box.appendChild(h("h3", { text: "Stories (" + d.stories.length + ")" }));
      box.appendChild(h("ul", { class: "plain small" }, d.stories.map((story) => h("li", null, h("strong", { text: story.name }), story.args ? [" ", h("span", { class: "mono muted", text: story.args })] : null))));
    } else if (node.k === "token") {
      const colour = colourOf(node);
      box.appendChild(kv([["Category", d.category], ["Value", [swatchFor(colour), h("span", { class: "mono", text: d.value })]], ["Declared in", d.scopes.join(", ") || "?"],
        ["Used", (d.uses.total || 0) === 0 ? "never: unused" : plural(d.uses.total, "time") + " (" + (d.uses.utility || 0) + " as a class, " + (d.uses.var || 0) + " as var() in code, " + (d.uses.css || 0) + " in CSS)"]]));
    }
    if (node.k === "component") box.appendChild(h("div", null, nodeList("d-stories", "Story files", near.top)));
    box.appendChild(h("div", null, nodeList("d-left", near.leftLabel || "Rendered by", near.left)));
    box.appendChild(h("div", null, nodeList("d-right", near.rightLabel || "Renders", near.right)));
    box.appendChild(h("div", null, nodeList("d-tokens", "Tokens used in its file", near.tokens)));
    box.appendChild(h("h3", { id: "d-findings", tabindex: "-1", text: "Findings (" + node.fnd.length + ")" }));
    if (!node.fnd.length) box.appendChild(h("p", { class: "muted small", text: "No Finding on this item." }));
    node.fnd.slice(0, 40).forEach((finding) => box.appendChild(findingCard(finding, false)));
    if (node.fnd.length > 40) box.appendChild(h("p", { class: "muted small", text: "…and " + (node.fnd.length - 40) + " more, in the Findings tab." }));
    const hit = state.f ? $("f-" + state.f) : null;
    if (hit) hit.scrollIntoView({ block: "nearest" });
  }

  // ---- Findings ----
  const COLUMNS = [["title", "Finding"], ["kind", "Kind"], ["zone", "Zone"], ["screens", "Screens", 1], ["uses", "Uses", 1], ["effort", "Effort"], ["confidence", "Confidence", 1], ["status", "Decision"]];
  function buildFindings(panel) {
    panel.appendChild(h("div", { class: "filters" },
      control("fq", "Search Findings"), control("fkind", "Kind", anyOf("All kinds", findingKinds)), control("fzone", "Zone", anyOf("All Zones", zones)),
      control("fstatus", "Decision", [["", "Any status"], ["open", "Open"], ["deferred", "Waiting on someone"], ["settled", "Settled"], ["applied", "Applied"], ["info", "Information only"]])));
    panel.appendChild(h("p", { class: "count", id: "fi-count", role: "status" }));
    panel.appendChild(h("div", { class: "panel tablewrap" }, h("table", null, h("thead", null, h("tr", { id: "fi-head" })), h("tbody", { id: "fi-body" }))));
    panel.appendChild(h("div", { id: "fi-more" }));
  }
  function sortValue(finding, key) {
    if (key === "screens" || key === "uses") return finding.reach[key];
    if (key === "effort") return EFFORTS.indexOf(finding.effort);
    if (key === "confidence") return finding.confidence === null ? -1 : finding.confidence;
    if (key === "status") return ["open", "deferred", "settled", "applied", "info"].indexOf(finding.status);
    return String(finding[key]).toLowerCase();
  }
  function renderFindings() {
    const q = state.fq.trim().toLowerCase();
    const dir = state.dir === "asc" ? 1 : -1;
    const list = D.findings.filter((finding) => (!state.fkind || finding.kind === state.fkind) && (!state.fzone || finding.zone === state.fzone) && (!state.fstatus || finding.status === state.fstatus)
      && (!q || finding.title.toLowerCase().indexOf(q) >= 0 || finding.subject.join(" ").toLowerCase().indexOf(q) >= 0)).sort((a, b) => {
      const x = sortValue(a, state.sort), y = sortValue(b, state.sort);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || b.reach.screens - a.reach.screens || b.reach.uses - a.reach.uses || a.id.localeCompare(b.id);
    });
    const head = clear($("fi-head"));
    COLUMNS.forEach((column) => {
      const active = state.sort === column[0];
      head.appendChild(h("th", { class: column[2] ? "num" : "", "aria-sort": active ? (state.dir === "asc" ? "ascending" : "descending") : "none" },
        h("button", { type: "button", onclick: () => go({ sort: column[0], dir: active && state.dir === "desc" ? "asc" : active ? "desc" : column[2] ? "desc" : "asc" }, false), text: column[1] + (active ? (state.dir === "asc" ? " ↑" : " ↓") : "") })));
    });
    const body = clear($("fi-body"));
    const open = (finding) => {
      if (finding.nodes.length) select(finding.nodes[0], finding);
      else $("fi-count").textContent = "“" + finding.title + "” is about " + (finding.subject.join(", ") || "the whole project") + ", which is not an item on the map.";
    };
    list.slice(0, caps.findings).forEach((finding) => {
      body.appendChild(h("tr", { class: "click", onclick: () => open(finding) },
        h("td", null, h("button", { class: "link", type: "button", text: finding.title })),
        h("td", { text: finding.kind }), h("td", { text: finding.zone }), h("td", { class: "num", text: finding.reach.screens }), h("td", { class: "num", text: finding.reach.uses }),
        h("td", { text: finding.effort || "–" }), h("td", { class: "num", text: finding.confidence === null ? "–" : Math.round(finding.confidence * 100) + "%" }),
        h("td", null, chip(STATUS_LABEL[finding.status] + (finding.status !== "open" && D.decisions[finding.id] && D.decisions[finding.id].choice ? ": " + D.decisions[finding.id].choice : ""), "s-" + finding.status))));
    });
    if (!list.length) body.appendChild(h("tr", null, h("td", { colspan: COLUMNS.length, class: "muted", text: D.findings.length ? "No Finding matches these filters." : "No Finding in this run yet." })));
    $("fi-count").textContent = plural(list.length, "Finding") + (list.length < D.findings.length ? " of " + D.findings.length : "") + ". Pick one to see it on the map.";
    const more = clear($("fi-more"));
    const button = moreButton(caps.findings, list.length, () => {
      caps.findings += CAP;
      renderFindings();
    });
    if (button) more.appendChild(button);
  }

  // ---- Tokens ----
  const tokens = N.filter((node) => node.k === "token");
  const COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color)\([^;{}]*\))$/i;
  function colourOf(node) {
    let value = node.d.value;
    for (let hop = 0; hop < 6; hop += 1) {
      const ref = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value);
      if (!ref) break;
      const target = byId.get("t:" + ref[1]);
      if (!target) return null;
      value = target.d.value;
    }
    return COLOUR.test(value) ? value : null;
  }
  function swatchFor(colour) {
    if (!colour) return null;
    const el = h("span", { class: "swatch", role: "img", "aria-label": "Colour " + colour });
    el.style.background = colour;
    return el;
  }
  function buildTokens(panel) {
    const unusedBox = h("input", { type: "checkbox", onchange: () => change("tun", unusedBox.checked ? "1" : "") });
    controls.tun = unusedBox;
    panel.appendChild(h("div", { class: "filters" }, control("tq", "Search tokens"), h("label", null, "Unused only", unusedBox)));
    panel.appendChild(h("p", { class: "count", id: "tk-count", role: "status" }));
    panel.appendChild(h("div", { id: "tk-groups" }));
  }
  function renderTokens() {
    const q = state.tq.trim().toLowerCase();
    const list = tokens.filter((node) => (!q || node.n.toLowerCase().indexOf(q) >= 0 || node.d.value.toLowerCase().indexOf(q) >= 0) && (!state.tun || !(node.d.uses.total > 0)));
    const unused = tokens.filter((node) => !(node.d.uses.total > 0)).length;
    $("tk-count").textContent = plural(list.length, "token") + (list.length < tokens.length ? " of " + tokens.length : "") + " · " + unused + " unused in all";
    const groups = clear($("tk-groups"));
    const categories = Array.from(new Set(list.map((node) => node.d.category))).sort();
    if (!list.length) groups.appendChild(h("p", { class: "muted", text: tokens.length ? "No token matches." : "No token found in the token files." }));
    categories.forEach((category) => {
      const members = list.filter((node) => node.d.category === category).sort((a, b) => a.n.localeCompare(b.n));
      const body = h("tbody");
      let shown = 0;
      const holder = h("div");
      const addRows = () => {
        members.slice(shown, shown + CAP).forEach((node) => {
          const total = node.d.uses.total || 0;
          body.appendChild(h("tr", null,
            h("td", null, swatchFor(category === "color" || colourOf(node) ? colourOf(node) : null), nodeLink(node)),
            h("td", { class: "mono", text: node.d.value }), h("td", { class: "num", text: total }),
            h("td", null, total === 0 ? chip("unused", "s-open") : null, node.fnd.length ? [" ", chip(plural(node.fnd.length, "Finding"))] : null)));
        });
        shown = Math.min(members.length, shown + CAP);
        clear(holder);
        const button = moreButton(shown, members.length, addRows);
        if (button) holder.appendChild(button);
      };
      addRows();
      groups.appendChild(h("details", { class: "group", open: categories.length <= 4 || members.length <= 30 || Boolean(q) },
        h("summary", { text: category + " (" + members.length + ", " + members.filter((node) => !(node.d.uses.total > 0)).length + " unused)" }),
        h("div", { class: "tablewrap" }, h("table", null, h("thead", null, h("tr", null, h("th", { text: "Token" }), h("th", { text: "Value" }), h("th", { class: "num", text: "Uses" }), h("th", { text: "" }))), body), holder)));
    });
  }

  // ---- Decisions ----
  function renderDecisions() {
    const panel = clear(panels.decisions);
    const openList = D.findings.filter((finding) => finding.status === "open").sort((a, b) => b.reach.screens - a.reach.screens || b.reach.uses - a.reach.uses || a.id.localeCompare(b.id));
    const entries = Object.keys(D.decisions).map((id) => Object.assign({ id }, D.decisions[id]));
    const section = (title, status, intro, rows, total) => h("details", { class: "group", open: status === "open" || total <= 30 },
      h("summary", null, chip(title, "s-" + status), " " + total),
      h("div", null, h("p", { class: "muted small", text: intro }), total ? rows : h("p", { class: "muted", text: "None." })));
    const subjectLink = (id, title) => {
      const finding = findingById.get(id);
      if (finding && finding.nodes.length) return h("button", { class: "link", type: "button", onclick: () => select(finding.nodes[0], finding), text: title });
      return h("span", null, title, finding ? null : h("span", { class: "muted", text: " (not in this run)" }));
    };
    const ledgerTable = (list, applied) => h("div", { class: "tablewrap" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { text: "Finding" }), h("th", { text: "Kind" }), h("th", { text: "Choice" }), h("th", { text: "Note" }), h("th", { text: "Settled" }), applied ? [h("th", { text: "Applied" }), h("th", { text: "Lot" })] : null)),
      h("tbody", null, list.slice(0, 500).map((entry) => h("tr", null, h("td", null, subjectLink(entry.id, entry.title)), h("td", { text: entry.kind }), h("td", { class: "mono", text: entry.choice || "" }), h("td", { text: entry.note || "" }), h("td", { text: entry.decidedAt || "" }),
        applied ? [h("td", { text: entry.appliedAt || "" }), h("td", { text: entry.lot || "" })] : null)))));
    const sorted = (status) => entries.filter((entry) => entry.status === status).sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.title).localeCompare(String(b.title)));
    const settled = sorted("settled");
    const applied = sorted("applied");
    panel.appendChild(section("Open", "open", "Findings that offer a choice and wait for an answer, widest Reach first.",
      [h("div", { class: "tablewrap" }, h("table", null,
        h("thead", null, h("tr", null, h("th", { text: "Finding" }), h("th", { text: "Kind" }), h("th", { class: "num", text: "Screens" }), h("th", { class: "num", text: "Uses" }), h("th", { text: "Options" }))),
        h("tbody", null, openList.slice(0, caps.decisions).map((finding) => h("tr", null, h("td", null, subjectLink(finding.id, finding.title)), h("td", { text: finding.kind }), h("td", { class: "num", text: finding.reach.screens }), h("td", { class: "num", text: finding.reach.uses }),
          h("td", { class: "small", text: finding.options.map((option) => option.key + (option.key === finding.recommendation ? " (recommended)" : "")).join(", ") })))))),
      moreButton(caps.decisions, openList.length, () => {
        caps.decisions += CAP;
        renderDecisions();
      })], openList.length));
    panel.appendChild(section("Settled", "settled", "Answered, not reworked in code yet. A “keep” needs no rework.", ledgerTable(settled, false), settled.length));
    panel.appendChild(section("Applied", "applied", "Answered and reworked in code.", ledgerTable(applied, true), applied.length));
    panel.appendChild(h("h2", { text: "Lots" }));
    if (!D.lots.length) panel.appendChild(h("p", { class: "muted", text: "No Lot yet. Lots are made from settled Decisions when the plan is built." }));
    D.lots.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((lot) => {
      panel.appendChild(h("details", { class: "group" },
        h("summary", null, (lot.order || "?") + ". " + lot.title + " ", chip(lot.status || "planned"), " ", h("span", { class: "muted small", text: plural((lot.decisions || []).length, "Decision") + " · " + plural((lot.files || []).length, "file") + " · effort " + (lot.effort || "not set") + ((lot.dependsOn || []).length ? " · after " + lot.dependsOn.join(", ") : "") })),
        h("div", null,
          h("p", { class: "small" }, h("span", { class: "muted", text: "Check: " }), lot.check || ""),
          h("h3", { text: "Decisions" }),
          h("ul", { class: "plain small" }, (lot.decisions || []).map((id) => h("li", null, subjectLink(id, (D.decisions[id] && D.decisions[id].title) || id), D.decisions[id] ? h("span", { class: "mono muted", text: " (" + D.decisions[id].choice + ")" }) : null))),
          h("h3", { text: "Files" }),
          h("ul", { class: "plain mono" }, (lot.files || []).slice(0, 60).map((file) => h("li", { text: file })), (lot.files || []).length > 60 ? h("li", { class: "muted", text: "…and " + ((lot.files || []).length - 60) + " more" }) : null),
          (lot.readOnlyBlocked || []).length ? [h("h3", { text: "Blocked, read-only" }), h("ul", { class: "plain mono" }, lot.readOnlyBlocked.map((file) => h("li", { text: file })))] : null)));
    });
  }

  // ---- Render ----
  const BUILD = { overview: buildOverview, explorer: buildExplorer, findings: buildFindings, tokens: buildTokens };
  const RENDER = { explorer: renderExplorer, findings: renderFindings, tokens: renderTokens, decisions: renderDecisions };
  function render() {
    TABS.forEach((tab) => {
      const active = tab === state.tab;
      panels[tab].hidden = !active;
      tabButtons[tab].setAttribute("aria-selected", active ? "true" : "false");
      tabButtons[tab].setAttribute("tabindex", active ? "0" : "-1");
    });
    if (BUILD[state.tab] && !built[state.tab]) {
      BUILD[state.tab](panels[state.tab]);
      built[state.tab] = true;
    }
    for (const key in controls) {
      const input = controls[key];
      if (input.type === "checkbox") input.checked = Boolean(state[key]);
      else if (input.value !== state[key]) input.value = state[key];
    }
    if (RENDER[state.tab]) RENDER[state.tab]();
  }
  window.addEventListener("hashchange", () => {
    if (location.hash === lastHash) return;
    readHash();
    lastHash = location.hash;
    render();
  });
  window.addEventListener("popstate", () => {
    readHash();
    lastHash = location.hash;
    render();
  });
  readHash();
  lastHash = location.hash;
  render();
}

const dataJson = JSON.stringify(embedded).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const script = `(${client.toString()})();`.replace(/<\/(script)/gi, "<\\/$1");
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(embedded.project)} map, run ${escapeHtml(run.id)}</title>
<style>${css}</style>
</head>
<body>
<header class="top"><h1>${escapeHtml(embedded.project)} map</h1><p id="meta"></p></header>
<nav class="tabs" id="tabs" role="tablist" aria-label="Views"></nav>
<main id="main"></main>
<noscript><p style="padding:16px">This map needs JavaScript. The text version is in reports/map.md.</p></noscript>
<script type="application/json" id="ud-data">${dataJson}</script>
<script>${script}</script>
</body>
</html>
`;
const htmlFile = path.join(run.dir, "map.html");
writeText(htmlFile, html);

// ---- reports/map.md ------------------------------------------------------------

const components = graph.nodes.filter((node) => node.kind === "component");
const storyFiles = graph.nodes.filter((node) => node.kind === "story");
const storied = new Set();
for (const node of components) if ((node.data?.stories ?? []).length || (node.data?.shownIn ?? []).length) storied.add(node.id);
for (const edge of graph.edges) if (String(edge.from).startsWith("y:")) storied.add(edge.to);
const familyById = new Map(components.map((node) => [node.id, familyOf(node.name)]));
const reachSort = (a, b) =>
  (b.data?.screens ?? 0) - (a.data?.screens ?? 0) || (b.data?.uses?.callSites ?? 0) - (a.data?.uses?.callSites ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const mmId = (text) => String(text).replace(/[^A-Za-z0-9_]/g, "_");
const mmLabel = (text) => `"${String(text).replace(/"/g, "#quot;").replace(/[\r\n]+/g, " ")}"`;
const NO_FAMILY = "No Family";

const zoneNames = [...new Set(components.map((node) => node.zone ?? "unzoned"))].sort();
const zoneLines = ["graph LR"];
for (const zone of zoneNames) {
  const members = components.filter((node) => (node.zone ?? "unzoned") === zone);
  const zoneId = `z_${mmId(zone)}`;
  zoneLines.push(`  ${zoneId}[${mmLabel(`${zone} (${members.length})`)}]`);
  const counted = countBy(members, (node) => familyById.get(node.id) ?? NO_FAMILY);
  const named = counted.filter(([family]) => family !== NO_FAMILY);
  for (const [family, count] of named.slice(0, 15)) zoneLines.push(`  ${zoneId} --> f_${mmId(zone)}_${mmId(family)}[${mmLabel(`${family} (${count})`)}]`);
  const rest = named.slice(15).reduce((sum, [, count]) => sum + count, 0);
  if (rest) zoneLines.push(`  ${zoneId} --> f_${mmId(zone)}_more[${mmLabel(`${named.length - 15} more Families (${rest})`)}]`);
  const none = counted.find(([family]) => family === NO_FAMILY)?.[1] ?? 0;
  if (none) zoneLines.push(`  ${zoneId} --> f_${mmId(zone)}_none[${mmLabel(`${NO_FAMILY} (${none})`)}]`);
}

const familyCounts = countBy(components.filter((node) => familyById.get(node.id)), (node) => familyById.get(node.id));
const familySections = familyCounts.slice(0, 8).map(([family, count]) => {
  const members = components.filter((node) => familyById.get(node.id) === family).sort(reachSort);
  const withStory = members.filter((node) => storied.has(node.id)).length;
  const shown = members.slice(0, members.length > 24 ? 23 : 24);
  const lines = ["graph TD", `  fam[${mmLabel(`${family} (${count})`)}]`];
  shown.forEach((node, index) => lines.push(`  fam --> n${index}[${mmLabel(`${node.name} · ${node.zone ?? "unzoned"} · ${node.data?.screens ?? 0} screen${(node.data?.screens ?? 0) === 1 ? "" : "s"}`)}]${storied.has(node.id) ? ":::storied" : ""}`));
  if (members.length > shown.length) lines.push(`  fam --> more[${mmLabel(`${members.length - shown.length} more, less used`)}]`);
  lines.push("  classDef storied stroke:#1f8a4c,stroke-width:3px");
  return [`### ${family}`, "", `${count} component${count === 1 ? "" : "s"}, ${withStory} with a story (thick green outline).`, "", "```mermaid", ...lines, "```", ""].join("\n");
});

const reused = [...components].sort((a, b) =>
  (b.data?.uses?.callSites ?? 0) - (a.data?.uses?.callSites ?? 0) || (b.data?.screens ?? 0) - (a.data?.screens ?? 0) || a.id.localeCompare(b.id)).slice(0, 30);
const storyCount = storyFiles.reduce((sum, node) => sum + (node.data?.stories ?? []).length, 0);
const storiesOf = (node) => {
  const ids = new Set([...(node.data?.stories ?? []), ...(node.data?.shownIn ?? [])]);
  for (const edge of graph.edges) if (edge.to === node.id && String(edge.from).startsWith("y:")) ids.add(edge.from);
  return ids.size;
};
const md = [
  "# Map",
  "",
  `Run ${run.id}${runMeta.commit ? `, commit ${String(runMeta.commit).slice(0, 7)}` : ""}. The interactive version is \`map.html\`, next to the reports folder: open it in a browser, it works offline.`,
  "",
  mdTable(["", "Count"], [
    ["Components", components.length],
    ["Components with a story", storied.size],
    ["Screens", graph.nodes.filter((node) => node.kind === "screen").length],
    ["Story files", storyFiles.length],
    ["Stories", storyCount],
    ["Tokens", graph.nodes.filter((node) => node.kind === "token").length],
    ["Findings", findings.length],
  ]),
  "",
  "## Zones and their Families",
  "",
  "Each Zone with its largest Families (15 at most) and how many components each holds. A Family is read from the last family word in a component's name.",
  "",
  components.length ? ["```mermaid", ...zoneLines, "```"].join("\n") : "No component found.",
  "",
  "## The largest Families",
  "",
  familySections.length ? familySections.join("\n") : "No Family found: no component name ends with one of the family words of the Project settings.\n",
  "## The most reused components",
  "",
  reused.length
    ? mdTable(["Component", "Zone", "Call sites", "Screens", "Story files", "File"], reused.map((node) => [node.name, node.zone ?? "unzoned", node.data?.uses?.callSites ?? 0, node.data?.screens ?? 0, storiesOf(node), node.file]))
    : "No component found.",
  "",
  "## Limits of this map",
  "",
  "- It reads the code's syntax only: a component counts as reached by a screen when its file is.",
  "- Props passed through a spread, and class names built at run time, are not seen.",
  "",
].join("\n");
const mdFile = path.join(run.dir, "reports", "map.md");
writeText(mdFile, md);

process.stdout.write(`${JSON.stringify({
  run: run.id,
  nodes: outNodes.length,
  edges: outEdges.length,
  findings: outFindings.length,
  decisions: Object.keys(outDecisions).length,
  lots: lots.length,
  families: familyCounts.length,
  htmlBytes: fs.statSync(htmlFile).size,
  out: [path.relative(root, htmlFile), path.relative(root, mdFile)],
}, null, 1)}\n`);
