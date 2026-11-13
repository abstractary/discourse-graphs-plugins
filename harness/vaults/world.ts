import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore, type Core } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import type { DgRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { createServices } from "@dg/sync/client.ts";
import { startLabSync } from "@dg/sync/lab-sync.ts";
import { ZOTERO_LOCAL } from "@dg/sync/zotero.ts";

/**
 * Several people, each with a vault of their own, and one lab server between
 * them. Every vault runs the real core, the real services client and the real
 * sync loop. The server is the reference server on a port of its own.
 *
 * Nothing here reaches outside this process. A vault's network goes through
 * one door, which lets through the lab server, answers for a Zotero of the
 * vault's own when it has one, and refuses everything else. The door also
 * keeps what each vault sent, so "did private work leave the device" is read
 * off the wire and not inferred.
 */

export type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

export type Sent = { at: number; method: string; path: string; records: DgRecord[] };

export type Vault = {
  name: string;
  core: Core;
  call: Call;
  store: MemoryStore;
  /** Whether this vault can reach the lab server. Off unless a round is running. */
  online: boolean;
  /** How far this person's computer clock is off, in milliseconds. Everything they do runs on it. */
  skewMs: number;
  /** Everything this vault sent to the lab server. */
  sent: Sent[];
  /** Files opened in the base's own panels, by surface name. */
  opened: string[];
  /** One full exchange with the lab: send what is new, take what arrived. */
  sync: () => Promise<void>;
  /** Every record this vault holds, whoever wrote it. */
  records: () => DgRecord[];
  did: () => string;
  stop: () => void;
};

export type World = {
  server: string;
  vaults: Vault[];
  vault: (name: string) => Vault;
  /** Rounds for the named vaults, in order, until nothing more moves. */
  settle: (names?: string[]) => Promise<void>;
  /** What the server holds for a lab, as it would hand it to a member. */
  restartServer: () => Promise<void>;
  close: () => Promise<void>;
};

export type Zotero = (input: string | URL | Request) => Promise<Response>;

const fixture = (name: string): Record<string, unknown>[] => JSON.parse(readFileSync(`test/fixtures/zotero/${name}.json`, "utf8")) as Record<string, unknown>[];

/**
 * One person's Zotero. `personal` gives them a library of their own with one paper, its PDF and
 * highlights on it. `group` gives them a group library with another paper, under the same keys
 * every member of that group sees, and the file in this person's own Zotero folder.
 */
export const zoteroWith = ({ personal = true, group }: { personal?: boolean; group?: { id: number; name: string } }) => (store: MemoryStore): Zotero => {
  const mine = { type: "user", id: 0, name: "My Library" };
  const path = "/Users/reader/Zotero/storage/PDFA0001/Carroll 2020.pdf";
  const item = { ...fixture("items")[0]!, library: mine };
  const pdf = {
    ...fixture("children")[0]!,
    library: mine,
    links: { enclosure: { href: `file://${encodeURI(path)}`, type: "application/pdf", length: 14 } },
  };
  const marks = fixture("annotations").map((raw) => ({ ...raw, library: mine }));
  if (personal) store.outside.set(path, { name: "Carroll 2020.pdf", mime: "application/pdf", dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 carroll")}` });

  const theirs = group ? { type: "group", id: group.id, name: group.name } : null;
  const groupPath = "/Users/reader/Zotero/storage/PDFG0001/Gauthier 2021.pdf";
  const base = fixture("items")[0]! as { key: string; data: Record<string, unknown> };
  const groupItem = { ...base, key: "GRPA0001", library: theirs, data: { ...base.data, key: "GRPA0001", title: "Next generation reservoir computing", DOI: "10.1038/s41467-021-25801-2", url: "https://www.nature.com/articles/s41467-021-25801-2", extra: "", publicationTitle: "Nature Communications", date: "2021", creators: [{ creatorType: "author", firstName: "Daniel", lastName: "Gauthier" }] } };
  const child = fixture("children")[0]! as { key: string; data: Record<string, unknown> };
  const groupPdf = {
    ...child,
    key: "PDFG0001",
    library: theirs,
    data: { ...child.data, key: "PDFG0001", parentItem: "GRPA0001", filename: "Gauthier 2021.pdf", title: "Gauthier 2021.pdf" },
    links: { enclosure: { href: `file://${encodeURI(groupPath)}`, type: "application/pdf", length: 15 } },
  };
  if (group) store.outside.set(groupPath, { name: "Gauthier 2021.pdf", mime: "application/pdf", dataUrl: `data:application/pdf;base64,${btoa("%PDF-1.7 gauthier")}` });

  return async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const at = url.pathname.replace(/^\/api/, "");
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "Zotero-Server-ID": "srv-1", "X-Zotero-Version": "10.0.9" } });
    const attachments = url.searchParams.get("itemType") === "attachment";
    const first = url.searchParams.get("start") === "0";
    if (at === "/users/0/groups") return json(group ? [{ id: group.id, data: { name: group.name } }] : []);
    if (at === "/users/0/items" && attachments) return json(personal && first ? [pdf] : []);
    if (at === "/users/0/items" && url.searchParams.get("itemKey")) return json(personal ? [item] : []);
    if (at === "/users/0/items") return json([]);
    if (personal && at === "/users/0/items/PDFA0001") return json(pdf);
    if (personal && at === "/users/0/items/ABCD2345") return json(item);
    if (personal && at === "/users/0/items/ABCD2345/children") return json([pdf]);
    if (personal && at === "/users/0/items/PDFA0001/children") return json(marks);
    if (group) {
      const root = `/groups/${group.id}/items`;
      if (at === root && attachments) return json(first ? [groupPdf] : []);
      if (at === root && url.searchParams.get("itemKey")) return json([groupItem]);
      if (at === root) return json([]);
      if (at === `${root}/PDFG0001`) return json(groupPdf);
      if (at === `${root}/GRPA0001`) return json(groupItem);
      if (at === `${root}/GRPA0001/children`) return json([groupPdf]);
      if (at === `${root}/PDFG0001/children`) return json([]);
    }
    return new Response("Not found", { status: 404 });
  };
};

/** A personal library only. */
export const personalZotero = zoteroWith({});

export const ZOTERO_FILE = "zotero:users/0/items/PDFA0001";
export const LAB_GROUP = { id: 4821, name: "Tension Lab papers" };
export const GROUP_FILE = `zotero:groups/${LAB_GROUP.id}/items/PDFG0001`;

/** Runs one person's work with their computer's clock set fast or slow. */
const RealDate = Date;
export const withClock = async <T>(offsetMs: number, work: () => Promise<T>): Promise<T> => {
  if (offsetMs === 0) return work();
  class Skewed extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + offsetMs);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + offsetMs;
    }
  }
  globalThis.Date = Skewed as DateConstructor;
  try {
    return await work();
  } finally {
    globalThis.Date = RealDate;
  }
};

const offline = (): never => {
  throw new TypeError("fetch failed");
};

const openVault = async ({ name, server, zotero }: { name: string; server: () => string; zotero?: (store: MemoryStore) => Zotero }): Promise<Vault> => {
  const store = createMemoryStore();
  const { host } = createMemoryHost({ store });
  const opened: string[] = [];
  const base = { ...host, openSurface: async (args: { route: { surface: string } }) => (opened.push(args.route.surface), { ok: true as const, value: null }) };
  const library = zotero?.(store);
  const sent: Sent[] = [];
  const vault = { name, online: false, skewMs: 0, sent, opened, store } as Vault;

  const door = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(ZOTERO_LOCAL)) return library ? library(input) : offline();
    if (!url.startsWith(server())) return offline();
    if (!vault.online) return offline();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { records?: DgRecord[] }) : {};
    sent.push({ at: Date.now(), method: init?.method ?? "GET", path: new URL(url).pathname, records: body.records ?? [] });
    const response = await fetch(input, init);
    // The server shares this process, so it read the time off this vault's skewed clock. Its own clock is right.
    if (vault.skewMs === 0 || !response.ok || !new URL(url).pathname.endsWith("/records")) return response;
    const answer = (await response.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...answer, now: new RealDate().toISOString() }), { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const kept = new Map<string, unknown>();
  const services = createServices({
    fetch: door,
    outside: door,
    store: { get: async (key) => kept.get(key) ?? null, set: async (key, value) => void kept.set(key, value) },
  });
  const core = await createCore({ host: base as never, services, demoGraphs: [] });

  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    withClock(vault.skewMs, () => new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    }));

  // The real loop, with its own timer. A vault is offline unless a round was asked for, so the timer's own rounds fail and are dropped.
  let failures = 0;
  const loop = startLabSync({ services, target: core, onError: () => void (failures += 1) });
  const sync = async (): Promise<void> => {
    vault.online = true;
    try {
      for (let tries = 0; tries < 5; tries += 1) {
        const before = failures;
        await withClock(vault.skewMs, () => loop.now());
        if (failures === before) return;
      }
      throw new Error(`${name} could not finish a round with the lab.`);
    } finally {
      vault.online = false;
    }
  };

  return Object.assign(vault, {
    core,
    call,
    sync,
    records: () => [...store.records],
    did: () => core.identity().did,
    stop: () => {
      loop.stop();
      core.stop();
    },
  });
};

type Running = { port: number; close: () => Promise<void> };
/** The reference server keeps its own type settings, so it is loaded as it runs and not checked here. */
const serverModule = (name: string): Promise<Record<string, (...args: never[]) => unknown>> => import(new URL(`../../server/src/${name}.ts`, import.meta.url).href);

export const openWorld = async (people: { name: string; zotero?: (store: MemoryStore) => Zotero }[]): Promise<World> => {
  const startServer = (await serverModule("app")).startServer as unknown as (config: Record<string, unknown>) => Promise<Running>;
  const loadConfig = (await serverModule("config")).loadConfig as unknown as (env: Record<string, string>) => Record<string, unknown>;
  const dataDir = mkdtempSync(join(tmpdir(), "dg-vaults-"));
  const config = { ...loadConfig({}), port: 0, dataDir, miraUrl: "http://127.0.0.1:9/closed", replayMs: 20 };
  let running = await startServer(config);
  let port = running.port;
  const server = (): string => `http://127.0.0.1:${port}`;
  const vaults: Vault[] = [];
  for (const person of people) {
    const vault = await openVault({ ...person, server });
    await vault.call("identity.setName", { name: person.name });
    vaults.push(vault);
  }
  const vault = (name: string): Vault => {
    const found = vaults.find((item) => item.name === name);
    if (!found) throw new Error(`No vault for ${name}.`);
    return found;
  };
  const settle = async (names: string[] = vaults.map((item) => item.name)): Promise<void> => {
    // What one vault sends in a round, another can only take in a later one.
    for (let pass = 0; pass < 6; pass += 1) {
      const before = names.map((name) => vault(name).records().length).join(",");
      for (const name of names) await vault(name).sync();
      if (pass > 0 && before === names.map((name) => vault(name).records().length).join(",")) return;
    }
  };
  return {
    get server() {
      return server();
    },
    vaults,
    vault,
    settle,
    restartServer: async () => {
      await running.close();
      running = await startServer({ ...config, port });
      port = running.port;
    },
    close: async () => {
      for (const item of vaults) item.stop();
      await running.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
};
