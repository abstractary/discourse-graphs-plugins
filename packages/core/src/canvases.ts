import {
  buildCanvas,
  canonicalJson,
  createAnchor,
  createCanvas,
  createCanvasItem,
  formatTitle,
  liveCanvasItems,
  revise,
  type CanvasItem,
  type CanvasItemRecord,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type HostRef,
  type PaperRecord,
} from "@dg/contract/records.ts";
import { fail, ok, type Result } from "@dg/contract/host.ts";
import type { CanvasSummary, CanvasView, PaperSummary, RelationOption, UnitSocial } from "@dg/contract/surface.ts";
import type { Context, Handlers, Stamp } from "./context.ts";
import { mayJoin, readingOf, refusal, sameThing } from "./locks.ts";
import { refuse, value } from "./refuse.ts";

const LAST_CANVAS_KEY = "last-canvas";
const HOME_TEXT = "This page holds a Discourse Graphs canvas.";
const HOME_ATTEMPTS = 6;

/**
 * A canvas gets a page or note of its own, so the base's search and lists find it. Made before the
 * feature context, because every feature can make a canvas.
 */
export const canvasHomes = ({
  host,
  put,
  stamp,
  canvasOf,
  anchorOf,
  hasLiveText,
  canvasFormat,
}: Pick<Context, "host" | "put" | "canvasOf" | "anchorOf" | "hasLiveText"> & { stamp: () => Stamp; canvasFormat: string }) => {
  const place = async (canvas: CanvasRecord): Promise<Result<HostRef>> => {
    for (let attempt = 1; attempt <= HOME_ATTEMPTS; attempt += 1) {
      const name = attempt === 1 ? canvas.title : `${canvas.title} ${attempt}`;
      const made = await host.createText({
        title: formatTitle({ content: name, format: canvasFormat }),
        body: HOME_TEXT,
        unit: canvas.id,
      });
      if (made.ok) {
        await put([createAnchor({ ...stamp(), node: canvas.id, ref: made.value.ref })]);
        return ok(made.value.ref);
      }
      if (made.error.code !== "conflict") return made;
    }
    return fail("conflict", `Couldn't find a free name for "${canvas.title}".`);
  };

  const homeOf = async (id: DgId): Promise<Result<HostRef>> => {
    const canvas = canvasOf(id);
    if (!canvas) return fail("not-found", "No such canvas.");
    const anchor = anchorOf(id);
    if (anchor && hasLiveText(anchor.ref)) return ok(anchor.ref);
    return place(canvas);
  };

  const make = async (title: string, fields: Parameters<typeof createCanvas>[0]["fields"] = {}): Promise<CanvasRecord> => {
    const canvas = createCanvas({ ...stamp(), title, fields });
    await put([canvas]);
    await place(canvas);
    return canvas;
  };

  return { homeOf, make };
};

type CanvasHandlers = Pick<
  Handlers,
  | "canvas.list"
  | "canvas.summaries"
  | "canvas.create"
  | "canvas.remove"
  | "canvas.show"
  | "canvas.reveal"
  | "canvas.revealed"
  | "canvas.setLayout"
  | "canvas.open"
  | "canvas.last"
  | "canvas.place"
  | "canvas.write"
  | "canvas.buildOn"
  | "canvas.export"
>;

/** Canvases: listing them, opening one as a panel reads it, and writing what a person did on one. */
export const canvasFeature = (
  context: Context,
  {
    homes,
    paperSummary,
    social,
    options,
    assert,
  }: {
    homes: ReturnType<typeof canvasHomes>;
    paperSummary: (paper: PaperRecord) => PaperSummary;
    social: (unit: DgId) => UnitSocial;
    /** The relations the grammar allows from one unit to another. */
    options: (source: DgId, target: DgId) => RelationOption[];
    assert: Handlers["relation.assert"];
  },
) => {
  const { host, put, documents, canvasOf, nodeOf } = context;
  const graph = () => context.graph();
  const me = () => context.me();

  let lastCanvas: DgId | null = null;
  /** The unit a canvas was last asked to point at, kept until that canvas collects it. */
  let pointedAt: { canvas: DgId; unit: DgId; at: number } | null = null;

  const lastUsed = async (): Promise<DgId | null> => {
    if (lastCanvas && canvasOf(lastCanvas)) return lastCanvas;
    const stored = await context.getLocal(LAST_CANVAS_KEY);
    const id = typeof stored === "string" ? stored : null;
    return id && canvasOf(id) ? id : null;
  };

  const usual = async (): Promise<DgId | null> => {
    const last = await lastUsed();
    if (last) return last;
    const [newest] = documents("canvas")
      .filter((canvas) => !canvas.removed)
      .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
    return newest?.id ?? null;
  };

  const summaryOf = (canvas: CanvasRecord): CanvasSummary => {
    const live = liveCanvasItems({ graph: graph(), canvas: canvas.id });
    return {
      id: canvas.id,
      title: canvas.title,
      cards: live.filter(({ item }) => "dg" in item && "x" in item).length,
      links: live.filter(({ item }) => "fromNode" in item).length,
      editedAt: live.reduce((latest, { editedAt }) => (editedAt > latest ? editedAt : latest), canvas.editedAt),
      credit: context.creditFor(canvas),
      kind: readingOf(graph(), canvas.id) ? "paper" : "canvas",
    };
  };

  const viewOf = (id: DgId): CanvasView => {
    const canvas = canvasOf(id);
    if (!canvas) throw refuse("not-found", `No canvas ${id}`);
    // A card can outlive its unit: one person removes the unit while another moves its card, and the
    // move wins. The card and its lines are left out, so nobody sees a card for a unit that is gone.
    const every = liveCanvasItems({ graph: graph(), canvas: id });
    const ghosts = new Set(
      every
        .filter(({ item }) => {
          const unit = (item as { dg?: { node?: DgId } }).dg?.node;
          const record = unit ? graph().documents.get(unit) : undefined;
          return record?.kind === "node" && record.removed === true;
        })
        .map((record) => record.id),
    );
    const live = ghosts.size === 0 ? every : every.filter(({ id: itemId, item }) => {
      const edge = item as { fromNode?: DgId; toNode?: DgId };
      return !ghosts.has(itemId) && !(edge.fromNode && ghosts.has(edge.fromNode)) && !(edge.toNode && ghosts.has(edge.toNode));
    });
    const nodes: CanvasView["nodes"] = {};
    const relations: CanvasView["relations"] = {};
    for (const { item } of live) {
      const dg = (item as { dg?: { node?: DgId; relation?: DgId } }).dg;
      if (dg?.node) {
        const node = nodeOf(dg.node);
        if (node) nodes[dg.node] = context.summarize(node);
      }
      if (dg?.relation) {
        const relation = graph().relations.get(dg.relation);
        if (relation) {
          const kind = context.relationTypeOf(relation.record.type)?.base;
          relations[dg.relation] = {
            label: context.relationLabel(relation.record.type),
            state: relation.state,
            credit: context.creditFor(relation.record),
            ...(kind ? { kind } : {}),
            ...(relation.record.by.id === me().id ? { mine: true as const } : {}),
            type: relation.record.type,
            source: relation.record.source,
            target: relation.record.target,
          };
        }
      }
    }
    const paper = canvas.paper ? documents("paper").find(({ id: paperId }) => paperId === canvas.paper) : undefined;
    return {
      canvas,
      items: live.map((record) => ({ id: record.id, z: record.z, item: record.item, credit: context.creditFor(record), at: record.at })),
      nodes,
      relations,
      social: canvas.shared ? Object.fromEntries(Object.keys(nodes).map((node) => [node, social(node)])) : {},
      ...(paper ? { paper: paperSummary(paper) } : {}),
    };
  };

  const itemOf = (id: DgId): CanvasItemRecord | undefined => {
    const record = graph().documents.get(id);
    return record?.kind === "canvas-item" ? record : undefined;
  };

  const show = async (id: DgId): Promise<void> => {
    value(await homes.homeOf(id));
    value(await host.openSurface({ route: { surface: "canvas", id }, placement: "main" }));
  };

  const handlers: CanvasHandlers = {
    "canvas.list": async () => documents("canvas").filter((canvas) => !canvas.removed),
    "canvas.summaries": async () =>
      documents("canvas")
        .filter((canvas) => !canvas.removed)
        .map(summaryOf)
        .sort((a, b) => b.editedAt.localeCompare(a.editedAt)),
    "canvas.create": async ({ title }) => homes.make(title),
    "canvas.remove": async ({ id }) => {
      const canvas = canvasOf(id);
      if (!canvas || canvas.removed) return null;
      if (canvas.by.id !== me().id) throw refuse("read-only", `Only ${context.nameOf(canvas.by)}, who made this canvas, can remove it.`);
      if (canvas.paper) throw refuse("read-only", "This is a paper's own canvas. It stays while the paper does.");
      const home = context.anchorOf(id);
      await put([revise({ record: canvas, changes: { removed: true }, by: me() })]);
      // Its note goes to the base's trash, where it can still be got back. The units on it are untouched.
      if (home && context.hasLiveText(home.ref)) await host.removeText({ ref: home.ref });
      if (lastCanvas === id) lastCanvas = null;
      return null;
    },
    "canvas.show": async ({ id }) => {
      await show(id);
      return null;
    },
    "canvas.reveal": async ({ id, unit }) => {
      pointedAt = { canvas: id, unit, at: Date.now() };
      await show(id);
      context.send({ event: "reveal-unit", canvas: id, unit });
      return null;
    },
    "canvas.revealed": async ({ id }) => {
      const asked = pointedAt;
      if (!asked || asked.canvas !== id) return null;
      pointedAt = null;
      // Only a request just made: a canvas opened later on its own points at nothing.
      return Date.now() - asked.at < 15000 ? asked.unit : null;
    },
    "canvas.setLayout": async ({ id, layout }) => {
      const canvas = canvasOf(id);
      if (canvas) await put([revise({ record: canvas, changes: { layout, needsLayout: false }, by: me() })]);
      return null;
    },
    "canvas.open": async ({ id }) => {
      const view = viewOf(id);
      if (lastCanvas !== id) {
        lastCanvas = id;
        await context.setLocal(LAST_CANVAS_KEY, id);
      }
      return view;
    },
    "canvas.last": async () => lastUsed(),
    "canvas.place": async ({ node }) => {
      context.send({ event: "place-node", node });
      return null;
    },
    "canvas.write": async ({ canvas, upserts = [], removes = [], restores = [] }) => {
      const fresh: DgRecord[] = [];
      const ids: DgId[] = [];
      // A PDF canvas holds only what comes from its paper: its units, and relations between them.
      const reading = readingOf(graph(), canvas);
      if (reading) {
        const fits = upserts.every(({ id, item }) => {
          const existing = id ? itemOf(id) : undefined;
          return existing ? sameThing(existing.item, item) : mayJoin(graph(), reading, item);
        });
        if (!fits) throw refusal(reading);
      }
      for (const { id, item, z } of upserts) {
        const existing = id ? itemOf(id) : undefined;
        if (!existing) {
          const record = createCanvasItem({ ...context.stamp(), canvas, item, z });
          fresh.push(record);
          ids.push(record.id);
          continue;
        }
        ids.push(existing.id);
        const next = { ...item, id: existing.id } as CanvasItemRecord["item"];
        if (canonicalJson(next) === canonicalJson(existing.item) && z === existing.z) continue;
        fresh.push(revise({ record: existing, changes: { item: next, z }, by: me() }));
      }
      for (const id of removes) {
        const existing = itemOf(id);
        if (existing && !existing.removed) fresh.push(revise({ record: existing, changes: { removed: true }, by: me() }));
      }
      for (const id of restores) {
        const existing = itemOf(id);
        if (existing?.removed) fresh.push(revise({ record: existing, changes: { removed: false }, by: me() }));
      }
      if (fresh.length > 0) await put(fresh);
      return { ids };
    },
    "canvas.buildOn": async ({ id, title: wanted }) => {
      const from = canvasOf(id);
      if (!from || from.removed) throw refuse("not-found", "That canvas is gone.");
      const taken = new Set(documents("canvas").filter((canvas) => !canvas.removed).map((canvas) => canvas.title));
      const base = wanted?.trim() || `Building on ${from.title}`;
      let name = base;
      for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
      const made = await homes.make(name);
      // The same units, drawn again: cards first, so links can point at the new cards.
      const live = liveCanvasItems({ graph: graph(), canvas: id });
      const cardOf = new Map<DgId, DgId>();
      const copies: DgRecord[] = [];
      for (const record of live) {
        if ("fromNode" in record.item) continue;
        const { id: _old, ...item } = record.item as CanvasItem & { id: DgId };
        const copy = createCanvasItem({ ...context.stamp(), canvas: made.id, item: item as never, z: record.z });
        cardOf.set(record.id, copy.id);
        copies.push(copy);
      }
      for (const record of live) {
        if (!("fromNode" in record.item)) continue;
        const { id: _old, ...item } = record.item as CanvasItem & { id: DgId; fromNode: DgId; toNode: DgId };
        const [fromNode, toNode] = [cardOf.get(item.fromNode), cardOf.get(item.toNode)];
        if (fromNode && toNode) copies.push(createCanvasItem({ ...context.stamp(), canvas: made.id, item: { ...item, fromNode, toNode } as never, z: record.z }));
      }
      if (copies.length) await put(copies);
      if (from.layout) await put([revise({ record: canvasOf(made.id)!, changes: { layout: from.layout }, by: me() })]);
      return { id: made.id, title: name };
    },
    "canvas.export": async ({ id }) => {
      const doc = buildCanvas({ graph: graph(), canvas: id });
      return {
        edges: doc.edges,
        nodes: doc.nodes.map((node) => {
          if (node.type !== "text" || !node.dg) return node;
          return { ...node, text: nodeOf(node.dg.node)?.title ?? node.text };
        }),
      };
    },
  };

  /** Cards for these units, laid out two across. For a base's own commands, away from the panel. */
  const add = async ({ canvas, nodes }: { canvas: DgId; nodes: DgId[] }): Promise<void> => {
    const start = liveCanvasItems({ graph: graph(), canvas }).length;
    await put(
      nodes.flatMap((node, index) => {
        const record = nodeOf(node);
        if (!record) return [];
        const spot = { x: (index % 2) * 330, y: Math.floor(index / 2) * 170 };
        const item = { type: "text" as const, text: record.title, ...spot, width: 240, height: 96, dg: { node } };
        return [createCanvasItem({ ...context.stamp(), canvas, item, z: start + index + 1 })];
      }),
    );
  };

  const relate = async ({ canvas, source, target, base }: { canvas: DgId; source: DgId; target: DgId; base?: string }): Promise<Result<DgId>> => {
    const allowed = options(source, target).filter((option) => !option.flipped);
    const option = base ? allowed.find(({ type }) => context.relationTypeOf(type)?.base === base) : allowed[0];
    if (!option) return fail("not-found", "The grammar has no such relation.");
    const relation = await assert({ type: option.type, source, target });
    const live = liveCanvasItems({ graph: graph(), canvas });
    const cardOf = (node: DgId): CanvasItemRecord | undefined =>
      live.find(({ item }) => (item as { dg?: { node?: DgId } }).dg?.node === node);
    const [from, to] = [cardOf(source), cardOf(target)];
    if (from && to) {
      const item = { fromNode: from.id, toNode: to.id, dg: { relation: relation.id } };
      await put([createCanvasItem({ ...context.stamp(), canvas, item, z: live.length + 1 })]);
    }
    return ok(relation.id);
  };

  return { handlers, usual, add, relate };
};
