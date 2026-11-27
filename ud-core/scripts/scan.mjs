#!/usr/bin/env node
// ud-scan: reads the whole project once and writes the graph and the raw facts
// every other UD skill works from. Syntax only (no type checker), so it is fast
// and gives the same result on every pass.
//
//   node scan.mjs            run from the project root
//
// Writes .ud/runs/<id>/{run.json,graph.json,facts/*.json}
import fs from "node:fs";
import path from "node:path";
import {
  UD_DIR, projectRoot, loadSettings, loadTypeScript, git, walk, matchesAny, zoneOf, isReadOnly,
  writeJson, runsDir, splitClass, tokenizeClasses, dirtyState,
} from "./lib.mjs";

const SCANNER_VERSION = 1;
const root = projectRoot();
const settings = loadSettings(root);
const ts = loadTypeScript(root);
const SK = ts.SyntaxKind;

const CODE_EXT = /\.(tsx?|jsx?|mjs)$/;
const STORY_RE = /\.stories\.(tsx?|jsx?|mjs)$/;
const TEST_RE = /(\.(test|spec)\.[a-z]+$)|(^|\/)__tests__\//;
const CLASS_FNS = new Set(["cn", "clsx", "cx", "classNames", "classnames", "twMerge", "twJoin", "cva", "tv"]);
const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const COLOR_FN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)/g;

const allFiles = walk(root, settings.sourceDirs, settings.exclude);
const codeFiles = allFiles.filter((file) => CODE_EXT.test(file) && !TEST_RE.test(file) && !file.endsWith(".d.ts"));
const cssFiles = [...new Set([...allFiles.filter((file) => file.endsWith(".css")), ...(settings.tokenFiles ?? [])])]
  .filter((file) => fs.existsSync(path.join(root, file)));
const fileSet = new Set(allFiles);

// ---- Import resolution ------------------------------------------------------

const tsconfig = (() => {
  const file = path.join(root, "tsconfig.json");
  if (!fs.existsSync(file)) return {};
  return ts.readConfigFile(file, ts.sys.readFile).config?.compilerOptions ?? {};
})();
const baseUrl = tsconfig.baseUrl ?? ".";
const aliasRules = Object.entries(tsconfig.paths ?? {})
  .map(([pattern, targets]) => ({ pattern, targets }))
  .sort((a, b) => b.pattern.length - a.pattern.length);

const RESOLVE_SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const existsCache = new Map();
function isFile(rel) {
  if (fileSet.has(rel)) return true;
  if (existsCache.has(rel)) return existsCache.get(rel);
  let ok = false;
  try {
    ok = fs.statSync(path.join(root, rel)).isFile();
  } catch {
    ok = false;
  }
  existsCache.set(rel, ok);
  return ok;
}
function tryFile(rel) {
  const clean = path.posix.normalize(rel);
  if (clean.startsWith("..")) return null;
  for (const suffix of RESOLVE_SUFFIXES) {
    if (isFile(clean + suffix)) return clean + suffix;
  }
  return null;
}
function resolveImport(spec, fromFile) {
  if (spec.startsWith(".")) return tryFile(path.posix.join(path.posix.dirname(fromFile), spec));
  for (const { pattern, targets } of aliasRules) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (spec !== pattern) continue;
      for (const target of targets) {
        const hit = tryFile(path.posix.join(baseUrl, target));
        if (hit) return hit;
      }
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
      const middle = spec.slice(prefix.length, spec.length - suffix.length);
      for (const target of targets) {
        const hit = tryFile(path.posix.join(baseUrl, target.replace("*", middle)));
        if (hit) return hit;
      }
    }
  }
  return null; // an external package
}

// ---- Small AST helpers ------------------------------------------------------

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const hasModifier = (node, kind) => (node.modifiers ?? []).some((modifier) => modifier.kind === kind);
const isComponentName = (name) => /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name);

function containsJsx(node) {
  let found = false;
  const visit = (child) => {
    if (found) return;
    if (child.kind === SK.JsxElement || child.kind === SK.JsxSelfClosingElement || child.kind === SK.JsxFragment) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function literalOf(node) {
  if (!node) return true;
  if (node.kind === SK.JsxExpression) return node.expression ? literalOf(node.expression) : true;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === SK.TrueKeyword) return true;
  if (node.kind === SK.FalseKeyword) return false;
  if (node.kind === SK.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return Number(node.getText());
  return undefined; // dynamic
}

function stringsIn(node, out = []) {
  const visit = (child) => {
    if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) out.push(child);
    else if (child.kind === SK.TemplateHead || child.kind === SK.TemplateMiddle || child.kind === SK.TemplateTail) out.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return out;
}

function unwrapFunction(node) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { fn: node, typeArgs: null };
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) {
      const inner = unwrapFunction(arg);
      if (inner) return { fn: inner.fn, typeArgs: inner.typeArgs ?? node.typeArguments ?? null };
    }
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression?.(node)) return unwrapFunction(node.expression);
  return null;
}

// ---- Per-file scan ----------------------------------------------------------

const modules = new Map(); // file -> scanned module
const rawValues = []; // { file, line, value, kind, context }
const inlineStyles = []; // { file, line, props }
const elements = []; // { file, line, tag, classes }
const classesByFile = {}; // file -> { token: count }
const arbitraryUses = []; // { file, line, token }

function scanCode(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const mod = {
    file,
    loc: sf.getLineStarts().length,
    imports: [], // { spec, resolved, names: [{ local, imported }], typeOnly }
    reExports: [], // { spec, resolved, names: [{ local, exported }] | "*" }
    bindings: new Map(), // local name -> { file, imported }
    exports: new Map(), // exported name -> local name
    locals: new Map(), // top-level name -> declaration node
    components: [], // { name, exportName, line, props, extends, variantsOf }
    cva: {}, // variable name -> { variantName: [values] }
    usages: [], // { name, line, props, spread, owner }
    varUses: {}, // "--token" -> count (var(--x) in classes, strings and styles)
    story: null,
    isStory: STORY_RE.test(file),
  };
  const classNodesSeen = new Set();
  const fileClasses = (classesByFile[file] = {});

  const addClasses = (literal) => {
    if (classNodesSeen.has(literal.pos)) return [];
    classNodesSeen.add(literal.pos);
    const tokens = tokenizeClasses(literal.text ?? "");
    const line = lineOf(sf, literal);
    for (const token of tokens) {
      fileClasses[token] = (fileClasses[token] ?? 0) + 1;
      if (/[[(]/.test(token)) arbitraryUses.push({ file, line, token });
    }
    return tokens;
  };

  // Top-level declarations, imports and exports.
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const spec = statement.moduleSpecifier.text;
      const resolved = resolveImport(spec, file);
      const names = [];
      const clause = statement.importClause;
      if (clause?.name) names.push({ local: clause.name.text, imported: "default" });
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) names.push({ local: clause.namedBindings.name.text, imported: "*" });
        else for (const element of clause.namedBindings.elements) names.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text });
      }
      mod.imports.push({ spec, resolved, names, typeOnly: Boolean(clause?.isTypeOnly) });
      if (resolved) for (const name of names) mod.bindings.set(name.local, { file: resolved, imported: name.imported });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const spec = statement.moduleSpecifier.text;
        const resolved = resolveImport(spec, file);
        const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => ({ local: (element.propertyName ?? element.name).text, exported: element.name.text }))
          : "*";
        mod.reExports.push({ spec, resolved, names });
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) mod.exports.set(element.name.text, (element.propertyName ?? element.name).text);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      mod.locals.set(statement.name.text, statement);
      if (hasModifier(statement, SK.ExportKeyword)) mod.exports.set(hasModifier(statement, SK.DefaultKeyword) ? "default" : statement.name.text, statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        mod.locals.set(declaration.name.text, declaration);
        if (hasModifier(statement, SK.ExportKeyword)) mod.exports.set(declaration.name.text, declaration.name.text);
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      mod.locals.set(`type:${statement.name.text}`, statement);
    } else if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) mod.exports.set("default", statement.expression.text);
      else mod.locals.set("default", statement), mod.exports.set("default", "default");
    }
  }

  // Types: a prop's literal values, and the members of a props type.
  const literalValues = (typeNode, depth = 0) => {
    if (!typeNode || depth > 3) return null;
    if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) return [typeNode.literal.text];
    if (ts.isUnionTypeNode(typeNode)) {
      const values = [];
      for (const part of typeNode.types) {
        const inner = literalValues(part, depth + 1);
        if (inner) values.push(...inner);
        else if (part.kind !== SK.UndefinedKeyword && part.kind !== SK.NullKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === SK.NullKeyword)) return null;
      }
      return values.length ? values : null;
    }
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      const target = mod.locals.get(`type:${typeNode.typeName.text}`);
      if (target && ts.isTypeAliasDeclaration(target)) return literalValues(target.type, depth + 1);
    }
    return null;
  };
  const membersOf = (typeNode, acc, depth = 0) => {
    if (!typeNode || depth > 4) return;
    if (ts.isTypeLiteralNode(typeNode) || ts.isInterfaceDeclaration(typeNode)) {
      if (ts.isInterfaceDeclaration(typeNode)) {
        for (const clause of typeNode.heritageClauses ?? []) for (const type of clause.types) membersOf(type, acc, depth + 1);
      }
      for (const member of typeNode.members) {
        if (!ts.isPropertySignature(member) || !member.name) continue;
        const name = member.name.getText(sf).replace(/^["']|["']$/g, "");
        const typeText = member.type ? member.type.getText(sf).replace(/\s+/g, " ").slice(0, 80) : "unknown";
        acc.props.push({ name, optional: Boolean(member.questionToken), type: typeText, values: literalValues(member.type) });
      }
      return;
    }
    if (ts.isIntersectionTypeNode(typeNode)) {
      for (const part of typeNode.types) membersOf(part, acc, depth + 1);
      return;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) return membersOf(typeNode.type, acc, depth + 1);
    const nameNode = typeNode.typeName ?? typeNode.expression;
    const name = nameNode ? nameNode.getText(sf) : null;
    if (name && mod.locals.has(`type:${name}`)) {
      const target = mod.locals.get(`type:${name}`);
      return membersOf(ts.isTypeAliasDeclaration(target) ? target.type : target, acc, depth + 1);
    }
    const textOf = typeNode.getText(sf).replace(/\s+/g, " ");
    const variantProps = /VariantProps<\s*typeof\s+(\w+)\s*>/.exec(textOf);
    if (variantProps) acc.variantsOf.push(variantProps[1]);
    else acc.extends.push(textOf.slice(0, 80));
  };

  // cva(...) variant maps.
  for (const [name, declaration] of mod.locals) {
    if (!ts.isVariableDeclaration?.(declaration) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
    const call = declaration.initializer;
    if (!ts.isIdentifier(call.expression) || !["cva", "tv"].includes(call.expression.text)) continue;
    const config = call.arguments.find((arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => p.name?.getText(sf) === "variants"));
    if (!config) continue;
    const variantsProp = config.properties.find((p) => p.name?.getText(sf) === "variants");
    if (!variantsProp || !ts.isPropertyAssignment(variantsProp) || !ts.isObjectLiteralExpression(variantsProp.initializer)) continue;
    const map = {};
    for (const variant of variantsProp.initializer.properties) {
      if (!ts.isPropertyAssignment(variant) || !ts.isObjectLiteralExpression(variant.initializer)) continue;
      map[variant.name.getText(sf).replace(/^["']|["']$/g, "")] = variant.initializer.properties.map((p) => p.name?.getText(sf).replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    mod.cva[name] = map;
  }

  // Lazy components: const X = dynamic(() => import("./x").then((m) => m.Y))
  for (const [name, declaration] of mod.locals) {
    if (!ts.isVariableDeclaration?.(declaration) || !declaration.initializer) continue;
    const source = declaration.initializer.getText(sf);
    const lazy = /import\(\s*["']([^"']+)["']\s*\)(?:\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*(?:\(\s*\{\s*default:\s*)?\2\.(\w+))?/.exec(source);
    if (!lazy) continue;
    const resolved = resolveImport(lazy[1], file);
    if (!resolved) continue;
    mod.imports.push({ spec: lazy[1], resolved, names: [{ local: name, imported: lazy[3] ?? "default" }], typeOnly: false, lazy: true });
    mod.bindings.set(name, { file: resolved, imported: lazy[3] ?? "default" });
  }

  // Components: exported, capitalised, and rendering JSX.
  const exportedLocals = new Map();
  for (const [exported, local] of mod.exports) if (!exportedLocals.has(local)) exportedLocals.set(local, exported);
  if (/\.(tsx|jsx)$/.test(file)) {
    for (const [local, exported] of exportedLocals) {
      const declaration = mod.locals.get(local);
      if (!declaration) continue;
      const displayName = local === "default" ? path.basename(file).replace(/\..*$/, "") : local;
      if (local !== "default" && !isComponentName(local)) continue;
      const body = ts.isFunctionDeclaration(declaration) ? declaration : declaration.initializer ?? declaration.expression;
      if (!body) continue;
      const unwrapped = unwrapFunction(body);
      const wrapperCall = ts.isCallExpression(body) && /(^|\.)(forwardRef|memo|dynamic|lazy|styled)\b/.test(body.expression.getText(sf));
      if (!(unwrapped && containsJsx(unwrapped.fn)) && !wrapperCall) continue;
      const acc = { props: [], extends: [], variantsOf: [] };
      if (unwrapped) {
        const propsType = unwrapped.typeArgs?.[1] ?? unwrapped.typeArgs?.[0] ?? unwrapped.fn.parameters?.[0]?.type;
        const useType = unwrapped.typeArgs?.length === 1 ? unwrapped.typeArgs[0] : propsType;
        membersOf(unwrapped.fn.parameters?.[0]?.type ?? useType, acc);
      }
      for (const cvaName of acc.variantsOf) {
        for (const [variant, values] of Object.entries(mod.cva[cvaName] ?? {})) {
          if (!acc.props.some((prop) => prop.name === variant)) acc.props.push({ name: variant, optional: true, type: "variant", values });
        }
      }
      mod.components.push({ name: displayName, exportName: exported, local, line: lineOf(sf, declaration), props: acc.props, extends: acc.extends, variantsOf: acc.variantsOf });
    }
  }
  const componentLocals = new Set(mod.components.map((component) => component.local));

  // Walk everything: JSX usages, classes, raw values, inline styles.
  const ownerStack = [];
  const noteRaw = (literal, context) => {
    const value = literal.text ?? "";
    if (!value || value.length > 2000) return;
    const line = lineOf(sf, literal);
    for (const match of value.matchAll(HEX_RE)) rawValues.push({ file, line, value: match[0].toLowerCase(), kind: "hex", context });
    for (const match of value.matchAll(COLOR_FN_RE)) rawValues.push({ file, line, value: match[0].replace(/\s+/g, " "), kind: "color-fn", context });
    for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) mod.varUses[match[1]] = (mod.varUses[match[1]] ?? 0) + 1;
    for (const match of value.matchAll(/-\((--[\w-]+)\)/g)) mod.varUses[match[1]] = (mod.varUses[match[1]] ?? 0) + 1;
  };

  const visit = (node) => {
    const topLevel = node.parent === sf;
    if (topLevel) {
      let name = null;
      if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
      else if (ts.isVariableStatement(node)) name = node.declarationList.declarations[0]?.name?.getText(sf) ?? null;
      ownerStack.length = 0;
      ownerStack.push(name && componentLocals.has(name) ? name : null);
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      const rootName = tag.split(".")[0];
      const staticClasses = [];
      let dynamicClass = false;
      const props = {};
      let spread = false;
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attribute)) {
          spread = true;
          continue;
        }
        const attrName = attribute.name.getText(sf);
        const value = literalOf(attribute.initializer);
        props[attrName] = value === undefined ? "{…}" : value;
        if (/^(class|className)$/.test(attrName) || /ClassName$/.test(attrName)) {
          const init = attribute.initializer;
          if (init && ts.isStringLiteral(init)) {
            const tokens = addClasses(init);
            noteRaw(init, "class");
            if (/^(class|className)$/.test(attrName)) staticClasses.push(...tokens);
          } else if (init && ts.isJsxExpression(init) && init.expression) {
            for (const literal of stringsIn(init.expression)) {
              const tokens = addClasses(literal);
              noteRaw(literal, "class");
              if (/^(class|className)$/.test(attrName)) staticClasses.push(...tokens);
            }
            if (!ts.isStringLiteral(init.expression) && !ts.isNoSubstitutionTemplateLiteral(init.expression)) dynamicClass = true;
          }
        } else if (attrName === "style" && attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression && ts.isObjectLiteralExpression(attribute.initializer.expression)) {
          const styleProps = {};
          for (const property of attribute.initializer.expression.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const literal = literalOf(property.initializer);
            styleProps[property.name.getText(sf).replace(/^["']|["']$/g, "")] = literal === undefined ? "{…}" : literal;
          }
          inlineStyles.push({ file, line: lineOf(sf, node), props: styleProps });
        }
      }
      if (staticClasses.length >= 3) elements.push({ file, line: lineOf(sf, node), tag, classes: staticClasses, dynamic: dynamicClass });
      if (/^[A-Z]/.test(rootName)) {
        delete props.className;
        delete props.key;
        delete props.ref;
        mod.usages.push({ name: rootName, member: tag.includes(".") ? tag : null, line: lineOf(sf, node), props, spread, owner: ownerStack[0] ?? null });
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CLASS_FNS.has(node.expression.text)) {
      for (const argument of node.arguments) for (const literal of stringsIn(argument)) {
        addClasses(literal);
        noteRaw(literal, "class");
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || node.kind === SK.TemplateHead || node.kind === SK.TemplateMiddle || node.kind === SK.TemplateTail) {
      if (!classNodesSeen.has(node.pos) && !(node.parent && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)))) noteRaw(node, "string");
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  // Stories.
  if (mod.isStory) {
    const objectOf = (node) => {
      let current = node;
      while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression?.(current) || ts.isParenthesizedExpression(current))) current = current.expression;
      return current && ts.isObjectLiteralExpression(current) ? current : null;
    };
    const propOf = (object, name) => object?.properties.find((p) => p.name?.getText(sf) === name);
    const argsOf = (object) => {
      const argsProp = propOf(object, "args");
      const argsObject = argsProp && ts.isPropertyAssignment(argsProp) ? objectOf(argsProp.initializer) : null;
      if (!argsObject) return {};
      const args = {};
      for (const property of argsObject.properties) {
        if (ts.isSpreadAssignment(property)) {
          args["…"] = property.expression.getText(sf).slice(0, 60);
          continue;
        }
        const literal = ts.isPropertyAssignment(property) ? literalOf(property.initializer) : undefined;
        args[property.name.getText(sf).replace(/^["']|["']$/g, "")] = literal === undefined ? "{…}" : literal;
      }
      return args;
    };
    const tagsOf = (object) => {
      const tagsProp = propOf(object, "tags");
      return tagsProp && ts.isPropertyAssignment(tagsProp) && ts.isArrayLiteralExpression(tagsProp.initializer)
        ? tagsProp.initializer.elements.map((element) => literalOf(element)).filter((tag) => typeof tag === "string")
        : [];
    };
    const defaultLocal = mod.exports.get("default");
    const metaNode = defaultLocal ? mod.locals.get(defaultLocal) : null;
    const meta = metaNode ? objectOf(metaNode.initializer ?? metaNode.expression) : null;
    const titleProp = propOf(meta, "title");
    const componentProp = propOf(meta, "component");
    const componentName = componentProp && ts.isPropertyAssignment(componentProp) ? componentProp.initializer.getText(sf) : componentProp?.name?.getText(sf) ?? null;
    const stories = [];
    for (const [exported, local] of mod.exports) {
      if (exported === "default") continue;
      const declaration = mod.locals.get(local);
      if (!declaration || !ts.isVariableDeclaration?.(declaration)) continue;
      const object = objectOf(declaration.initializer);
      stories.push({
        name: exported,
        line: lineOf(sf, declaration),
        args: argsOf(object),
        tags: tagsOf(object),
        hasPlay: Boolean(propOf(object, "play")),
        hasRender: Boolean(propOf(object, "render")) || (declaration.initializer && !object ? true : false),
      });
    }
    mod.story = {
      title: titleProp && ts.isPropertyAssignment(titleProp) ? literalOf(titleProp.initializer) ?? null : null,
      componentName,
      metaArgs: argsOf(meta),
      tags: tagsOf(meta),
      stories,
    };
  }

  modules.set(file, mod);
}

for (const file of codeFiles) {
  try {
    scanCode(file);
  } catch (error) {
    process.stderr.write(`ud-scan: skipped ${file}: ${error.message}\n`);
  }
}

// ---- Screens ----------------------------------------------------------------

const screenSettings = settings.screens ?? { kind: "none" };
const SCREEN_SUPPORT = /\/(layout|template|loading|error|not-found|default)\.(tsx|jsx)$/;
function routeOf(file) {
  const rel = path.posix.dirname(file).slice(screenSettings.dir.length).replace(/^\//, "");
  const segments = rel.split("/").filter((segment) => segment && !/^\(.*\)$/.test(segment) && !segment.startsWith("@") && !segment.startsWith("_"));
  return `/${segments.join("/")}`;
}
const screens = []; // { file, route, kind }
if (screenSettings.kind === "next-app") {
  for (const file of codeFiles) {
    if (!file.startsWith(`${screenSettings.dir}/`)) continue;
    if (/\/page\.(tsx|jsx)$/.test(file)) screens.push({ file, route: routeOf(file), kind: "page" });
    else if (SCREEN_SUPPORT.test(file)) screens.push({ file, route: routeOf(file), kind: path.basename(file).replace(/\..*$/, "") });
  }
} else if (screenSettings.kind === "globs") {
  for (const file of codeFiles) if (matchesAny(file, screenSettings.include)) screens.push({ file, route: file, kind: "page" });
}
const screenFiles = new Set(screens.map((screen) => screen.file));

// ---- Resolve bindings to components ----------------------------------------

function resolveExport(file, name, depth = 0) {
  const mod = modules.get(file);
  if (!mod || depth > 8) return null;
  if (name !== "*" && mod.exports.has(name)) {
    const local = mod.exports.get(name);
    const component = mod.components.find((candidate) => candidate.local === local);
    if (component) return { file, component };
    const binding = mod.bindings.get(local);
    if (binding) return resolveExport(binding.file, binding.imported, depth + 1);
    return { file, component: null };
  }
  for (const reExport of mod.reExports) {
    if (!reExport.resolved) continue;
    if (reExport.names === "*") {
      const hit = resolveExport(reExport.resolved, name, depth + 1);
      if (hit?.component) return hit;
    } else {
      const entry = reExport.names.find((candidate) => candidate.exported === name);
      if (entry) return resolveExport(reExport.resolved, entry.local, depth + 1);
    }
  }
  return null;
}

const componentId = (file, name) => `c:${file}#${name}`;
const ownerId = (mod, owner) => {
  if (screenFiles.has(mod.file)) return `s:${mod.file}`;
  if (mod.isStory) return `y:${mod.file}`;
  if (owner) {
    const component = mod.components.find((candidate) => candidate.local === owner);
    if (component) return componentId(mod.file, component.name);
  }
  if (mod.components.length === 1) return componentId(mod.file, mod.components[0].name);
  return `m:${mod.file}`;
};

const nodes = [];
const edges = [];
const componentNodes = new Map();

for (const mod of modules.values()) {
  if (screenFiles.has(mod.file) || mod.isStory) continue;
  for (const component of mod.components) {
    const node = {
      id: componentId(mod.file, component.name),
      kind: "component",
      name: component.name,
      file: mod.file,
      line: component.line,
      zone: zoneOf(mod.file, settings),
      readOnly: isReadOnly(mod.file, settings),
      data: {
        exportName: component.exportName,
        loc: mod.loc,
        props: component.props,
        extends: component.extends,
        variants: Object.fromEntries(component.variantsOf.map((name) => [name, mod.cva[name] ?? {}])),
        uses: { callSites: 0, files: [], storyCallSites: 0, spreads: 0, props: {} },
        screens: 0,
        stories: [],
      },
    };
    nodes.push(node);
    componentNodes.set(node.id, node);
  }
}

const fileEdges = new Map(); // file -> Set(file), for reach
const addFileEdge = (from, to) => {
  if (!to || from === to) return;
  if (!fileEdges.has(from)) fileEdges.set(from, new Set());
  fileEdges.get(from).add(to);
};
const renderEdges = new Map(); // "from>to" -> edge
const moduleNodes = new Set();

for (const mod of modules.values()) {
  for (const entry of mod.imports) {
    if (!entry.resolved || entry.typeOnly) continue;
    addFileEdge(mod.file, entry.resolved);
    for (const name of entry.names) {
      const hit = name.imported === "*" ? null : resolveExport(entry.resolved, name.imported);
      if (hit) addFileEdge(mod.file, hit.file);
    }
  }
  for (const reExport of mod.reExports) if (reExport.resolved) addFileEdge(mod.file, reExport.resolved);

  for (const usage of mod.usages) {
    let target = null;
    const binding = mod.bindings.get(usage.name);
    if (binding) {
      if (binding.imported === "*" && usage.member) target = resolveExport(binding.file, usage.member.split(".")[1]);
      else target = resolveExport(binding.file, binding.imported);
    } else {
      const local = mod.components.find((candidate) => candidate.local === usage.name);
      if (local) target = { file: mod.file, component: local };
    }
    if (!target?.component) continue;
    const targetId = componentId(target.file, target.component.name);
    const targetNode = componentNodes.get(targetId);
    if (!targetNode) continue;
    const from = ownerId(mod, usage.owner);
    if (from === targetId) continue;
    if (from.startsWith("m:")) moduleNodes.add(mod.file);
    const key = `${from}>${targetId}`;
    if (!renderEdges.has(key)) renderEdges.set(key, { from, to: targetId, kind: "renders", count: 0 });
    renderEdges.get(key).count += 1;

    const uses = targetNode.data.uses;
    if (mod.isStory) uses.storyCallSites += 1;
    else {
      uses.callSites += 1;
      if (!uses.files.includes(mod.file)) uses.files.push(mod.file);
      if (usage.spread) uses.spreads += 1;
      for (const [prop, value] of Object.entries(usage.props)) {
        const slot = (uses.props[prop] ??= { count: 0, dynamic: 0, values: {} });
        slot.count += 1;
        if (value === "{…}") slot.dynamic += 1;
        else if (String(value).length <= 40) slot.values[String(value)] = (slot.values[String(value)] ?? 0) + 1;
      }
    }
  }
}
edges.push(...renderEdges.values());
for (const file of moduleNodes) nodes.push({ id: `m:${file}`, kind: "module", name: path.basename(file), file, zone: zoneOf(file, settings), readOnly: isReadOnly(file, settings), data: {} });

// Screens and their reach.
function closure(startFiles) {
  const seen = new Set(startFiles);
  const queue = [...startFiles];
  while (queue.length) {
    const file = queue.pop();
    for (const next of fileEdges.get(file) ?? []) if (!seen.has(next)) seen.add(next), queue.push(next);
  }
  return seen;
}
const supportByDir = new Map();
for (const screen of screens) if (screen.kind !== "page") {
  const dir = path.posix.dirname(screen.file);
  if (!supportByDir.has(dir)) supportByDir.set(dir, []);
  supportByDir.get(dir).push(screen.file);
}
const reachByFile = new Map(); // file -> Set(route)
for (const screen of screens) {
  if (screen.kind === "page") {
    const roots = [screen.file];
    let dir = path.posix.dirname(screen.file);
    while (dir && dir !== "." && dir.length >= (screenSettings.dir ?? "").length) {
      roots.push(...(supportByDir.get(dir) ?? []));
      dir = path.posix.dirname(dir);
    }
    const reached = closure(roots);
    for (const file of reached) {
      if (!reachByFile.has(file)) reachByFile.set(file, new Set());
      reachByFile.get(file).add(screen.route);
    }
    screen.files = reached.size;
  }
  nodes.push({
    id: `s:${screen.file}`, kind: "screen", name: screen.kind === "page" ? screen.route : `${screen.route} (${screen.kind})`,
    file: screen.file, zone: zoneOf(screen.file, settings), readOnly: isReadOnly(screen.file, settings),
    data: { route: screen.route, screenKind: screen.kind, files: screen.files ?? null },
  });
}
for (const node of componentNodes.values()) {
  const routes = reachByFile.get(node.file);
  node.data.screens = routes ? routes.size : 0;
  node.data.screenSample = routes ? [...routes].sort().slice(0, 8) : [];
}

// Stories.
for (const mod of modules.values()) {
  if (!mod.story) continue;
  let documented = null;
  const name = mod.story.componentName;
  if (name) {
    const rootName = name.split(".")[0];
    const binding = mod.bindings.get(rootName);
    const hit = binding ? resolveExport(binding.file, binding.imported === "*" ? name.split(".")[1] : binding.imported) : null;
    if (hit?.component) documented = componentId(hit.file, hit.component.name);
  }
  const id = `y:${mod.file}`;
  nodes.push({
    id, kind: "story", name: mod.story.title ?? path.basename(mod.file), file: mod.file,
    zone: zoneOf(mod.file, settings), readOnly: isReadOnly(mod.file, settings),
    data: { title: mod.story.title, componentName: name, component: documented, metaArgs: mod.story.metaArgs, tags: mod.story.tags, stories: mod.story.stories },
  });
  if (documented) {
    edges.push({ from: id, to: documented, kind: "documents" });
    componentNodes.get(documented)?.data.stories.push(id);
  }
}
// A story that renders a component without naming it in `component:` still shows it.
for (const edge of renderEdges.values()) {
  if (!edge.from.startsWith("y:")) continue;
  const node = componentNodes.get(edge.to);
  if (node) (node.data.shownIn ??= []).push(edge.from);
}

// ---- Tokens (CSS custom properties) ----------------------------------------

const tokens = new Map(); // name -> token
const cssRaw = [];
const cssVarUses = {}; // name -> count
function scanCss(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const stack = [];
  let buffer = "";
  let line = 1;
  let bufferLine = 1;
  const flushDeclaration = () => {
    const text = buffer.trim();
    const match = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(text);
    const scope = stack.filter(Boolean).join(" ") || "(root)";
    if (match) {
      const name = match[1];
      const value = match[2].replace(/\s+/g, " ").trim();
      if (!tokens.has(name)) tokens.set(name, { name, declarations: [] });
      tokens.get(name).declarations.push({ file, line: bufferLine, scope, value });
    }
    const valuePart = match ? match[2] : text;
    for (const use of valuePart.matchAll(/var\(\s*(--[\w-]+)/g)) cssVarUses[use[1]] = (cssVarUses[use[1]] ?? 0) + 1;
    if (!match) for (const hex of text.matchAll(HEX_RE)) cssRaw.push({ file, line: bufferLine, value: hex[0].toLowerCase(), kind: "hex", context: "css" });
  };
  for (const char of source) {
    if (char === "\n") line += 1;
    if (char === "{") {
      stack.push(buffer.trim().replace(/\s+/g, " ").slice(0, 80));
      buffer = "";
    } else if (char === "}") {
      if (buffer.trim()) flushDeclaration();
      stack.pop();
      buffer = "";
    } else if (char === ";") {
      flushDeclaration();
      buffer = "";
    } else {
      if (!buffer.trim()) bufferLine = line;
      buffer += char;
    }
  }
}
for (const file of cssFiles) {
  try {
    scanCss(file);
  } catch (error) {
    process.stderr.write(`ud-scan: skipped ${file}: ${error.message}\n`);
  }
}

const THEME_NAMESPACES = ["color", "radius", "shadow", "inset-shadow", "drop-shadow", "font-weight", "font", "text", "spacing", "ease", "animate", "breakpoint", "container", "leading", "tracking", "blur", "aspect"];
function categoryOf(name, value) {
  for (const namespace of THEME_NAMESPACES) if (name.startsWith(`--${namespace}-`)) return namespace;
  if (/^(#|rgb|hsl|oklch|oklab|color-mix)/.test(value) || /^var\(--color-/.test(value)) return "color";
  if (/gradient\(/.test(value)) return "gradient";
  if (/^-?[\d.]+(px|rem|em|%|vh|vw|dvh|svh)$/.test(value) || /^calc\(/.test(value)) return "length";
  if (/^[\d.]+m?s$/.test(value) || /cubic-bezier/.test(value)) return "motion";
  return "other";
}

// How Tailwind utilities refer to theme tokens: "bg-brand/50" uses --color-brand.
const themeNames = new Map(); // namespace -> Map(short name -> token name)
for (const token of tokens.values()) {
  const inTheme = token.declarations.some((declaration) => declaration.scope.startsWith("@theme"));
  token.theme = inTheme;
  token.category = categoryOf(token.name, token.declarations[0].value);
  if (!inTheme) continue;
  const namespace = THEME_NAMESPACES.find((candidate) => token.name.startsWith(`--${candidate}-`));
  if (!namespace) continue;
  if (!themeNames.has(namespace)) themeNames.set(namespace, new Map());
  themeNames.get(namespace).set(token.name.slice(namespace.length + 3), token.name);
}
const UTILITY_ROOTS = {
  radius: /^rounded(-|$)/, shadow: /^shadow-/, "inset-shadow": /^inset-shadow-/, "drop-shadow": /^drop-shadow-/,
  font: /^font-/, "font-weight": /^font-/, text: /^text-/, ease: /^ease-/, animate: /^animate-/, leading: /^leading-/, tracking: /^tracking-/, blur: /^(backdrop-)?blur-/, aspect: /^aspect-/,
};
function tokenOfUtility(utility) {
  const base = utility.replace(/\/[^/]+$/, "");
  const parts = base.replace(/^-/, "").split("-");
  for (let index = 1; index < parts.length; index += 1) {
    const suffix = parts.slice(index).join("-");
    for (const [namespace, names] of themeNames) {
      if (!names.has(suffix)) continue;
      if (namespace === "color") return names.get(suffix);
      if (namespace === "spacing" || namespace === "breakpoint" || namespace === "container") continue;
      if (UTILITY_ROOTS[namespace]?.test(base)) return names.get(suffix);
    }
  }
  return null;
}

const tokenUse = new Map(); // name -> { utility, var, css, files:Set }
const useOf = (name) => {
  if (!tokenUse.has(name)) tokenUse.set(name, { utility: 0, var: 0, css: 0, files: new Set() });
  return tokenUse.get(name);
};
for (const [file, classes] of Object.entries(classesByFile)) {
  for (const [token, count] of Object.entries(classes)) {
    const name = tokenOfUtility(splitClass(token).utility);
    if (!name) continue;
    const use = useOf(name);
    use.utility += count;
    use.files.add(file);
  }
}
for (const mod of modules.values()) for (const [name, count] of Object.entries(mod.varUses)) {
  const use = useOf(name);
  use.var += count;
  use.files.add(mod.file);
}
for (const [name, count] of Object.entries(cssVarUses)) useOf(name).css += count;

const tokenFacts = [];
for (const token of [...tokens.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const use = tokenUse.get(token.name) ?? { utility: 0, var: 0, css: 0, files: new Set() };
  const fact = {
    name: token.name, category: token.category, theme: token.theme,
    declarations: token.declarations,
    uses: { utility: use.utility, var: use.var, css: use.css, total: use.utility + use.var + use.css },
    files: [...use.files].sort(),
  };
  tokenFacts.push(fact);
  nodes.push({
    id: `t:${token.name}`, kind: "token", name: token.name, file: token.declarations[0].file, line: token.declarations[0].line,
    zone: "tokens", readOnly: false,
    data: { category: token.category, theme: token.theme, value: token.declarations[0].value, scopes: token.declarations.map((d) => d.scope), uses: fact.uses, files: fact.files.slice(0, 200) },
  });
}
const undeclared = [...tokenUse.keys()].filter((name) => !tokens.has(name)).sort().map((name) => {
  const use = tokenUse.get(name);
  return { name, uses: use.var + use.css, files: [...use.files].sort().slice(0, 20) };
});

// ---- Write ------------------------------------------------------------------

const now = new Date();
const pad = (number) => String(number).padStart(2, "0");
const runId = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const runDir = path.join(runsDir(root), runId);
const counts = {
  files: codeFiles.length, cssFiles: cssFiles.length,
  components: componentNodes.size, screens: screens.filter((screen) => screen.kind === "page").length,
  storyFiles: nodes.filter((node) => node.kind === "story").length,
  stories: nodes.filter((node) => node.kind === "story").reduce((sum, node) => sum + node.data.stories.length, 0),
  tokens: tokenFacts.length, edges: edges.length,
};
// The uncommitted files are listed, with a hash each, so that a later run can tell what changed
// even when the work was never committed between the two.
const dirtyNow = dirtyState(root);
writeJson(path.join(runDir, "run.json"), {
  id: runId, scannerVersion: SCANNER_VERSION, startedAt: now.toISOString(),
  commit: git(["rev-parse", "HEAD"], root), branch: git(["rev-parse", "--abbrev-ref", "HEAD"], root),
  ...dirtyNow,
  counts,
});
writeJson(path.join(runDir, "graph.json"), { run: runId, counts, nodes, edges });
writeJson(path.join(runDir, "facts", "classes.json"), { byFile: classesByFile, arbitrary: arbitraryUses });
writeJson(path.join(runDir, "facts", "raw-values.json"), { code: rawValues, css: cssRaw, inlineStyles });
writeJson(path.join(runDir, "facts", "tokens.json"), { tokens: tokenFacts, undeclared });
writeJson(path.join(runDir, "facts", "elements.json"), { elements });
writeJson(path.join(runDir, "facts", "files.json"), {
  files: codeFiles.map((file) => ({ file, zone: zoneOf(file, settings), screens: reachByFile.get(file)?.size ?? 0 })),
  imports: Object.fromEntries([...fileEdges].map(([file, targets]) => [file, [...targets].sort()])),
});

process.stdout.write(`${JSON.stringify({ run: runId, dir: path.relative(root, runDir), counts }, null, 1)}\n`);
