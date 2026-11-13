import assert from "node:assert/strict";
import test from "node:test";
import { createCore, type Core } from "@dg/core/index.ts";
import { BASE_WORDS, STARTER_TEMPLATES, fillTemplate } from "@dg/contract/grammar.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { BASE_NODE_TYPES, type NodeRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async (store = createMemoryStore()) => {
  const { host } = createMemoryHost({ store });
  const files = new Map<string, string>();
  const tables: { name: string; property: string; value: string; columns: { property: string; label: string }[] }[] = [];
  const base = {
    ...host,
    saveFile: async ({ name, dataBase64 }: { name: string; dataBase64: string }) => (files.set(name, dataBase64), { ok: true as const, value: { where: `saved/${name}` } }),
    openTable: async (args: (typeof tables)[number]) => (tables.push(args), { ok: true as const, value: { where: `Discourse tables/${args.name}.base` } }),
  };
  const core: Core = await createCore({ host: base });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  const put = async (name: string, body: string): Promise<string> => {
    const made = await host.writeAsset({ asset: { name, mime: "application/json", dataUrl: `data:application/json;base64,${btoa(body)}` } });
    assert.ok(made.ok);
    return made.value.ref;
  };
  const texts = () => [...store.texts.values()] as { title: string; body?: string; properties?: Record<string, unknown> }[];
  return { core, call, store, files, tables, put, texts };
};

test("every kind of unit has plain words, and a template fills its blanks", () => {
  assert.deepEqual(Object.keys(BASE_WORDS).sort(), [...BASE_NODE_TYPES].sort());
  assert.equal(fillTemplate("{type}: {title}, {date}, {author}. {other}", { title: "A", type: "Run", author: "Ada", date: "2026-11-13" }), "Run: A, 2026-11-13, Ada. {other}");
  assert.match(STARTER_TEMPLATES.run!, /Departures from the protocol/);
});

test("a lab adds its own type on one of the nine kinds, changes it, and can't make a tenth kind", async () => {
  const { call } = await setup();
  const made = await call("grammar.saveNodeType", { label: " Hypothesis ", base: "claim", abbreviation: "hyp" });
  assert.equal(made.label, "Hypothesis");
  assert.equal(made.base, "claim");
  assert.equal(made.abbreviation, "HYP");
  assert.equal(made.titleFormat, "HYP - {content}", "the note title follows the abbreviation unless told otherwise");
  assert.ok((await call("grammar.get", {})).nodeTypes.some((type) => type.id === made.id));

  const changed = await call("grammar.saveNodeType", { id: made.id, label: "Hypothesis", base: "claim", abbreviation: "H", titleFormat: "[[H]] {content}", template: "## Prediction\n" });
  assert.equal(changed.id, made.id);
  assert.equal(changed.rev, 2);
  assert.equal(changed.titleFormat, "[[H]] {content}");
  // A cleared field is cleared.
  const cleared = await call("grammar.saveNodeType", { id: made.id, label: "Hypothesis", base: "claim" });
  assert.equal(cleared.template, undefined);
  assert.equal(cleared.abbreviation, undefined);

  await assert.rejects(call("grammar.saveNodeType", { label: "Sample", base: "sample" as never }), /one of the nine kinds/);
  await assert.rejects(call("grammar.saveNodeType", { label: "claim", base: "claim" }), /already a type called Claim/);
  await assert.rejects(call("grammar.saveNodeType", { label: "Odd", base: "claim", titleFormat: "{content} {more}" }), /needs \{content\} once/);
  await assert.rejects(call("grammar.saveNodeType", { label: "  ", base: "claim" }), /needs a name/);
});

test("a type in use can't be removed, and one taken out of use is no longer offered", async () => {
  const { call, core } = await setup();
  const type = await call("grammar.saveNodeType", { label: "Hypothesis", base: "claim" });
  const unit = await call("node.create", { title: "Load matters", type: type.id });
  assert.equal((await call("grammar.get", {})).uses?.[type.id], 1);
  await assert.rejects(call("grammar.removeNodeType", { id: type.id }), /1 unit has this type/);

  const spare = await call("grammar.saveNodeType", { label: "Conjecture", base: "claim" });
  const joins = await call("grammar.saveRelationType", { label: "Refines", complement: "Refined by", rules: [{ source: spare.id, target: type.id }] });
  await call("grammar.removeNodeType", { id: spare.id });
  const after = await call("grammar.get", {});
  assert.ok(!after.nodeTypes.some((item) => item.id === spare.id));
  assert.deepEqual(after.relationTypes.find((item) => item.id === joins.id)!.rules, [], "a pair that named it goes with it");
  // The unit and its type are untouched.
  assert.equal((core.graph().documents.get(unit.id) as NodeRecord).type, type.id);
  // The only type of a kind an argument needs stays.
  const claim = after.nodeTypes.find((item) => item.label === "Claim")!;
  await call("grammar.removeNodeType", { id: claim.id });
  await assert.rejects(call("grammar.removeNodeType", { id: after.nodeTypes.find((item) => item.label === "Evidence")!.id }), /only evidence type/);
});

test("a new relation says what it may join, and is then offered between those types only", async () => {
  const { call } = await setup();
  const { nodeTypes } = await call("grammar.get", {});
  const typeOf = (label: string) => nodeTypes.find((type) => type.label === label)!;
  const made = await call("grammar.saveRelationType", { label: "Replicates", complement: "Replicated by", rules: [{ source: typeOf("Evidence").id, target: typeOf("Evidence").id }, { source: typeOf("Evidence").id, target: typeOf("Evidence").id }] });
  assert.equal(made.rules.length, 1, "the same pair twice is one pair");
  await assert.rejects(call("grammar.saveRelationType", { label: "supports", complement: "x", rules: [] }), /already uses that wording/);
  await assert.rejects(call("grammar.saveRelationType", { label: "Extends", complement: "", rules: [] }), /both ways/);
  await assert.rejects(call("grammar.saveRelationType", { label: "Extends", complement: "Extended by", rules: [{ source: "nope", target: typeOf("Claim").id }] }), /types that are in use/);

  const first = await call("node.create", { title: "A rose", type: typeOf("Evidence").id });
  const second = await call("node.create", { title: "A rose again", type: typeOf("Evidence").id });
  const claim = await call("node.create", { title: "It rises", type: typeOf("Claim").id });
  const between = await call("relation.options", { source: first.id, target: second.id });
  assert.ok(between.some((option) => option.label === "Replicates"));
  assert.ok(!(await call("relation.options", { source: first.id, target: claim.id })).some((option) => option.label === "Replicates"));
  await call("relation.assert", { type: made.id, source: first.id, target: second.id });
  await assert.rejects(call("grammar.removeRelationType", { id: made.id }), /1 link uses this relation/);
});

test("the grammar travels as one file by name, and reading it adds what is missing and changes nothing", async () => {
  const first = await setup();
  const hyp = await first.call("grammar.saveNodeType", { label: "Hypothesis", base: "claim", abbreviation: "HYP", template: "## Prediction\n" });
  const evidence = (await first.call("grammar.get", {})).nodeTypes.find((type) => type.label === "Evidence")!;
  await first.call("grammar.saveRelationType", { label: "Tests", complement: "Tested by", rules: [{ source: evidence.id, target: hyp.id }] });
  const saved = await first.call("grammar.export", {});
  assert.equal(saved.name, "discourse-graphs-schema.json");
  const text = atob(first.files.get(saved.name)!);
  const file = JSON.parse(text) as { format: string; nodeTypes: { label: string; template?: string }[]; relationTypes: { label: string; rules: { source: string; target: string }[] }[] };
  assert.equal(file.format, "discourse-graphs-schema");
  assert.ok(!text.includes(hyp.id), "nothing in the file is an id from this base");
  assert.deepEqual(file.relationTypes.find((type) => type.label === "Tests")!.rules, [{ source: "Evidence", target: "Hypothesis" }]);

  // Another base, with a Claim template of its own, reads it.
  const second = await setup();
  const theirClaim = (await second.call("grammar.get", {})).nodeTypes.find((type) => type.label === "Claim")!;
  await second.call("grammar.saveNodeType", { id: theirClaim.id, label: "Claim", base: "claim", abbreviation: "CLM", template: "Ours" });
  const ref = await second.put("discourse-graphs-schema.json", text);
  assert.ok((await second.call("grammar.files", {})).some((item) => item.ref === ref));
  const read = await second.call("grammar.import", { ref });
  assert.equal(read.from, "discourse-graphs");
  assert.equal(read.nodeTypes, 1);
  assert.equal(read.relationTypes, 1);
  const after = await second.call("grammar.get", {});
  const theirs = after.nodeTypes.find((type) => type.label === "Hypothesis")!;
  assert.equal(theirs.template, "## Prediction\n");
  assert.equal(after.nodeTypes.find((type) => type.label === "Claim")!.template, "Ours", "what was here is left as it was");
  const tests = after.relationTypes.find((type) => type.label === "Tests")!;
  assert.deepEqual(tests.rules, [{ source: after.nodeTypes.find((type) => type.label === "Evidence")!.id, target: theirs.id }]);
  const again = await second.call("grammar.import", { ref });
  assert.deepEqual([again.nodeTypes, again.relationTypes, again.rules], [0, 0, 0], "twice adds nothing");
  await assert.rejects(second.put("other.json", '{"a":1}').then((other) => second.call("grammar.import", { ref: other })), /isn't a Discourse Graphs schema/);
});

test("the official plugin's schema export is read: its types, templates and allowed pairs", async () => {
  const { call, put } = await setup();
  const official = {
    version: 1,
    exportedAt: "2026-11-01T00:00:00.000Z",
    pluginVersion: "1.0.0",
    vaultName: "Lab",
    vaultId: "abc",
    nodeTypes: [
      { id: "n1", name: "Result", format: "RES - {content}", template: "Result page", color: "#aabbcc", created: 0, modified: 0 },
      { id: "n2", name: "Claim", format: "CLM - {content}", created: 0, modified: 0 },
      { id: "n3", name: "Experiment", format: "{content} ({date})", created: 0, modified: 0 },
    ],
    relationTypes: [{ id: "r1", label: "Supports", complement: "Supported by", color: "green", created: 0, modified: 0 }],
    discourseRelations: [{ id: "d1", sourceId: "n1", destinationId: "n2", relationshipTypeId: "r1", created: 0, modified: 0 }],
    templates: [{ name: "Result page", content: "## Result\n" }],
  };
  const read = await call("grammar.import", { ref: await put("dg-schema.json", JSON.stringify(official)) });
  assert.equal(read.from, "official-plugin");
  assert.equal(read.nodeTypes, 2, "Claim was already here");
  const { nodeTypes, relationTypes } = await call("grammar.get", {});
  const result = nodeTypes.find((type) => type.label === "Result")!;
  assert.equal(result.base, "evidence", "a result is evidence");
  assert.equal(result.abbreviation, "RES");
  assert.equal(result.template, "## Result\n", "the template's text, not its name");
  // A title pattern this can't use is replaced, and the type still arrives.
  assert.equal(nodeTypes.find((type) => type.label === "Experiment")!.titleFormat, undefined);
  assert.equal(nodeTypes.find((type) => type.label === "Experiment")!.base, "study");
  assert.ok(relationTypes.find((type) => type.label === "Supports")!.rules.some((rule) => rule.source === result.id), "the pair is added to the relation already here");
});

test("a new unit's note starts from its type's template, and carries the facts a table sorts by", async () => {
  const { call, texts, tables } = await setup();
  const { nodeTypes } = await call("grammar.get", {});
  const claim = nodeTypes.find((type) => type.label === "Claim")!;
  await call("grammar.saveNodeType", { id: claim.id, label: "Claim", base: "claim", abbreviation: "CLM", template: "# {title}\n\nMade {date} by {author} as a {type}.\n\n## What it rests on\n" });
  const unit = await call("node.create", { title: "Tension rises", type: claim.id });
  await call("units.export", { nodes: [unit.id], target: { kind: "workspace" } });
  const note = texts().find((text) => text.title === "CLM - Tension rises")!;
  assert.ok(note, texts().map((text) => text.title).join(" | "));
  assert.match(note.body ?? "", /# Tension rises\n\nMade \d{4}-\d{2}-\d{2} by Test Person as a Claim\.\n\n## What it rests on/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(note.properties?.["dg-type"], "Claim");
  assert.match(String(note.properties?.["dg-made"]), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(note.properties?.["dg-by"], "Test Person");

  assert.equal((await call("grammar.get", {})).tables, true);
  const opened = await call("table.open", { type: claim.id });
  assert.equal(opened.where, "Discourse tables/Claim.base");
  assert.deepEqual(tables[0], { name: "Claim", property: "dg-type", value: "Claim", columns: [{ property: "dg-made", label: "Made" }, { property: "dg-by", label: "By" }, { property: "dg-source", label: "Source" }] });
});

test("a canvas can be removed by its maker, and its units stay", async () => {
  const { call, core, texts } = await setup();
  const canvas = await call("canvas.create", { title: "Scratch" });
  const unit = await call("node.create", { title: "Stays" });
  assert.ok(texts().some((text) => text.title.includes("Scratch")));
  await call("canvas.remove", { id: canvas.id });
  assert.ok(!(await call("canvas.list", {})).some((item) => item.id === canvas.id));
  assert.ok(!texts().some((text) => text.title.includes("Scratch")), "its note goes to the base's trash");
  assert.equal((core.graph().documents.get(unit.id) as NodeRecord).removed, undefined);
  assert.equal(await call("canvas.remove", { id: canvas.id }), null, "twice is nothing");

  // A unit goes the same way: off every canvas, its note to the trash, its record kept.
  const board = await call("canvas.create", { title: "Board" });
  await call("units.export", { nodes: [unit.id], target: { kind: "canvas", id: board.id } });
  assert.equal(Object.keys((await call("canvas.open", { id: board.id })).nodes).length, 1);
  await call("node.remove", { id: unit.id });
  assert.equal((core.graph().documents.get(unit.id) as NodeRecord).removed, true);
  assert.equal(Object.keys((await call("canvas.open", { id: board.id })).nodes).length, 0);
  assert.ok(!texts().some((text) => text.title.includes("Stays")));
});
