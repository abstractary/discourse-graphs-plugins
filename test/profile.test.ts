import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { createNode, type DgRecord } from "@dg/contract/records.ts";
import type { ExtractionGraph, Services } from "@dg/contract/services.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { historyOf, statsOf } from "@dg/core/profile.ts";

const demo = JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")) as ExtractionGraph;

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async () => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const opened: unknown[] = [];
  const watching = { ...host, openSurface: async (args: unknown) => (opened.push(args), { ok: true as const, value: null }) };
  const services = { servers: async () => [], extract: async () => demo, storeGraph: async () => {}, link: async () => null, pushRecords: async () => {}, pullRecords: async () => ({ records: [], done: true }) } as unknown as Services;
  const core = await createCore({ host: watching as never, services, demoGraphs: [{ filename: "demo.pdf", graph: demo }] });
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
  return { core, call, opened };
};

test("a person sees all of their own work, told as a history", async () => {
  const { call } = await setup();
  const claim = await call("node.create", { title: "Reservoirs need memory" } as never);
  await call("node.rename", { id: claim.id, title: "Reservoirs need fading memory" });
  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);

  const profile = await call("profile.view", {});
  assert.equal(profile.person.me, true);
  assert.deepEqual(profile.audiences, ["private", "lab", "public"]);
  const history = profile.private!.history;
  const texts = history.map((event) => event.text);
  assert.ok(texts.some((text) => /^Wrote a/.test(text)), texts.join(" | "));
  assert.ok(texts.some((text) => /^Renamed a/.test(text)));
  // A paper's units arrive together, and are told as one reading of the paper.
  const read = history.filter((event) => event.action === "read");
  assert.equal(read.length, 1);
  assert.match(read[0]!.text, new RegExp(`Read a paper into ${paper.units} units`));
  assert.equal(read[0]!.canvas?.id, paper.canvas);
  assert.equal(history.filter((event) => event.action === "made").length, 1, "extracted units are not listed one by one");
  assert.deepEqual([...history].sort((a, b) => b.at.localeCompare(a.at)), history, "newest first");
  // With no lab, nothing is the lab's to see.
  assert.equal(profile.lab!.history.length, 0);
  assert.equal(profile.private!.stats.written, 1);
  assert.equal(profile.private!.stats.read, paper.units);
  assert.equal(profile.private!.stats.papers, 1);
  assert.equal(profile.private!.stats.weeks.length, 26);
  assert.ok(profile.private!.stats.weeks[25]! > 0, "this week shows work");
});

test("what everyone sees is counts alone", async () => {
  const { call } = await setup();
  await call("node.create", { title: "A secret hypothesis about spectral radius" } as never);
  const profile = await call("profile.view", {});
  const said = JSON.stringify(profile.public);
  assert.equal(profile.public.written, 1);
  assert.ok(!/secret|spectral/i.test(said), said);
  assert.deepEqual(Object.keys(profile.public).sort(), ["activeDays", "byType", "canvases", "lastActive", "papers", "read", "relations", "since", "units", "weeks", "written"]);
  const card = await call("profile.card", { id: profile.person.id });
  assert.equal(card.written, 1);
  assert.ok(!/secret|spectral/i.test(JSON.stringify(card)));
});

test("a stranger's profile shows only counts, and a labmate's work from elsewhere is lab history", () => {
  const stamp = { space: "their-space", by: { id: "did:plc:other", name: "Sam Okafor" } };
  const theirs = createNode({ ...stamp, title: "Their claim" });
  const mine = createNode({ space: "here", by: { id: "did:plc:me", name: "Me" }, title: "My claim" });
  const records: DgRecord[] = [theirs, mine];
  const graph = { documents: new Map(records.map((record) => [record.id, record])), relations: new Map(), withdrawn: new Set() } as never;
  const input = { records, graph, person: "did:plc:other", shared: new Set<string>(), localSpace: "here" };
  const history = historyOf(input);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.audience, "lab", "what arrived from another space came through a lab");
  assert.equal(statsOf(input, "private").units, 0);
  assert.equal(statsOf(input, "lab").units, 1);
  // My own unshared work is private; once it is on a shared canvas it is the lab's to see.
  const own = { ...input, person: "did:plc:me" };
  assert.equal(historyOf(own)[0]!.audience, "private");
  assert.equal(historyOf({ ...own, shared: new Set([mine.id]) })[0]!.audience, "lab");
});

test("initials lead to a profile, and a note on a canvas says who wrote it", async () => {
  const { call, opened, core } = await setup();
  await call("profile.show", { id: "did:plc:someone" });
  assert.deepEqual(opened.at(-1), { route: { surface: "profile", id: "did:plc:someone" }, placement: "main" });
  const unknown = await call("profile.view", { id: "did:plc:someone" });
  assert.deepEqual(unknown.audiences, ["public"]);
  assert.equal(unknown.private, undefined);
  assert.equal(unknown.public.units, 0);

  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  const view = await call("canvas.open", { id: paper.canvas });
  const me = (await call("profile.view", {})).person.id;
  assert.ok(view.items.length > 0);
  for (const item of view.items) {
    assert.equal(item.credit.id, me);
    assert.ok(!Number.isNaN(new Date(item.at).getTime()));
  }
  void core;
});
