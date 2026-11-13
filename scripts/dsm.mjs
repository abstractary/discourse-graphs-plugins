// Prints a design structure matrix from the imports actually in the code, as Markdown.
//   node scripts/dsm.mjs            modules
//   node scripts/dsm.mjs scholarly  the files behind identifiers, lookups, crates, announcements, profiles and Zotero
// A mark in a row means the row depends on the column. Marks above the diagonal are
// dependencies that point back up the order, which is what a cycle looks like. It exits
// with an error when it finds one, so `npm run dsm` is also a check.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const MODULES = ["packages/contract", "packages/layout", "packages/core", "packages/sync", "packages/native", "packages/surfaces", "plugins/obsidian", "plugins/roam", "local", "server"];
const SCOPE = { "@dg/contract": "packages/contract", "@dg/layout": "packages/layout", "@dg/core": "packages/core", "@dg/sync": "packages/sync", "@dg/native": "packages/native", "@dg/surfaces": "packages/surfaces" };

/** Listed in the order they should depend: each on the ones above it only. */
const SCHOLARLY = [
  "packages/contract/src/scholarly.ts",
  "packages/contract/src/records.ts",
  "packages/contract/src/services.ts",
  "packages/contract/src/surface.ts",
  "packages/core/src/process.ts",
  "packages/core/src/jsonld.ts",
  "packages/core/src/card.ts",
  "packages/core/src/library.ts",
  "packages/core/src/profile.ts",
  "packages/core/src/zip.ts",
  "packages/core/src/datacite.ts",
  "packages/core/src/zenodo.ts",
  "packages/core/src/mira.ts",
  "packages/core/src/rocrate.ts",
  "packages/core/src/works.ts",
  "packages/core/src/notify.ts",
  "packages/core/src/crate.ts",
  "packages/sync/src/scholarly.ts",
  "packages/sync/src/zotero.ts",
  "packages/sync/src/zenodo.ts",
  "packages/sync/src/client.ts",
  "packages/surfaces/src/shared/people.tsx",
  "packages/surfaces/src/shared/facts.tsx",
  "packages/surfaces/src/context/Work.tsx",
  "packages/surfaces/src/canvas/nodes.tsx",
  "packages/surfaces/src/canvas/ExportMenu.tsx",
  "packages/surfaces/src/profile/App.tsx",
  "packages/surfaces/src/zotero/App.tsx",
  "server/src/notify.ts",
  "server/src/signposting.ts",
];

const walk = (folder) =>
  !existsSync(folder)
    ? []
    : readdirSync(folder).flatMap((name) => {
        if (name === "node_modules" || name === "data") return [];
        const path = join(folder, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
      });

const importsOf = (file) =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].flatMap(([, specifier]) => {
    const scope = /^@dg\/[a-z-]+/.exec(specifier)?.[0];
    if (scope && SCOPE[scope]) return [join(SCOPE[scope], "src", specifier.slice(scope.length + 1))];
    if (specifier.startsWith(".")) return [normalize(join(dirname(file), specifier))];
    return [];
  });

const matrix = (names, depends) => {
  const short = names.map((name) => name.replace(/^packages\//, "").replace(/\/src\//, "/").replace(/^plugins\//, ""));
  const lines = [`| | ${names.map((_, index) => index + 1).join(" | ")} |`, `|---|${names.map(() => ":-:").join("|")}|`];
  const back = [];
  names.forEach((row, r) => {
    const cells = names.map((column, c) => {
      if (r === c) return "■";
      if (!depends(row, column)) return " ";
      if (c > r) back.push(`${short[r]} depends on ${short[c]}, which is listed after it`);
      return "×";
    });
    lines.push(`| **${r + 1}** ${short[r]} | ${cells.join(" | ")} |`);
  });
  return { text: lines.join("\n"), back };
};

const which = process.argv[2] ?? "modules";
let result;
if (which === "modules") {
  const edges = new Set();
  for (const module of MODULES) {
    for (const file of walk(join(module, "src"))) {
      for (const target of importsOf(file)) {
        const owner = MODULES.find((name) => target.startsWith(`${name}/`));
        if (owner && owner !== module) edges.add(`${module}>${owner}`);
      }
    }
  }
  result = matrix(MODULES, (row, column) => edges.has(`${row}>${column}`));
} else {
  const edges = new Set();
  for (const file of SCHOLARLY) for (const target of importsOf(file)) if (SCHOLARLY.includes(target) && target !== file) edges.add(`${file}>${target}`);
  result = matrix(SCHOLARLY, (row, column) => edges.has(`${row}>${column}`));
}
console.log(result.text);
if (result.back.length) {
  console.error(`\nDependencies that point back up the order:\n${result.back.map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}
