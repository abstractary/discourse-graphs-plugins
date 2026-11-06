import assert from "node:assert/strict";
import test from "node:test";
import type { Host } from "@dg/contract/host.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import {
  assertRelation,
  createAnchor,
  createCanvas,
  createCanvasItem,
  createNode,
  decide,
  defaultGrammar,
  foldRecords,
  retract,
  revise,
  type DgRecord,
  type NodeRecord,
  type NodeTypeRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";

const value = <T>(result: { ok: true; value: T } | { ok: false }): T => {
  assert.ok(result.ok);
  return result.value;
};

const readAll = async (host: Host): Promise<DgRecord[]> =>
  value(await host.listRecords({ limit: 1000 })).items;

/** Everything goes through the contract, so it can't depend on which base is underneath. */
const journey = async (host: Host): Promise<unknown> => {
  const info = value(await host.describe());
  const stamp = { space: info.space.id, by: info.person };
  const grammar = defaultGrammar(stamp);
  value(await host.putRecords({ records: grammar }));
  const nodeType = (label: string): NodeTypeRecord =>
    grammar.find((item) => item.label === label) as NodeTypeRecord;
  const relationType = (label: string): RelationTypeRecord =>
    grammar.find((item) => item.label === label) as RelationTypeRecord;

  const capture = async (title: string, type?: string): Promise<{ node: NodeRecord; ref: string }> => {
    const text = value(await host.createText({ title }));
    const node = createNode({ ...stamp, title: text.title, ...(type ? { type } : {}) });
    value(await host.putRecords({ records: [node, createAnchor({ ...stamp, node: node.id, ref: text.ref })] }));
    return { node, ref: text.ref };
  };

  const thought = await capture("Actin rises with tension");
  const evidence = await capture("EVD - Actin rose 2x", nodeType("Evidence").id);

  const typed = revise({ record: thought.node, changes: { type: nodeType("Claim").id }, by: info.person });
  value(await host.putRecords({ records: [typed] }));

  const supports = assertRelation({ ...stamp, type: relationType("Supports").id, source: evidence.node.id, target: thought.node.id });
  const canvas = createCanvas({ ...stamp, title: "Tension map" });
  const box = { type: "text", y: 0, width: 240, height: 80 } as const;
  const cardA = createCanvasItem({ ...stamp, canvas: canvas.id, z: 1, item: { ...box, x: 0, text: typed.title, dg: { node: typed.id } } });
  const cardB = createCanvasItem({ ...stamp, canvas: canvas.id, z: 2, item: { ...box, x: 320, text: evidence.node.title, dg: { node: evidence.node.id } } });
  const line = createCanvasItem({ ...stamp, canvas: canvas.id, z: 3, item: { fromNode: cardB.id, toNode: cardA.id, dg: { relation: supports.id } } });
  value(await host.putRecords({ records: [supports, canvas, cardA, cardB, line] }));

  value(await host.renameText({ ref: thought.ref, title: "Actin scales with tension" }));
  const unit = value(await host.readText({ ref: thought.ref }));
  value(await host.putRecords({ records: [revise({ record: typed, changes: { title: unit.title }, by: info.person })] }));

  const fromPartner = assertRelation({
    space: "partner-lab",
    by: { id: "partner", name: "Partner" },
    type: relationType("Opposes").id,
    source: evidence.node.id,
    target: thought.node.id,
  });
  value(await host.putRecords({ records: [fromPartner] }));
  const before = foldRecords({ records: await readAll(host), localSpace: info.space.id });
  assert.equal(before.relations.get(fromPartner.id)?.state, "pending");

  value(await host.putRecords({ records: [decide({ ...stamp, target: fromPartner.id, decision: "accepted" })] }));
  value(await host.putRecords({ records: [retract({ ...stamp, target: supports.id, reason: "Mislabelled" })] }));

  const graph = foldRecords({ records: await readAll(host), localSpace: info.space.id });
  const node = graph.documents.get(typed.id) as NodeRecord;
  assert.equal(node.title, "Actin scales with tension");
  assert.equal(node.type, nodeType("Claim").id);
  return {
    documents: graph.documents.size,
    states: [...graph.relations.values()].map(({ state }) => state).sort(),
  };
};

test("the same journey gives the same result on any host", async () => {
  const roam = await journey(createMemoryHost({ store: createMemoryStore(), host: "roam" }).host);
  const obsidian = await journey(createMemoryHost({ store: createMemoryStore(), host: "obsidian" }).host);
  assert.deepEqual(roam, obsidian);
  assert.deepEqual(roam, { documents: 17, states: ["active", "withdrawn"] });
});
