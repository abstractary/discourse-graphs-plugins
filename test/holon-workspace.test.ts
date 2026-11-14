import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DgRecord, NodeRecord } from "@dg/contract/records.ts";
import { makeCore } from "./support.ts";

// The holonic canvas as the base sees it: focus that follows the canvas in
// front, a holon's canvas opened or made, a canvas tied to a holon, highlights
// that reach every panel, and the gesture choice kept per device.
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const unit = (start: string) => records.find((r): r is NodeRecord => r.kind === "node" && r.title.startsWith(start))!;

const setup = () => makeCore({ records });

test("a canvas in front brings its holon into focus, and every panel hears it", async () => {
  const { call, events } = await setup();
  const question = unit("How does a shared issue board");
  const { id } = await call("holon.canvas", { ref: { level: "question", id: question.id } });
  await call("holon.focus.set", { canvas: id });
  const focus = await call("holon.focus.get", {});
  assert.deepEqual(focus, { ref: { level: "question", id: question.id }, canvas: id });
  assert.ok(events.some((e) => e.event === "holon-focus-changed" && e.ref?.id === question.id));
  const where = await call("holon.ofCanvas", { id });
  assert.deepEqual(where.path.map((p) => p.ref.level), ["lab", "question"]);
});

test("a holon's canvas opens if it has one, and is made once if it doesn't", async () => {
  const { call, store } = await setup();
  const question = unit("How does a shared issue board");
  const existing = await call("holon.canvas", { ref: { level: "question", id: question.id } });
  assert.equal(existing.made, false, "the worked example arranged one");
  const claim = unit("29% of MATSUlab issues (n=445) were claimed as experiments.");
  const before = store.records.length;
  const first = await call("holon.canvas", { ref: { level: "claim", id: claim.id } });
  const again = await call("holon.canvas", { ref: { level: "claim", id: claim.id } });
  assert.equal(first.made, true);
  assert.equal(again.made, false);
  assert.equal(again.id, first.id);
  const made = store.records.find((r) => r.id === first.id);
  assert.equal(made?.kind === "canvas" && made.needsLayout, true, "the canvas tab tidies it with its own engine");
  assert.ok(store.records.length > before);
});

test("a loose canvas can be tied to a holon, and untied", async () => {
  const { call } = await setup();
  const { id } = await call("canvas.create", { title: "Scratch" });
  const loose = await call("holon.ofCanvas", { id });
  assert.equal(loose.ref, null);
  const claim = unit("Three undergraduate researchers");
  await call("canvas.setHolon", { id, holon: claim.id });
  assert.equal((await call("holon.ofCanvas", { id })).ref?.id, claim.id);
  await call("canvas.setHolon", { id, holon: null });
  assert.equal((await call("holon.ofCanvas", { id })).ref, null);
});

test("a highlight from one panel reaches the others; a choice is kept per device", async () => {
  const { call, events, core } = await setup();
  await call("canvas.highlight", { units: ["a", "b"] });
  assert.ok(events.some((e) => e.event === "highlight" && e.units.length === 2));
  assert.equal((await call("prefs.get", {})).linkDelete, "ask");
  await call("prefs.set", { linkDelete: "canvas" });
  assert.equal((await core.prefs()).linkDelete, "canvas");
  assert.ok(events.some((e) => e.event === "prefs-changed" && e.prefs.linkDelete === "canvas"));
  // A choice an earlier version stored and this one no longer offers isn't handed back.
  assert.equal("holonGesture" in (await core.prefs()), false);
});
