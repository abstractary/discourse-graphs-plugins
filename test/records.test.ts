import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRelation,
  canonicalJson,
  buildCanvas,
  createCanvas,
  createCanvasItem,
  createNode,
  createNodeType,
  createPerson,
  createSnapshot,
  decide,
  defaultGrammar,
  foldRecords,
  formatTitle,
  isJsonSafe,
  parseTitle,
  recognizeTitle,
  retract,
  revise,
  staysLocal,
  createAnchor,
  uuidv7,
  validateRecord,
  type Author,
  type DgRecord,
  type NodeRecord,
  type NodeTypeRecord,
} from "@dg/contract/records.ts";

const ana: Author = { id: "ana", name: "Ana" };
const ben: Author = { id: "ben", name: "Ben" };
const home = { space: "home", by: ana };
const away = { space: "away", by: ben };

const permutations = <T>(items: T[]): T[][] =>
  items.length < 2
    ? [items]
    : items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
          (rest) => [item, ...rest],
        ),
      );

const fingerprint = (records: DgRecord[]): string => {
  const graph = foldRecords({ records, localSpace: "home" });
  const sorted = <T extends [string, unknown]>(map: Map<string, T[1]>): unknown =>
    [...map].sort(([a], [b]) => (a < b ? -1 : 1));
  return canonicalJson({
    documents: sorted(graph.documents),
    relations: sorted(graph.relations),
    withdrawn: [...graph.withdrawn].sort(),
  });
};

test("every order of arrival folds to the same graph", () => {
  const node = createNode({ ...home, title: "Claim" });
  const editA = revise({ record: node, changes: { title: "A" }, by: ana, at: "2026-11-06T10:00:00.000Z" });
  const editB = revise({ record: node, changes: { title: "B" }, by: ben, at: "2026-11-06T10:00:00.000Z" });
  const mine = assertRelation({ ...home, type: "t", source: "s", target: node.id });
  const theirs = assertRelation({ ...away, type: "t", source: "s", target: node.id });
  const withdrawal = retract({ ...home, target: mine.id });
  const records = [node, editA, editB, mine, theirs, withdrawal];
  const expected = fingerprint(records);
  for (const order of permutations(records)) {
    assert.equal(fingerprint(order), expected);
  }
});

test("disagreement is kept as content, not resolved as a conflict", () => {
  const claim = createNode({ ...home, title: "Claim" });
  const evidence = createNode({ ...home, title: "Evidence" });
  const supports = assertRelation({ ...home, type: "supports", source: evidence.id, target: claim.id });
  const opposes = assertRelation({ ...home, by: ben, type: "opposes", source: evidence.id, target: claim.id });
  const graph = foldRecords({ records: [claim, evidence, supports, opposes], localSpace: "home" });
  assert.equal(graph.relations.size, 2);
  assert.ok([...graph.relations.values()].every(({ state }) => state === "active"));
});

test("relations from elsewhere wait for this space's decision", () => {
  const relation = assertRelation({ ...away, type: "t", source: "s", target: "d" });
  const stateWith = (...extra: DgRecord[]): string | undefined =>
    foldRecords({ records: [relation, ...extra], localSpace: "home" }).relations.get(relation.id)?.state;
  assert.equal(stateWith(), "pending");
  const at = (minute: number): string => `2026-11-06T10:0${minute}:00.000Z`;
  const accepted = decide({ ...home, target: relation.id, decision: "accepted", at: at(1) });
  const rejected = decide({ ...home, target: relation.id, decision: "rejected", at: at(2) });
  assert.equal(stateWith(accepted), "active");
  assert.equal(stateWith(accepted, rejected), "rejected");
  const elsewhere = decide({ ...away, target: relation.id, decision: "accepted" });
  assert.equal(stateWith(elsewhere), "pending", "another space's stance doesn't count here");
});

test("only the author can withdraw", () => {
  const relation = assertRelation({ ...home, type: "t", source: "s", target: "d" });
  const stateWith = (retraction: DgRecord): string | undefined =>
    foldRecords({ records: [relation, retraction], localSpace: "home" }).relations.get(relation.id)?.state;
  assert.equal(stateWith(retract({ ...home, target: relation.id })), "withdrawn");
  assert.equal(stateWith(retract({ space: "home", by: ben, target: relation.id })), "active");
});

test("a withdrawal outranks an acceptance", () => {
  const relation = assertRelation({ ...away, type: "t", source: "s", target: "d" });
  const graph = foldRecords({
    records: [
      relation,
      decide({ ...home, target: relation.id, decision: "accepted" }),
      retract({ ...away, target: relation.id }),
    ],
    localSpace: "home",
  });
  assert.equal(graph.relations.get(relation.id)?.state, "withdrawn");
});

test("editing keeps the original author", () => {
  const node = createNode({ ...home, title: "Draft" });
  const edited = revise({ record: node, changes: { title: "Final", type: "claim" }, by: ben });
  assert.equal(edited.by.id, "ana");
  assert.equal(edited.at, node.at);
  assert.equal(edited.editedBy.id, "ben");
  assert.equal(edited.rev, 2);
});

test("a node can exist with no type", () => {
  const node: NodeRecord = createNode({ ...home, title: "A thought" });
  assert.equal(node.type, undefined);
  assert.deepEqual(validateRecord(node), []);
});

test("the default grammar is valid and points at base types", () => {
  const grammar = defaultGrammar(home);
  assert.deepEqual(grammar.flatMap(validateRecord), []);
  assert.ok(grammar.every((record) => record.base !== undefined));
  assert.ok(isJsonSafe(grammar));
});

test("validation rejects malformed records", () => {
  const node = createNode({ ...home, title: "x" });
  assert.notDeepEqual(validateRecord({ ...node, kind: "mystery" }), []);
  assert.notDeepEqual(validateRecord({ ...node, v: 99 }), []);
  assert.notDeepEqual(validateRecord({ ...node, id: "no-tid-here" }), []);
  assert.notDeepEqual(validateRecord({ ...node, rev: 0 }), []);
  assert.notDeepEqual(validateRecord({ ...node, by: "ana" }), []);
  assert.notDeepEqual(validateRecord("nope"), []);
});

test("unknown fields are valid", () => {
  const node = createNode({ ...home, title: "x" });
  assert.deepEqual(validateRecord({ ...node, later: true, ext: { lab: 1 } }), []);
});

const textCard = (id: string, x: number) =>
  ({ type: "text", text: id, x, y: 0, width: 200, height: 80, dg: { node: id } }) as const;

test("a canvas builds to plain JSON Canvas", () => {
  const canvas = createCanvas({ ...home, title: "Map" });
  const card = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("claim", 0), z: 1 });
  const other = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("evidence", 300), z: 2 });
  const edge = createCanvasItem({
    ...home,
    canvas: canvas.id,
    item: { fromNode: other.id, toNode: card.id, label: "Supports", dg: { relation: "r" } },
    z: 3,
  });
  assert.deepEqual([canvas, card, other, edge].flatMap(validateRecord), []);
  const built = buildCanvas({
    graph: foldRecords({ records: [edge, other, card, canvas], localSpace: "home" }),
    canvas: canvas.id,
  });
  assert.deepEqual(built.nodes.map((node) => node.id), [card.id, other.id]);
  assert.equal(built.edges[0]?.toNode, card.id);
  const plain = JSON.parse(JSON.stringify(built, (key, value: unknown) => (key === "dg" ? undefined : value))) as typeof built;
  assert.equal(plain.nodes[0]?.type, "text");
});

test("two people editing different canvas items both keep their work", () => {
  const canvas = createCanvas({ ...home, title: "Map" });
  const a = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("a", 0), z: 1 });
  const b = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("b", 300), z: 2 });
  const moved = revise({ record: a, changes: { item: { ...a.item, x: 40 } }, by: ana });
  const recoloured = revise({ record: b, changes: { item: { ...b.item, color: "1" } }, by: ben });
  for (const order of permutations<DgRecord>([a, b, moved, recoloured])) {
    const built = buildCanvas({
      graph: foldRecords({ records: [canvas, ...order], localSpace: "home" }),
      canvas: canvas.id,
    });
    assert.equal(built.nodes.find((node) => node.id === a.id)?.x, 40);
    assert.equal(built.nodes.find((node) => node.id === b.id)?.color, "1");
  }
});

test("removing a card removes its edges from the built canvas", () => {
  const canvas = createCanvas({ ...home, title: "Map" });
  const a = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("a", 0), z: 1 });
  const b = createCanvasItem({ ...home, canvas: canvas.id, item: textCard("b", 300), z: 2 });
  const edge = createCanvasItem({ ...home, canvas: canvas.id, item: { fromNode: a.id, toNode: b.id }, z: 3 });
  const gone = revise({ record: b, changes: { removed: true }, by: ana });
  const built = buildCanvas({
    graph: foldRecords({ records: [canvas, a, b, edge, gone], localSpace: "home" }),
    canvas: canvas.id,
  });
  assert.equal(built.nodes.length, 1);
  assert.equal(built.edges.length, 0);
});

test("a stroke needs a path and stays out of the built canvas", () => {
  const canvas = createCanvas({ ...home, title: "Map" });
  const stroke = createCanvasItem({ ...home, canvas: canvas.id, z: 1, item: { type: "stroke", x: 0, y: 0, width: 10, height: 10, path: "M0 0 L10 10" } });
  assert.deepEqual(validateRecord(stroke), []);
  const empty = createCanvasItem({ ...home, canvas: canvas.id, z: 1, item: { type: "stroke", x: 0, y: 0, width: 10, height: 10, path: "" } });
  assert.notDeepEqual(validateRecord(empty), []);
  const built = buildCanvas({ graph: foldRecords({ records: [canvas, stroke], localSpace: "home" }), canvas: canvas.id });
  assert.equal(built.nodes.length, 0);
});

test("canvas positions must be integers and edges need both ends", () => {
  const box = { type: "text", text: "x", y: 0, width: 1, height: 1 } as const;
  const bad = createCanvasItem({ ...home, canvas: "c", item: { ...box, x: 1.5 }, z: 1 });
  assert.equal(validateRecord(bad).length, 1);
  const edge = createCanvasItem({ ...home, canvas: "c", item: { fromNode: "a", toNode: "" }, z: 1 });
  assert.equal(validateRecord(edge).length, 1);
});

test("titles hold content only, and each space keeps its own format", () => {
  const roam = "[[CLM]] - {content}";
  const obsidian = "CLM - {content}";
  const content = "Actin scales with tension";
  assert.equal(parseTitle({ format: roam, title: formatTitle({ format: roam, content }) }), content);
  assert.equal(parseTitle({ format: obsidian, title: formatTitle({ format: obsidian, content }) }), content);
  assert.equal(parseTitle({ format: "@{content}", title: "@miki2000" }), "miki2000");
  assert.equal(parseTitle({ format: obsidian, title: "EVD - Something" }), null);
  assert.equal(parseTitle({ format: obsidian, title: "CLM - " }), null);
});

test("a title in a type's format is recognized as that type", () => {
  const types = defaultGrammar(home).filter((item) => item.kind === "node-type") as NodeTypeRecord[];
  const found = recognizeTitle({ title: "CLM - Actin scales", nodeTypes: types });
  assert.equal(found?.type.base, "claim");
  assert.equal(found?.content, "Actin scales");
  assert.equal(recognizeTitle({ title: "A plain note", nodeTypes: types }), null);
});

test("a base can keep its own title convention", () => {
  const types = defaultGrammar({ ...home, titleFormat: (abbr) => `[[${abbr}]] - {content}` }).filter(
    (item) => item.kind === "node-type",
  ) as NodeTypeRecord[];
  assert.equal(recognizeTitle({ title: "[[EVD]] - Actin rose", nodeTypes: types })?.type.base, "evidence");
});

test("a title format can't smuggle a slot back in", () => {
  const bad = createNodeType({ ...home, fields: { label: "Evidence", titleFormat: "EVD - {content} - {Source}" } });
  assert.notDeepEqual(validateRecord(bad), []);
});

test("a proposed relation waits, even in its own space", () => {
  const relation = assertRelation({ ...home, type: "t", source: "s", target: "d", proposed: true });
  const stateWith = (...extra: DgRecord[]): string | undefined =>
    foldRecords({ records: [relation, ...extra], localSpace: "home" }).relations.get(relation.id)?.state;
  assert.equal(stateWith(), "pending");
  assert.equal(stateWith(decide({ ...home, target: relation.id, decision: "accepted" })), "active");
});

test("an alias doesn't grant withdrawal rights", () => {
  const relation = assertRelation({ ...home, type: "t", source: "s", target: "d" });
  const claim = createPerson({ ...away, name: "Ben", aliases: ["ana"] });
  const graph = foldRecords({
    records: [relation, claim, retract({ ...away, target: relation.id })],
    localSpace: "home",
  });
  assert.equal(graph.relations.get(relation.id)?.state, "active");
});

test("snapshots and people are valid and can travel", () => {
  const snapshot = createSnapshot({ ...home, node: "n", body: "Full text" });
  const person = createPerson({ ...home, name: "Ana", orcid: "0000-0000", aliases: ["roam-ana"] });
  assert.deepEqual([snapshot, person].flatMap(validateRecord), []);
  assert.equal(staysLocal(snapshot), false);
  assert.equal(staysLocal(person), false);
});

test("anchors and decisions stay in their space", () => {
  assert.equal(staysLocal(createAnchor({ ...home, node: "n", ref: "r" })), true);
  assert.equal(staysLocal(decide({ ...home, target: "x", decision: "accepted" })), true);
  assert.equal(staysLocal(createNode({ ...home, title: "x" })), false);
  assert.equal(staysLocal(assertRelation({ ...home, type: "t", source: "s", target: "d" })), false);
});

test("uuidv7 is well formed, unique and time ordered", () => {
  const ids = Array.from({ length: 200 }, uuidv7);
  assert.equal(new Set(ids).size, 200);
  assert.ok(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
  const first = ids[0]!.slice(0, 13).replace("-", "");
  assert.equal(parseInt(first, 16) <= Date.now(), true);
});
