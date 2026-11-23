import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { compile } from "@vue/compiler-dom";

// None of these modules is bundled or type-checked anywhere: a syntax error,
// a missing export or a broken template only shows up in the browser.
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
// The entry mounts the app when imported, the service worker needs `self`, and
// importing a test file would register its tests again. Those are parsed and
// their imports checked without running them.
const ENTRY = "public/js/app.js";
const NOT_IMPORTED = [ENTRY, "public/sw.js"];
const runsOnImport = (file) => !NOT_IMPORTED.includes(file) && !file.startsWith("test/");
const SCRIPT_DIRS = ["src", "public", "test"];
const EXTRA_SCRIPTS = ["eslint.config.js"];

function listScripts(relativeDir, out = []) {
  for (const entry of readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })) {
    const relative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) listScripts(relative, out);
    else if (entry.name.endsWith(".js")) out.push(relative);
  }
  return out;
}

const scripts = [...SCRIPT_DIRS.flatMap((dir) => listScripts(dir)), ...EXTRA_SCRIPTS].sort();
const read = (relative) => readFileSync(path.join(ROOT, relative), "utf8");

test("every module parses", async () => {
  const results = await Promise.all(
    scripts.map(async (file) => {
      try {
        await run(process.execPath, ["--check", path.join(ROOT, file)]);
        return null;
      } catch (err) {
        return `${file}\n${err.stderr || err.message}`;
      }
    })
  );
  assert.deepEqual(results.filter(Boolean), []);
  assert.ok(scripts.length > 20, "expected to cover the whole source tree");
});

test("every import resolves to an export of its module", async () => {
  const namespaces = new Map();
  const problems = [];
  for (const file of scripts.filter(runsOnImport)) {
    await import(pathToFileURL(path.join(ROOT, file)).href);
  }
  const load = async (file, specifier) => {
    const target = path.resolve(ROOT, path.dirname(file), specifier);
    if (!namespaces.has(target)) {
      namespaces.set(target, import(pathToFileURL(target).href));
    }
    return namespaces.get(target);
  };

  for (const file of scripts) {
    const source = read(file);
    for (const [, clause, specifier] of source.matchAll(/^import\s+([^;]*?)\s+from\s+["']([^"']+)["'];?/gm)) {
      if (!specifier.startsWith(".")) continue; // bare specifiers are CDN globals, not Node modules
      const namespace = await load(file, specifier);
      const braces = clause.match(/\{([^}]*)\}/);
      const named = (braces ? braces[1] : "")
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/\s+as\s+/)[0]);
      const hasDefaultImport = clause.replace(/\{[^}]*\}/, "").replace(/[*]/g, "").includes(",");
      for (const name of named) {
        if (!Object.hasOwn(namespace, name)) problems.push(`${file}: "${specifier}" has no export named ${name}`);
      }
      if (hasDefaultImport && !Object.hasOwn(namespace, "default")) {
        problems.push(`${file}: "${specifier}" has no default export`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every component template compiles with the page's Vue version", async () => {
  const errors = [];
  const compileTemplate = (label, template) => {
    compile(template, { onError: (err) => errors.push(`${label}: ${err.message}`) });
  };

  for (const file of scripts.filter((name) => name.startsWith("public/js/") && runsOnImport(name))) {
    const component = (await import(pathToFileURL(path.join(ROOT, file)).href)).default;
    if (typeof component?.template === "string") compileTemplate(file, component.template);
  }
  // The root component and the inline 404 view are templates inside the entry.
  const inlineTemplates = [...read(ENTRY).matchAll(/template: `([^`]*)`/g)].map((match) => match[1]);
  inlineTemplates.forEach((template, index) => compileTemplate(`${ENTRY} template #${index + 1}`, template));
  assert.ok(inlineTemplates.length >= 2, "expected the root and the 404 view templates in app.js");

  assert.deepEqual(errors, []);
});

test("the template compiler used by the tests matches the Vue build the page loads", () => {
  const page = read("public/index.html");
  const loaded = page.match(/vue@([\d.]+)\/dist\/vue\.global\.prod\.js/)?.[1];
  const compiler = JSON.parse(
    readFileSync(new URL("../node_modules/@vue/compiler-dom/package.json", import.meta.url), "utf8")
  ).version;

  assert.ok(loaded, "index.html should load vue@<version>/dist/vue.global.prod.js");
  assert.equal(compiler, loaded, "bump @vue/compiler-dom in package.json together with the Vue version in index.html");
});
