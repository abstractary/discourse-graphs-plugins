import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore, type Core } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import type { ExtractionGraph, LabLink, Services } from "@dg/contract/services.ts";
import type { DgRecord } from "@dg/contract/records.ts";
import type { SurfaceEvent, SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

const demo = (name: string): ExtractionGraph => JSON.parse(readFileSync(`demo/papers/${name}.graph.json`, "utf8")) as ExtractionGraph;
const NEPHRITIS = "lupus-nephritis-prediction";
const MEDIATORS = "preclinical-sle-mediators";

type Calls = {
  stored: { doi: string; graph: ExtractionGraph }[];
  uploaded: { paper: { id: string }; fileBase64?: string; graph: ExtractionGraph }[];
  crumbs: string[];
  pushed: DgRecord[];
  asked: { units: { id: string }[]; grounded?: string[] }[];
};

/** Stands in for a server, and records exactly what would have left the machine. */
const fakeServices = (graph: ExtractionGraph, link: LabLink | null = null): { services: Services; calls: Calls; state: { link: LabLink | null } } => {
  const calls: Calls = { stored: [], uploaded: [], crumbs: [], pushed: [], asked: [] };
  const state = { link };
  const services = {
    servers: async () => [{ id: "local", name: "This computer", url: "http://local", kind: "local" as const }],
    addServer: async (server: { name: string; url: string; kind: "local" }) => ({ ...server, id: "new" }),
    removeServer: async () => {},
    check: async () => ({ name: "Test", kind: "local" as const, version: "0", ai: { mode: "search-only" as const } }),
    models: async () => [{ id: "demo-replay", label: "Replay", default: true }],
    schemas: async () => [{ id: "mira", label: "MIRA", default: true }],
    extract: async ({ onStatus }: { onStatus: (message: string) => void }) => {
      onStatus("Reading");
      return graph;
    },
    storeGraph: async (args: { doi: string; graph: ExtractionGraph }) => {
      calls.stored.push(args);
    },
    link: async () => state.link,
    saveLink: async (next: LabLink | null) => {
      state.link = next;
    },
    createLab: async ({ server, name }: { server: string; name: string }) => ({ server, id: "lab-1", name, token: "t", role: "admin" as const, tokenKind: "personal" as const }),
    findLab: async ({ id }: { id: string }) => ({ id, name: "Lab" }),
    requestToJoin: async ({ server, id }: { server: string; id: string }) => ({ server, id, name: "Lab", pending: { requestId: "r", secret: "s" } }),
    checkRequest: async (current: LabLink) => ({ link: current, state: "pending" as const }),
    requests: async () => [],
    decide: async () => {},
    members: async () => [],
    pushRecords: async (_: LabLink, records: DgRecord[]) => {
      calls.pushed.push(...records);
    },
    pullRecords: async () => ({ records: [], done: true }),
    uploadPaper: async (_: LabLink, args: Calls["uploaded"][number]) => {
      calls.uploaded.push(args);
    },
    labPapers: async () => [],
    paperFile: async () => ({ name: "paper.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }),
    leaveBreadcrumb: async (_: LabLink, { paper }: { paper: string }) => {
      calls.crumbs.push(paper);
    },
    ask: async ({ units, grounded, onDelta }: { units: { id: string }[]; grounded?: string[]; onDelta: (text: string) => void }) => {
      calls.asked.push({ units, ...(grounded ? { grounded } : {}) });
      onDelta("Partly");
      return { answer: "Partly", citations: [units[0]!.id], mode: "search-only" as const };
    },
  } as unknown as Services;
  return { services, calls, state };
};

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async (
  graph: ExtractionGraph,
  link: LabLink | null = null,
  extra: { askBreadcrumb?: (paper: { id: string; title: string }) => void } = {},
): Promise<{ core: Core; call: Call; store: MemoryStore; calls: Calls; events: SurfaceEvent[] }> => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const { services, calls } = fakeServices(graph, link);
  const core = await createCore({ host, services, demoGraphs: [{ filename: "demo.pdf", graph }], ...extra });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  const events: SurfaceEvent[] = [];
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("event" in message) events.push(message as SurfaceEvent);
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
  return { core, call, store, calls, events };
};

const FILE = { name: "paper.pdf", mediaType: "application/pdf", dataBase64: "AAAA" };
const EXTRACT = { file: FILE, server: "http://local", model: "demo-replay", schema: "mira" };

test("a paper gets its own canvas, and its units stay off the base until exported", async () => {
  const graph = demo(NEPHRITIS);
  const { call, store } = await setup(graph);
  const textsBefore = store.texts.size;
  const paper = await call("paper.extract", EXTRACT);
  assert.equal(paper.title, graph.paper!.title);
  assert.equal(paper.units, graph.nodes.length);
  assert.equal(paper.relations, graph.edges.length);
  assert.equal(store.texts.size, textsBefore, "no notes yet");
  const view = await call("canvas.open", { id: paper.canvas });
  assert.equal(Object.keys(view.nodes).length, graph.nodes.length);
  assert.equal(view.canvas.needsLayout, true);
  assert.equal(view.paper?.id, paper.id);
  assert.ok(Object.values(view.nodes).every((node) => node.staged && !node.hasText));
});

test("MIRA types and relations keep their meaning", async () => {
  const { call } = await setup(demo(MEDIATORS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const labels = new Set(Object.values(view.nodes).map(({ typeLabel }) => typeLabel));
  for (const label of ["Question", "Claim", "Evidence", "Run", "Protocol", "Source", "Request"]) assert.ok(labels.has(label), label);
  const kinds = new Set(Object.values(view.relations).map(({ kind }) => kind));
  for (const kind of ["supports", "addresses", "grounds", "follows", "describesActivity", "requestTarget"]) assert.ok(kinds.has(kind), kind);
});

test("a paper with a DOI stores its graph and DOI, and never the file", async () => {
  const { call, calls } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  assert.equal(calls.stored.length, 1);
  assert.equal(calls.stored[0]!.doi, "10.1016/j.semarthrit.2018.02.012");
  assert.ok(!JSON.stringify(calls.stored[0]).includes(FILE.dataBase64));
  assert.equal(paper.stored, true);
});

test("a paper with no DOI sends nothing to the server", async () => {
  const graph = demo(NEPHRITIS);
  const { paper: _paper, ...rest } = graph;
  const { call, calls } = await setup({ ...rest, paper: { title: "No DOI here" } });
  const paper = await call("paper.extract", EXTRACT);
  assert.equal(calls.stored.length, 0);
  assert.equal(paper.stored, false);
});

test("progress reaches the panel while a paper is read", async () => {
  const { call, events } = await setup(demo(NEPHRITIS));
  await call("paper.extract", EXTRACT);
  assert.ok(events.some((event) => event.event === "job-status" && event.message === "Reading"));
});

test("demo papers load once", async () => {
  const { call } = await setup(demo(NEPHRITIS));
  assert.equal((await call("paper.loadDemo", {})).length, 1);
  assert.equal((await call("paper.loadDemo", {})).length, 0);
  assert.equal((await call("paper.list", {})).length, 1);
});

test("exporting gives units real text, and brings their links along", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const claims = Object.values(view.nodes).filter(({ typeLabel }) => typeLabel === "Claim" || typeLabel === "Evidence");
  const before = store.texts.size;
  const result = await call("units.export", { nodes: claims.map(({ id }) => id), target: { kind: "workspace" } });
  assert.equal(result.made, claims.length);
  assert.equal(store.texts.size, before + claims.length + 1, "each unit, plus the workspace's own page");
  const workspace = await call("canvas.open", { id: result.canvas! });
  assert.equal(workspace.canvas.personal, true);
  assert.equal(Object.keys(workspace.nodes).length, claims.length);
  assert.ok(Object.keys(workspace.relations).length > 0, "relations between exported units come too");
  const again = await call("units.export", { nodes: claims.map(({ id }) => id), target: { kind: "workspace" } });
  assert.equal(again.made, 0, "the same id, so nothing is made twice");
  assert.equal(again.canvas, result.canvas);
});

test("the anchor and description travel into the note", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const claim = Object.values(view.nodes).find(({ title }) => title.startsWith("Low albumin-to-globulin"))!;
  await call("units.export", { nodes: [claim.id], target: { kind: "workspace" } });
  const text = [...store.texts.values()].find(({ title }) => title.includes("Low albumin-to-globulin"));
  assert.match(text!.body, /In particular, a low AGR/);
  assert.match(text!.body, /From: Predicting eventual development/);
});

test("folders collect units, in the base's own way", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const ids = Object.keys(view.nodes).slice(0, 3);
  const { folder } = await call("units.export", { nodes: ids, target: { kind: "new-folder", title: "AGR review" } });
  assert.deepEqual((await call("folder.list", {})).map(({ title, units }) => [title, units]), [["AGR review", 3]]);
  assert.equal(store.folders.size, 3);
  await call("units.export", { nodes: ids, target: { kind: "folder", id: folder! } });
  assert.equal((await call("folder.list", {}))[0]!.units, 3, "filing twice files once");
});

test("opening a unit shows where it came from and everywhere it lives", async () => {
  const { call } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const claim = Object.values(view.nodes).find(({ title }) => title.startsWith("Low albumin-to-globulin"))!;
  let opened = await call("node.view", { id: claim.id });
  assert.equal(opened.provenance.paper?.title, paper.title);
  assert.equal(opened.provenance.paper?.doi, "10.1016/j.semarthrit.2018.02.012");
  assert.equal(opened.provenance.paper?.model, "nvidia/nemotron-3-ultra-550b-a55b:free");
  assert.match(opened.provenance.paper?.anchor ?? "", /In particular, a low AGR/);
  assert.equal(opened.provenance.lives.text, null);
  assert.deepEqual(opened.provenance.lives.canvases.map(({ title }) => title), [paper.title]);
  await call("units.export", { nodes: [claim.id], target: { kind: "new-folder", title: "Keep" } });
  await call("units.export", { nodes: [claim.id], target: { kind: "workspace" } });
  opened = await call("node.view", { id: claim.id });
  assert.ok(opened.provenance.lives.text);
  assert.deepEqual(opened.provenance.lives.folders.map(({ title }) => title), ["Keep"]);
  assert.equal(opened.provenance.lives.canvases.length, 2);
});

test("reactions are one per person, and only shared canvases carry them", async () => {
  const { call, core } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const unit = Object.keys(view.nodes)[0]!;
  assert.deepEqual(view.social, {});
  assert.equal((await call("node.view", { id: unit })).social, undefined);
  await core.createLab("Home Lab");
  await call("canvas.share", { id: paper.canvas });
  await call("unit.react", { unit, value: "interesting" });
  await call("unit.react", { unit, value: "disagree" });
  let shared = await call("canvas.open", { id: paper.canvas });
  assert.equal(shared.social[unit]!.mine, "disagree");
  assert.deepEqual([shared.social[unit]!.who.interesting.length, shared.social[unit]!.who.disagree.length], [0, 1]);
  await call("unit.react", { unit, value: null });
  shared = await call("canvas.open", { id: paper.canvas });
  assert.equal(shared.social[unit]!.mine, null);
});

test("notes stay apart from the unit, and only their author can take them back", async () => {
  const { call, core } = await setup(demo(NEPHRITIS));
  const paper = await call("paper.extract", EXTRACT);
  await core.createLab("Home Lab");
  await call("canvas.share", { id: paper.canvas });
  const view = await call("canvas.open", { id: paper.canvas });
  const unit = Object.keys(view.nodes)[0]!;
  await call("unit.note", { unit, text: "Worth checking the cut-off" });
  const social = (await call("node.view", { id: unit })).social!;
  assert.equal(social.notes[0]!.text, "Worth checking the cut-off");
  assert.equal(social.notes[0]!.mine, true);
  await call("unit.removeNote", { id: social.notes[0]!.id });
  assert.equal((await call("node.view", { id: unit })).social!.notes.length, 0);
});

const LINK: LabLink = { server: "http://local", id: "lab-1", name: "Home Lab", token: "t", tokenKind: "personal", role: "admin" };

test("sharing a paper uploads it with who did what, and shares its canvas", async () => {
  const { call, core, calls } = await setup(demo(NEPHRITIS), LINK);
  await core.createLab("Home Lab");
  const paper = await call("paper.extract", { ...EXTRACT, share: { includeFile: true } });
  assert.equal(calls.uploaded.length, 1);
  assert.equal(calls.uploaded[0]!.fileBase64, FILE.dataBase64);
  assert.equal(calls.uploaded[0]!.graph.nodes.length, demo(NEPHRITIS).nodes.length);
  assert.equal(paper.labPaper, paper.id);
  const view = await call("canvas.open", { id: paper.canvas });
  assert.equal(view.canvas.shared, core.identity().lab!.did);
  const kinds = new Set(core.shareable().map(({ kind }) => kind));
  for (const kind of ["canvas", "canvas-item", "node", "relation", "paper", "lab"]) assert.ok(kinds.has(kind as never), kind);
  assert.ok(!kinds.has("anchor" as never), "anchors stay local");
});

test("the file only goes to the lab when a person says so", async () => {
  const { call, core, calls } = await setup(demo(NEPHRITIS), LINK);
  await core.createLab("Home Lab");
  await call("paper.extract", { ...EXTRACT, share: { includeFile: false } });
  assert.equal(calls.uploaded[0]!.fileBase64, undefined);
});

test("a member can keep the original, and it lands in their base", async () => {
  const { call, core, store } = await setup(demo(NEPHRITIS), LINK);
  await core.createLab("Home Lab");
  assert.deepEqual(await call("paper.getFile", { id: "any" }), { where: "paper.pdf" });
  assert.equal(store.files.get("paper.pdf"), "AAAA");
});

test("what isn't on a shared canvas stays out of sync", async () => {
  const { call, core } = await setup(demo(NEPHRITIS), LINK);
  await core.createLab("Home Lab");
  const paper = await call("paper.extract", EXTRACT);
  const units = Object.keys((await call("canvas.open", { id: paper.canvas })).nodes);
  assert.ok(!core.shareable().some(({ id }) => units.includes(id)));
});

test("closing a lab paper asks first, and a person can set the default", async () => {
  const owner = await setup(demo(NEPHRITIS), LINK);
  await owner.core.createLab("Home Lab");
  const paper = await owner.call("paper.extract", { ...EXTRACT, share: { includeFile: false } });
  const asked: string[] = [];
  const { call, core, calls } = await setup(demo(NEPHRITIS), LINK, { askBreadcrumb: ({ id }) => asked.push(id) });
  await core.take(owner.core.shareable());
  await core.canvasClosed({ id: paper.canvas });
  assert.deepEqual(asked, [paper.labPaper]);
  assert.equal(calls.crumbs.length, 0, "nothing is left until they answer");
  await core.answerBreadcrumb({ paper: paper.labPaper!, leave: true });
  assert.equal(calls.crumbs.length, 1);
  await call("lab.setBreadcrumbs", { value: "always" });
  await core.canvasClosed({ id: paper.canvas });
  assert.equal(asked.length, 1);
  assert.equal(calls.crumbs.length, 2);
  await call("lab.setBreadcrumbs", { value: "never" });
  await core.canvasClosed({ id: paper.canvas });
  assert.equal(calls.crumbs.length, 2);
  await core.answerBreadcrumb({ paper: paper.labPaper!, leave: true, remember: true });
  assert.equal((await call("lab.view", {})).breadcrumbs, "always");
});

test("the uploader isn't asked, because the repository already names them", async () => {
  const asked: string[] = [];
  const { call, core } = await setup(demo(NEPHRITIS), LINK, { askBreadcrumb: ({ id }) => asked.push(id) });
  await core.createLab("Home Lab");
  const paper = await call("paper.extract", { ...EXTRACT, share: { includeFile: false } });
  await core.canvasClosed({ id: paper.canvas });
  assert.deepEqual(asked, []);
});

test("arrivals show at once, and a person accepted early joins when the lab's record lands", async () => {
  const lab = await setup(demo(NEPHRITIS), LINK);
  await lab.core.createLab("Home Lab");
  const records = lab.core.shareable();
  const member = await setup(demo(NEPHRITIS), LINK);
  assert.equal(member.core.identity().lab, undefined);
  await member.core.take(records);
  assert.equal(member.core.identity().lab?.name, "Home Lab");
});

test("a paper outside a lab leaves no breadcrumb", async () => {
  const asked: string[] = [];
  const { call, core } = await setup(demo(NEPHRITIS), null, { askBreadcrumb: ({ id }) => asked.push(id) });
  const paper = await call("paper.extract", EXTRACT);
  await core.canvasClosed({ id: paper.canvas });
  assert.deepEqual(asked, []);
});

test("AI comes with a lab, and asks about this canvas or the units picked", async () => {
  const graph = demo(NEPHRITIS);
  const solo = await setup(graph);
  assert.equal((await solo.call("ai.status", {})).ready, false);
  const { call, calls, events, core } = await setup(graph, LINK);
  await core.createLab("Home Lab");
  assert.equal((await call("ai.status", {})).ready, true);
  const paper = await call("paper.extract", EXTRACT);
  const view = await call("canvas.open", { id: paper.canvas });
  const [first] = Object.keys(view.nodes);
  const answer = await call("ai.ask", { canvas: paper.canvas, question: "What predicts nephritis?", grounded: [first!], requestId: "q1" });
  assert.equal(answer.mode, "search-only");
  assert.equal(calls.asked[0]!.units.length, graph.nodes.length);
  assert.deepEqual(calls.asked[0]!.grounded, [first]);
  assert.ok(events.some((event) => event.event === "ai-delta" && event.requestId === "q1"));
});

test("a relation from your own lab doesn't wait for a decision", async () => {
  const { foldRecords, assertRelation } = await import("@dg/contract/records.ts");
  const stamp = { space: "theirs", by: { id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", name: "Ana" } };
  const inLab = assertRelation({ ...stamp, lab: "did:plc:lab", type: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa#3mzn56x7n6sxg", source: "a", target: "b" });
  const outside = assertRelation({ ...stamp, lab: "did:plc:other", type: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa#3mzn56x7n6sxg", source: "a", target: "b" });
  const graph = foldRecords({ records: [inLab, outside], localSpace: "mine", trustedLab: "did:plc:lab" });
  assert.equal(graph.relations.get(inLab.id)!.state, "active");
  assert.equal(graph.relations.get(outside.id)!.state, "pending");
});
