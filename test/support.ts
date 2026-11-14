import { createCore, type Core } from "@dg/core/index.ts";
import type { Host, HostEvent } from "@dg/contract/host.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import type { DgRecord, NodeRecord } from "@dg/contract/records.ts";
import type { Services } from "@dg/contract/services.ts";
import type { SurfaceEvent, SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";

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

/**
 * Waits for something to become so, looking again each turn of the event loop
 * and then each millisecond. Hands back what `look` found. A test waits on the
 * thing it is about to read, not on the clock.
 */
export const until = async <T>(look: () => T | Promise<T>, what = "what the test was waiting for", within = 3000): Promise<NonNullable<T>> => {
  const deadline = Date.now() + within;
  for (let turn = 0; ; turn += 1) {
    const found = await look();
    if (found) return found as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`Waited ${within} ms for ${what}.`);
    await new Promise<void>((resolve) => (turn < 100 ? setImmediate(resolve) : setTimeout(resolve, 1)));
  }
};

/** How many looks in a row must find the base untouched before the core counts as at rest. */
const STILL = 3;

/**
 * Counts what the core asks of its base. The core has no hook that says its
 * background work is done, and everything it does lasting goes through the base.
 */
const watchHost = (host: Host): { host: Host; rest: () => Promise<void> } => {
  let asked = 0;
  let open = 0;
  const counted = Object.fromEntries(
    Object.entries(host).map(([name, member]) => [
      name,
      typeof member !== "function"
        ? member
        : (...args: unknown[]) => {
            asked += 1;
            const result = (member as (...args: unknown[]) => unknown)(...args);
            if (!(result instanceof Promise)) return result;
            open += 1;
            // Counted again when it answers: what the core does with the answer is still to come.
            const closed = (): void => void ((open -= 1), (asked += 1));
            result.then(closed, closed);
            return result;
          },
    ]),
  ) as Host;
  const rest = async (): Promise<void> => {
    const deadline = Date.now() + 5000;
    for (let still = 0, last = -1; still < STILL; ) {
      if (Date.now() > deadline) throw new Error("The core was still working on its base after 5 s.");
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      still = open === 0 && asked === last ? still + 1 : 0;
      last = asked;
    }
  };
  return { host: counted, rest };
};

export type Made = {
  core: Core;
  call: Call;
  store: MemoryStore;
  host: Host;
  /** Tells the core something changed in the base underneath it. */
  emit: (event: HostEvent) => void;
  /** Every event the core has sent to its panel. */
  events: SurfaceEvent[];
  /** Every panel or dialog the core asked the base to open, when `watchSurfaces` is on. */
  opened: unknown[];
  node: (id: string) => NodeRecord;
  nodes: () => NodeRecord[];
  /**
   * Lets work the core started without being awaited come to rest: resolves once the core has
   * asked nothing of its base for a few looks in a row. For a test that checks nothing more
   * happened. Where a test waits for something to appear, `until` says what.
   */
  settle: () => Promise<void>;
  /** Waits until the core has read these records, which something else wrote to the base, at these versions or later. */
  arrive: (...records: DgRecord[]) => Promise<unknown>;
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
  const { host, rest } = watchHost(wrap(watched));
  const made = await createCore({ host, ...(services ? { services: stubServices(services) } : {}), ...core });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  const events: SurfaceEvent[] = [];
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message ? pending.get(message.id)?.(message) : events.push(message as SurfaceEvent)), onMessage: (handler) => ((listener = handler), () => {}) };
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
    settle: rest,
    arrive: (...records) =>
      until(() => {
        const { documents, relations, proposals } = made.graph();
        return records.every((record) => {
          const held = documents.get(record.id);
          return held ? !("rev" in record) || held.rev >= record.rev : relations.has(record.id) || proposals.has(record.id);
        });
      }, "records from elsewhere to reach the core"),
  };
};
