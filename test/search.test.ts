import assert from "node:assert/strict";
import test from "node:test";
import { fail, type Host } from "@dg/contract/host.ts";
import { createMemoryHost } from "@dg/contract/memory-host.ts";
import { createLab, createNode, type CanvasItemRecord, type DgRecord } from "@dg/contract/records.ts";
import { fold, readable, wordsOf } from "@dg/core/search.ts";
import { makeCore } from "./support.ts";

// Finding units by their words, renaming them, and putting them on a canvas from another panel.
const setup = async (overrides: Partial<Host> = {}) => {
  const made = await makeCore({ watchSurfaces: true, wrap: (host) => ({ ...host, ...overrides }) });
  const { core, store, emit } = made;
  const type = (label: string) => core.nodeTypes().find((item) => item.label.toLowerCase() === label)!.id;
  const refOf = (title: string) => [...store.texts.entries()].find(([, text]) => text.title.endsWith(title))![0];
  /** Writes a unit's note the way a person would, in the base. */
  const write = (title: string, body: string) => {
    const ref = refOf(title);
    store.texts.get(ref)!.body = body;
    emit({ type: "text-changed", ref });
  };
  return { ...made, type, write, refOf };
};

const titles = (results: { hits: { node: { title: string } }[] }) => results.hits.map((hit) => hit.node.title);

test("words fold the way people type them", () => {
  assert.equal(fold("Ménière’s ﬁbrosis"), "meniere’s fibrosis");
  assert.deepEqual(wordsOf('IFN  "type I" interferon'), ["ifn", "type i", "interferon"]);
  assert.equal(readable("---\nid: x\n---\n# Heading\nSee [[CLM - Other claim|the claim]] and **bold** [a](http://x)."), "Heading See the claim and bold a.");
});

test("a title match ranks above the same words in a note, and every word must be found", async () => {
  const { call, type, write } = await setup();
  await call("node.create", { title: "Interferon rises before autoantibodies", type: type("claim") });
  await call("node.create", { title: "A cohort of 200 patients", type: type("evidence") });
  await call("node.create", { title: "Unrelated question", type: type("question") });
  write("A cohort of 200 patients", "Serum interferon was measured at every visit.");

  const found = await call("search.query", { text: "interferon", limit: 10 });
  assert.deepEqual(titles(found), ["Interferon rises before autoantibodies", "A cohort of 200 patients"]);
  assert.equal(found.textReady, true);
  assert.deepEqual(found.hits[0]!.titleMarks, [[0, 10]]);
  assert.equal(found.hits[1]!.match?.field, "text");
  assert.match(found.hits[1]!.match!.snippet, /Serum interferon was measured/);
  const [start, end] = found.hits[1]!.match!.marks[0]!;
  assert.equal(found.hits[1]!.match!.snippet.slice(start, end), "interferon");

  assert.deepEqual(titles(await call("search.query", { text: "interferon cohort", limit: 10 })), ["A cohort of 200 patients"]);
  assert.deepEqual(titles(await call("search.query", { text: "interferon nowhere", limit: 10 })), []);
  // Only the parts asked for are read.
  assert.deepEqual(titles(await call("search.query", { text: "serum", fields: ["title"], limit: 10 })), []);
});

test("a note edited in the base is searched by its new words", async () => {
  const { call, type, write, settle } = await setup();
  await call("node.create", { title: "A protocol", type: type("evidence") });
  write("A protocol", "Spin at 400 g.");
  assert.equal((await call("search.query", { text: "centrifuge", limit: 5 })).total, 0);
  write("A protocol", "Centrifuge at 400 g for ten minutes.");
  await settle();
  assert.deepEqual(titles(await call("search.query", { text: "centrifuge", limit: 5 })), ["A protocol"]);
});

test("a PDF passage is searched, and filters by type and by person count what the words matched", async () => {
  const { call, core, type, store, emit, settle } = await setup();
  // A highlight without a real PDF: the passage lives on the unit.
  const staged = createNode({ space: "here", by: { id: core.identity().did, name: "Me" }, title: "Mediators climb", type: type("evidence"), facts: { anchor: { exact: "IFN-α was elevated three years before diagnosis" } } } as never);
  await core.createLab("Home Lab");
  const ana = { space: "their-space", by: { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ana Ruiz" }, lab: core.identity().lab!.did };
  const theirs = createNode({ ...ana, title: "IFN signature in siblings", type: type("claim") });
  store.records.push(staged, theirs);
  emit({ type: "records-changed" });
  await settle();

  const all = await call("search.query", { text: "ifn", limit: 10 });
  assert.deepEqual(titles(all).sort(), ["IFN signature in siblings", "Mediators climb"]);
  const passage = all.hits.find((hit) => hit.node.title === "Mediators climb")!;
  assert.equal(passage.match?.field, "passage");
  assert.deepEqual(all.types.map((facet) => [facet.label, facet.count]).sort(), [["Claim", 1], ["Evidence", 1]]);
  const ruiz = all.credits.find((credit) => credit.label === "Ana Ruiz")!;
  assert.equal(ruiz.kind, "person");
  assert.ok(all.credits.find((credit) => credit.mine));

  const onlyAna = await call("search.query", { text: "ifn", credits: [ruiz.id], limit: 10 });
  assert.deepEqual(titles(onlyAna), ["IFN signature in siblings"]);
  // Facets still show everything the words found, so a person can switch filters.
  assert.equal(onlyAna.types.length, 2);
  assert.deepEqual(titles(await call("search.query", { text: "ifn", types: [type("evidence")], limit: 10 })), ["Mediators climb"]);
  assert.equal((await call("search.query", { text: "ifn", fields: ["title", "text"], limit: 10 })).total, 1);
});

test("an empty search lists the newest work first, and results say which canvases hold them", async () => {
  const { call, type } = await setup();
  const first = await call("node.create", { title: "Older", type: type("claim") });
  // A real wait: the two units have to be made at different times to be put in order.
  await new Promise((done) => setTimeout(done, 5));
  await call("node.create", { title: "Newer", type: type("claim") });
  const canvas = await call("canvas.create", { title: "Argument" });
  await call("units.put", { canvas: canvas.id, nodes: [first.id] });
  const listed = await call("search.query", { limit: 10 });
  assert.deepEqual(titles(listed), ["Newer", "Older"]);
  assert.deepEqual(listed.hits[1]!.canvases, [{ id: canvas.id, title: "Argument" }]);
});

test("search sorts by title or by when units were made", async () => {
  const { call, type } = await setup();
  await call("node.create", { title: "Beta", type: type("claim") });
  // A real wait: the two units have to be made at different times to be put in order.
  await new Promise((done) => setTimeout(done, 5));
  await call("node.create", { title: "Alpha", type: type("claim") });
  assert.deepEqual(titles(await call("search.query", { sort: "title", limit: 10 })), ["Alpha", "Beta"]);
  assert.deepEqual(titles(await call("search.query", { sort: "created", limit: 10 })), ["Alpha", "Beta"]);
  const canvas = await call("canvas.create", { title: "Where" });
  const beta = (await call("search.query", { text: "beta", limit: 1 })).hits[0]!;
  await call("units.put", { canvas: canvas.id, nodes: [beta.node.id] });
  assert.deepEqual((await call("search.query", { text: "beta", limit: 1 })).hits[0]!.canvases, [{ id: canvas.id, title: "Where" }]);
});

test("the quick finder hands its search to the panel, once", async () => {
  const { call, events, opened } = await setup();
  await call("search.show", { query: { text: "interferon", types: ["none"] } });
  assert.deepEqual(opened.at(-1), { route: { surface: "search" }, placement: "side" });
  assert.deepEqual(events.find((event) => event.event === "search-set"), { event: "search-set", query: { text: "interferon", types: ["none"] } });
  assert.deepEqual(await call("search.take", {}), { text: "interferon", types: ["none"] });
  assert.equal(await call("search.take", {}), null);
});

test("a person renames their own unit and its note, but not a teammate's", async () => {
  let refuse = false;
  const { call, core, type, store, emit, settle, refOf } = await setup({
    // A base refuses a name another note already has.
    renameText: async (args) => (refuse ? fail("conflict", "Taken") : memoryRename!(args)),
  });
  const memoryRename: Host["renameText"] | undefined = createMemoryHost({ store }).host.renameText;
  const mine = await call("node.create", { title: "Old wording", type: type("claim") });
  assert.equal(mine.mine, true);
  const ref = refOf("Old wording");
  const renamed = await call("node.rename", { id: mine.id, title: "  New   wording " });
  assert.equal(renamed.title, "New wording");
  assert.equal(store.texts.get(ref)!.title, "CLM - New wording");
  await settle();
  assert.equal(core.nodeTypes().length > 0, true);
  assert.deepEqual(titles(await call("search.query", { text: "wording", limit: 5 })), ["New wording"]);

  refuse = true;
  await assert.rejects(call("node.rename", { id: mine.id, title: "Taken" }), /already a note called "Taken"/);
  refuse = false;
  assert.equal((await call("node.view", { id: mine.id })).node.title, "New wording");
  await assert.rejects(call("node.rename", { id: mine.id, title: "   " }), /needs a title/);

  const theirs = createNode({ space: "their-space", by: { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ana Ruiz" }, title: "Ana's claim" });
  store.records.push(theirs);
  emit({ type: "records-changed" });
  await settle();
  const view = await call("node.view", { id: theirs.id });
  assert.equal(view.node.mine, undefined);
  await assert.rejects(call("node.rename", { id: theirs.id, title: "Mine now" }), /Only Ana Ruiz can rename/);
  void createLab;
});

test("a type can be taken away again, for undo, and the note loses its prefix", async () => {
  const { call, type, store, refOf } = await setup();
  const made = await call("node.create", { title: "Typed" });
  const ref = refOf("Typed");
  await call("node.setType", { id: made.id, type: type("claim") });
  assert.equal(store.texts.get(ref)!.title, "CLM - Typed");
  const back = await call("node.setType", { id: made.id, type: null });
  assert.equal(back.type, undefined);
  assert.equal(store.texts.get(ref)!.title, "Typed");
});

test("a link to a unit goes in at the cursor, and only for a unit with a note", async () => {
  const { call, core, type, store, refOf, settle } = await setup();
  const target = await call("node.create", { title: "Linked claim", type: type("claim") });
  await call("node.create", { title: "Writing here", type: type("question") });
  store.cursor = refOf("Writing here");
  await call("node.insertLink", { id: target.id });
  assert.match(store.texts.get(refOf("Writing here"))!.body, /\[\[CLM - Linked claim\]\]/);
  const staged = createNode({ space: "here", by: { id: core.identity().did, name: "Me" }, title: "No note", facts: { anchor: { exact: "words" } } } as never);
  store.records.push(staged);
  await settle();
  await assert.rejects(call("node.insertLink", { id: staged.id }), /no note/);
});

test("units put on a canvas from search go beside what's there, and ones already on it are lit", async () => {
  const { call, type, store, events } = await setup();
  const a = await call("node.create", { title: "Claim A", type: type("claim") });
  const b = await call("node.create", { title: "Evidence B", type: type("evidence") });
  const canvas = await call("canvas.create", { title: "Board" });
  await call("relation.assert", { type: (await call("relation.options", { source: b.id, target: a.id }))[0]!.type, source: b.id, target: a.id });
  const first = await call("units.put", { canvas: canvas.id, nodes: [a.id] });
  assert.deepEqual(first, { placed: [a.id], already: [] });
  const second = await call("units.put", { canvas: canvas.id, nodes: [a.id, b.id] });
  assert.deepEqual(second, { placed: [b.id], already: [a.id] });
  const items = new Map<string, CanvasItemRecord>();
  for (const record of store.records as DgRecord[]) if (record.kind === "canvas-item" && record.canvas === canvas.id) items.set(record.id, record);
  const cards = [...items.values()].filter((item) => "dg" in item.item && (item.item as { dg?: { node?: string } }).dg?.node);
  const edges = [...items.values()].filter((item) => "fromNode" in item.item);
  assert.equal(cards.length, 2);
  assert.equal(edges.length, 1, "the relation between them comes along");
  const [cardA, cardB] = [a.id, b.id].map((id) => cards.find((card) => (card.item as { dg: { node: string } }).dg.node === id)!.item as { x: number; y: number });
  assert.ok(cardB!.x > cardA!.x, "the new card sits to the right of what's there");
  assert.ok(events.some((event) => event.event === "units-placed" && event.units.includes(b.id)));
  assert.ok(events.some((event) => event.event === "highlight" && event.units.includes(a.id)));
});

test("a relation says whether this person asserted it", async () => {
  const { call, type } = await setup();
  const a = await call("node.create", { title: "A", type: type("claim") });
  const b = await call("node.create", { title: "B", type: type("evidence") });
  const canvas = await call("canvas.create", { title: "Mine" });
  await call("relation.assert", { type: (await call("relation.options", { source: b.id, target: a.id }))[0]!.type, source: b.id, target: a.id });
  await call("units.put", { canvas: canvas.id, nodes: [a.id, b.id] });
  const view = await call("canvas.open", { id: canvas.id });
  assert.equal(Object.values(view.relations)[0]!.mine, true);
});
