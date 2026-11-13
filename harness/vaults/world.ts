import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { createCore, type Core } from "@dg/core/index.ts";
import type { KeyStore } from "@dg/core/identity.ts";
import { readLog } from "@dg/contract/log.ts";
import { resetIds } from "@dg/contract/ids.ts";
import { canonicalJson, clock, entropy } from "@dg/contract/records.ts";
import type { HostEvent } from "@dg/contract/host.ts";
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
  /** An older app: what it sends carries no signature and doesn't say which version it replaces. */
  old: boolean;
  /** This device's keys, so a test can sign as it would. */
  keys: KeyStore;
  /** Tells the core that the log changed underneath it, as a file-sync tool arriving does. */
  changed: (event: HostEvent) => void;
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

/** What a file-sync tool can do to a log on its way between two of a person's devices. */
export type SyncFault = "clean" | "torn" | "doubled" | "joined" | "crlf";

export type World = {
  server: string;
  /** The world's one clock. Nothing in a run reads the real time, so the same seed gives the same records. */
  time: { ms: number };
  /** Another device of someone already here: same vault, its own keys and its own link to the lab. */
  openDevice: (of: string, name: string) => Promise<Vault>;
  /** Carries each device's log to the other, as a file-sync tool would, with whatever it does on the way. */
  fileSync: (a: Vault, b: Vault, fault?: SyncFault) => Promise<{ skipped: number }>;
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

/** A seeded source of chance. */
export const chance = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Keys that come out the same on every run of a seed, signed with the same bytes every time. The
 * platform's own keys are random and so are its signatures, and a person's DID is the hash of a
 * signed operation, so without this no two runs would even agree on who anyone is.
 */
const seededKeys = (random: () => number): KeyStore => {
  const pairs = new Map<string, CryptoKeyPair>();
  const scalars = new WeakMap<CryptoKey, Uint8Array>();
  const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
  return {
    get: async (name) => pairs.get(name) ?? null,
    put: async (name, pair) => void pairs.set(name, pair),
    make: async () => {
      let d = new Uint8Array(32);
      do d = d.map(() => Math.floor(random() * 256));
      while (!p256.utils.isValidPrivateKey(d));
      const point = p256.getPublicKey(d, false);
      const shared = { kty: "EC", crv: "P-256", x: base64url(point.subarray(1, 33)), y: base64url(point.subarray(33, 65)) };
      const privateKey = await crypto.subtle.importKey("jwk", { ...shared, d: base64url(d) }, ECDSA, false, ["sign"]);
      const publicKey = await crypto.subtle.importKey("jwk", shared, ECDSA, true, ["verify"]);
      scalars.set(privateKey, d);
      return { privateKey, publicKey };
    },
    sign: async (pair, bytes) => p256.sign(sha256(bytes), scalars.get(pair.privateKey)!, { lowS: true }).toCompactRawBytes(),
  };
};

const offline = (): never => {
  throw new TypeError("fetch failed");
};

type Setup = { time: { ms: number }; skew: { ms: number }; random: () => number; server: () => string };

const openVault = async ({ name, setup, zotero, from }: { name: string; setup: Setup; zotero?: (store: MemoryStore) => Zotero; from?: MemoryStore }): Promise<Vault> => {
  const store = createMemoryStore();
  if (from) {
    // The same vault on another device: its files arrive before the app first starts there.
    store.spaceId = from.spaceId;
    store.records.push(...from.records);
  }
  const { host, emit } = createMemoryHost({ store });
  const opened: string[] = [];
  const base = { ...host, openSurface: async (args: { route: { surface: string } }) => (opened.push(args.route.surface), { ok: true as const, value: null }) };
  const library = zotero?.(store);
  const sent: Sent[] = [];
  const keys = seededKeys(setup.random);
  const vault = { name, online: false, skewMs: 0, old: false, sent, opened, store, keys, changed: emit } as Vault;
  /** Everything this device does, it does on its own clock, a little later than the last thing. */
  const onItsClock = async <T>(work: () => Promise<T>): Promise<T> => {
    setup.time.ms += 3;
    setup.skew.ms = vault.skewMs;
    try {
      return await work();
    } finally {
      setup.skew.ms = 0;
    }
  };

  const door = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(ZOTERO_LOCAL)) return library ? library(input) : offline();
    if (!url.startsWith(setup.server())) return offline();
    if (!vault.online) return offline();
    let sending = init;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { records?: DgRecord[] }) : {};
    if (vault.old && body.records) {
      // What an app from before signing would have sent: the same records, without the two newer fields.
      body.records = body.records.map((record) => {
        const { sig: _sig, prev: _prev, ...bare } = record as DgRecord & { prev?: string };
        return bare as DgRecord;
      });
      sending = { ...init, body: JSON.stringify(body) };
    }
    sent.push({ at: setup.time.ms, method: init?.method ?? "GET", path: new URL(url).pathname, records: body.records ?? [] });
    const response = await fetch(input, sending);
    // The server shares this process and has no clock of its own here: it tells the world's time.
    if (!response.ok || !new URL(url).pathname.endsWith("/records")) return response;
    const answer = (await response.json()) as Record<string, unknown>;
    return new Response(JSON.stringify({ ...answer, now: new Date(setup.time.ms).toISOString() }), { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const kept = new Map<string, unknown>();
  const services = createServices({
    fetch: door,
    outside: door,
    store: { get: async (key) => kept.get(key) ?? null, set: async (key, value) => void kept.set(key, value) },
  });
  const core = await onItsClock(() => createCore({ host: base as never, services, keys, demoGraphs: [] }));

  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    onItsClock(() => new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    }));

  // The real loop, without its timer: a round happens when the story says so, so a run can be played again.
  let failures = 0;
  const loop = startLabSync({ services, target: core, onError: () => void (failures += 1) });
  loop.stop();
  const sync = async (): Promise<void> => {
    vault.online = true;
    try {
      for (let tries = 0; tries < 5; tries += 1) {
        const before = failures;
        await onItsClock(() => loop.now());
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

/** What a sync tool does to a log's text on the way. */
const mangle = (text: string, fault: SyncFault, random: () => number): string => {
  const lines = text.split("\n").filter(Boolean);
  if (fault === "clean" || lines.length < 2) return text;
  // The last line is still being written when the file is copied.
  if (fault === "torn") return `${lines.slice(0, -1).join("\n")}\n${lines.at(-1)!.slice(0, Math.max(1, Math.floor(lines.at(-1)!.length / 2)))}`;
  // A stretch of the file is carried twice.
  if (fault === "doubled") return `${[...lines, ...lines.slice(Math.floor(lines.length * 0.6))].join("\n")}\n`;
  if (fault === "crlf") return `\uFEFF${lines.join("\r\n")}\r\n`;
  // Two copies were joined by a tool that marks where they met, and one line was cut where they did.
  const at = 1 + Math.floor(random() * (lines.length - 1));
  return `${[...lines.slice(0, at), "<<<<<<< this device", lines[at]!.slice(0, 20), "=======", lines[at]!, ">>>>>>> the other device", ...lines.slice(at + 1)].join("\n")}\n`;
};

export const openWorld = async (people: { name: string; zotero?: (store: MemoryStore) => Zotero }[], { seed = 1, server: outside }: { seed?: number; /** A lab server already running in a process of its own, where something outside this process must reach it too. */ server?: string } = {}): Promise<World> => {
  const startServer = (await serverModule("app")).startServer as unknown as (config: Record<string, unknown>) => Promise<Running>;
  const loadConfig = (await serverModule("config")).loadConfig as unknown as (env: Record<string, string>) => Record<string, unknown>;
  const dataDir = mkdtempSync(join(tmpdir(), "dg-vaults-"));
  const config = { ...loadConfig({}), port: 0, dataDir, miraUrl: "http://127.0.0.1:9/closed", replayMs: 20 };
  let running: Running = outside ? { port: Number(new URL(outside).port), close: async () => {} } : await startServer(config);
  let port = running.port;

  // One clock and one source of chance for the whole run, in place of the real ones.
  const random = chance(seed);
  const time = { ms: Date.UTC(2026, 10, 13, 9, 0, 0) };
  const skew = { ms: 0 };
  const real = { now: clock.now, fill: entropy.fill, offsetMs: clock.offsetMs };
  resetIds();
  clock.offsetMs = 0;
  clock.now = () => time.ms + skew.ms;
  entropy.fill = (into) => {
    for (let at = 0; at < into.length; at += 1) into[at] = Math.floor(random() * (into.BYTES_PER_ELEMENT === 2 ? 65536 : 256));
    return into;
  };
  const setup: Setup = { time, skew, random, server: () => `http://127.0.0.1:${port}` };

  const vaults: Vault[] = [];
  for (const person of people) {
    const vault = await openVault({ ...person, setup });
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
  /** Lets a core finish reading what just changed underneath it. */
  const breathe = async (): Promise<void> => {
    for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setImmediate(done));
  };
  const carry = async (from: Vault, to: Vault, fault: SyncFault): Promise<number> => {
    const text = mangle(`${from.store.records.map((record) => JSON.stringify(record)).join("\n")}\n`, fault, random);
    const read = readLog(text);
    const held = new Set(to.store.records.map((record) => canonicalJson(record)));
    const fresh = read.records.filter((record) => !held.has(canonicalJson(record)) && (held.add(canonicalJson(record)), true));
    to.store.records.push(...fresh);
    if (fresh.length > 0) to.changed({ type: "records-changed" });
    await breathe();
    return read.skipped;
  };
  return {
    get server() {
      return setup.server();
    },
    time,
    vaults,
    vault,
    settle,
    openDevice: async (of, name) => {
      const first = vault(of);
      const device = await openVault({ name, setup, from: first.store });
      vaults.push(device);
      return device;
    },
    fileSync: async (a, b, fault = "clean") => ({ skipped: (await carry(a, b, fault)) + (await carry(b, a, fault)) }),
    restartServer: async () => {
      if (outside) throw new Error("This world doesn't run its own server.");
      await running.close();
      running = await startServer({ ...config, port });
      port = running.port;
    },
    close: async () => {
      for (const item of vaults) item.stop();
      await running.close();
      rmSync(dataDir, { recursive: true, force: true });
      clock.now = real.now;
      clock.offsetMs = real.offsetMs;
      entropy.fill = real.fill;
      resetIds();
    },
  };
};
