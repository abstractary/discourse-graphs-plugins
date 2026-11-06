import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Lexicons } from "@atproto/lexicon";
import { createCore } from "@dg/core/index.ts";
import { memoryKeys } from "@dg/core/identity.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { assertRelation, createCanvas, createCanvasItem, revise } from "@dg/contract/records.ts";
import { atUriOf, cidOf, toAtRecord, unitIdOf } from "@dg/contract/atproto.ts";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const lexicons = (): Lexicons => {
  const lex = new Lexicons();
  for (const file of walk("lexicons").filter((path) => path.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { lexicon?: number };
    if (doc.lexicon) lex.add(doc as never);
  }
  return lex;
};

const setup = async () => {
  const store = createMemoryStore();
  const ready = await createCore({ host: createMemoryHost({ store }).host, keys: memoryKeys() });
  return { store, ready };
};

const typed = (ready: Awaited<ReturnType<typeof setup>>["ready"], label: string): string =>
  ready.nodeTypes().find((type) => type.label === label)!.id;

test("every record a person can make validates against its lexicon", async () => {
  const { ready } = await setup();
  await ready.createLab("Akamatsu Lab");
  const claim = await ready.capture({ text: "Actin tracks tension", type: typed(ready, "Claim") });
  const evidence = await ready.capture({ text: "Actin rose 2x", type: typed(ready, "Evidence") });
  await ready.capture({ text: "A question", type: typed(ready, "Question") });
  await ready.capture({ text: "A paper", type: typed(ready, "Source") });
  await ready.capture({ text: "A loose thought" });
  assert.ok(claim.ok && evidence.ok);
  const lex = lexicons();
  const records = await ready.atRecords();
  const collections = new Set(records.map((record) => record.collection));
  for (const expected of [
    "science.mira.claim",
    "science.mira.evidence",
    "science.mira.question",
    "science.mira.sourceDocument",
    "org.discoursegraphs.draft",
    "org.discoursegraphs.nodeType",
    "org.discoursegraphs.relationType",
    "org.discoursegraphs.lab",
    "org.discoursegraphs.membership",
    "org.discoursegraphs.person",
  ]) {
    assert.ok(collections.has(expected), expected);
  }
  for (const record of records) lex.assertValidRecord(record.collection, record.value);
});

test("relations become science.mira.relation, and proposals say they aren't asserted", async () => {
  const { ready, store } = await setup();
  const graph = ready.graph();
  const supports = [...graph.documents.values()].find((item) => item.kind === "relation-type" && item.base === "supports")!;
  const stamp = { space: "s", by: { id: ready.identity().did, name: "A" } };
  const a = await ready.capture({ text: "A", type: typed(ready, "Evidence") });
  const b = await ready.capture({ text: "B", type: typed(ready, "Claim") });
  assert.ok(a.ok && b.ok);
  const relation = assertRelation({ ...stamp, type: supports.id, source: a.value.node, target: b.value.node, proposed: true });
  store.records.push(relation);
  const after = ready.graph();
  const projected = toAtRecord(relation, after)!;
  assert.equal(projected.collection, "science.mira.relation");
  assert.equal(projected.value.predicate, "supports");
  assert.deepEqual(projected.value.source, { uri: atUriOf(a.value.node, after) });
  assert.equal((projected.value.provenance as { method: string }).method, "imported");
  lexicons().assertValidRecord(projected.collection, projected.value);
});

test("anchors stay local and never become AT records", async () => {
  const { ready } = await setup();
  await ready.capture({ text: "Local link" });
  const records = await ready.atRecords();
  assert.ok(records.every((record) => !record.collection.includes("anchor")));
  assert.ok([...ready.graph().documents.values()].some((item) => item.kind === "anchor"));
});

test("typing a node moves its collection and keeps its id and record key", async () => {
  const { ready } = await setup();
  const captured = await ready.capture({ text: "A loose thought" });
  assert.ok(captured.ok);
  const { node: id } = captured.value;
  const before = atUriOf(id, ready.graph())!;
  assert.ok(before.includes("/org.discoursegraphs.draft/"));
  const node = ready.graph().documents.get(id)!;
  const after = revise({ record: node as never, changes: { type: typed(ready, "Claim") } as never, by: node.by });
  const graph = { ...ready.graph(), documents: new Map(ready.graph().documents).set(id, after as never) };
  const moved = atUriOf(id, graph)!;
  assert.ok(moved.includes("/science.mira.claim/"));
  assert.equal(moved.split("/").pop(), before.split("/").pop());
  assert.equal(unitIdOf(moved), id);
});

test("canvases round out as records, and their items stay integers", async () => {
  const { ready } = await setup();
  const stamp = { space: "s", by: { id: ready.identity().did, name: "A" } };
  const canvas = createCanvas({ ...stamp, title: "Findings" });
  const item = createCanvasItem({ ...stamp, canvas: canvas.id, z: 1, item: { type: "text", text: "x", x: 1, y: 2, width: 3, height: 4 } });
  const graph = { ...ready.graph(), documents: new Map(ready.graph().documents).set(canvas.id, canvas).set(item.id, item) };
  const lex = lexicons();
  for (const record of [canvas, item]) {
    const projected = toAtRecord(record, graph)!;
    lex.assertValidRecord(projected.collection, projected.value);
  }
});

test("CIDs follow the repo format, and change when content does", async () => {
  const first = await cidOf({ $type: "science.mira.claim", title: "A", createdAt: "2026-11-06T00:00:00.000Z" });
  const second = await cidOf({ $type: "science.mira.claim", title: "B", createdAt: "2026-11-06T00:00:00.000Z" });
  assert.match(first, /^bafyrei/);
  assert.notEqual(first, second);
});

test("the published MATSUlab records read in, and go back out in the same collections", async () => {
  const { ready } = await setup();
  const folder = "test/fixtures/matsulab-records";
  const published = readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => JSON.parse(readFileSync(join(folder, name), "utf8")) as { uri: string; cid: string; value: Record<string, unknown> }[]);
  assert.equal(published.length, 20);
  const added = await ready.importAtRecords(published);
  assert.ok(added >= 20);
  const graph = ready.graph();
  const nodes = [...graph.documents.values()].filter((item) => item.kind === "node");
  assert.equal(nodes.length, 20);
  assert.ok(nodes.every((node) => !node.title.startsWith("[[")));
  const lex = lexicons();
  for (const { uri } of published) {
    const id = unitIdOf(uri);
    const node = graph.documents.get(id);
    assert.ok(node, uri);
    const projected = toAtRecord(node, graph)!;
    assert.equal(projected.uri, uri, "same address out as in");
    lex.assertValidRecord(projected.collection, projected.value);
  }
  const states = [...graph.relations.values()].map(({ state }) => state);
  assert.ok(states.length >= 12, `${states.length} relations`);
  assert.ok(states.every((state) => state === "pending"), "someone else's relations wait for review");
  assert.equal(await ready.importAtRecords(published), 0, "reading twice adds nothing");
});
