import {
  buildCanvas,
  decide,
  foldRecords,
  staysLocal,
  type DgRecord,
  type NodeRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import type { Host, Result } from "@dg/contract/host.ts";
import type { CoreForAdapter } from "@dg/contract/core.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceResponse } from "@dg/contract/surface.ts";

const value = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

export const readAllRecords = async (host: Host): Promise<DgRecord[]> => {
  const records: DgRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = value(
      await host.listRecords({ limit: 2000, ...(after ? { after } : {}) }),
    );
    records.push(...page.items);
    after = page.next;
    if (page.done) return records;
  }
};

/** What leaves a space: everything except records that only mean something here. */
export const exportRecords = async (host: Host): Promise<DgRecord[]> =>
  (await readAllRecords(host)).filter(
    (record) =>
      !staysLocal(record) &&
      !(record.kind === "node" && record.title.startsWith("Load test")),
  );

/** Takes in another base's records, then accepts what arrived as pending. */
export const importAndAccept = async ({
  host,
  records,
}: {
  host: Host;
  records: DgRecord[];
}) => {
  const info = value(await host.describe());
  value(await host.putRecords({ records }));
  const localSpace = info.space.id;
  const before = foldRecords({ records: await readAllRecords(host), localSpace });
  const pending = [...before.relations.values()].filter(
    ({ state }) => state === "pending",
  );
  value(
    await host.putRecords({
      records: pending.map(({ record }) =>
        decide({
          space: localSpace,
          by: info.person,
          target: record.id,
          decision: "accepted",
        }),
      ),
    }),
  );
  const after = foldRecords({ records: await readAllRecords(host), localSpace });
  const label = (id: string): string =>
    (after.documents.get(id) as NodeRecord | undefined)?.title ?? "(missing)";
  const typeOf = (id: string): string =>
    (after.documents.get(id) as RelationTypeRecord | undefined)?.base ?? "(missing)";
  const foreignCanvases = [...after.documents.values()].filter(
    (record) => record.kind === "canvas" && record.space !== localSpace,
  );
  return {
    host: info.host,
    arrived: records.length,
    pendingOnArrival: pending.length,
    acceptedAfterDecision: pending.filter(
      ({ record }) => after.relations.get(record.id)?.state === "active",
    ).length,
    sample: pending.slice(-1).map(({ record }) => ({
      source: label(record.source),
      relation: typeOf(record.type),
      target: label(record.target),
    })),
    foreignCanvasCards: foreignCanvases.map(
      (canvas) => buildCanvas({ graph: after, canvas: canvas.id }).nodes.length,
    ),
  };
};

type Box = { x: number; y: number; width: number; height: number };

/** Lets a test script find things inside the sandboxed frame. */
export const createFrameProbe = (frame: () => HTMLIFrameElement | null) => {
  let next = 0;
  const waiting = new Map<number, (value: unknown) => void>();
  const listen = (event: MessageEvent): void => {
    const data = event.data as { dg?: string; requestId?: number; value?: unknown };
    if (data?.dg === "probe-reply" && data.requestId !== undefined) {
      waiting.get(data.requestId)?.(data.value);
      waiting.delete(data.requestId);
    }
  };
  window.addEventListener("message", listen);
  const ask = (what: string, selector: string, prop?: string): Promise<unknown> =>
    new Promise((resolve) => {
      const target = frame();
      if (!target?.contentWindow) {
        resolve(null);
        return;
      }
      next += 1;
      waiting.set(next, resolve);
      target.contentWindow.postMessage({ dg: "probe", what, selector, prop, requestId: next }, "*");
      window.setTimeout(() => resolve(null), 1500);
    });
  return {
    stop: () => window.removeEventListener("message", listen),
    text: (selector: string) => ask("text", selector),
    count: (selector: string) => ask("count", selector),
    value: (selector: string) => ask("value", selector),
    focus: () => ask("focus", "html"),
    doubleClicks: () => ask("doubleClicks", "html"),
    theme: () => ask("theme", "html"),
    scroll: () => ask("scroll", "html"),
    drawn: () => ask("drawn", "html"),
    style: (selector: string, prop: string) => ask("style", selector, prop),
    choose: (selector: string, value: string) => ask("choose", selector, value),
    reveal: (selector: string) => ask("reveal", selector),
    dragTo: (selector: string, at: { x: number; y: number }) => ask("dragTo", selector, JSON.stringify(at)),
    dropFile: (selector: string, file: { name: string; type: string; base64: string }) => ask("dropFile", selector, JSON.stringify(file)),
    selection: () => ask("selection", "html"),
    pick: (selector: string, file: { name: string; type: string; base64: string }) => ask("pick", selector, JSON.stringify(file)),
    locate: async (selector: string) => {
      const box = (await ask("box", selector)) as Box | null;
      const outer = frame()?.getBoundingClientRect();
      if (!box || !outer) return null;
      return { x: box.x + outer.left, y: box.y + outer.top, width: box.width, height: box.height };
    },
  };
};

export const summarize = async ({
  host,
  localSpace,
}: {
  host: Host;
  localSpace: string;
}) => {
  const records = await readAllRecords(host);
  const graph = foldRecords({ records, localSpace });
  const docs = [...graph.documents.values()];
  const items = docs.filter((doc) => doc.kind === "canvas-item");
  return {
    versions: records.filter((record) => record.kind === "canvas-item").length,
    canvases: docs.filter((doc) => doc.kind === "canvas").map((doc) => (doc as { title: string }).title),
    liveItems: items.filter((doc) => !(doc as { removed?: true }).removed).length,
    strokes: items.filter((doc) => (doc as { item: { type?: string } }).item.type === "stroke" && !(doc as { removed?: true }).removed).length,
    nodes: docs.filter((doc) => doc.kind === "node").map((doc) => (doc as NodeRecord).title),
    relations: [...graph.relations.values()].map(({ state }) => state),
  };
};

/** Lets a test call the surface API without a frame, the way a panel would. */
export const surfaceCaller = (core: CoreForAdapter) => {
  const waiting = new Map<string, (message: SurfaceResponse) => void>();
  const listeners = new Set<(message: SurfaceMessage) => void>();
  let next = 0;
  core.connectSurface({
    port: {
      send: (message) => {
        if ("id" in message && "ok" in message) {
          waiting.get(message.id)?.(message);
          waiting.delete(message.id);
        }
      },
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
  return (method: SurfaceMethod, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      next += 1;
      const id = `test-${next}`;
      waiting.set(id, (message) => {
        if (message.ok) resolve(message.result);
        else reject(new Error(message.error.message));
      });
      for (const listener of listeners) {
        listener({ id, method, params } as SurfaceMessage);
      }
    });
};

/** A cheap way to prove text didn't change across an import. */
export const fingerprint = (parts: string[]): string => {
  let hash = 5381;
  for (const part of [...parts].sort()) {
    for (let i = 0; i < part.length; i += 1) hash = (hash * 33 + part.charCodeAt(i)) >>> 0;
  }
  return `${parts.length}:${hash.toString(16)}`;
};
