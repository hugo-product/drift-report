#!/usr/bin/env node
// ud-init helper: looks at the project and prints a proposed settings.json on
// stdout. It writes nothing. The skill shows the proposal, asks the owner the
// project-specific questions, then writes .ud/settings.json itself.
//
//   node detect.mjs            run from the project root
import fs from "node:fs";
import path from "node:path";
import { projectRoot, readJson, git, walk } from "./lib.mjs";

const root = projectRoot();
const pkg = readJson(path.join(root, "package.json"), {});
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
const exists = (rel) => fs.existsSync(path.join(root, rel));
const notes = [];

// Framework.
let framework = "unknown";
if (has("next")) framework = "next";
else if (has("@remix-run/react") || has("react-router")) framework = "react-router";
else if (has("vite") && has("react")) framework = "react-vite";
else if (has("react")) framework = "react";
if (!has("react")) notes.push("React was not found. The scan reads JSX/TSX; other view layers are not supported yet.");

// Styling.
let styling = "unknown";
const tailwind = deps.tailwindcss ?? "";
if (tailwind) styling = /(^|[^\d])4\./.test(tailwind) ? "tailwind-v4" : "tailwind-v3";
else if (has("styled-components") || has("@emotion/react")) styling = "css-in-js";
else if (has("@vanilla-extract/css")) styling = "vanilla-extract";
if (!styling.startsWith("tailwind")) notes.push(`Styling looks like "${styling}". Class-based checks (tokens, scales, patterns) are written for Tailwind and will find little here.`);

// Source directories.
const CANDIDATES = ["src", "app", "pages", "components", "features", "ui", "lib", "hooks", "slices", "layouts", "styles"];
const sourceDirs = CANDIDATES.filter((dir) => exists(dir) && fs.statSync(path.join(root, dir)).isDirectory());
if (sourceDirs.includes("src")) for (const dir of [...sourceDirs]) if (dir !== "src" && !["app", "pages"].includes(dir)) notes.push(`Both src/ and ${dir}/ exist: check that ${dir}/ really holds interface code.`);

// Storybook.
const configDir = [".storybook", "storybook", ".config/storybook"].find(exists) ?? null;
let storyGlobs = [];
if (configDir) {
  const main = ["main.ts", "main.js", "main.mjs", "main.tsx"].map((name) => path.join(root, configDir, name)).find((file) => fs.existsSync(file));
  if (main) {
    const text = fs.readFileSync(main, "utf8");
    const block = /stories\s*:\s*\[([\s\S]*?)\]/.exec(text);
    if (block) storyGlobs = [...block[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => path.posix.normalize(path.posix.join(configDir, match[1])));
  }
}
const storybookVersion = deps.storybook ?? deps["@storybook/react"] ?? null;
if (!configDir) notes.push("No Storybook configuration found. Story checks will report every component as lacking a story.");

// Screens.
let screens = { kind: "none" };
const appDir = ["app", "src/app"].find((dir) => exists(dir));
const pagesDir = ["pages", "src/pages"].find((dir) => exists(dir));
if (framework === "next" && appDir) screens = { kind: "next-app", dir: appDir };
else if (pagesDir) screens = { kind: "globs", include: [`${pagesDir}/**/*.{tsx,jsx}`] };
else if (exists("src/routes")) screens = { kind: "globs", include: ["src/routes/**/*.{tsx,jsx}"] };
if (screens.kind === "none") notes.push("No screens were found. Tell ud-init where the screens (routes, pages) live, or Reach will be 0 everywhere.");

// Token files: CSS files that declare custom properties, biggest first.
const cssFiles = walk(root, sourceDirs.length ? sourceDirs : ["."], []).filter((file) => file.endsWith(".css"));
const tokenFiles = cssFiles
  .map((file) => {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return { file, declarations: (text.match(/^\s*--[\w-]+\s*:/gm) ?? []).length, theme: /@theme\b/.test(text) };
  })
  .filter((entry) => entry.declarations >= 5 || entry.theme)
  .sort((a, b) => b.declarations - a.declarations);
if (exists("tailwind.config.ts") || exists("tailwind.config.js")) notes.push("A tailwind.config file exists. Tokens defined there (theme.extend) are not read by the scan; only CSS custom properties are.");

// Zones: a first guess from the top-level folders, for the owner to rename.
const zones = [];
if (screens.kind === "next-app") {
  const groups = fs.readdirSync(path.join(root, screens.dir), { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\(.*\)$/.test(entry.name));
  for (const group of groups) zones.push({ name: group.name.slice(1, -1), include: [`${screens.dir}/${group.name}/**`] });
}
for (const dir of sourceDirs) zones.push({ name: dir, include: [`${dir}/**`] });

const readOnlyHints = ["slices", "generated", "vendor", "__generated__"].filter((dir) => exists(dir)).map((dir) => `${dir}/**`);

// Which reference system looks closest.
let referenceSystem = null;
if (exists("components.json") || has("@radix-ui/react-slot") || has("radix-ui")) referenceSystem = "shadcn-radix";
else if (has("@mui/material")) referenceSystem = "material-3";
else if (has("@carbon/react")) referenceSystem = "carbon";
else if (has("@shopify/polaris")) referenceSystem = "polaris";
else if (has("@atlaskit/tokens")) referenceSystem = "atlassian";
else if (has("@primer/react")) referenceSystem = "primer";

const proposal = {
  version: 1,
  project: { name: pkg.name ?? path.basename(root) },
  stack: { framework, styling, storybook: { configDir, storyGlobs, version: storybookVersion } },
  sourceDirs,
  exclude: [],
  tokenFiles: tokenFiles.map((entry) => entry.file),
  screens,
  zones,
  readOnly: [],
  referenceSystem,
  reportLanguage: "en",
  workingRules: "",
};

process.stdout.write(`${JSON.stringify({
  proposal,
  detected: {
    typescript: has("typescript"),
    tokenFiles,
    readOnlyHints,
    gitRoot: git(["rev-parse", "--show-toplevel"], root) || null,
    udExcluded: (() => {
      const exclude = path.join(git(["rev-parse", "--git-dir"], root) || ".git", "info", "exclude");
      const file = path.isAbsolute(exclude) ? exclude : path.join(root, exclude);
      return fs.existsSync(file) && /^\.ud\/?$/m.test(fs.readFileSync(file, "utf8"));
    })(),
    existingSettings: exists(".ud/settings.json"),
  },
  notes,
}, null, 1)}\n`);
