import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DgRecord, NodeRecord } from "@dg/contract/records.ts";
import { makeCore } from "./support.ts";

// The nested canvas as the base sees it: focus that follows the canvas in
// front, a whole's canvas opened or made, a canvas tied to a whole, highlights
// that reach every panel, and the gesture choice kept per device.
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const unit = (start: string) => records.find((r): r is NodeRecord => r.kind === "node" && r.title.startsWith(start))!;

const setup = () => makeCore({ records });

test("a canvas in front brings its whole into focus, and every panel hears it", async () => {
  const { call, events } = await setup();
  const question = unit("How does a shared issue board");
  const { id } = await call("overview.canvas", { ref: { level: "question", id: question.id } });
  await call("overview.focus.set", { canvas: id });
  const focus = await call("overview.focus.get", {});
  assert.deepEqual(focus, { ref: { level: "question", id: question.id }, canvas: id });
  assert.ok(events.some((e) => e.event === "overview-focus-changed" && e.ref?.id === question.id));
  const where = await call("overview.ofCanvas", { id });
  assert.deepEqual(where.path.map((p) => p.ref.level), ["lab", "question"]);
});

test("a whole's canvas opens if it has one, and is made once if it doesn't", async () => {
  const { call, store } = await setup();
  const question = unit("How does a shared issue board");
  const existing = await call("overview.canvas", { ref: { level: "question", id: question.id } });
  assert.equal(existing.made, false, "the worked example arranged one");
  const claim = unit("29% of MATSUlab issues (n=445) were claimed as experiments.");
  const before = store.records.length;
  const first = await call("overview.canvas", { ref: { level: "claim", id: claim.id } });
  const again = await call("overview.canvas", { ref: { level: "claim", id: claim.id } });
  assert.equal(first.made, true);
  assert.equal(again.made, false);
  assert.equal(again.id, first.id);
  const made = store.records.find((r) => r.id === first.id);
  assert.equal(made?.kind === "canvas" && made.needsLayout, true, "the canvas tab tidies it with its own engine");
  assert.ok(store.records.length > before);
});

test("a loose canvas can be tied to a whole, and untied", async () => {
  const { call } = await setup();
  const { id } = await call("canvas.create", { title: "Scratch" });
  const loose = await call("overview.ofCanvas", { id });
  assert.equal(loose.ref, null);
  const claim = unit("Three undergraduate researchers");
  await call("canvas.setWhole", { id, whole: claim.id });
  assert.equal((await call("overview.ofCanvas", { id })).ref?.id, claim.id);
  await call("canvas.setWhole", { id, whole: null });
  assert.equal((await call("overview.ofCanvas", { id })).ref, null);
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
  assert.equal("wholeGesture" in (await core.prefs()), false);
});

test("a canvas from an older log, tied under the old field name, reads as tied and its next edit writes today's name", async () => {
  const old = records.filter((r) => r.kind === "canvas" && "holon" in r);
  assert.ok(old.length > 0, "the worked example is the older log");
  const { core, call, host } = await setup();
  const canvas = old[0]!;
  const read = core.graph().documents.get(canvas.id) as { whole?: string; holon?: string };
  assert.equal(read.whole, (canvas as unknown as { holon: string }).holon);
  assert.equal("holon" in read, false);
  await call("canvas.setWhole", { id: canvas.id, whole: null });
  const page = await host.listRecords({ limit: 100000 });
  assert.ok(page.ok);
  const written = page.value.items.filter((r) => r.id === canvas.id).at(-1) as { whole?: string; holon?: string; rev: number };
  assert.ok(written.rev > (canvas as unknown as { rev: number }).rev);
  assert.equal("holon" in written, false);
  assert.equal(written.whole, undefined);
});
