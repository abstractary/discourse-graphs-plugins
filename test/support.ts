import { createCore, type Core } from "@dg/core/index.ts";
import type { Host, HostEvent } from "@dg/contract/host.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import type { DgRecord, NodeRecord } from "@dg/contract/records.ts";
import type { Services } from "@dg/contract/services.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

/**
 * A core over the in-memory base, with a `call` that speaks to it as a panel
 * does. This was written out in each test file. New tests start here, and the
 * older files move over as they are next touched.
 */

export type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

/** Services that answer and do nothing: no servers, no lab, nothing to pull. */
export const stubServices = (over: Partial<Services> = {}): Services =>
  ({
    servers: async () => [],
    extract: async () => ({ nodes: [], edges: [] }),
    storeGraph: async () => {},
    link: async () => null,
    pushRecords: async () => {},
    pullRecords: async () => ({ records: [], done: true }),
    ...over,
  }) as unknown as Services;

export type Made = {
  core: Core;
  call: Call;
  store: MemoryStore;
  host: Host;
  /** Tells the core something changed in the base underneath it. */
  emit: (event: HostEvent) => void;
  /** Every event the core has sent to its panel. */
  events: SurfaceMessage[];
  /** Every panel or dialog the core asked the base to open, when `watchSurfaces` is on. */
  opened: unknown[];
  node: (id: string) => NodeRecord;
  nodes: () => NodeRecord[];
  /** Lets work the core started without being awaited come to rest. */
  settle: (ms?: number) => Promise<void>;
};

export const makeCore = async ({
  store = createMemoryStore(),
  records = [],
  memory = {},
  wrap = (host) => host,
  watchSurfaces = false,
  services,
  ...core
}: {
  /** A store to open, such as one a second core will share. */
  store?: MemoryStore;
  /** Records already in the log when the core starts. */
  records?: DgRecord[];
  memory?: { host?: string; textForEveryUnit?: boolean };
  /** Changes the base before the core sees it, for a test that needs one member to behave differently. */
  wrap?: (host: Host) => Host;
  /** Records which panels the core opens, and answers that each opened. */
  watchSurfaces?: boolean;
  /** Merged over `stubServices`. Left out, the core runs with no services at all. */
  services?: Partial<Services>;
} & Omit<Parameters<typeof createCore>[0], "host" | "services"> = {}): Promise<Made> => {
  store.records.push(...records);
  const { host: plain, emit } = createMemoryHost({ store, ...memory });
  const opened: unknown[] = [];
  const watched: Host = watchSurfaces ? { ...plain, openSurface: async (args) => (opened.push(args), { ok: true as const, value: null }) } : plain;
  const host = wrap(watched);
  const made = await createCore({ host, ...(services ? { services: stubServices(services) } : {}), ...core });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  const events: SurfaceMessage[] = [];
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message ? pending.get(message.id)?.(message) : events.push(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  made.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  return {
    core: made,
    call,
    store,
    host,
    emit,
    events,
    opened,
    node: (id) => made.graph().documents.get(id) as NodeRecord,
    nodes: () => [...made.graph().documents.values()].filter((record): record is NodeRecord => record.kind === "node" && !record.removed),
    settle: (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
};
