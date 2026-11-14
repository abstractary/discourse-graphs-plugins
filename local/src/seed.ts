// Writes the worked example into a vault folder, as one device's record log.
//   node local/src/seed.ts [folder]
// The folder defaults to examples/worked-example/vault, which git ignores. Open
// it in the local app, or in Obsidian with the Discourse Graphs plugin.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DgRecord } from "@dg/contract/records.ts";

const folder = resolve(process.argv[2] ?? "examples/worked-example/vault");
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const root = join(folder, "discourse-graph");
mkdirSync(join(root, "records"), { recursive: true });
if (!existsSync(join(root, "space.json"))) writeFileSync(join(root, "space.json"), JSON.stringify({ id: "matsulab" }));
writeFileSync(join(root, "records", "worked-example.jsonl"), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
console.log(`Wrote ${records.length} records to ${join(root, "records", "worked-example.jsonl")}`);
