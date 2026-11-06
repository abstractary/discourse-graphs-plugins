import assert from "node:assert/strict";
import test from "node:test";
import { createCore, type Core } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import { assertRelation, createCanvasItem, createLab, createNode, defaultGrammar, type DgId, type NodeTypeRecord } from "@dg/contract/records.ts";
import type { Host } from "@dg/contract/host.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async (wrap: (host: Host) => Host = (host) => host): Promise<{ core: Core; call: Call; store: MemoryStore; host: Host; emit: (event: Parameters<ReturnType<typeof createMemoryHost>["emit"]>[0]) => void; events: SurfaceMessage[]; type: (base: string) => DgId; relation: (base: string) => DgId }> => {
  const store = createMemoryStore();
  const { host, emit } = createMemoryHost({ store });
  const core = await createCore({ host: wrap(host) });
  const events: SurfaceMessage[] = [];
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("event" in message) events.push(message);
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
  const grammar = await call("grammar.get", {});
  return {
    core, call, store, host, emit, events,
    type: (base) => (grammar.nodeTypes.find((item: NodeTypeRecord) => item.base === base))!.id,
    relation: (base) => grammar.relationTypes.find((item) => item.base === base)!.id,
  };
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

test("a new space gets the default grammar once", async () => {
  const { store, host } = await setup();
  const count = store.records.filter((record) => record.kind === "node-type").length;
  assert.equal(count, 4);
  await createCore({ host });
  assert.equal(store.records.filter((record) => record.kind === "node-type").length, 4);
});

test("creating a node writes text, a node and an anchor", async () => {
  const { call, type, store } = await setup();
  const node = await call("node.create", { title: "Actin scales", type: type("claim") });
  assert.equal(node.title, "Actin scales");
  assert.equal(node.abbreviation, "CLM");
  assert.equal(node.hasText, true);
  assert.deepEqual([...store.texts.values()].map((text) => text.title), ["CLM - Actin scales"]);
});

test("relation options follow the grammar in both directions", async () => {
  const { call, type, relation } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const forward = await call("relation.options", { source: evidence.id, target: claim.id });
  assert.deepEqual(forward.map((option) => [option.label, option.flipped]).sort(), [["Opposes", false], ["Supports", false]]);
  const backward = await call("relation.options", { source: claim.id, target: evidence.id });
  assert.deepEqual(backward.map((option) => [option.label, option.flipped]).sort(), [["Opposed by", true], ["Supported by", true]]);
  await assert.rejects(call("relation.assert", { type: relation("supports"), source: claim.id, target: evidence.id }));
});

test("an untyped node offers no relations until it has a type", async () => {
  const { call, type, store } = await setup();
  const thought = await call("node.create", { title: "A thought" });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  assert.deepEqual(await call("relation.options", { source: thought.id, target: claim.id }), []);
  await call("node.setType", { id: thought.id, type: type("evidence") });
  assert.equal((await call("relation.options", { source: thought.id, target: claim.id })).length, 2);
  assert.ok([...store.texts.values()].some((text) => text.title === "EVD - A thought"));
});

test("asserting the same relation twice stores it once", async () => {
  const { call, type, relation, store } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const args = { type: relation("supports"), source: evidence.id, target: claim.id };
  const first = await call("relation.assert", args);
  const second = await call("relation.assert", args);
  assert.equal(first.id, second.id);
  assert.equal(store.records.filter((record) => record.kind === "relation").length, 1);
});

test("moving one card writes one record", async () => {
  const { call, store } = await setup();
  const canvas = await call("canvas.create", { title: "Map" });
  const box = { type: "text", text: "x", y: 0, width: 100, height: 50 } as const;
  const { ids } = await call("canvas.write", { canvas: canvas.id, upserts: [{ item: { ...box, x: 0 }, z: 1 }, { item: { ...box, x: 200 }, z: 2 }] });
  const before = store.records.length;
  await call("canvas.write", { canvas: canvas.id, upserts: [{ id: ids[0]!, item: { ...box, x: 40 }, z: 1 }, { id: ids[1]!, item: { ...box, x: 200 }, z: 2 }] });
  assert.equal(store.records.length, before + 1);
  const view = await call("canvas.open", { id: canvas.id });
  assert.equal((view.items.find((entry) => entry.id === ids[0])!.item as { x: number }).x, 40);
});

test("removing an edge from a canvas leaves the relation standing", async () => {
  const { call, type, relation, core } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const assertion = await call("relation.assert", { type: relation("supports"), source: evidence.id, target: claim.id });
  const canvas = await call("canvas.create", { title: "Map" });
  const box = { type: "text", y: 0, width: 100, height: 50 } as const;
  const cards = await call("canvas.write", { canvas: canvas.id, upserts: [
    { item: { ...box, x: 0, text: "E", dg: { node: evidence.id } }, z: 1 },
    { item: { ...box, x: 200, text: "C", dg: { node: claim.id } }, z: 2 },
  ] });
  const edge = await call("canvas.write", { canvas: canvas.id, upserts: [{ item: { fromNode: cards.ids[0]!, toNode: cards.ids[1]!, dg: { relation: assertion.id } }, z: 3 }] });
  assert.equal((await call("canvas.open", { id: canvas.id })).relations[assertion.id]?.label, "Supports");
  await call("canvas.write", { canvas: canvas.id, removes: [edge.ids[0]!] });
  assert.equal((await call("canvas.open", { id: canvas.id })).items.length, 2);
  assert.equal(core.graph().relations.get(assertion.id)?.state, "active");
});

test("strokes persist but stay out of plain JSON Canvas", async () => {
  const { call } = await setup();
  const canvas = await call("canvas.create", { title: "Map" });
  await call("canvas.write", { canvas: canvas.id, upserts: [
    { item: { type: "stroke", x: 1, y: 2, width: 30, height: 40, path: "M0 0 L30 40" }, z: 1 },
    { item: { type: "text", text: "note", x: 0, y: 0, width: 100, height: 50 }, z: 2 },
  ] });
  assert.equal((await call("canvas.open", { id: canvas.id })).items.length, 2);
  const doc = await call("canvas.export", { id: canvas.id });
  assert.deepEqual(doc.nodes.map((node) => node.type), ["text"]);
});

test("a rename in the base reaches the node and any open surface", async () => {
  const { call, type, store, emit, events } = await setup();
  const node = await call("node.create", { title: "Old", type: type("claim") });
  const [ref] = [...store.texts.keys()];
  events.length = 0;
  store.texts.get(ref!)!.title = "CLM - New";
  emit({ type: "text-renamed", ref: ref!, title: "CLM - New" });
  await settle();
  assert.equal((await call("node.view", { id: node.id })).node.title, "New");
  assert.ok(events.some((event) => "event" in event && event.event === "graph-changed"));
});

test("a rename that drops the prefix keeps the whole title", async () => {
  const { call, type, store, emit } = await setup();
  const node = await call("node.create", { title: "Old", type: type("claim") });
  const [ref] = [...store.texts.keys()];
  emit({ type: "text-renamed", ref: ref!, title: "Something else" });
  await settle();
  assert.equal((await call("node.view", { id: node.id })).node.title, "Something else");
});

test("records from elsewhere arrive through the cursor", async () => {
  const { call, core, store, emit, events } = await setup();
  const canvas = await call("canvas.create", { title: "Map" });
  events.length = 0;
  const other = { space: core.info.space.id, by: { id: "teammate", name: "T" } };
  store.records.push(createCanvasItem({ ...other, canvas: canvas.id, z: 9, item: { type: "text", text: "from elsewhere", x: 5, y: 5, width: 100, height: 50 } }));
  emit({ type: "records-changed" });
  await settle();
  assert.equal((await call("canvas.open", { id: canvas.id })).items.length, 1);
  assert.ok(events.some((event) => "event" in event && event.event === "graph-changed"));
});

test("a removed text is reported without losing the node", async () => {
  const { call, type, store, emit } = await setup();
  const node = await call("node.create", { title: "Gone", type: type("claim") });
  const [ref] = [...store.texts.keys()];
  store.texts.delete(ref!);
  emit({ type: "text-removed", ref: ref! });
  await settle();
  const view = await call("node.view", { id: node.id });
  assert.equal(view.node.hasText, false);
  assert.equal(view.body, null);
});

test("a text that comes back clears the warning on open surfaces", async () => {
  const { call, type, store, emit, events } = await setup();
  const node = await call("node.create", { title: "Back", type: type("claim") });
  const [ref] = [...store.texts.keys()];
  emit({ type: "text-removed", ref: ref! });
  await settle();
  assert.equal((await call("node.view", { id: node.id })).node.hasText, false);
  events.length = 0;
  emit({ type: "text-renamed", ref: ref!, title: "CLM - Back" });
  await settle();
  assert.equal((await call("node.view", { id: node.id })).node.hasText, true);
  assert.ok(events.some((event) => "event" in event && event.event === "graph-changed"));
});

test("a grammar seeded twice, as two offline devices would, shows each type once", async () => {
  const { call, core, store, emit, type } = await setup();
  const other = defaultGrammar({ space: "second-device", by: { id: "did:plc:seconddevice", name: "Me" } });
  store.records.push(...other);
  emit({ type: "records-changed" });
  await settle();
  assert.equal(core.nodeTypes().length, 4);
  const { nodeTypes, relationTypes } = await call("grammar.get", {});
  assert.equal(nodeTypes.length, 4);
  assert.equal(relationTypes.length, 5);
  const secondClaim = other.find((item) => item.label === "Claim")!;
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: secondClaim.id });
  const options = await call("relation.options", { source: evidence.id, target: claim.id });
  assert.deepEqual(options.map((option) => option.label).sort(), ["Opposes", "Supports"]);
});

test("nodes from another space match the grammar by base type", async () => {
  const { call, core, store, emit, type } = await setup();
  const foreign = { space: "partner", by: { id: "p", name: "P" } };
  const theirs = createNode({ ...foreign, title: "Their evidence", type: "partner-evidence-type" });
  store.records.push({ ...theirs });
  store.records.push({ v: 2, id: "partner-evidence-type", kind: "node-type", space: "partner", at: theirs.at, by: foreign.by, rev: 2, editedAt: theirs.at, editedBy: foreign.by, label: "Result", base: "evidence" } as NodeTypeRecord);
  emit({ type: "records-changed" });
  await settle();
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const options = await call("relation.options", { source: theirs.id, target: claim.id });
  assert.deepEqual(options.map((option) => option.label).sort(), ["Opposes", "Supports"]);
  assert.equal((await call("node.view", { id: theirs.id })).node.hasText, false);
  assert.equal(core.badgeFor({ ref: "nothing" }), null);
});

test("badges are ready synchronously, and count only active relations", async () => {
  const { call, core, type, relation, store } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const ref = [...store.texts.keys()][0]!;
  assert.equal(core.badgeFor({ ref })?.count, 0);
  const made = await call("relation.assert", { type: relation("supports"), source: evidence.id, target: claim.id });
  const badge = core.badgeFor({ ref });
  assert.equal(badge?.count, 1);
  assert.equal(badge?.node, evidence.id);
  assert.equal(badge?.base, "evidence");
  await call("relation.withdraw", { id: made.id });
  assert.equal(core.badgeFor({ ref })?.count, 0);
});

test("a person can turn badges off, and the choice stays on this device", async () => {
  const { call, core, type, host, store } = await setup();
  await call("node.create", { title: "E", type: type("evidence") });
  const ref = [...store.texts.keys()][0]!;
  let changes = 0;
  core.onGraphChange(() => {
    changes += 1;
  });
  assert.equal(await core.toggleBadges(), false);
  assert.equal(core.badgeFor({ ref }), null);
  assert.equal(changes, 1);
  const again = await createCore({ host });
  assert.equal(again.badgeFor({ ref }), null);
  again.stop();
  assert.equal(await core.toggleBadges(), true);
  assert.notEqual(core.badgeFor({ ref }), null);
});

test("a badge opens the context panel on its node without moving the page", async () => {
  const opened: unknown[] = [];
  const { call, core, type, store } = await setup((host) => ({
    ...host,
    openSurface: async (args) => {
      opened.push(args);
      return host.openSurface(args);
    },
  }));
  const first = await call("node.create", { title: "First", type: type("claim") });
  const second = await call("node.create", { title: "Second", type: type("claim") });
  const secondRef = [...store.texts.keys()][1]!;
  await call("focus.set", { node: first.id });
  const shown = await core.showContext({ ref: secondRef });
  assert.equal(shown.ok, true);
  assert.deepEqual(opened, [{ route: { surface: "context" }, placement: "side" }]);
  assert.equal(await call("focus.get", {}), second.id);
  assert.equal((await core.showContext({ ref: "nothing" })).ok, false);
});

test("a type shared by another lab never changes how titles are written here", async () => {
  const { call, core, store, emit, type } = await setup();
  const ours = type("claim");
  const older = "2000-01-01T00:00:00.000Z";
  const stamp = { space: "their-space", by: { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ana" }, at: older };
  const theirs = defaultGrammar({ ...stamp, titleFormat: (abbreviation: string) => `[[${abbreviation}]] - {content}` } as never);
  store.records.push(...theirs.map((record) => ({ ...record, at: older })));
  emit({ type: "records-changed" });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(core.nodeTypes().find((item) => item.label === "Claim")?.id, ours);
  const made = await call("node.create", { title: "Local format", type: core.nodeTypes().find((item) => item.label === "Claim")!.id });
  assert.ok(![...store.texts.values()].some(({ title }) => title.startsWith("[[")), made.title);
});

test("credit shows the contributor inside a lab, and the lab from outside it", async () => {
  const { call, core, type, emit, store } = await setup();
  const mine = await call("node.create", { title: "Mine", type: type("claim") });
  assert.deepEqual([mine.credit.kind, mine.credit.id], ["person", core.identity().did]);
  await core.createLab("Home Lab");
  const home = core.identity().lab!.did;
  const stamp = { space: "their-space", by: { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ana Ruiz" } };
  const colleague = createNode({ ...stamp, lab: home, title: "From a colleague" });
  const stranger = createNode({ ...stamp, lab: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", title: "From another lab" });
  const lab = { ...createLab({ ...stamp, name: "Away Lab", did: "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb", custodian: stamp.by.id, custodianKey: "did:key:z", plc: [] }) };
  const solo = createNode({ ...stamp, title: "From someone with no lab" });
  store.records.push(colleague, stranger, lab, solo);
  emit({ type: "records-changed" });
  await new Promise((done) => setTimeout(done, 20));
  const credit = async (title: string) => (await call("node.query", { text: title, limit: 1 }))[0]!.credit;
  assert.deepEqual([(await credit("colleague")).kind, (await credit("colleague")).name], ["person", "Ana Ruiz"]);
  assert.deepEqual([(await credit("another lab")).kind, (await credit("another lab")).name], ["lab", "Away Lab"]);
  assert.equal((await credit("no lab")).kind, "person");
});

test("a new name reaches work done before it was set", async () => {
  const { call, core, type } = await setup();
  const before = await call("node.create", { title: "Early", type: type("claim") });
  await core.setName("Dana Lee");
  assert.equal((await call("node.query", { text: "Early", limit: 1 }))[0]!.credit.name, "Dana Lee");
  assert.equal(core.personName(), "Dana Lee");
  const stored = core.graph().documents.get(before.id) as { by: { name: string } };
  assert.notEqual(stored.by.name, "Dana Lee", "the record itself is history, and stays as it was");
});

test("a canvas gets its own text, and renaming that text renames the canvas", async () => {
  const { call, core, store, emit } = await setup();
  const canvas = await call("canvas.create", { title: "Findings" });
  const home = await core.canvasHome({ id: canvas.id });
  assert.equal(home.ok, true);
  if (!home.ok) return;
  assert.equal(store.texts.get(home.value)?.title, "Canvas - Findings");
  assert.equal(core.canvasOfRef({ ref: home.value }), canvas.id);
  assert.equal(core.badgeFor({ ref: home.value }), null, "a canvas isn't a node");
  emit({ type: "text-renamed", ref: home.value, title: "Canvas - New name" });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(core.canvasTitle({ id: canvas.id }), "New name");
});

test("two canvases can share a name without sharing a home", async () => {
  const { call, core } = await setup();
  const [a, b] = [await call("canvas.create", { title: "Same" }), await call("canvas.create", { title: "Same" })];
  const [first, second] = [await core.canvasHome({ id: a.id }), await core.canvasHome({ id: b.id })];
  assert.ok(first.ok && second.ok && first.value !== second.value);
});

test("removing examples takes back only what they made", async () => {
  const { call, core, type, store } = await setup();
  const keep = await call("node.create", { title: "Keep me", type: type("claim") });
  const made = await call("node.create", { title: "Example", type: type("claim") });
  const canvas = await call("canvas.create", { title: "Example canvas" });
  const texts = store.texts.size;
  await core.removeExamples({ texts: [], nodes: [made.id], relations: [], canvases: [canvas.id] });
  assert.equal(store.texts.size, texts - 2);
  assert.deepEqual((await call("node.query", { limit: 10 })).map(({ id }) => id), [keep.id]);
  assert.deepEqual(await call("canvas.list", {}), []);
  assert.ok(!(await core.atRecords()).some(({ uri }) => uri.endsWith(made.id.split("#")[1]!)));
});

test("a saved layout travels with the canvas", async () => {
  const { call } = await setup();
  const canvas = await call("canvas.create", { title: "Laid out" });
  await call("canvas.setLayout", { id: canvas.id, layout: { mode: "timeline" } });
  assert.equal((await call("canvas.open", { id: canvas.id })).canvas.layout?.mode, "timeline");
  const [summary] = await call("canvas.summaries", {});
  assert.equal(summary?.title, "Laid out");
});

test("the usage log holds operations and never content", async () => {
  const { call, core, host, type } = await setup();
  await call("node.create", { title: "Unpublished finding", type: type("claim") });
  await core.flushUsage();
  const stored = await host.getLocal({ key: "usage" });
  assert.ok(stored.ok);
  const text = JSON.stringify(stored.ok ? stored.value : null);
  assert.ok(text.includes("surface:node.create"));
  assert.ok(text.includes("createText"));
  assert.ok(!text.includes("Unpublished"));
});

test("the surface never receives a host ref", async () => {
  const { call, type, relation, store } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  await call("relation.assert", { type: relation("supports"), source: evidence.id, target: claim.id });
  const seen = JSON.stringify([await call("node.view", { id: claim.id }), await call("node.query", { limit: 10 })]);
  for (const ref of store.texts.keys()) assert.ok(!seen.includes(ref));
});

test("a remounted panel can return to the last canvas", async () => {
  const { call, host } = await setup();
  const first = await call("canvas.create", { title: "One" });
  const second = await call("canvas.create", { title: "Two" });
  assert.equal(await call("canvas.last", {}), null);
  await call("canvas.open", { id: second.id });
  assert.equal(await call("canvas.last", {}), second.id);
  await call("canvas.open", { id: first.id });
  await call("canvas.open", { id: second.id });
  const again = await createCore({ host });
  const stored = await host.getLocal({ key: "last-canvas" });
  assert.ok(stored.ok && stored.value === second.id);
  assert.equal(again.graph().documents.has(second.id), true);
});

test("records made elsewhere stay pending until accepted", async () => {
  const { call, core, store, emit, type, relation } = await setup();
  const evidence = await call("node.create", { title: "E", type: type("evidence") });
  const claim = await call("node.create", { title: "C", type: type("claim") });
  const theirs = assertRelation({ space: "partner", by: { id: "p", name: "P" }, type: relation("supports"), source: evidence.id, target: claim.id });
  store.records.push(theirs);
  emit({ type: "records-changed" });
  await settle();
  assert.equal(core.graph().relations.get(theirs.id)?.state, "pending");
  await call("relation.decide", { id: theirs.id, decision: "accepted" });
  assert.equal(core.graph().relations.get(theirs.id)?.state, "active");
});

