import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CanvasItemRecord, DgRecord, NodeRecord } from "@dg/contract/records.ts";
import { normalizeQuote } from "@dg/core/reading.ts";
import { makeCore } from "./support.ts";

// Reading a PDF into the graph, and the drawer of units waiting to go on a canvas.
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const paperPdf = readFileSync("demo/papers/preclinical-sle-mediators.pdf").toString("base64");
const graphOf = JSON.parse(readFileSync("demo/papers/preclinical-sle-mediators.graph.json", "utf8"));

const setup = (seed: DgRecord[] = records) => makeCore({ records: seed, watchSurfaces: true });

const cardsOf = (store: { records: DgRecord[] }, canvas: string) => {
  const latest = new Map<string, CanvasItemRecord>();
  for (const r of store.records) if (r.kind === "canvas-item" && r.canvas === canvas && (latest.get(r.id)?.rev ?? 0) < r.rev) latest.set(r.id, r);
  return [...latest.values()].filter((r) => !r.removed);
};

test("a quote matches however its line breaks were selected", () => {
  assert.equal(normalizeQuote("auto-\nantibodies   rose\n before  ﬁrst"), "autoantibodies rose before first");
});

test("a PDF dropped in is kept, listed and read back", async () => {
  const { call } = await setup();
  const added = await call("pdf.add", { name: "notes", dataBase64: paperPdf });
  assert.equal(added.name, "notes.pdf");
  assert.equal(added.units, 0);
  const listed = await call("pdf.list", {});
  assert.ok(listed.some((doc) => doc.ref === added.ref));
  const opened = await call("pdf.open", { ref: added.ref });
  assert.equal(opened.dataBase64, paperPdf);
  await assert.rejects(call("pdf.add", { name: "fake.pdf", dataBase64: btoa("hello") }), /isn't a PDF/);
});

test("a highlight becomes a staged unit on the chosen canvas, with its quote, page and source", async () => {
  const { call, store, events } = await setup();
  const doc = await call("pdf.add", { name: "Lab paper.pdf", dataBase64: paperPdf });
  const canvas = await call("canvas.create", { title: "Reading" });
  const types = await call("grammar.get", {});
  const evidence = types.nodeTypes.find((t) => t.base === "evidence")!;
  const cut = await call("pdf.cut", { ref: doc.ref, exact: "IFN-α was\nelevated", page: 3, title: "", type: evidence.id, canvas: canvas.id, documentTitle: "A lab paper" });
  assert.equal(cut.canvas, canvas.id);
  assert.equal(cut.node.title, "IFN-α was elevated");
  assert.equal(cut.node.staged, true);
  const node = store.records.find((r): r is NodeRecord => r.kind === "node" && r.id === cut.node.id)!;
  assert.equal(node.facts?.anchor?.exact, "IFN-α was elevated");
  assert.equal(node.facts?.anchor?.page, "3");
  const source = store.records.find((r): r is NodeRecord => r.kind === "node" && r.id === node.prov?.sourceDocument)!;
  assert.equal(source.title, "A lab paper");
  assert.equal(source.facts?.uri, doc.ref);
  assert.match(source.facts?.cid ?? "", /^b/);
  assert.equal(cardsOf(store, canvas.id).filter((c) => (c.item as { dg?: { node?: string } }).dg?.node === node.id).length, 1);
  assert.ok(events.some((e) => e.event === "units-placed" && e.canvas === canvas.id));

  // The reader lights it, and a second highlight reuses the source and stacks under the first.
  const second = await call("pdf.cut", { ref: doc.ref, exact: "Autoantibodies accumulated", page: 4, title: "Autoantibodies came first", canvas: canvas.id });
  const opened = await call("pdf.open", { ref: doc.ref });
  assert.deepEqual(opened.marks.map((m) => [m.exact, m.page]), [["IFN-α was elevated", 3], ["Autoantibodies accumulated", 4]]);
  assert.equal(opened.document.source, source.id);
  const [a, b] = [cut.node.id, second.node.id].map((id) => cardsOf(store, canvas.id).find((c) => (c.item as { dg?: { node?: string } }).dg?.node === id)!.item as { x: number; y: number; height: number });
  assert.equal(a!.x, b!.x);
  assert.ok(b!.y > a!.y);

  // The context panel can go back to the passage.
  const view = await call("node.view", { id: second.node.id });
  assert.deepEqual(view.provenance.pdf, { ref: doc.ref, name: "Lab paper.pdf", page: 4, exact: "Autoantibodies accumulated" });

  // Undo takes the unit and its card back.
  await call("pdf.uncut", { node: second.node.id });
  assert.equal((await call("pdf.open", { ref: doc.ref })).marks.length, 1);
  assert.ok(!cardsOf(store, canvas.id).some((c) => (c.item as { dg?: { node?: string } }).dg?.node === second.node.id));
});

test("a highlight can start a new canvas, or stay in the graph only", async () => {
  const { call } = await setup();
  const doc = await call("pdf.add", { name: "x.pdf", dataBase64: paperPdf });
  const made = await call("pdf.cut", { ref: doc.ref, exact: "Interferon", page: 1, title: "Interferon", canvas: null, newCanvas: "From x" });
  const summaries = await call("canvas.summaries", {});
  assert.equal(summaries.find((s) => s.id === made.canvas)?.title, "From x");
  const loose = await call("pdf.cut", { ref: doc.ref, exact: "Cytokines", page: 1, title: "Cytokines", canvas: null });
  assert.equal(loose.canvas, null);
});

test("a paper's PDF lights the units extracted from it", async () => {
  const { call } = await setup([]);
  await call("paper.importGraph", { graph: graphOf, filename: "preclinical-sle-mediators.pdf" });
  const doc = await call("pdf.add", { name: "preclinical-sle-mediators.pdf", dataBase64: paperPdf });
  assert.ok(doc.paper);
  const list = await call("pdf.list", {});
  assert.equal(list[0]?.ref, doc.ref);
  const opened = await call("pdf.open", { ref: doc.ref });
  assert.ok(opened.marks.length >= 10, `${opened.marks.length} marks`);
  assert.equal(opened.document.title, graphOf.paper.title);
  // A highlight on a paper hangs off the paper's own source unit.
  const cut = await call("pdf.cut", { ref: doc.ref, exact: "Serum samples", page: 2, title: "Serum samples", canvas: null });
  const view = await call("node.view", { id: cut.node.id });
  assert.equal(view.provenance.pdf?.ref, doc.ref);
});

test("the reader opens beside the canvas at a passage", async () => {
  const { call, events, opened } = await setup();
  const doc = await call("pdf.add", { name: "y.pdf", dataBase64: paperPdf });
  const cut = await call("pdf.cut", { ref: doc.ref, exact: "Cytokines", page: 1, title: "Cytokines", canvas: null });
  await call("pdf.show", { ref: doc.ref, unit: cut.node.id });
  assert.deepEqual(opened.at(-1), { route: { surface: "pdf", id: doc.ref }, placement: "main" });
  assert.ok(events.some((e) => e.event === "pdf-reveal" && e.unit === cut.node.id));
  assert.equal((await call("pdf.open", { ref: doc.ref })).reveal, cut.node.id);
  assert.equal((await call("pdf.open", { ref: doc.ref })).reveal, undefined);
});

test("the drawer lists units not on this canvas, grouped by the canvases and folders that hold them", async () => {
  const { call, store } = await setup();
  const summaries = await call("canvas.summaries", {});
  const target = summaries.find((s) => s.title.startsWith("Issue exchange"))!;
  const available = await call("units.available", { canvas: target.id });
  const onTarget = new Set(cardsOf(store, target.id).flatMap((c) => (c.item as { dg?: { node?: string } }).dg?.node ?? []));
  const listed = Object.keys(available.units);
  assert.ok(listed.length > 0);
  assert.ok(listed.every((id) => !onTarget.has(id)), "a unit already on the canvas is listed");
  assert.ok(available.segments.every((s) => s.id !== target.id), "the canvas itself is a segment");
  assert.ok(available.segments.some((s) => s.kind === "canvas"));
  for (const segment of available.segments) assert.ok(segment.units.every((id) => available.units[id]), segment.title);
  // Units that link to this canvas come first in a segment.
  for (const segment of available.segments) {
    const links = segment.units.map((id) => available.units[id]!.links);
    assert.deepEqual(links, [...links].sort((a, b) => b - a), segment.title);
  }
  // A folder is a segment, and a unit in no canvas or folder is loose.
  const folder = await call("folder.create", { title: "To read" });
  const lone = await call("node.create", { title: "A lone claim" });
  const extra = listed.find((id) => available.units[id]!.links === 0)!;
  await call("units.export", { nodes: [extra], target: { kind: "folder", id: folder.id } });
  const again = await call("units.available", { canvas: target.id });
  assert.ok(again.segments.find((s) => s.kind === "folder" && s.title === "To read")?.units.includes(extra));
  assert.ok(again.segments.find((s) => s.kind === "loose")?.units.includes(lone.id));
});

test("placing units together brings their relations, to each other and to what's there", async () => {
  const { call, store } = await setup();
  // A canvas missing units that link to its cards.
  let target: { id: string } | undefined;
  let available: Awaited<ReturnType<typeof call<"units.available">>> | undefined;
  for (const summary of await call("canvas.summaries", {})) {
    const found = await call("units.available", { canvas: summary.id });
    if (Object.values(found.units).some((u) => u.links > 0) && found.relations.length) [target, available] = [summary, found];
  }
  assert.ok(target && available, "no canvas is missing a linked unit");
  const linked = Object.values(available.units).find((u) => u.links > 0)!;
  const pair = available.relations[0]!;
  const units = [...new Set([linked.id, pair.source, pair.target])];
  const before = cardsOf(store, target.id).length;
  const { ids } = await call("canvas.placeUnits", { canvas: target.id, places: units.map((node, i) => ({ node, x: 2000 + i * 300, y: 0, width: 240, height: 80 })) });
  const after = cardsOf(store, target.id);
  const edges = after.filter((c) => "fromNode" in c.item && ids.includes(c.id));
  assert.equal(after.length, before + ids.length);
  assert.ok(edges.length >= 2, `${edges.length} edges`);
  // Placing again adds nothing, and they leave the drawer.
  assert.deepEqual((await call("canvas.placeUnits", { canvas: target.id, places: units.map((node) => ({ node, x: 0, y: 0, width: 240, height: 80 })) })).ids, []);
  const left = await call("units.available", { canvas: target.id });
  assert.ok(units.every((id) => !left.units[id]));
});

test("a paper's PDF finds its source unit by DOI, lights the units that cite it, and makes no second source", async () => {
  const { call, store } = await setup();
  const doc = await call("pdf.add", { name: "preclinical-sle-mediators.pdf", dataBase64: paperPdf });
  const source = store.records.find((r): r is NodeRecord => r.kind === "node" && r.facts?.doi === "10.1016/j.jaut.2016.06.001")!;
  assert.equal(doc.source, source.id);
  const opened = await call("pdf.open", { ref: doc.ref });
  assert.ok(opened.marks.length >= 6, `${opened.marks.length} marks`);
  const sources = () => store.records.filter((r) => r.kind === "node" && r.title === source.title).length;
  const before = sources();
  const cut = await call("pdf.cut", { ref: doc.ref, exact: "BLyS increased", page: 5, title: "BLyS increased", canvas: null });
  assert.equal(sources(), before);
  const node = store.records.find((r): r is NodeRecord => r.kind === "node" && r.id === cut.node.id)!;
  assert.equal(node.prov?.sourceDocument, source.id);
  const evidence = opened.marks[0]!.unit.id;
  assert.equal((await call("node.view", { id: evidence })).provenance.pdf?.ref, doc.ref);
});
