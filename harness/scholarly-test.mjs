// Card facts, registry lookups and research crates in real Obsidian, on the reservoir computing papers.
//   npm run build:test, then: node harness/scholarly-test.mjs [stage ...]
// Needs the papers science-test.mjs reads (see docs/testing.md). The lookup stage asks the open
// registries about one paper, sending its DOI and title only. Pictures go to reports/scholarly.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const VAULT = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox";
const FILE = "Carroll-2020-edge-of-chaos.pdf";
const EVIDENCE = "For polynomial map reservoir with Lorenz input, the smallest testing error is at the edge of stability.";

const stages = process.argv.slice(2);
const wants = (name) => stages.length === 0 || stages.includes(name);
const t = await session({ out: resolve("reports/scholarly"), reload: !process.env.DG_NO_RELOAD });
const { s, check, note, until, shot, at, click, has, call } = t;

await s("s.test(true)");
const paper = (await call("paper.list")).find((item) => item.filename === FILE);
if (!paper) {
  console.log("SKIP: run harness/science-test.mjs first, so the papers are read.");
  process.exit(await t.finish("scholarly"));
}
const cards = () => at("canvas", "count", ".react-flow__node");
const rows = (field) => at("canvas", "count", `.card .fact[data-field="${field}"]`);
const openCanvas = async () => {
  await s("s.closeAll()");
  await s(`s.open(${q(paper.canvas)})`);
  await until(async () => ((await cards()) ?? 0) >= 30);
};
const pick = async (title) => {
  await click("canvas", '[data-dg="fit"]');
  await sleep(900);
  await click("canvas", `[data-dg="card-${title}"]`);
};
const FIELDS = ["source", "authors", "origin", "created", "identifiers"];

// ---------------------------------------------------------------- What every card shows
if (wants("cards")) {
  await call("prefs.set", { cardFields: ["source"] });
  await openCanvas();
  const total = await at("canvas", "count", ".card:not(.nested)");
  check("cards.source-is-on-by-default", (await rows("source")) === total && total >= 30, `${await rows("source")} of ${total}`);
  check("cards.source-says-how-it-was-read", /Auto/.test((await at("canvas", "text", `[data-dg="fact-how-${EVIDENCE}"]`)) ?? ""), await at("canvas", "text", `[data-dg="fact-how-${EVIDENCE}"]`));
  check("cards.source-names-the-paper", /Carroll 2020/.test((await at("canvas", "text", `[data-dg="fact-source-${EVIDENCE}"]`)) ?? ""));
  check("cards.other-facts-start-hidden", (await rows("authors")) === 0 && (await rows("identifiers")) === 0);

  await click("canvas", '[data-dg="card-fields"]');
  check("cards.menu-opens", await until(() => has("canvas", '[data-dg="card-fields-menu"]')));
  check("cards.menu-lists-five-switches", (await at("canvas", "count", '[data-dg="card-fields-menu"] [role="menuitemcheckbox"]')) === 5);
  check("cards.menu-shows-what-is-on", (await at("canvas", "count", '[data-dg="card-field-source"][aria-checked="true"]')) === 1);
  await shot("01-card-fields-menu");
  for (const field of FIELDS.slice(1)) {
    await click("canvas", `[data-dg="card-field-${field}"]`);
    await until(async () => ((await rows(field)) ?? 0) > 0, 5000);
  }
  check("cards.every-fact-shows-on-every-card", (await Promise.all(FIELDS.slice(0, 4).map(rows))).every((count) => count === total), (await Promise.all(FIELDS.map(rows))).join(", "));
  check("cards.menu-stays-open-while-switching", await has("canvas", '[data-dg="card-fields-menu"]'));
  check("cards.choice-is-kept", (await call("prefs.get")).cardFields.length === 5);
  await sleep(600);
  await shot("02-cards-with-every-fact");
  // Cards grew, so some now cover others: the bar says so and offers Tidy, and moves nothing itself.
  const crowded = await until(() => has("canvas", '[data-dg="tidy-after-fields"]'), 4000);
  check("cards.says-when-cards-cover-each-other", crowded, await at("canvas", "text", '[data-dg="status-text"]'));
  // A click on a card picks it up and opens nothing, wherever on the card it lands.
  await pick(EVIDENCE);
  await sleep(1200);
  check("cards.a-click-only-selects", !(await has("pdf", ".pdf-mark").catch(() => false)));
  await call("prefs.set", { cardFields: FIELDS });

  check("cards.menu-closes-on-a-click-elsewhere", !(await has("canvas", '[data-dg="card-fields-menu"]')));
  check("cards.a-selected-card-offers-its-source", await has("canvas", `button[data-dg="fact-source-${EVIDENCE}"]`));

  // Switching one off takes it off every card at once.
  await click("canvas", '[data-dg="card-fields"]');
  await until(() => has("canvas", '[data-dg="card-fields-menu"]'));
  await click("canvas", '[data-dg="card-field-origin"]');
  await until(async () => (await rows("origin")) === 0, 5000);
  check("cards.switching-off-clears-every-card", (await rows("origin")) === 0 && (await rows("created")) === total);
  await click("canvas", '[data-dg="card-fields"]');
}

// ---------------------------------------------------------------- The same facts head the context panel
if (wants("panel")) {
  await openCanvas();
  await s(`s.openSide("context")`);
  await pick(EVIDENCE);
  await until(async () => (await at("context", "text", '[data-dg="ctx-title"]')) === EVIDENCE);
  const labels = await at("context", "text", '.ctx-head .facts[data-density="panel"]');
  check("panel.heads-with-all-five-facts", (await at("context", "count", '.ctx-head .facts[data-density="panel"] .fact')) === 5, q(labels));
  const cardLabel = await s(`s.style(${q(`[data-dg="facts-${EVIDENCE}"] dt`)}, "color")`).catch(() => null);
  const panelLabel = await s(`s.ctx.style(".ctx-head .facts dt", "color")`).catch(() => null);
  check("panel.labels-weigh-the-same-as-the-card", !cardLabel || cardLabel === panelLabel, `${cardLabel} / ${panelLabel}`);
  check("panel.says-auto", /Auto/.test((await at("context", "text", '.ctx-head [data-dg="fact-how"]')) ?? ""));
  check("panel.offers-a-lookup", await has("context", '[data-dg="ctx-lookup"]'));
  await shot("04-panel-facts");
}

// ---------------------------------------------------------------- Registries
if (wants("lookup")) {
  await openCanvas();
  await s(`s.openSide("context")`);
  await pick(EVIDENCE);
  await until(() => has("context", '[data-dg="ctx-lookup"]'));
  await s(`s.ctx.reveal('[data-dg="ctx-lookup"]')`);
  await click("context", '[data-dg="ctx-lookup"]');
  const checked = await until(async () => {
    const text = await at("context", "text", '[data-dg="ctx-work-checked"]');
    return /Checked with/.test(text ?? "") ? text : null;
  }, 40000);
  check("lookup.registries-answer", Boolean(checked), checked ?? (await at("context", "text", '[data-dg="ctx-work"]')));
  const held = (await call("paper.list")).find((item) => item.filename === FILE);
  const view = await call("node.view", { id: Object.values((await call("canvas.open", { id: paper.canvas })).nodes).find((node) => node.title === EVIDENCE).id });
  const ids = view.node.card.identifiers.map(({ scheme, value }) => `${scheme}:${value}`);
  note(`identifiers: ${ids.join(", ")}`);
  note(`standing: ${JSON.stringify(view.provenance.work?.standing)}`);
  check("lookup.keeps-the-doi-and-more", ids.some((id) => id.startsWith("doi:")) && ids.some((id) => id.startsWith("openalex:")), ids.join(", "));
  check("lookup.keeps-venue-and-date", Boolean(view.provenance.work?.venue && view.provenance.work?.published), `${view.provenance.work?.venue}, ${view.provenance.work?.published}`);
  check("lookup.title-is-untouched", held.title === paper.title);
  await s(`s.ctx.reveal('[data-dg="ctx-work"]')`);
  await shot("05-published-work");
}

// ---------------------------------------------------------------- Research crates, out and back
if (wants("crate")) {
  await openCanvas();
  const slug = "do-reservoir-computers-work-best-at-the-edge-of-chaos";
  for (const name of [`${slug}.crate.zip`, `${slug}.eln`]) rmSync(`${VAULT}/Paper files/${name}`, { force: true });
  await click("canvas", '[data-dg="canvas-menu"]');
  await click("canvas", '[data-dg="export"]');
  await until(() => has("canvas", '[data-dg="export-menu"]'));
  await s(`s.choose('[data-dg="export-target"]', "crate")`).catch((error) => note(String(error)));
  const offered = await until(() => has("canvas", '[data-dg="crate-options"]'), 4000);
  check("crate.export-offers-it", offered);
  if (offered) {
    await s(`s.choose('[data-dg="crate-license"]', "https://creativecommons.org/licenses/by/4.0/")`);
    await shot("06-export-a-crate");
    await click("canvas", '[data-dg="export-go"]');
  } else {
    await call("crate.export", { canvas: paper.canvas, license: "https://creativecommons.org/licenses/by/4.0/" });
  }
  const file = `${VAULT}/Paper files/${slug}.crate.zip`;
  check("crate.file-is-saved", await until(async () => existsSync(file), 15000), file);
  if (existsSync(file)) {
    const listing = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
    check("crate.holds-what-a-reader-expects", ["ro-crate-metadata.json", "ro-crate-preview.html", "discourse-graph.jsonld", "dg-records.jsonl", "datacite.json"].every((name) => listing.includes(name)) && !listing.some((name) => name.endsWith(".pdf")), listing.join(", "));
    const metadata = JSON.parse(execFileSync("unzip", ["-p", file, "ro-crate-metadata.json"], { maxBuffer: 64e6 }).toString());
    const root = metadata["@graph"].find((entity) => entity["@id"] === "./");
    const types = new Map();
    for (const entity of metadata["@graph"]) for (const type of [entity["@type"]].flat()) types.set(type, (types.get(type) ?? 0) + 1);
    note(`crate entities: ${[...types].map(([type, count]) => `${count} ${type}`).join(", ")}`);
    check("crate.root-is-complete", root?.name && root.description && root.datePublished && root.license?.["@id"] && root.hasPart.length >= 4 && [root.citation ?? []].flat().length >= 1, JSON.stringify({ name: root?.name, license: root?.license, parts: root?.hasPart?.length }));
    check("crate.runs-are-process-run-actions", (types.get("CreateAction") ?? 0) >= 1 && [root.conformsTo ?? []].flat().some((item) => item["@id"] === "https://w3id.org/ro/wfrun/process/0.6"), `${types.get("CreateAction")} actions`);
    writeFileSync(resolve("reports/scholarly/ro-crate-metadata.json"), JSON.stringify(metadata, null, 2));
  }

  // The lab-notebook form, then back in: the same graph, nothing new.
  const eln = await call("crate.export", { canvas: paper.canvas, format: "eln" });
  check("crate.eln-is-saved", existsSync(`${VAULT}/${eln.where}`), eln.where);
  const before = Object.keys((await call("canvas.open", { id: paper.canvas })).nodes).length;
  const again = await call("crate.import", { ref: eln.where });
  check("crate.own-crate-reads-back-with-nothing-new", again.kind === "own" && again.fresh === 0 && again.units >= before, JSON.stringify(again));

  // Someone else's run crate, through the file's own menu command.
  const foreign = {
    "@context": "https://w3id.org/ro/crate/1.1/context",
    "@graph": [
      { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" }, about: { "@id": "./" } },
      { "@id": "./", "@type": "Dataset", name: "Lorenz reservoir sweep", datePublished: "2026-11-01", hasPart: [{ "@id": "sweep.csv" }], mentions: [{ "@id": "#sweep" }], citation: [{ "@id": "https://doi.org/10.1063/5.0038163" }] },
      { "@id": "https://doi.org/10.1063/5.0038163", "@type": "ScholarlyArticle", name: "Do reservoir computers work best at the edge of chaos?" },
      { "@id": "https://github.com/example/reservoir", "@type": "SoftwareSourceCode", name: "reservoir sweep", version: "a1b2c3d", codeRepository: "https://github.com/example/reservoir", programmingLanguage: "Python" },
      { "@id": "#sweep", "@type": "CreateAction", name: "Sweep spectral radius", instrument: { "@id": "https://github.com/example/reservoir" }, object: [{ "@id": "#rho" }], result: { "@id": "sweep.csv" }, endTime: "2026-11-01T12:00:00Z", actionStatus: { "@id": "http://schema.org/CompletedActionStatus" } },
      { "@id": "#rho", "@type": "PropertyValue", name: "spectral_radius", value: "0.1 to 1.5" },
      { "@id": "sweep.csv", "@type": "File", name: "Testing error by spectral radius", encodingFormat: "text/csv", contentSize: "4096" },
    ],
  };
  writeFileSync(`${VAULT}/Crates/lorenz-sweep-ro-crate-metadata.json`, JSON.stringify(foreign, null, 2));
  await sleep(1500);
  const read = await call("crate.import", { ref: "Crates/lorenz-sweep-ro-crate-metadata.json" });
  check("crate.foreign-run-becomes-units", read.kind === "foreign" && read.units === 4, JSON.stringify(read));
  await s(`s.open(${q(read.canvas)})`);
  await until(async () => ((await cards()) ?? 0) >= 4);
  const units = Object.values((await call("canvas.open", { id: read.canvas })).nodes);
  check("crate.foreign-units-are-typed", ["code", "output", "run", "source"].every((base) => units.some((unit) => unit.base === base)), units.map((unit) => `${unit.base}: ${unit.title}`).join(" | "));
  const run = units.find((unit) => unit.base === "run");
  const page = await call("process.run", { id: run.id }).catch((error) => ({ error: String(error) }));
  note(`run page: ${JSON.stringify(page).slice(0, 300)}`);
  await sleep(1500);
  await click("canvas", '[data-dg="fit"]');
  await sleep(900);
  await shot("07-a-foreign-crate");
}

await call("prefs.set", { cardFields: ["source"] });
process.exit(await t.finish("scholarly"));
