// Fails when a module imports something it isn't allowed to know about.
//   node scripts/check-boundaries.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Each module, and what it may depend on. The server stands alone on purpose. */
const ALLOWED = {
  "packages/contract": [],
  "packages/layout": ["@dg/contract"],
  "packages/core": ["@dg/contract"],
  "packages/sync": ["@dg/contract"],
  "packages/native": ["@dg/contract", "@dg/core"],
  "packages/surfaces": ["@dg/contract", "@dg/layout"],
  "plugins/obsidian": ["@dg/contract", "@dg/core", "@dg/native", "@dg/sync"],
  "plugins/roam": ["@dg/contract", "@dg/core", "@dg/native", "@dg/sync"],
  local: ["@dg/contract", "@dg/core", "@dg/sync"],
  server: [],
};

/** Only the frame's code may use a browser UI library, and only plugins may touch a base's API. */
const FORBIDDEN = {
  "packages/core": ["obsidian", "react", "@xyflow/react"],
  "packages/contract": ["obsidian", "react", "@xyflow/react"],
  "packages/layout": ["obsidian", "react", "@xyflow/react"],
  "packages/sync": ["obsidian", "react", "@xyflow/react"],
  "packages/surfaces": ["obsidian"],
  local: ["obsidian", "react", "@xyflow/react"],
};

/** A plugin reaches the core through its entry file, and types against what the contract names for it. */
const CORE_ENTRY = "@dg/core/index.ts";

/**
 * Imports past the core's entry that stand because the entry doesn't export these names:
 * `browserKeys` from identity.ts and the `ExistingGraph` type from migrate.ts. A line here
 * that no longer matches an import fails the check, so the list can only shrink.
 */
const PAST_THE_ENTRY = new Set([]);
const pastTheEntry = new Set();

const walk = (folder) =>
  readdirSync(folder).flatMap((name) => {
    if (name === "node_modules" || name === "data") return [];
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

const problems = [];
for (const [module, allowed] of Object.entries(ALLOWED)) {
  let files = [];
  try {
    files = walk(join(module, "src"));
  } catch {
    continue;
  }
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const scope = /^@dg\/[a-z-]+/.exec(specifier)?.[0];
      if (scope && !allowed.includes(scope)) problems.push(`${file} imports ${scope}, which ${module} may not use`);
      if ((FORBIDDEN[module] ?? []).some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
        problems.push(`${file} imports ${specifier}, which ${module} may not use`);
      }
      if (module.startsWith("plugins/") && scope === "@dg/core" && specifier !== CORE_ENTRY) {
        const known = `${file.split("\\").join("/")} ${specifier}`;
        if (PAST_THE_ENTRY.has(known)) pastTheEntry.add(known);
        else problems.push(`${file} imports ${specifier}: a plugin may import from @dg/core only ${CORE_ENTRY}`);
      }
      if (specifier.startsWith(".") && /\.\.\/\.\.\/\.\.\//.test(specifier) && !specifier.includes("harness/")) {
        problems.push(`${file} reaches outside its module with ${specifier}`);
      }
    }
  }
}

for (const known of PAST_THE_ENTRY) {
  if (!pastTheEntry.has(known)) problems.push(`${known}: this import is gone, so take its line out of PAST_THE_ENTRY`);
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("Module boundaries hold.");
