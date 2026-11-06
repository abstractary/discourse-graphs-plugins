// The surface under test. The same built file runs in every base, and it can
// only talk to the base through the MessagePort it is handed.
import type { DgCanvas, NodeTypeRecord, RelationTypeRecord } from "@dg/contract/records.ts";
import type { NodeSummary, SurfaceMethod, SurfaceMethods } from "@dg/contract/surface.ts";

declare const __PANEL_BUILD__: string;

type Check = { id: string; pass: boolean; detail: string };

let port: MessagePort | undefined;
let nextId = 0;
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const graphEvents: number[] = [];

const call = <M extends SurfaceMethod>(
  method: M,
  params: SurfaceMethods[M]["params"],
): Promise<SurfaceMethods[M]["result"]> =>
  new Promise((resolve, reject) => {
    nextId += 1;
    const id = `r${nextId}`;
    waiting.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    port!.postMessage({ id, method, params });
  });

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  parent: HTMLElement = document.body,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.appendChild(node);
  return node;
};

const drawCanvas = (doc: DgCanvas, parent: HTMLElement): void => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const width = Math.max(...doc.nodes.map((node) => node.x + node.width)) + 20;
  const height = Math.max(...doc.nodes.map((node) => node.y + node.height)) + 20;
  svg.setAttribute("viewBox", `-10 -10 ${width} ${height}`);
  svg.setAttribute("class", "canvas");
  const shape = (name: string, attrs: Record<string, string | number>, text?: string): void => {
    const item = document.createElementNS(ns, name);
    for (const [key, val] of Object.entries(attrs)) item.setAttribute(key, String(val));
    if (text) item.textContent = text;
    svg.appendChild(item);
  };
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  for (const edge of doc.edges) {
    const from = byId.get(edge.fromNode)!;
    const to = byId.get(edge.toNode)!;
    shape("line", {
      x1: from.x, y1: from.y + from.height / 2,
      x2: to.x + to.width, y2: to.y + to.height / 2,
      class: "edge",
    });
    shape("text", {
      x: (from.x + to.x + to.width) / 2, y: from.y + from.height / 2 - 8,
      class: "edge-label", "text-anchor": "middle",
    }, edge.label);
  }
  for (const node of doc.nodes) {
    shape("rect", { x: node.x, y: node.y, width: node.width, height: node.height, rx: 6, class: "card" });
    if (node.type === "text") {
      shape("text", { x: node.x + 12, y: node.y + node.height / 2 + 5, class: "card-text" }, node.text);
    }
  }
  parent.appendChild(svg);
};

const run = async (): Promise<void> => {
  const checks: Check[] = [];
  const check = async (id: string, work: () => Promise<string>): Promise<void> => {
    try {
      checks.push({ id, pass: true, detail: await work() });
    } catch (error) {
      checks.push({ id, pass: false, detail: String(error) });
    }
  };

  await check("panel.isolated-from-host", async () => {
    let reachable = true;
    try {
      void (window.parent as Window).document.title;
    } catch (error) {
      reachable = false;
      return `parent blocked: ${(error as Error).name}`;
    }
    if (reachable) throw new Error("the panel can reach the host page");
    return "";
  });

  let storage = "available";
  try {
    window.localStorage.setItem("dg", "1");
  } catch (error) {
    storage = `blocked: ${(error as Error).name}`;
  }

  const stamp = String(Date.now());
  const { nodeTypes, relationTypes } = await call("grammar.get", {});
  const typeOf = (base: string): NodeTypeRecord =>
    nodeTypes.find((type) => type.base === base)!;
  const relationOf = (base: string): RelationTypeRecord =>
    relationTypes.find((type) => type.base === base)!;

  let claim: NodeSummary | undefined;
  let evidence: NodeSummary | undefined;
  await check("panel.create-nodes", async () => {
    claim = await call("node.create", { title: `Panel claim ${stamp}`, type: typeOf("claim").id });
    evidence = await call("node.create", { title: `Panel evidence ${stamp}`, type: typeOf("evidence").id });
    return "created in the base through the port";
  });

  const eventsBefore = graphEvents.length;
  await check("panel.assert-relation", async () => {
    const relation = await call("relation.assert", {
      type: relationOf("supports").id,
      source: evidence!.id,
      target: claim!.id,
    });
    return relation.id;
  });

  await check("panel.hears-graph-changed", async () => {
    for (let i = 0; i < 40 && graphEvents.length === eventsBefore; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (graphEvents.length === eventsBefore) throw new Error("no graph-changed event");
    return `${graphEvents.length - eventsBefore} event(s)`;
  });

  let shared: DgCanvas | undefined;
  await check("panel.canvas-round-trip", async () => {
    const canvas = await call("canvas.create", { title: `Panel canvas ${stamp}` });
    const box = { type: "text", y: 0, width: 280, height: 70 } as const;
    const cards = await call("canvas.write", {
      canvas: canvas.id,
      upserts: [
        { item: { ...box, x: 0, text: evidence!.title, dg: { node: evidence!.id } }, z: 1 },
        { item: { ...box, x: 380, text: claim!.title, dg: { node: claim!.id } }, z: 2 },
      ],
    });
    await call("canvas.write", {
      canvas: canvas.id,
      upserts: [{ item: { fromNode: cards.ids[0]!, toNode: cards.ids[1]!, label: "Supports" }, z: 3 }],
    });
    const doc = await call("canvas.export", { id: canvas.id });
    if (doc.nodes.length !== 2 || doc.edges.length !== 1) throw new Error("canvas lost items");
    shared = doc;
    return `${doc.nodes.length} cards, ${doc.edges.length} edge`;
  });

  await check("panel.view-reads-the-base", async () => {
    const view = await call("node.view", { id: claim!.id });
    if (view.body === null) throw new Error("no text came back from the base");
    if (view.context.length !== 1) throw new Error("context missing the relation");
    return `state ${view.context[0]!.state}`;
  });

  await check("panel.no-host-refs-reach-the-surface", async () => {
    const seen = JSON.stringify(await call("node.view", { id: claim!.id }));
    if (seen.includes('"ref"') || seen.includes('"anchor"')) throw new Error("a host ref leaked");
    return "none in node.view";
  });

  await check("panel.reveal-in-base", async () => {
    await call("base.reveal", { id: claim!.id, placement: "main" });
    return "asked the base to reveal the node";
  });

  const started = performance.now();
  const rounds = 200;
  for (let i = 0; i < rounds; i += 1) await call("node.query", { limit: 5 });
  const latencyMs = (performance.now() - started) / rounds;

  document.body.textContent = "";
  el("h1", "Discourse Graphs panel");
  el("p", `Build ${__PANEL_BUILD__}. This view doesn't know which base it's in.`);
  el("h2", "Canvas");
  if (shared) drawCanvas(shared, document.body);
  el("h2", "Frame checks");
  const list = el("ul");
  for (const item of checks) {
    el("li", `${item.pass ? "Pass" : "FAIL"}: ${item.id}`, list);
  }
  el("p", `Round trip ${latencyMs.toFixed(2)} ms. Frame storage ${storage}.`);

  port!.postMessage({
    event: "panel-report",
    data: {
      build: __PANEL_BUILD__,
      checks,
      latencyMs,
      storage,
      claim: claim?.id,
      evidence: evidence?.id,
      titles: [claim?.title, evidence?.title].map((title) => title?.replace(stamp, "<stamp>")),
      canvasShape: shared
        ? { nodes: shared.nodes.map((node) => ({ type: node.type, x: node.x, y: node.y })), edges: shared.edges.map((edge) => edge.label) }
        : null,
    },
  });
};

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as { type?: string } | undefined;
  if (data?.type !== "dg-connect" || !event.ports[0]) return;
  port = event.ports[0];
  port.onmessage = (incoming: MessageEvent) => {
    const message = incoming.data as {
      id?: string; ok?: boolean; result?: unknown; error?: { message: string }; event?: string;
    };
    if (message.event === "graph-changed") graphEvents.push(Date.now());
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id)!;
      waiting.delete(message.id);
      if (message.ok) resolve(message.result);
      else reject(new Error(message.error?.message));
    }
  };
  void run();
});
