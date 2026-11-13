import assert from "node:assert/strict";
import test from "node:test";
import { createCore, type Core } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import type { NodeRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async () => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  // In this base a kept file is read back by the ref it was kept under, as a vault reads one back by its path.
  const core: Core = await createCore({ host });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  const events: SurfaceMessage[] = [];
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message ? pending.get(message.id)?.(message) : events.push(message)), onMessage: (handler) => ((listener = handler), () => {}) };
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
  const node = (id: string): NodeRecord => core.graph().documents.get(id) as NodeRecord;
  return { core, call, store, host, node, events };
};

// A 1x1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const gel = { name: "gel_2026-11-13.png", mediaType: "image/png", dataBase64: PNG };

test("a picture becomes an output pinned to its bytes, sits on the canvas, and is one unit however often it is added", async () => {
  const { call, node, store } = await setup();
  const canvas = await call("canvas.create", { title: "Bench" });
  const made = await call("image.add", { canvas: canvas.id, file: gel, x: 40, y: 60 });
  assert.equal(made.fresh, true);
  assert.equal(made.unit.title, "gel 2026 11 13");
  assert.equal(made.unit.base, "output");
  assert.equal(made.unit.image, true);
  const record = node(made.unit.id);
  assert.match(record.facts?.cid ?? "", /^bafkrei/);
  assert.equal(record.facts?.outputKind, "figure");
  assert.equal(record.facts?.size, 70);
  assert.ok(store.assets.has(record.facts!.locator!.path!), "the file is kept in the base");
  const view = await call("canvas.open", { id: canvas.id });
  assert.deepEqual(Object.keys(view.nodes), [made.unit.id]);

  const again = await call("image.add", { canvas: canvas.id, file: { ...gel, name: "copy.png" } });
  assert.equal(again.fresh, false);
  assert.equal(again.unit.id, made.unit.id);
  assert.equal(store.assets.size, 1, "the same bytes are kept once");

  const shown = await call("unit.image", { id: made.unit.id });
  assert.equal(shown?.dataUrl, `data:image/png;base64,${PNG}`);
  assert.equal(shown?.stale, false);
  // The file is swapped for another: the card says so, and doesn't pass it off as the result.
  store.assets.set(record.facts!.locator!.path!, { name: "gel.png", mime: "image/png", dataUrl: `data:image/png;base64,${btoa("not the gel")}` });
  assert.equal((await call("unit.image", { id: made.unit.id }))?.stale, true);

  await assert.rejects(call("image.add", { file: { name: "notes.txt", mediaType: "text/plain", dataBase64: btoa("x") } }), /isn't a picture/);
  await assert.rejects(call("image.add", { file: { name: "empty.png", mediaType: "image/png", dataBase64: "" } }), /is empty/);
});

test("saying what a picture shows makes evidence that rests on it, pinned to its bytes", async () => {
  const { call, node } = await setup();
  const canvas = await call("canvas.create", { title: "Bench" });
  const { unit: picture } = await call("image.add", { canvas: canvas.id, file: gel });
  const evidence = await call("output.observe", { output: picture.id, title: "  The 42 kDa band is absent in the knockout  ", canvas: canvas.id, x: 300, y: 0 });
  assert.equal(evidence.base, "evidence");
  assert.equal(evidence.title, "The 42 kDa band is absent in the knockout");
  assert.deepEqual(node(evidence.id).prov?.observationBase, [{ uri: picture.id, cid: node(picture.id).facts!.cid! }]);
  assert.equal(Object.keys((await call("canvas.open", { id: canvas.id })).nodes).length, 2);
  await assert.rejects(call("output.observe", { output: picture.id, title: " " }), /Say what it shows/);
  await assert.rejects(call("output.observe", { output: evidence.id, title: "x" }), /isn't an output/);
});

test("a card lists what its unit is related to, what isn't on the canvas first, in the unit's own words", async () => {
  const { call } = await setup();
  const { nodeTypes, relationTypes } = await call("grammar.get", {});
  const typeOf = (label: string) => nodeTypes.find((type) => type.label === label)!.id;
  const supports = relationTypes.find((type) => type.label === "Supports")!.id;
  const claim = await call("node.create", { title: "Actin tracks tension", type: typeOf("Claim") });
  const first = await call("node.create", { title: "Actin rose twofold", type: typeOf("Evidence") });
  const second = await call("node.create", { title: "Actin stayed flat", type: typeOf("Evidence") });
  await call("relation.assert", { type: supports, source: first.id, target: claim.id });
  await call("relation.assert", { type: relationTypes.find((type) => type.label === "Opposes")!.id, source: second.id, target: claim.id });
  const canvas = await call("canvas.create", { title: "Argument" });
  await call("canvas.placeUnits", { canvas: canvas.id, places: [{ node: claim.id, x: 0, y: 0, width: 260, height: 96 }, { node: first.id, x: 300, y: 0, width: 260, height: 96 }] });

  const related = await call("unit.related", { id: claim.id, canvas: canvas.id });
  assert.deepEqual(related.map(({ label, unit, here }) => [label, unit.title, here]), [["Opposed by", "Actin stayed flat", false], ["Supported by", "Actin rose twofold", true]]);
  assert.deepEqual((await call("unit.related", { id: first.id, canvas: canvas.id })).map(({ label, here }) => [label, here]), [["Supports", true]]);
  // Placing the one that was missing draws its link too.
  await call("canvas.placeUnits", { canvas: canvas.id, places: [{ node: second.id, x: 300, y: 140, width: 260, height: 96 }] });
  const view = await call("canvas.open", { id: canvas.id });
  assert.equal(Object.keys(view.relations).length, 2);
  assert.ok((await call("unit.related", { id: claim.id, canvas: canvas.id })).every(({ here }) => here));
});

test("a line tagged while writing is a candidate, and promoting it makes the unit and leaves a link in its place", async () => {
  const { call, host, store } = await setup();
  const { nodeTypes } = await call("grammar.get", {});
  const claim = nodeTypes.find((type) => type.label === "Claim")!;
  assert.deepEqual((await call("candidate.list", {})).tags, [], "no type has a tag yet");
  await call("grammar.saveNodeType", { id: claim.id, label: "Claim", base: "claim", abbreviation: "CLM", tag: "#clm-candidate", template: "## What it rests on\n" });
  await assert.rejects(call("grammar.saveNodeType", { label: "Hypothesis", base: "claim", tag: "CLM-candidate" }), /Claim already uses that tag/);
  await assert.rejects(call("grammar.saveNodeType", { label: "Hypothesis", base: "claim", tag: "two words" }), /A tag is one word/);

  const daily = await host.createText({ title: "2026-11-13", body: "Lab meeting\n- Load sets the assembly rate #clm-candidate\n- buy tips\n- Not one #clm-candidates" });
  assert.ok(daily.ok);
  const listed = await call("candidate.list", {});
  assert.equal(listed.supported, true);
  assert.deepEqual(listed.candidates.map(({ note, line, text, typeLabel }) => [note, line, text, typeLabel]), [["2026-11-13", 1, "Load sets the assembly rate", "Claim"]]);

  const one = listed.candidates[0]!;
  const unit = await call("candidate.promote", { ref: one.ref, line: one.line, type: one.type, text: one.text });
  assert.equal(unit.title, "Load sets the assembly rate");
  assert.equal(unit.base, "claim");
  assert.equal(store.texts.get(daily.value.ref)!.body.split("\n")[1], "- [[CLM - Load sets the assembly rate]]");
  const note = [...store.texts.values()].find((text) => text.title === "CLM - Load sets the assembly rate")!;
  assert.equal(note.body, "## What it rests on\n", "its note starts from the type's template");
  assert.deepEqual((await call("candidate.list", {})).candidates, [], "once promoted it is no longer a candidate");
  // The note was edited in between: nothing is made from a line that no longer carries the tag.
  await assert.rejects(call("candidate.promote", { ref: one.ref, line: one.line, type: one.type, text: "Something else" }), /has changed since it was listed/);
});

test("a command from the base reaches the canvas it names", async () => {
  const { core, call, events } = await setup();
  const canvas = await call("canvas.create", { title: "Front" });
  core.command(canvas.id, "tidy");
  assert.deepEqual(events.filter((message) => "event" in message && message.event === "command"), [{ event: "command", canvas: canvas.id, name: "tidy" }]);
});
