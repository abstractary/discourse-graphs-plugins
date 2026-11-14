// The local app: the holon views and canvas repository over a vault's record log.
//   node local/src/main.ts --vault <folder> [--port 8796] [--name "Your name"]
// The vault can be an Obsidian vault. The app reads every device's log in
// `discourse-graph/records/`, the same files the Obsidian plugin reads, and it
// writes its own log there as one more device. So Obsidian sees what it writes,
// and it sees Obsidian's edits as they land. It also mirrors each canvas as a
// JSON Canvas file under `discourse-graph/canvases/`, which Obsidian opens natively.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildCanvas, type CanvasRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfacePort } from "@dg/contract/surface.ts";
import { createCore } from "@dg/core/index.ts";
import { createLlm } from "@dg/sync/providers.ts";
import { openVault } from "./vault.ts";

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    port: { type: "string", default: "8796" },
    name: { type: "string" },
    keys: { type: "string" },
  },
});
if (!values.vault) {
  console.error("Usage: node local/src/main.ts --vault <folder> [--port 8796] [--name \"Your name\"]");
  process.exit(1);
}
const UI = join(import.meta.dirname, "..", "..", "dist", "local.html");

// Core writes its identity while it starts, before the mirror below can run.
let ready = false;
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleMirror(): void {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(mirror, 300);
}

const opened = openVault({
  vault: values.vault,
  keys: values.keys ?? join(homedir(), ".discourse-graphs", "local-app"),
  ...(values.name ? { name: values.name } : {}),
  onWrite: scheduleMirror,
  onArrival: scheduleMirror,
});
const { host } = opened;
const VAULT = opened.path;
const CANVASES = join(opened.root, "canvases");
const settings = { deviceId: opened.device };
const store = { records: { get length() { return opened.recordCount(); } } };

// The call to a provider is made here, in Node, so the page never holds the key.
const core = await createCore({ host, keys: opened.keys, llm: createLlm({ browser: false }), secrets: opened.secrets });
if (values.name && core.personName() !== values.name) await core.setName(values.name);


// ---------------------------------------------------------------------------
// JSON Canvas mirror. A nested canvas becomes a file node, which Obsidian draws
// as that canvas. The mirror is written from the log and never read back.

const slug = (title: string): string => title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Canvas";
function mirror(): void {
  if (!ready) return;
  mkdirSync(CANVASES, { recursive: true });
  const graph = core.graph();
  const canvases = [...graph.documents.values()].filter((r): r is CanvasRecord => r.kind === "canvas" && !r.removed);
  const names = new Map(canvases.map((c) => [c.id, `${slug(c.title)}.canvas`]));
  for (const canvas of canvases) {
    const doc = buildCanvas({ graph, canvas: canvas.id });
    for (const node of doc.nodes) {
      if (node.type === "file" && node.dg?.canvas && names.has(node.dg.canvas)) node.file = `discourse-graph/canvases/${names.get(node.dg.canvas)}`;
    }
    const path = join(CANVASES, names.get(canvas.id)!);
    const text = `${JSON.stringify(doc, null, "\t")}\n`;
    if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
  }
}
ready = true;
mirror();

// ---------------------------------------------------------------------------
// HTTP: the page, an RPC endpoint, and server-sent events. Each browser tab
// gets a port of its own, the same port a frame gets inside a base.

type Tab = {
  port: SurfacePort;
  listeners: Set<(message: SurfaceMessage) => void>;
  stream?: ServerResponse;
  waiting: Map<string, (message: SurfaceMessage) => void>;
  queue: SurfaceMessage[];
  disconnect?: () => void;
};
const tabs = new Map<string, Tab>();
const tabOf = (id: string): Tab => {
  const known = tabs.get(id);
  if (known) return known;
  const tab: Tab = {
    listeners: new Set(),
    waiting: new Map(),
    queue: [],
    port: {
      send: (message) => {
        const answer = "id" in message ? tab.waiting.get(String(message.id)) : undefined;
        if (answer) {
          tab.waiting.delete(String((message as { id: string }).id));
          answer(message);
        } else if (tab.stream) tab.stream.write(`data: ${JSON.stringify(message)}\n\n`);
        else tab.queue.push(message);
      },
      onMessage: (listener) => {
        tab.listeners.add(listener);
        return () => tab.listeners.delete(listener);
      },
    },
  };
  tabs.set(id, tab);
  tab.disconnect = core.connectSurface({ port: tab.port });
  return tab;
};

const readBody = (request: import("node:http").IncomingMessage): Promise<string> =>
  new Promise((done, fail) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => done(body));
    request.on("error", fail);
  });

const PORT = Number(values.port);
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  // Only this machine's pages may call in.
  const origin = request.headers.origin;
  if (origin && origin !== `http://localhost:${PORT}` && origin !== `http://127.0.0.1:${PORT}`) {
    response.writeHead(403).end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    if (!existsSync(UI)) {
      response.writeHead(503, { "content-type": "text/plain" }).end("Build the page first: npm run build:local");
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(readFileSync(UI));
    return;
  }
  if (request.method === "GET" && url.pathname === "/events") {
    const tab = tabOf(url.searchParams.get("tab") ?? "");
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    tab.stream = response;
    for (const message of tab.queue.splice(0)) response.write(`data: ${JSON.stringify(message)}\n\n`);
    // A closed page lets go of its port. If it reconnects, it gets a fresh one.
    request.on("close", () => {
      if (tab.stream !== response) return;
      tab.disconnect?.();
      tabs.delete(url.searchParams.get("tab") ?? "");
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/rpc") {
    const message = JSON.parse(await readBody(request)) as { tab: string; id: string; method: string; params: unknown };
    const tab = tabOf(message.tab);
    const answer = new Promise<SurfaceMessage>((done) => tab.waiting.set(message.id, done));
    for (const listener of tab.listeners) listener({ id: message.id, method: message.method, params: message.params } as SurfaceMessage);
    const result = await answer;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    return;
  }
  if (request.method === "GET" && url.pathname === "/about") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ vault: VAULT, device: settings.deviceId, records: store.records.length, canvases: CANVASES }));
    return;
  }
  response.writeHead(404).end();
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Discourse Graphs local app on http://localhost:${PORT}`);
  console.log(`Vault ${VAULT}: ${store.records.length} records; this device writes ${opened.log.replace(VAULT + "/", "")}`);
});
process.on("SIGINT", () => {
  core.stop();
  server.close();
  process.exit(0);
});
