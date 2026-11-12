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

test("a lab's model answers about this canvas or the units picked, and with no lab the units are quoted", async () => {
  const graph = demo(NEPHRITIS);
  const solo = await setup(graph);
  const alone = await solo.call("ai.status", {});
  assert.deepEqual([alone.ready, alone.mode, alone.source], [true, "search-only", "none"]);
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

// ---- Extract graph: a saved extraction beside the file stands in for a server ----

const SAVED: ExtractionGraph = {
  source: "reservoir.pdf",
  models: ["a-model"],
  paper: { title: "A paper about reservoirs", doi: "https://doi.org/10.1000/abc", license: "CC BY 4.0", authors: [{ name: "A. Author" }] },
  nodes: [
    { id: "g0", type: "Question", text: "Does it work?", anchor: "does it work" },
    { id: "g1", type: "Claim", text: "It works.", anchor: "it works" },
    { id: "g2", type: "Evidence", text: "Error fell by half.", anchor: "error fell by half" },
    { id: "g3", type: "SourceDocument", text: "An earlier paper someone else wrote." },
    { id: "g4", type: "SourceDocument", text: "A paper about reservoirs, A. Author." },
    { id: "g5", type: "Study", text: "A simulation." },
  ],
  edges: [
    { relation: "addresses", subject: "g1", object: "g0" },
    { relation: "supports", subject: "g2", object: "g1" },
    { relation: "describesActivity", subject: "g4", object: "g5" },
    { relation: "grounds", subject: "g5", object: "g2" },
  ],
};

const asMira = (graph: ExtractionGraph) => ({
  "@context": ["https://purl.org/mira-science/mira.jsonld", { x: "urn:test:" }],
  "@graph": [
    { "@id": "x:author-0", "@type": "UserAccount", accountName: "A. Author" },
    ...["Question", "Claim", "Evidence", "SourceDocument", "Study"].map((name) => ({ "@id": `x:_schema_${name}`, "@type": "NodeSchema", subClassOf: [name] })),
    ...graph.nodes.flatMap((node) => [
      ...(node.anchor ? [{ "@id": `x:a-${node.id}`, "@type": "Item", content: node.anchor }] : []),
      { "@id": `x:${node.id}`, "@type": [`x:_schema_${node.type}`, node.type], title: node.text, content: `${node.text}\n\nMore about it.`, ...(node.anchor ? { description: `x:a-${node.id}` } : {}) },
    ]),
    ...graph.edges.map((edge, index) => ({ "@id": `x:r${index}`, "@type": [`x:_rel_${edge.relation}`, edge.relation, "RelationInstance"], source: `x:${edge.subject}`, destination: `x:${edge.object}` })),
  ],
});

const put = async (store: MemoryStore, name: string, body: string, mime = "application/json"): Promise<string> => {
  const ref = `ref-${name}`;
  store.assets.set(ref, { name, mime, dataUrl: `data:${mime};base64,${Buffer.from(body).toString("base64")}` });
  return ref;
};

test("extract graph uses the saved extraction beside a PDF, and needs no server", async () => {
  const { call, store, calls } = await setup(demo(NEPHRITIS));
  const ref = await put(store, "reservoir.pdf", "%PDF-1.4", "application/pdf");
  assert.equal(await call("paper.saved", { name: "reservoir.pdf", ref }), null);
  await put(store, "reservoir.graph.json", JSON.stringify(SAVED));
  const saved = await call("paper.saved", { name: "reservoir.pdf", ref });
  assert.deepEqual(saved, { name: "reservoir.graph.json", title: "A paper about reservoirs", model: "a-model", units: 6, relations: 4 });

  const paper = await call("paper.extract", { ref, saved: true });
  assert.equal(paper.title, "A paper about reservoirs");
  assert.equal(paper.units, 6);
  assert.equal(paper.relations, 4);
  assert.equal(paper.model, "a-model");
  assert.equal(paper.server, "Saved extraction (reservoir.graph.json)");
  assert.equal(paper.doi, "10.1000/abc", "a DOI written as a link is kept bare");
  assert.equal(calls.stored.length, 0, "nothing went to a server");

  const again = await call("paper.extract", { ref, saved: true });
  assert.equal(again.id, paper.id, "the same saved file read twice is one paper");
  assert.equal((await call("paper.list", {})).length, 1);
});

test("the paper's own source is told from the ones it cites, and keeps its DOI", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  const ref = await put(store, "reservoir.pdf", "%PDF-1.4", "application/pdf");
  const paper = await call("paper.extract", { ref, saved: { name: "reservoir.graph.json", text: JSON.stringify(SAVED) } });
  const opened = await call("pdf.open", { ref, data: false });
  assert.equal(opened.document.paper?.id, paper.id);
  const view = await call("canvas.open", { id: paper.canvas });
  const source = view.nodes[opened.document.source!]!;
  assert.match(source.title, /A paper about reservoirs/, "not the paper it cites, though that one comes first");
  assert.equal(opened.marks.length, 3, "every unit with a passage is marked in the reader");
});

test("MIRA's own JSON-LD reads into the same graph", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  const ref = await put(store, "reservoir.pdf", "%PDF-1.4", "application/pdf");
  await put(store, "reservoir.mira.jsonld", JSON.stringify(asMira(SAVED)), "application/ld+json");
  const saved = await call("paper.saved", { name: "reservoir.pdf", ref });
  assert.equal(saved?.name, "reservoir.mira.jsonld");
  assert.equal(saved?.units, 6);
  assert.equal(saved?.relations, 4);
  const paper = await call("paper.extract", { ref, saved: true });
  const view = await call("canvas.open", { id: paper.canvas });
  const titles = Object.values(view.nodes).map(({ title }) => title);
  assert.ok(titles.includes("It works."), "the title is the unit's own words, without the description");
  assert.equal(paper.authors[0], "A. Author");
});

test("a picked PDF is kept for the reader, and a file that isn't an extraction says so", async () => {
  const { call, store } = await setup(demo(NEPHRITIS));
  await assert.rejects(call("paper.saved", { name: "x.graph.json", text: "{\"hello\":1}" }), /isn't a saved extraction/);
  await assert.rejects(call("paper.saved", { name: "x.graph.json", text: "not json" }), /isn't valid JSON/);
  await assert.rejects(call("paper.extract", { file: FILE, saved: true }), /No saved extraction/);
  const pdf = { name: "reservoir.pdf", mediaType: "application/pdf", dataBase64: Buffer.from("%PDF-1.4").toString("base64") };
  await call("paper.extract", { file: pdf, saved: { name: "reservoir.graph.json", text: JSON.stringify(SAVED) } });
  assert.ok([...store.assets.values()].some((asset) => asset.name === "reservoir.pdf"), "the reader can find the file by name");
  const listed = await call("pdf.list", {});
  assert.equal(listed[0]?.paper?.title, "A paper about reservoirs");
});

// ---- Reading across papers ----

const METHODS: ExtractionGraph = {
  ...SAVED,
  nodes: [
    ...SAVED.nodes,
    { id: "p1", type: "Protocol", text: "Drive the reservoir with a Lorenz signal." },
    { id: "p2", type: "Protocol", text: "Fit the readout by ridge regression." },
    { id: "p3", type: "Protocol", text: "Compute the testing error." },
  ],
  edges: [...SAVED.edges, { relation: "follows", subject: "g5", object: "p1" }, { relation: "follows", subject: "g5", object: "p2" }, { relation: "follows", subject: "g5", object: "p3" }],
};

const OTHER: ExtractionGraph = {
  source: "capacity.pdf",
  models: ["a-model"],
  paper: { title: "Capacity of dynamical systems", authors: [{ name: "Joni Dambre" }, { name: "David Verstraeten" }, { name: "Serge Massar" }] },
  nodes: [
    { id: "c1", type: "Claim", text: "Reservoir error falls when memory capacity matches the task." },
    { id: "c2", type: "Evidence", text: "Measured capacity stayed near the number of nodes." },
    { id: "c3", type: "SourceDocument", text: "Dambre et al., Sci. Rep. 2, 514 (2012)." },
    { id: "c4", type: "Study", text: "A capacity measurement." },
  ],
  edges: [
    { relation: "supports", subject: "c2", object: "c1" },
    { relation: "describesActivity", subject: "c3", object: "c4" },
    { relation: "grounds", subject: "c4", object: "c2" },
  ],
};

const twoPapers = async () => {
  const made = await setup(demo(NEPHRITIS));
  const first = await made.call("paper.extract", { file: { ...FILE, name: "reservoir-2021.pdf" }, saved: { name: "reservoir-2021.graph.json", text: JSON.stringify(METHODS) } });
  const second = await made.call("paper.extract", { file: { ...FILE, name: "capacity.pdf" }, saved: { name: "capacity.graph.json", text: JSON.stringify(OTHER) } });
  const unitsOf = async (canvas: string) => Object.values((await made.call("canvas.open", { id: canvas })).nodes);
  const [a, b] = [await unitsOf(first.canvas), await unitsOf(second.canvas)];
  const named = (start: string) => [...a, ...b].find((unit) => unit.title.startsWith(start))!;
  return { ...made, first, second, named };
};

test("a unit read from a paper says which, in the few words a person would", async () => {
  const { named } = await twoPapers();
  assert.equal(named("It works").paper?.label, "Author 2021", "one author, and the year from the file's name");
  assert.equal(named("Reservoir error falls").paper?.label, "Dambre et al. 2012", "three authors, and the year from the paper's own citation");
  assert.equal(named("Reservoir error falls").paper?.title, "Capacity of dynamical systems");
});

test("a run a paper reports shows every method it followed, and isn't held to a lab's bookkeeping", async () => {
  const { call, named } = await twoPapers();
  const method = await call("process.method", { id: named("Error fell by half").id });
  const roles = method.chains[0]!.steps.map((step) => step.role);
  assert.deepEqual(roles, ["protocol", "protocol", "protocol", "run", "source", "evidence"]);
  assert.equal(method.chains[0]!.ungrounded, false, "it rests on a run and on the paper");
  assert.equal(method.chains[0]!.steps.find((step) => step.role === "run")!.detail, undefined, "the day it was imported isn't when it ran");
  assert.ok(!method.problems.some((problem) => problem.rule === "evidence-ungrounded"));

  const page = await call("process.run", { id: named("A simulation").id });
  assert.equal(page.protocol?.unit?.title, "Drive the reservoir with a Lorenz signal.");
  assert.equal(page.alsoFollowed.length, 2);
  assert.equal(page.reportedIn?.paper?.label, "Author 2021");
  assert.match(page.reportedIn?.source?.title ?? "", /A paper about reservoirs/);
  assert.deepEqual(page.problems.map((problem) => problem.rule), [], "no study and no code is how a paper's run arrives");
  const listed = (await call("run.list", {})).find((item) => item.run.id === page.run.id)!;
  assert.equal(listed.reported, true);
});

test("a type someone made under the same name but another meaning isn't taken for MIRA's", async () => {
  const { call, core } = await setup(demo(NEPHRITIS));
  const { createNodeType } = await import("@dg/contract/records.ts");
  const me = (await call("identity.get", {})) as unknown as { id: string; name: string };
  void me;
  const odd = createNodeType({ ...(core as unknown as { stamp?: () => never }).stamp?.(), by: { id: "did:plc:someone", name: "Someone" }, space: "s", at: new Date().toISOString(), fields: { label: "Protocol", base: "source", abbreviation: "PRO", titleFormat: "PRO - {content}" } } as never);
  await core.take([odd]);
  const paper = await call("paper.extract", { file: { ...FILE, name: "reservoir-2021.pdf" }, saved: { name: "reservoir-2021.graph.json", text: JSON.stringify(METHODS) } });
  const protocol = Object.values((await call("canvas.open", { id: paper.canvas })).nodes).find((unit) => unit.title.startsWith("Fit the readout"))!;
  assert.equal(protocol.base, "protocol");
});

test("a relation stated away from a canvas is drawn on the canvases that hold both units", async () => {
  const { call, named } = await twoPapers();
  const canvas = await call("canvas.create", { title: "Across papers" });
  const [mine, theirs] = [named("It works"), named("Reservoir error falls")];
  await call("units.put", { canvas: canvas.id, nodes: [mine.id, theirs.id] });
  const option = (await call("relation.options", { source: theirs.id, target: mine.id })).find((item) => item.label === "Supports")!;
  const edges = async () => (await call("canvas.open", { id: canvas.id })).items.filter(({ item }) => "fromNode" in item).length;
  assert.equal(await edges(), 0);
  await call("relation.assert", { type: option.type, source: theirs.id, target: mine.id });
  assert.equal(await edges(), 0, "a canvas draws its own, so nothing is drawn unless asked");
  await call("relation.assert", { type: option.type, source: theirs.id, target: mine.id, draw: true });
  assert.equal(await edges(), 1);
  await call("relation.assert", { type: option.type, source: theirs.id, target: mine.id, draw: true });
  assert.equal(await edges(), 1, "and only once");
});

test("a claim says what it rests on through other claims, and which papers that comes from", async () => {
  const { call, named } = await twoPapers();
  const own = await call("node.create", { title: "Capacity, not the reservoir, is what matters.", type: named("It works").type! });
  for (const from of [named("It works"), named("Reservoir error falls")]) {
    const option = (await call("relation.options", { source: from.id, target: own.id })).find((item) => item.label === "Supports")!;
    await call("relation.assert", { type: option.type, source: from.id, target: own.id });
  }
  const method = await call("process.method", { id: own.id });
  assert.equal(method.rests?.claims, 2);
  assert.equal(method.rests?.evidence, 2);
  assert.equal(method.rests?.runs, 2);
  assert.deepEqual(method.rests?.papers.map((paper) => paper.label).sort(), ["Author 2021", "Dambre et al. 2012"]);
  assert.equal((await call("process.method", { id: named("It works").id })).rests, undefined, "a claim resting straight on evidence has its chains instead");
});

test("units that read alike in other papers are offered, and never the same paper's or ones already related", async () => {
  const { call, named } = await twoPapers();
  const own = await call("node.create", { title: "Reservoir error depends on memory capacity matching the task.", type: named("It works").type! });
  const found = await call("node.similar", { id: own.id });
  assert.equal(found[0]?.node.title, "Reservoir error falls when memory capacity matches the task.");
  assert.ok(found[0]!.shared.length >= 2, "it says which words they share");
  const fromSamePaper = await call("node.similar", { id: named("Reservoir error falls").id });
  assert.ok(fromSamePaper.every((item) => item.node.paper?.label !== "Dambre et al. 2012"));
  const option = (await call("relation.options", { source: found[0]!.node.id, target: own.id })).find((item) => item.label === "Supports")!;
  await call("relation.assert", { type: option.type, source: found[0]!.node.id, target: own.id });
  assert.ok(!(await call("node.similar", { id: own.id })).some((item) => item.node.id === found[0]!.node.id), "once related, it's no longer a lead");
});
