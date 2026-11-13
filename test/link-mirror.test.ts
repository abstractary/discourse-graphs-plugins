import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import type { ExtractionGraph, Services } from "@dg/contract/services.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const demo = JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")) as ExtractionGraph;

const setup = async (textForEveryUnit = false) => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store, textForEveryUnit });
  const services = { servers: async () => [], extract: async () => demo, storeGraph: async () => {}, link: async () => null, pushRecords: async () => {}, pullRecords: async () => ({ records: [], done: true }) } as unknown as Services;
  const core = await createCore({ host: host as never, services });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
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
  return { call, core, store, host };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
// A note also carries plain facts (its type, the day it was made). These tests are about the links, which are lists.
const linksIn = (properties: Record<string, unknown> | undefined): Record<string, string[]> => Object.fromEntries(Object.entries(properties ?? {}).filter(([, value]) => Array.isArray(value))) as Record<string, string[]>;
const propsOf = (store: ReturnType<typeof createMemoryStore>, ref: string) => linksIn((store.texts.get(ref) as { properties?: Record<string, unknown> } | undefined)?.properties);

test("a relation shows on both notes as link properties, and goes when the relation does", async () => {
  const { call, core, store } = await setup();
  const grammar = await call("grammar.get", {} as never);
  const typeOf = (base: string) => grammar.nodeTypes.find((type) => type.base === base)!.id;
  const claim = await core.capture({ text: "Entropy predicts error", type: typeOf("claim") });
  const evidence = await core.capture({ text: "Lowest error at the edge of stability", type: typeOf("evidence") });
  assert.ok(claim.ok && evidence.ok);
  const [option] = await call("relation.options", { source: evidence.value.node, target: claim.value.node });
  assert.ok(option && !option.flipped);
  const type = grammar.relationTypes.find((item) => item.id === option.type)!;
  const made = await call("relation.assert", { type: type.id, source: evidence.value.node, target: claim.value.node });
  await settle();
  assert.deepEqual(propsOf(store, evidence.value.ref), { [type.label]: [claim.value.ref] });
  assert.deepEqual(propsOf(store, claim.value.ref), { [type.complement]: [evidence.value.ref] });

  // A note with no relations carries none.
  const other = await core.capture({ text: "Unrelated" });
  await settle();
  assert.ok(other.ok);
  assert.deepEqual(propsOf(store, other.value.ref), {});

  await call("relation.withdraw", { id: made.id } as never);
  await settle();
  assert.deepEqual(propsOf(store, evidence.value.ref), {});
});

test("where the base wants it, every unit read from a paper gets a note, and its relations show there", async () => {
  const { call, store } = await setup(true);
  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  await settle();
  await settle();
  const view = await call("canvas.open", { id: paper.canvas });
  const nodes = Object.values(view.nodes);
  assert.ok(nodes.length > 3);
  assert.ok(nodes.every((node) => node.hasText), "no unit is left without a note");
  const withLinks = [...store.texts.values()].filter((text) => Object.keys(linksIn((text as { properties?: Record<string, unknown> }).properties)).length > 0);
  assert.ok(withLinks.length > 0, "the paper's relations reach the notes");
  // Same wording twice still gives two notes.
  const titles = [...store.texts.values()].map((text) => text.title);
  assert.equal(new Set(titles).size, titles.length);
  const before = store.texts.size;
  await call("node.create", { title: "One more" } as never);
  await settle();
  assert.equal(store.texts.size, before + 1, "nothing is made twice");
});

test("without that, a unit read from a paper stays without a note", async () => {
  const { call } = await setup();
  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  await settle();
  const view = await call("canvas.open", { id: paper.canvas });
  assert.ok(Object.values(view.nodes).some((node) => !node.hasText));
});
