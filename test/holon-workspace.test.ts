import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import type { DgRecord, NodeRecord } from "@dg/contract/records.ts";
import type { SurfaceEvent, SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { createCore } from "@dg/core/index.ts";

// The holonic canvas as the base sees it: focus that follows the canvas in
// front, a holon's canvas opened or made, a canvas tied to a holon, highlights
// that reach every panel, and the gesture choice kept per device.
const records = JSON.parse(readFileSync("examples/worked-example/records.json", "utf8")) as DgRecord[];
const unit = (start: string) => records.find((r): r is NodeRecord => r.kind === "node" && r.title.startsWith(start))!;

const setup = async () => {
  const store = createMemoryStore();
  store.records.push(...records);
  const core = await createCore({ host: createMemoryHost({ store }).host });
  const events: SurfaceEvent[] = [];
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("event" in message) events.push(message as SurfaceEvent);
      if ("id" in message) pending.get(String(message.id))?.(message);
    },
    onMessage: (handler) => {
      listener = handler;
      return () => {};
    },
  };
  core.connectSurface({ port });
  let next = 0;
  const call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]): Promise<SurfaceMethods[M]["result"]> =>
    new Promise((resolve, reject) => {
      next += 1;
      const id = `w${next}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  return { core, call, events, store };
};

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

test("a highlight from one panel reaches the others; the gesture is kept per device", async () => {
  const { call, events, core } = await setup();
  await call("canvas.highlight", { units: ["a", "b"] });
  assert.ok(events.some((e) => e.event === "highlight" && e.units.length === 2));
  assert.equal((await call("prefs.get", {})).holonGesture, "button");
  await call("prefs.set", { holonGesture: "semantic" });
  assert.equal((await core.prefs()).holonGesture, "semantic");
  assert.ok(events.some((e) => e.event === "prefs-changed" && e.prefs.holonGesture === "semantic"));
});
