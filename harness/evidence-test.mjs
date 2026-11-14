// Evidence crates in real Obsidian: a MATSUlab bundle read as a folder in the vault, sent back out as
// one MIRA-and-RO-Crate graph with its files, the Zenodo option in the export dialog, and the three
// discipline examples.
//   npm run build:test, node examples/disciplines/build.ts, then: node harness/evidence-test.mjs
// Nothing is sent to Zenodo: the test stops at the dialog, with no token kept.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const BUNDLE = process.env.MATSULAB_BUNDLES ?? "../org-repos/MATSUlab-issue-exchange-analysis/output/evidence_bundles";
const FOLDER = "Evidence bundles/evd1-conversion-rate";

// The bundle sits in the vault the way a person would drop it in, and the examples are one device's records each.
cpSync(`${BUNDLE}/evd1-conversion-rate`, `${VAULT}/${FOLDER}`, { recursive: true });
for (const slug of ["biology", "computer-science", "sociology"]) {
  const records = JSON.parse(readFileSync(`examples/disciplines/${slug}/records.json`, "utf8"));
  writeFileSync(`${VAULT}/discourse-graph/records/example-${slug}.jsonl`, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
}

const t = await session({ out: resolve("reports/evidence"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call } = t;
await s("s.test(true)");

// ---------------------------------------------------------------- A bundle comes in
const read = await call("crate.import", { ref: `${FOLDER}/ro-crate-metadata.json` });
check("bundle.reads-as-units", read.kind === "foreign" && read.units === 18, JSON.stringify(read));
check("bundle.files-are-hashed", read.hashed >= 9, `${read.hashed} files`);
const view = await call("canvas.open", { id: read.canvas });
const bases = Object.values(view.nodes).reduce((count, node) => ({ ...count, [node.base]: (count[node.base] ?? 0) + 1 }), {});
check("bundle.has-evidence-study-protocol", bases.evidence === 1 && bases.run === 1 && bases.protocol === 1 && bases.code === 4, JSON.stringify(bases));

// ---------------------------------------------------------------- The export dialog offers files and Zenodo
await s("s.closeAll()");
await s(`s.open(${q(read.canvas)})`);
await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) >= 10);
await click("canvas", '[data-dg="canvas-menu"]');
await click("canvas", '[data-dg="export"]');
await until(() => has("canvas", '[data-dg="export-menu"]'));
await s(`s.choose('[data-dg="export-target"]', "crate")`);
check("dialog.offers-output-files", await until(() => has("canvas", '[data-dg="crate-outputs"]'), 4000));
const zenodo = await until(() => has("canvas", '[data-dg="crate-zenodo"]'), 4000);
check("dialog.offers-zenodo", zenodo);
if (zenodo) {
  await click("canvas", '[data-dg="crate-zenodo"]');
  check("dialog.asks-for-a-token", await until(() => has("canvas", '[data-dg="zenodo-token"]'), 4000));
  check("dialog.wont-send-without-a-token", (await at("canvas", "count", '[data-dg="export-go"][disabled]')) === 1, String(await at("canvas", "text", '[data-dg="export-go"]')));
  await shot("01-export-with-zenodo");
  await click("canvas", '[data-dg="crate-zenodo"]');
}
await s(`s.choose('[data-dg="crate-license"]', "https://creativecommons.org/licenses/by/4.0/")`);
const file = `${VAULT}/Paper files/crate-evd-1-issue-conversion-rate-matsulab-discourse-graph.crate.zip`;
rmSync(file, { force: true });
await click("canvas", '[data-dg="export-go"]');
check("crate.file-is-saved", await until(async () => existsSync(file), 20000), file);
if (existsSync(file)) {
  const listing = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
  check("crate.packs-readme-and-outputs", listing.includes("README.md") && listing.includes("outputs/fig1_conversion_rate.png") && listing.includes("outputs/conversion_data.json"), listing.join(", "));
  const metadata = JSON.parse(execFileSync("unzip", ["-p", file, "ro-crate-metadata.json"], { maxBuffer: 64e6 }).toString());
  const typed = (name) => metadata["@graph"].filter((entity) => [entity["@type"]].flat().includes(name));
  check("crate.is-mira-in-one-graph", typed("mira:Evidence").length === 1 && typed("mira:Study").length === 1 && typed("mira:Protocol").length === 1, `${typed("mira:Evidence").length} evidence`);
  const hashed = metadata["@graph"].filter((entity) => typeof entity.sha256 === "string").length;
  check("crate.every-file-is-hashed", hashed >= 12, `${hashed} hashed`);
  const readme = execFileSync("unzip", ["-p", file, "README.md"]).toString();
  check("crate.readme-tells-the-finding", /### 29% of MATSUlab issues/.test(readme) && /!\[Figure 1/.test(readme) && /Produced by/.test(readme), readme.slice(0, 200));
  note(`crate: ${listing.length} files, ${metadata["@graph"].length} entities`);
}

// ---------------------------------------------------------------- Three fields, one chain
const canvases = await call("canvas.list");
for (const [slug, title, cards] of [
  ["biology", "Actin force production in clathrin-mediated endocytosis (Akamatsu et al. 2020)", 14],
  ["computer-science", "Next generation reservoir computing (Gauthier et al. 2021)", 9],
  ["sociology", "Inequality and unpredictability in an artificial cultural market (Salganik, Dodds and Watts 2006)", 9],
]) {
  const canvas = canvases.find((item) => item.title === title);
  check(`examples.${slug}-is-listed`, Boolean(canvas), title);
  if (!canvas) continue;
  await s("s.closeAll()");
  await s(`s.open(${q(canvas.id)})`);
  const shown = await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) >= cards, 8000);
  check(`examples.${slug}-draws`, shown, `${await at("canvas", "count", ".react-flow__node")} cards`);
  await click("canvas", '[data-dg="fit"]');
  await sleep(900);
  await shot(`02-${slug}`);
}

process.exit(await t.finish("evidence"));
