// The local app: the holon views and canvas repository over a vault's record log.
//   node local/src/main.ts --vault <folder> [--port 8796] [--name "Your name"]
// The vault can be an Obsidian vault. The app reads every device's log in
// `discourse-graph/records/`, the same files the Obsidian plugin reads, and it
// writes its own log there as one more device. So Obsidian sees what it writes,
// and it sees Obsidian's edits as they land. It also mirrors each canvas as a
// JSON Canvas file under `discourse-graph/canvases/`, which Obsidian opens natively.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import {
  buildCanvas,
  canonicalJson,
  uuidv7,
  type CanvasRecord,
  type DgRecord,
} from "@dg/contract/records.ts";
import type { Host } from "@dg/contract/host.ts";
import type { SurfaceMessage, SurfacePort } from "@dg/contract/surface.ts";
import { createCore } from "@dg/core/index.ts";
import { createLlm } from "@dg/sync/providers.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { KeyStore } from "@dg/core/identity.ts";

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
const VAULT = resolve(values.vault);
const ROOT = join(VAULT, "discourse-graph");
const RECORDS = join(ROOT, "records");
const CANVASES = join(ROOT, "canvases");
const UI = join(import.meta.dirname, "..", "..", "dist", "local.html");
const PAPER_FILES = "Paper files";
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
mkdirSync(RECORDS, { recursive: true });

// ---------------------------------------------------------------------------
// This device: its id and settings live in the vault, its keys never do.

const SETTINGS = join(ROOT, "local-app.json");
type Settings = { deviceId: string; local: Record<string, unknown> };
const settings: Settings = existsSync(SETTINGS)
  ? (JSON.parse(readFileSync(SETTINGS, "utf8")) as Settings)
  : { deviceId: `local-${uuidv7()}`, local: {} };
const saveSettings = (): void => writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 1)}\n`);
saveSettings();
const deviceLog = join(RECORDS, `${settings.deviceId}.jsonl`);

const spaceFile = join(ROOT, "space.json");
const spaceId = existsSync(spaceFile) ? (JSON.parse(readFileSync(spaceFile, "utf8")) as { id: string }).id : uuidv7();
if (!existsSync(spaceFile)) writeFileSync(spaceFile, JSON.stringify({ id: spaceId }));

/** Keys stay outside the vault, which may sync elsewhere, in a file only this user can read. */
const fileKeys = (folder: string): KeyStore => {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
  const pathOf = (name: string) => join(folder, `${createHash("sha256").update(`${VAULT}:${name}`).digest("hex").slice(0, 16)}.json`);
  const load = async (path: string): Promise<CryptoKeyPair> => {
    const { privateKey, publicKey } = JSON.parse(readFileSync(path, "utf8")) as { privateKey: JsonWebKey; publicKey: JsonWebKey };
    return {
      privateKey: await crypto.subtle.importKey("jwk", privateKey, ECDSA, false, ["sign"]),
      publicKey: await crypto.subtle.importKey("jwk", publicKey, ECDSA, true, ["verify"]),
    };
  };
  return {
    get: async (name) => {
      const path = pathOf(name);
      if (!existsSync(path)) {
        const pair = (await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"])) as CryptoKeyPair;
        const jwk = { privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey), publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
        writeFileSync(path, JSON.stringify(jwk), { mode: 0o600 });
      }
      return load(path);
    },
    put: async () => undefined,
  };
};

// ---------------------------------------------------------------------------
// The record log: every device's file, read the way the Obsidian plugin reads it.

// Core writes its identity while it starts, before the mirror below can run.
let ready = false;
let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleMirror(): void {
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(mirror, 300);
}

const store = createMemoryStore();
store.spaceId = spaceId;
for (const [key, value] of Object.entries(settings.local)) store.local.set(key, value as never);
const seen = new Set<string>();

/** New records from every device's log. A line with no trailing newline may be mid-write. */
const readLogs = (): DgRecord[] => {
  const fresh: DgRecord[] = [];
  for (const name of readdirSync(RECORDS).filter((f) => f.endsWith(".jsonl")).sort()) {
    const lines = readFileSync(join(RECORDS, name), "utf8").split("\n");
    lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as DgRecord;
      const key = canonicalJson(record);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(record);
    }
  }
  return fresh;
};
store.records.push(...readLogs());

const { host: memory, emit } = createMemoryHost({ store, host: "local" });
const host: Host = {
  ...memory,
  describe: async () => {
    const info = await memory.describe();
    if (!info.ok) return info;
    return { ...info, value: { ...info.value, space: { id: spaceId, name: VAULT.split("/").pop() ?? "Vault" }, person: { id: settings.deviceId, name: values.name ?? "Local app" } } };
  },
  // What core writes goes to this device's own log, so Obsidian reads it as another device.
  putRecords: async (args) => {
    const result = await memory.putRecords(args);
    if (result.ok && args.records.length) {
      const lines = args.records.map((record) => {
        seen.add(canonicalJson(record));
        return `${JSON.stringify(record)}\n`;
      });
      appendFileSync(deviceLog, lines.join(""));
      scheduleMirror();
    }
    return result;
  },
  setLocal: async (args) => {
    const result = await memory.setLocal(args);
    settings.local[args.key] = args.value;
    saveSettings();
    return result;
  },
  // Files are the vault's own, by their path in it, the same refs Obsidian uses.
  listFiles: async ({ extensions, limit }) => {
    const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));
    const found = vaultFiles(VAULT).filter((path) => wanted.has(extname(path).slice(1).toLowerCase()));
    const files = found
      .map((path) => ({ path, stat: statSync(path) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, limit)
      .map(({ path, stat }) => {
        const ref = relative(VAULT, path).split(sep).join("/");
        const folder = dirname(ref);
        return {
          ref,
          name: ref.split("/").pop()!,
          mime: MIME[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream",
          ...(folder !== "." ? { folder } : {}),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      });
    return { ok: true, value: files };
  },
  readAsset: async ({ ref }) => {
    const path = inVault(ref);
    if (!path || !existsSync(path)) return memory.readAsset({ ref });
    const mime = MIME[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";
    return { ok: true, value: { name: path.split(sep).pop()!, mime, dataUrl: `data:${mime};base64,${readFileSync(path).toString("base64")}` } };
  },
  // A reference library's PDF, read where the library keeps it.
  readLocalFile: async ({ path }) => {
    if (!/\.pdf$/i.test(path)) return { ok: false, error: { code: "unavailable", message: "Only PDFs are read from outside the vault." } };
    if (!existsSync(path)) return { ok: false, error: { code: "not-found", message: `${path.split(sep).pop()} isn't where Zotero says it is. Open it in Zotero once so it downloads.` } };
    return { ok: true, value: { name: path.split(sep).pop()!, mime: "application/pdf", dataUrl: `data:application/pdf;base64,${readFileSync(path).toString("base64")}` } };
  },
  writeAsset: async ({ asset }) => {
    if (asset.mime !== "application/pdf") return memory.writeAsset({ asset });
    mkdirSync(join(VAULT, PAPER_FILES), { recursive: true });
    const clean = asset.name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Document.pdf";
    const dot = clean.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot + 1)] : [clean, "pdf"];
    let ref = `${PAPER_FILES}/${stem}.${extension}`;
    for (let n = 2; existsSync(join(VAULT, ref)); n += 1) ref = `${PAPER_FILES}/${stem} ${n}.${extension}`;
    writeFileSync(join(VAULT, ref), Buffer.from(asset.dataUrl.split(",")[1] ?? "", "base64"));
    return { ok: true, value: { ref } };
  },
};

/** A vault path, kept inside the vault. */
function inVault(ref: string): string | null {
  const path = resolve(VAULT, ref);
  return path.startsWith(VAULT + sep) ? path : null;
}
/** Every file in the vault, skipping the hidden folders Obsidian keeps. */
function vaultFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(folder, entry.name);
    return entry.isDirectory() ? vaultFiles(path) : [path];
  });
}

const KEYS = values.keys ?? join(homedir(), ".discourse-graphs", "local-app");

/** Model keys sit beside the signing keys, outside the vault, in a file only this user can read. */
const fileSecrets = (folder: string): SecretStore => {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, "secrets.json");
  const read = (): Record<string, string> => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {});
  return {
    kind: "file",
    get: async (id) => read()[id] ?? null,
    set: async (id, value) => {
      const all = read();
      if (value) all[id] = value;
      else delete all[id];
      writeFileSync(path, JSON.stringify(all), { mode: 0o600 });
    },
  };
};

// The call to a provider is made here, in Node, so the page never holds the key.
const core = await createCore({ host, keys: fileKeys(KEYS), llm: createLlm({ browser: false }), secrets: fileSecrets(KEYS) });
if (values.name && core.personName() !== values.name) await core.setName(values.name);

// Obsidian, or another device, wrote to the log.
let pending: ReturnType<typeof setTimeout> | undefined;
watch(RECORDS, () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    const fresh = readLogs();
    if (!fresh.length) return;
    store.records.push(...fresh);
    emit({ type: "records-changed" });
    scheduleMirror();
  }, 150);
});

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
  console.log(`Vault ${VAULT}: ${store.records.length} records; this device writes ${deviceLog.replace(VAULT + "/", "")}`);
});
process.on("SIGINT", () => {
  core.stop();
  server.close();
  process.exit(0);
});
