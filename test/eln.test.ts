import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNode, type JsonObject, type NodeRecord } from "@dg/contract/records.ts";
import { ensureProcessTypes, unitCid } from "@dg/core/process.ts";
import { ELN_SPEC } from "@dg/core/rocrate.ts";
import { unzip } from "@dg/core/zip.ts";
import { makeCore } from "./support.ts";

const setup = async () => {
  const files = new Map<string, string>();
  const made = await makeCore({ wrap: (host) => ({ ...host, saveFile: async ({ name, dataBase64 }) => (files.set(name, dataBase64), { ok: true as const, value: { where: `saved/${name}` } }) }) });
  return { ...made, files };
};

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const sha256 = async (bytes: Uint8Array): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** A bench day: a protocol, a run that followed it with a gel picture, what the gel shows, and the claim it supports. */
const bench = async () => {
  const kit = await setup();
  const { call, host, emit, core, arrive } = kit;
  const stamp = { space: kit.store.spaceId, by: { id: core.identity().did, name: "Test Person" } };
  const types = ensureProcessTypes({ nodeTypes: (await call("grammar.get", {})).nodeTypes, stamp });
  const protocol = createNode({ ...stamp, title: "Western blot for the 42 kDa protein", type: types.types.protocol.id, facts: { version: "2", steps: ["Run the gel", "Transfer", "Probe with the antibody"], materials: ["Anti-GFP antibody (RRID:AB_2313773)"] } });
  const run = createNode({
    ...stamp,
    title: "Blot of knockout and wild type, 13 November",
    type: types.types.run.id,
    prov: { follows: { uri: protocol.id, cid: await unitCid(protocol) } },
    facts: { status: "completed", startedAt: "2026-11-13T09:00:00.000Z", endedAt: "2026-11-13T15:00:00.000Z", parameterValues: { "exposure, s": 30, lanes: "KO, WT" }, deviations: ["Blocked for 2 h instead of 1"] },
  });
  await host.putRecords({ records: [...types.created, protocol, run] });
  emit({ type: "records-changed" });
  await arrive(...types.created, protocol, run);
  const canvas = await call("canvas.create", { title: "Knockout check" });
  const { unit: gel } = await call("image.add", { canvas: canvas.id, file: { name: "gel.png", mediaType: "image/png", dataBase64: PNG } });
  // The picture is this run's output.
  const output = core.graph().documents.get(gel.id) as NodeRecord;
  const revised = { ...output, rev: output.rev + 1, prov: { generatedBy: run.id } };
  await host.putRecords({ records: [revised] });
  emit({ type: "records-changed" });
  await arrive(revised);
  const evidence = await call("output.observe", { output: gel.id, title: "The 42 kDa band is absent in the knockout", canvas: canvas.id });
  const { nodeTypes, relationTypes } = await call("grammar.get", {});
  const claim = await call("node.create", { title: "The knockout removes the protein", type: nodeTypes.find((type) => type.label === "Claim")!.id });
  await call("relation.assert", { type: relationTypes.find((type) => type.label === "Supports")!.id, source: evidence.id, target: claim.id });
  await call("canvas.placeUnits", { canvas: canvas.id, places: [{ node: claim.id, x: 0, y: 300, width: 260, height: 96 }, { node: run.id, x: 300, y: 300, width: 260, height: 96 }] });
  await call("unit.check", { unit: run.id, verdict: "checked", way: "sourceRead", note: "Lanes match the notebook" });
  await call("unit.check", { unit: evidence.id, verdict: "checked" });
  return { ...kit, canvas, run, protocol, gel, evidence, claim };
};

test("a notebook file lists its entries the way eLabFTW's importer reads them", async () => {
  const { call, files, canvas, run, protocol } = await bench();
  const made = await call("crate.export", { canvas: canvas.id, format: "eln", license: "https://creativecommons.org/licenses/by/4.0/" });
  assert.match(made.name, /\.eln$/);
  const entries = await unzip(bytesOf(files.get(made.name)!));
  const paths = entries.map(({ path }) => path);
  const root = paths[0]!.split("/")[0]!;
  assert.ok(paths.every((path) => path.startsWith(`${root}/`)), "one folder at the top, as the format asks");
  assert.equal(`${root}.eln`, made.name, "named as the archive is");
  const metadata = JSON.parse(new TextDecoder().decode(entries.find(({ path }) => path === `${root}/ro-crate-metadata.json`)!.bytes)) as { "@graph": JsonObject[] };
  const byId = new Map(metadata["@graph"].map((node) => [String(node["@id"]), node]));
  const crate = byId.get("./")!;
  assert.ok((crate.conformsTo as JsonObject[]).some((item) => item["@id"] === ELN_SPEC), "says which version of the notebook format it is");
  assert.equal((byId.get("ro-crate-metadata.json")!.sdPublisher as JsonObject)["@id"], "https://discoursegraphs.com");

  // eLabFTW's importer (src/Import/Eln.php) walks the root's parts and takes each as one entry.
  const parts = crate.hasPart as JsonObject[];
  assert.ok(Array.isArray(parts));
  const imported = parts.map((part) => byId.get(String(part["@id"]))!);
  assert.ok(imported.every((node) => node["@type"] === "Dataset"), "every part is an entry, not a loose file");
  // Its genre decides what it becomes: an experiment, a template (from "protocol"), or a resource.
  assert.deepEqual(imported.map((node) => [node.genre, node.name]), [
    ["experiment", run.title],
    ["protocol", protocol.title],
    ["resource", "Knockout check"],
  ]);
  for (const node of imported) {
    assert.equal(node.encodingFormat, "text/markdown", "so the body is read as Markdown");
    assert.equal(typeof node.text, "string");
    assert.equal(node.description, undefined, "eLabFTW appends a description to the body, so there is none to double it");
    assert.equal(typeof node.keywords, "string", "tags are one comma-separated string");
    assert.equal(typeof node.identifier, "string");
    assert.ok(byId.get(String((node.author as JsonObject)["@id"]))?.name, "its author is a person in the graph");
    assert.equal(node.about, undefined, "eLabFTW reads `about` as a category, so the unit is linked another way");
  }

  const experiment = imported[0]!;
  assert.match(String(experiment.text), /\*\*Protocol followed:\*\* Western blot for the 42 kDa protein, version 2/);
  assert.match(String(experiment.text), /## Departures from the protocol\n\n- Blocked for 2 h instead of 1/);
  assert.match(String(experiment.text), /## What was observed\n\n- The 42 kDa band is absent in the knockout\n {2}- Signed by its author, Test Person/);
  // Its parameters are values a notebook shows as fields.
  const values = (experiment.variableMeasured as JsonObject[]).map((item) => byId.get(String(item["@id"]))!);
  assert.deepEqual(values.map((value) => [value["@type"], value.propertyID, value.value]), [["PropertyValue", "exposure, s", "30"], ["PropertyValue", "lanes", "KO, WT"]]);
  // The sign-off is a comment, with who, when and what they said.
  const comments = (experiment.comment as JsonObject[]).map((item) => byId.get(String(item["@id"]))!);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!["@type"], "Comment");
  assert.match(String(comments[0]!.text), /^Signed by its author, Test Person, \d{4}-\d{2}-\d{2} \(read the source\): Lanes match the notebook$/);
  assert.ok(comments[0]!.dateCreated && byId.get(String((comments[0]!.author as JsonObject)["@id"])));
  // Its files are found at root/@id, and eLabFTW refuses one whose sha256 doesn't match.
  const held = experiment.hasPart as JsonObject[];
  assert.equal(held.length, 1, "the gel goes with the run that made it");
  for (const node of imported) {
    for (const part of (node.hasPart as JsonObject[] | undefined) ?? []) {
      const file = byId.get(String(part["@id"]))!;
      if (/^https?:/.test(String(file["@id"]))) continue;
      const entry = entries.find(({ path }) => path === `${root}/${decodeURIComponent(String(file["@id"]))}`);
      assert.ok(entry, `${file["@id"]} is in the archive`);
      assert.equal(file.sha256, await sha256(entry.bytes));
      assert.equal(file.contentSize, String(entry.bytes.length));
      assert.ok(file.name && file.encodingFormat);
    }
  }
  // An entry with no files still has its folder.
  assert.ok(new TextDecoder("latin1").decode(bytesOf(files.get(made.name)!)).includes(`${root}/western-blot-for-the-42-kda-protein/`), "the archive holds the empty folder");
  // The graph's own entry reads as the README does.
  assert.match(String(imported[2]!.text), /## Findings\n\n### The 42 kDa band is absent in the knockout/);
  assert.match(String(imported[2]!.text), /- \*\*Signed by its author:\*\* Test Person/);
});

test("the notebook file opens again here with everything, sign-offs included", async () => {
  const first = await bench();
  const made = await first.call("crate.export", { canvas: first.canvas.id, format: "eln" });
  const second = await setup();
  const kept = await second.host.writeAsset({ asset: { name: made.name, mime: "application/vnd.eln+zip", dataUrl: `data:application/vnd.eln+zip;base64,${first.files.get(made.name)!}` } });
  assert.ok(kept.ok);
  const read = await second.call("crate.import", { ref: kept.value.ref });
  assert.equal(read.kind, "own");
  assert.equal(read.units, 5);
  const view = await second.call("node.view", { id: first.run.id });
  assert.equal(view.node.title, first.run.title);
  assert.equal(view.checks?.length, 1, "who checked the run came with it");
  assert.equal(view.checks![0]!.note, "Lanes match the notebook");
  assert.equal((await second.call("crate.import", { ref: kept.value.ref })).fresh, 0);
});

test("a crate tells who checked each unit, and a zip crate still lists its files at the top", async () => {
  const { call, files, canvas, evidence } = await bench();
  const made = await call("crate.export", { canvas: canvas.id });
  const entries = await unzip(bytesOf(files.get(made.name)!));
  const metadata = JSON.parse(new TextDecoder().decode(entries.find(({ path }) => path === "ro-crate-metadata.json")!.bytes)) as { "@graph": JsonObject[] };
  const byId = new Map(metadata["@graph"].map((node) => [String(node["@id"]), node]));
  const reviews = metadata["@graph"].filter((node) => node["@type"] === "Review");
  assert.equal(reviews.length, 2);
  const about = metadata["@graph"].find((node) => node.name === evidence.title && [node["@type"]].flat().includes("Evidence"))!;
  const review = byId.get(String((about.review as JsonObject)["@id"]))!;
  assert.equal(review.name, "Signed by its author");
  assert.equal((review.itemReviewed as JsonObject)["@id"], about["@id"]);
  assert.match(String(review.identifier), /^bafkrei/, "pinned to the version it was made on");
  assert.equal(review.description, undefined, "and that version is the one in the crate");
  assert.ok(([byId.get("./")!.hasPart].flat() as JsonObject[]).some((part) => part["@id"] === "README.md"), "outside a notebook file the root lists the files themselves");
  assert.match(new TextDecoder().decode(entries.find(({ path }) => path === "README.md")!.bytes), /- \*\*Signed by its author:\*\* Test Person, \d{4}-\d{2}-\d{2} \(read it and agree\)/);
});

test("real exports from two other notebooks come in as runs with their files, hashed", async () => {
  // Unchanged example files from the ELN Consortium's repository (MIT). See test/fixtures/eln/README.md.
  for (const [file, expected] of [
    ["kadi4mat-records-example.eln", { runs: 1, outputs: 4, first: "records-example", author: "Manideep" }],
    ["PASTA.eln", { runs: 8, outputs: 10, first: "This is an example task", author: undefined }],
  ] as const) {
    const { call, host, core } = await setup();
    const kept = await host.writeAsset({ asset: { name: file, mime: "application/vnd.eln+zip", dataUrl: `data:application/vnd.eln+zip;base64,${readFileSync(`test/fixtures/eln/${file}`).toString("base64")}` } });
    assert.ok(kept.ok);
    const read = await call("crate.import", { ref: kept.value.ref });
    assert.equal(read.kind, "foreign", file);
    const units = Object.values((await call("canvas.open", { id: read.canvas! })).nodes);
    const runs = units.filter((unit) => unit.base === "run");
    const outputs = units.filter((unit) => unit.base === "output");
    assert.equal(runs.length, expected.runs, `${file}: each entry is a run`);
    assert.equal(outputs.length, expected.outputs, `${file}: each entry's files are outputs`);
    assert.ok(runs.some((unit) => unit.title === expected.first), `${file}: ${runs.map((unit) => unit.title).join(" | ")}`);
    const records = [...core.graph().documents.values()].filter((record): record is NodeRecord => record.kind === "node");
    const hashed = records.filter((record) => record.facts?.cid);
    assert.ok(hashed.length >= 4, `${file}: ${hashed.length} files hashed from the archive`);
    assert.ok(records.some((record) => record.prov?.generatedBy && runs.some((unit) => unit.id === record.prov!.generatedBy)), `${file}: a file belongs to the entry that holds it`);
    if (expected.author) assert.deepEqual(records.find((record) => record.title === expected.first)?.facts?.creators?.map(({ name }) => name), [expected.author]);
    assert.equal((await call("crate.import", { ref: kept.value.ref })).fresh, 0, `${file}: twice makes nothing new`);
  }
});
