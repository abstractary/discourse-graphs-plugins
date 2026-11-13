import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import type { ExtractionGraph, Services } from "@dg/contract/services.ts";
import { PDF_CANVAS_FIXED, type SurfaceMessage, type SurfaceMethod, type SurfaceMethods, type SurfacePort } from "@dg/contract/surface.ts";

const demo = JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")) as ExtractionGraph;

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async () => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const services = { servers: async () => [], extract: async () => demo, storeGraph: async () => {}, link: async () => null, pushRecords: async () => {}, pullRecords: async () => ({ records: [], done: true }) } as unknown as Services;
  const core = await createCore({ host: host as never, services, demoGraphs: [{ filename: "demo.pdf", graph: demo }] });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("id" in message) pending.get(message.id)?.(message);
    },
    onMessage: (handler) => {
      listener = handler;
      return () => {};
    },
  };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      next += 1;
      const id = `r${next}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  return { call, paper };
};

const refused = new RegExp(PDF_CANVAS_FIXED);

test("a PDF canvas can be polished, and takes nothing that isn't its paper's", async () => {
  const { call, paper } = await setup();
  const view = await call("canvas.open", { id: paper.canvas });
  assert.ok(view.paper, "a PDF canvas says which reading it is");
  const card = view.items.find(({ item }) => "x" in item && "dg" in item)!;
  const { id: _id, ...item } = card.item as { id: string; x: number };

  // Moving and taking off are polish.
  await call("canvas.write", { canvas: paper.canvas, upserts: [{ id: card.id, z: card.z, item: { ...item, x: item.x + 40 } as never }] });
  await call("canvas.write", { canvas: paper.canvas, removes: [card.id] });
  assert.equal((await call("canvas.open", { id: paper.canvas })).items.some(({ id }) => id === card.id), false);
  await call("canvas.write", { canvas: paper.canvas, restores: [card.id] });

  // A sticky, and a unit written from nothing, are someone's own work.
  await assert.rejects(call("canvas.write", { canvas: paper.canvas, upserts: [{ z: 99, item: { type: "text", text: "Mine", x: 0, y: 0, width: 200, height: 60 } as never }] }), refused);
  const own = await call("node.create", { title: "My own claim" } as never);
  await assert.rejects(call("canvas.write", { canvas: paper.canvas, upserts: [{ z: 99, item: { type: "text", text: own.title, x: 0, y: 0, width: 200, height: 60, dg: { node: own.id } } as never }] }), refused);
  await assert.rejects(call("units.put", { canvas: paper.canvas, nodes: [own.id] }), refused);
  await assert.rejects(call("canvas.placeUnits", { canvas: paper.canvas, places: [{ node: own.id, x: 0, y: 0, width: 200, height: 60 }] }), refused);
  // A card can't be repointed at another unit.
  await assert.rejects(call("canvas.write", { canvas: paper.canvas, upserts: [{ id: card.id, z: card.z, item: { ...item, dg: { node: own.id } } as never }] }), refused);
  assert.equal((await call("canvas.open", { id: paper.canvas })).items.length, view.items.length, "nothing foreign was added");

  // One of the paper's own units, taken off earlier, can go back on.
  const unit = (card.item as { dg: { node: string } }).dg.node;
  await call("canvas.write", { canvas: paper.canvas, removes: [card.id] });
  const { placed } = await call("units.put", { canvas: paper.canvas, nodes: [unit] });
  assert.deepEqual(placed, [unit]);
});

test("a unit a model read can be reworded, and keeps the model's wording beside it", async () => {
  const { call, paper } = await setup();
  const view = await call("canvas.open", { id: paper.canvas });
  const read = Object.values(view.nodes).find((node) => node.card.source?.how === "auto")!;
  assert.equal(read.card.source?.reworded, undefined);
  const reworded = await call("node.rename", { id: read.id, title: "Said more exactly" });
  assert.equal(reworded.title, "Said more exactly");
  assert.equal(reworded.card.source?.reworded, true);
  assert.equal(reworded.card.source?.how, "auto", "it is still the model's reading");
  assert.equal((await call("node.view", { id: read.id })).provenance.paper?.asRead, read.title);
  // A second rewording keeps the first original.
  await call("node.rename", { id: read.id, title: "Said more exactly still" });
  assert.equal((await call("node.view", { id: read.id })).provenance.paper?.asRead, read.title);
  // Going back to the model's words clears the mark.
  const back = await call("node.rename", { id: read.id, title: read.title });
  assert.equal(back.card.source?.reworded, undefined);
  assert.equal((await call("node.view", { id: read.id })).provenance.paper?.asRead, undefined);
});
test("building on a PDF canvas makes a canvas of the same cards that can be changed", async () => {
  const { call, paper } = await setup();
  const before = await call("canvas.open", { id: paper.canvas });
  const built = await call("canvas.buildOn", { id: paper.canvas });
  const view = await call("canvas.open", { id: built.id });
  assert.equal(view.paper, undefined, "it is a canvas of the person's own");
  assert.equal(view.items.length, before.items.length);
  assert.deepEqual(Object.keys(view.nodes).sort(), Object.keys(before.nodes).sort(), "the same units, not copies of them");
  const cards = new Set(view.items.map(({ id }) => id));
  for (const { item } of view.items) if ("fromNode" in item) assert.ok(cards.has(item.fromNode) && cards.has(item.toNode), "links join the new cards");

  const own = await call("node.create", { title: "My own claim" } as never);
  const { placed } = await call("units.put", { canvas: built.id, nodes: [own.id] });
  assert.deepEqual(placed, [own.id]);
  assert.equal((await call("canvas.open", { id: paper.canvas })).items.length, before.items.length, "the PDF canvas is unchanged");
  const again = await call("canvas.buildOn", { id: paper.canvas });
  assert.notEqual(again.title, built.title, "a second one gets its own name");
});

test("the canvas list says which workspace each canvas lives in, what it draws on and who did most", async () => {
  const { call, paper } = await setup();
  const built = await call("canvas.buildOn", { id: paper.canvas });
  const own = await call("node.create", { title: "My own claim" } as never);
  await call("units.put", { canvas: built.id, nodes: [own.id] });
  const list = await call("repository.canvases", {});
  const fixedOne = list.find((c) => c.id === paper.canvas)!;
  const mine = list.find((c) => c.id === built.id)!;
  assert.equal(fixedOne.kind, "paper");
  assert.equal(mine.kind, "canvas");
  assert.deepEqual(mine.workspace.kind, "own");
  assert.equal(mine.workspace.name, "Your workspace");
  assert.equal(mine.privacy, "private");
  assert.equal(mine.sources.length, 1);
  assert.equal(mine.sources[0]!.title, fixedOne.paper);
  assert.equal(mine.sources[0]!.units, Object.keys((await call("canvas.open", { id: paper.canvas })).nodes).length);
  assert.equal(mine.contributorCount, 1);
  assert.ok(mine.contributors[0]!.edits > 0);
  const summaries = await call("canvas.summaries", {});
  assert.equal(summaries.find((c) => c.id === paper.canvas)!.kind, "paper");
  assert.equal(summaries.find((c) => c.id === built.id)!.kind, "canvas");
});
