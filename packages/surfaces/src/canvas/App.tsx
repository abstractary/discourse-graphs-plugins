import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  MarkerType,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useViewport,
  type Connection as FlowConnection,
  type Edge,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import type { CanvasItem, CanvasRecord, NodeTypeRecord, TidyMode, WithoutId } from "@dg/contract/records.ts";
import type { CanvasItemView, CanvasView, Credit, NodeSummary, RelationOption } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Icon, Mark, plain } from "../shared/ui.tsx";
import { scoreLabel, scoresFor } from "@dg/layout/centrality.ts";
import { sidesFor } from "@dg/layout/edges.ts";
import { relationColor } from "../shared/relations.ts";
import { AiBar } from "./AiBar.tsx";
import { ExportMenu } from "./ExportMenu.tsx";
import { Legend } from "./Legend.tsx";
import { MODES, arrange, leaningOf, measureOf, type Card, type RelationLink } from "@dg/layout/modes.ts";
import { ActionsContext, nodeTypes, type Actions, type Box, type CardData } from "./nodes.tsx";

/** Three columns fit the common 725 px frame beside a sidebar. */
// Keeps a link's tooltip inside the frame.
const TIP_WIDTH = 160;
// Shift is what most drawing tools use to add to a selection.
const MULTI_SELECT_KEYS = ["Meta", "Control", "Shift"];

const CARD_WIDTH = 240;
const NOTE = { width: 200, height: 80 };
const GAP = 24;

/** Median research titles run about 70 characters, and some twice that. */
const cardHeight = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));

type FlowData = Record<string, unknown>;
type FlowNode = Node<FlowData>;

const withoutId = (item: CanvasItem): WithoutId<CanvasItem> => {
  const { id: _id, ...rest } = item;
  return rest as WithoutId<CanvasItem>;
};

const toNode = ({ id, z, item }: CanvasItemView, view: CanvasView): FlowNode | null => {
  if ("fromNode" in item) return null;
  const base = { id, position: { x: item.x, y: item.y }, zIndex: z };
  const sized = { ...base, width: item.width, height: item.height };
  if (item.type === "stroke") return { ...sized, type: "ink", data: { path: item.path } };
  if (item.type === "group") {
    const fixed = item.guide ? { draggable: false, selectable: false, focusable: false, deletable: false } : {};
    return { ...sized, ...fixed, type: "zone", zIndex: -1, data: { label: item.label ?? "", guide: item.guide ?? false } };
  }
  if (item.type === "text" && item.dg) {
    return {
      ...base,
      width: item.width,
      type: "card",
      data: {
        node: view.nodes[item.dg.node],
        text: item.text,
        minHeight: item.height,
        ...(view.social[item.dg.node] ? { social: view.social[item.dg.node] } : {}),
      },
    };
  }
  const text = item.type === "text" ? item.text : item.type === "file" ? item.file : item.url;
  return { ...sized, type: "note", data: { text } };
};

const toEdge = ({ id, item }: CanvasItemView, view: CanvasView, boxes: Map<string, Box>): Edge | null => {
  if (!("fromNode" in item)) return null;
  const relation = item.dg ? view.relations[item.dg.relation] : undefined;
  // A declined relation is history. Nobody should have to read past it.
  if (relation?.state === "rejected" || relation?.state === "withdrawn") return null;
  const from = boxes.get(item.fromNode);
  const to = boxes.get(item.toNode);
  const [sourceHandle, targetHandle] = from && to ? sidesFor(from, to) : ["r", "l"];
  const kind = relation?.kind ?? "";
  const color = relationColor(kind);
  return {
    id,
    source: item.fromNode,
    target: item.toNode,
    sourceHandle,
    targetHandle,
    ...(relation?.label || item.label ? { label: relation?.label ?? item.label } : {}),
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 3,
    style: { stroke: color },
    labelStyle: { fill: color },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
    className: relation?.state === "pending" ? "edge-pending" : "",
    data: { ...(kind ? { kind } : {}), ...(relation ? { credit: relation.credit } : {}) },
  };
};

const pathFrom = (outline: number[][]): string => {
  if (outline.length === 0) return "";
  const round = (value: number): number => Math.round(value * 10) / 10;
  const [first, ...rest] = outline;
  return `M${round(first![0]!)} ${round(first![1]!)}${rest.map(([x, y]) => `L${round(x!)} ${round(y!)}`).join("")}Z`;
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, Math.max(low, high)));

const nodeOfItem = (entry: CanvasItemView | undefined): string | undefined =>
  (entry?.item as { dg?: { node?: string } } | undefined)?.dg?.node;

type End = { item: string; node: string };
type RelationMenu = { source: End; target: End; options: RelationOption[]; x: number; y: number };
type TypeMenu = { node: string; x: number; y: number };
/** A connection dropped on empty canvas, waiting for the node it should reach. */
type Linking = { from: End | null; item: string; at: { x: number; y: number } };
type Anchor = { left: number; top: number };
type EdgeTip = { x: number; y: number; credit: Credit };

const ViewBar = () => {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="view-bar">
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => void flow.zoomOut({ duration: 120 })}>
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className="level"
        data-dg="fit"
        aria-label="Fit to view"
        title="Fit to view"
        onClick={() => void flow.fitView({ maxZoom: 1, padding: 0.12, duration: 180 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => void flow.zoomIn({ duration: 120 })}>
        <Icon name="plus" />
      </button>
    </div>
  );
};

export const App = ({ connection }: { connection: Connection }) => {
  const { call, on, route } = connection;
  const [tidyAt, setTidyAt] = useState<Anchor | null>(null);
  const [edgeTip, setEdgeTip] = useState<EdgeTip | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [grounded, setGrounded] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const flow = useReactFlow();
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  const [current, setCurrent] = useState<string | undefined>(route.id);
  const [view, setView] = useState<CanvasView | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeTypeList, setNodeTypeList] = useState<NodeTypeRecord[]>([]);
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [addAt, setAddAt] = useState<Anchor | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [menu, setMenu] = useState(false);
  const [naming, setNaming] = useState(false);
  const [canvasName, setCanvasName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NodeSummary[]>([]);
  const [active, setActive] = useState(0);
  const [relationMenu, setRelationMenu] = useState<RelationMenu | null>(null);
  const [typeMenu, setTypeMenu] = useState<TypeMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{ label: string; apply: () => Promise<unknown> } | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const dragging = useRef(new Set<string>());
  const ink = useRef<number[][]>([]);
  const items = useRef(new Map<string, CanvasItemView>());
  const fitted = useRef<string | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const tidyButton = useRef<HTMLButtonElement>(null);

  const report = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : String(error));
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;

  // Read through a ref: a refresh already in flight must not undo a canvas switch.
  const currentRef = useRef(current);
  currentRef.current = current;

  const refresh = useCallback(async () => {
    const list = await call("canvas.list", {});
    setCanvases(list);
    const id = currentRef.current ?? (await call("canvas.last", {})) ?? list[0]?.id;
    if (!id) {
      setView(null);
      return;
    }
    if (!currentRef.current) setCurrent(id);
    const next = await call("canvas.open", { id });
    if ((currentRef.current ?? id) === id) setView(next);
  }, [call]);

  useEffect(() => {
    void call("grammar.get", {}).then(({ nodeTypes: types }) => setNodeTypeList(types));
  }, [call]);

  useEffect(() => {
    void refresh().catch(report);
  }, [refresh, current, report]);

  useEffect(() => on("graph-changed", () => void refresh().catch(report)), [refresh, on, report]);
  useEffect(() => on("focus-changed", (message) => setFollowed(message.node)), [on]);

  useEffect(() => {
    if (!view) {
      setNodes([]);
      setEdges([]);
      return;
    }
    items.current = new Map(view.items.map((entry) => [entry.id, entry]));
    const boxes = new Map<string, Box>();
    for (const { id, item } of view.items) if (!("fromNode" in item)) boxes.set(id, item);
    setNodes((previous) => {
      const known = new Map(previous.map((node) => [node.id, node]));
      return view.items.flatMap((entry) => {
        const next = toNode(entry, view);
        if (!next) return [];
        const old = known.get(next.id);
        if (!old) return [next];
        // Keep what the person is doing right now over what just arrived.
        const position = dragging.current.has(next.id) ? old.position : next.position;
        return [{ ...old, ...next, height: next.height, position, selected: old.selected ?? false }];
      });
    });
    setEdges((previous) => {
      const known = new Map(previous.map((edge) => [edge.id, edge]));
      return view.items.flatMap((entry) => {
        const next = toEdge(entry, view, boxes);
        return next ? [{ ...next, selected: known.get(next.id)?.selected ?? false }] : [];
      });
    });
    if (fitted.current !== view.canvas.id) {
      fitted.current = view.canvas.id;
      // Never open so far out that titles can't be read. Panning is cheaper than squinting.
      window.setTimeout(() => void flow.fitView({ maxZoom: 1, minZoom: 0.7, padding: 0.12 }), 50);
    }
  }, [view, flow]);

  // A base's sidebar opening halves the frame. What's in the middle stays in the middle.
  const hasCanvas = canvases.length > 0;
  useEffect(() => {
    const box = area.current;
    if (!box) return undefined;
    let last = { width: box.clientWidth, height: box.clientHeight };
    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = box;
      if (width === 0 || height === 0) return;
      const { x, y, zoom } = flow.getViewport();
      void flow.setViewport({ x: x + (width - last.width) / 2, y: y + (height - last.height) / 2, zoom });
      last = { width, height };
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [flow, hasCanvas]);

  const nextZ = useCallback(
    (): number => Math.max(0, ...[...items.current.values()].map((entry) => entry.z)) + 1,
    [],
  );

  const write = useCallback(
    async (args: {
      upserts?: { id?: string; item: WithoutId<CanvasItem>; z: number }[];
      removes?: string[];
      restores?: string[];
    }) => {
      if (!current) return { ids: [] as string[] };
      setNotice("");
      setUndo(null);
      return call("canvas.write", { canvas: current, ...args });
    },
    [call, current],
  );

  /** Finds room near a spot, so a new item never lands on top of an old one. */
  const freeSpot = useCallback(
    (start: { x: number; y: number }, size: { width: number; height: number }) => {
      const taken = flow.getNodes().flatMap((node) =>
        node.type === "ink"
          ? []
          : [{
              x: node.position.x,
              y: node.position.y,
              width: node.measured?.width ?? node.width ?? 0,
              height: node.measured?.height ?? node.height ?? 0,
            }],
      );
      const clear = (x: number, y: number): boolean =>
        taken.every(
          (box) =>
            x + size.width + GAP <= box.x ||
            x >= box.x + box.width + GAP ||
            y + size.height + GAP <= box.y ||
            y >= box.y + box.height + GAP,
        );
      for (let ring = 0; ring < 24; ring += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          for (let dx = -ring; dx <= ring; dx += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const x = start.x + dx * (size.width / 2 + GAP);
            const y = start.y + dy * (size.height / 2 + GAP);
            if (clear(x, y)) return { x: Math.round(x), y: Math.round(y) };
          }
        }
      }
      return { x: Math.round(start.x), y: Math.round(start.y) };
    },
    [flow],
  );

  const startingPoint = useCallback(
    (size: { width: number; height: number }) => {
      const picked = flow.getNodes().filter((node) => node.selected && node.type !== "ink");
      if (picked.length === 1) {
        const [node] = picked;
        return { x: node!.position.x + (node!.measured?.width ?? CARD_WIDTH) + 48, y: node!.position.y };
      }
      const box = area.current!.getBoundingClientRect();
      const point = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
    },
    [flow],
  );

  const updateItem = useCallback(
    (id: string, change: (item: CanvasItem) => CanvasItem) => {
      const entry = items.current.get(id);
      if (!entry) return;
      void write({ upserts: [{ id, item: withoutId(change(entry.item)), z: entry.z }] }).catch(report);
    },
    [write, report],
  );

  /** Menus sit where they were asked for, but never past the frame's edge. */
  const inFrame = useCallback((x: number, y: number, width: number, height: number) => {
    const box = shell.current!.getBoundingClientRect();
    return { x: clamp(x - box.left, 6, box.width - width - 6), y: clamp(y - box.top, 6, box.height - height - 6) };
  }, []);

  const actions = useMemo<Actions>(
    () => ({
      reveal: (node) => {
        // A unit still on its paper's canvas has no text to open, so it opens as context.
        if (viewRef.current?.nodes[node]?.hasText === false) {
          void call("focus.set", { node }).then(() => call("panel.open", { surface: "context" })).catch(report);
          return;
        }
        void call("base.reveal", { id: node, placement: "main" }).catch(report);
      },
      react: (node, value) => void call("unit.react", { unit: node, value }).catch(report),
      chooseType: (node, anchor) => {
        const { x, y } = inFrame(anchor.left, anchor.bottom + 4, 170, 240);
        setTypeMenu({ node, x, y });
      },
      saveBox: (item, box: Box) =>
        updateItem(item, (old) => ({
          ...old,
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        })),
      saveText: (item, text) => updateItem(item, (old) => ({ ...old, text }) as CanvasItem),
    }),
    [call, report, updateItem, inFrame],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((previous) => applyNodeChanges(changes, previous));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((previous) => applyEdgeChanges(changes, previous));
  }, []);

  const askRelation = useCallback(
    async (source: End, target: End, screen: { x: number; y: number }) => {
      const options = await call("relation.options", { source: source.node, target: target.node });
      const { x, y } = inFrame(screen.x - 85, screen.y - 60, 170, 180);
      setRelationMenu({ source, target, options, x: x + 85, y: y + 60 });
    },
    [call, inFrame],
  );

  const onConnect = useCallback(
    async (link: FlowConnection) => {
      const from = items.current.get(link.source);
      const to = items.current.get(link.target);
      if (!from || !to || link.source === link.target) return;
      const fromNode = nodeOfItem(from);
      const toNode_ = nodeOfItem(to);
      if (!fromNode || !toNode_) {
        await write({ upserts: [{ item: { fromNode: from.id, toNode: to.id }, z: nextZ() }] });
        return;
      }
      const a = flow.getNode(link.source);
      const b = flow.getNode(link.target);
      const middle = flow.flowToScreenPosition({
        x: ((a?.position.x ?? 0) + (b?.position.x ?? 0)) / 2 + CARD_WIDTH / 2,
        y: ((a?.position.y ?? 0) + (b?.position.y ?? 0)) / 2 + 40,
      });
      await askRelation({ item: from.id, node: fromNode }, { item: to.id, node: toNode_ }, middle);
    },
    [askRelation, flow, nextZ, write],
  );

  /** Dropping a connection on empty canvas starts the next card of the argument. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || state.toNode || !state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0]! : event;
      const entry = items.current.get(state.fromNode.id);
      const node = nodeOfItem(entry);
      setLinking({
        from: node ? { item: state.fromNode.id, node } : null,
        item: state.fromNode.id,
        at: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      });
      const { x, y } = inFrame(point.clientX, point.clientY, 380, 300);
      setAddAt({ left: x, top: y });
    },
    [flow, inFrame],
  );

  const chooseRelation = async (option: RelationOption): Promise<void> => {
    if (!relationMenu) return;
    const { source, target } = relationMenu;
    const [from, to] = option.flipped ? [target, source] : [source, target];
    setRelationMenu(null);
    try {
      const relation = await call("relation.assert", { type: option.type, source: from.node, target: to.node });
      await write({
        upserts: [{ item: { fromNode: from.item, toNode: to.item, dg: { relation: relation.id } }, z: nextZ() }],
      });
    } catch (error) {
      report(error);
    }
  };

  const closeAdd = useCallback(() => {
    setAddAt(null);
    setLinking(null);
    setQuery("");
    setActive(0);
  }, []);

  const addCard = async (node: NodeSummary): Promise<void> => {
    const size = { width: CARD_WIDTH, height: cardHeight(node.title) };
    const link = linking;
    closeAdd();
    const spot = link
      ? { x: Math.round(link.at.x - size.width / 2), y: Math.round(link.at.y - 20) }
      : freeSpot(startingPoint(size), size);
    try {
      const { ids } = await write({
        upserts: [{ item: { type: "text", text: node.title, ...spot, ...size, dg: { node: node.id } }, z: nextZ() }],
      });
      const item = ids[0];
      if (link?.from && item) {
        const screen = flow.flowToScreenPosition({ x: spot.x + size.width / 2, y: spot.y - 30 });
        await askRelation(link.from, { item, node: node.id }, screen);
      }
    } catch (error) {
      report(error);
    }
  };

  const placeRef = useRef(addCard);
  placeRef.current = addCard;
  useEffect(
    () =>
      on("place-node", ({ node }) => {
        void call("node.view", { id: node }).then((view_) => placeRef.current(view_.node)).catch(report);
      }),
    [on, call, report],
  );

  const createNode = async (type?: string): Promise<void> => {
    const title = query.trim();
    if (!title) return;
    try {
      await addCard(await call("node.create", { title, ...(type ? { type } : {}) }));
    } catch (error) {
      report(error);
    }
  };

  const adding = addAt !== null;
  useEffect(() => {
    if (!adding) return;
    setActive(0);
    void call("node.query", { text: query, limit: 8 }).then(setResults).catch(report);
  }, [adding, query, call, report]);

  const openAdd = useCallback(() => {
    const button = addButton.current?.getBoundingClientRect();
    const frame = shell.current!.getBoundingClientRect();
    const { x, y } = inFrame((button?.left ?? 0) - 6, (button?.bottom ?? 40) + 4, Math.min(380, frame.width - 12), 300);
    setAddAt({ left: x, top: y });
    setLinking(null);
  }, [inFrame]);

  const addNote = useCallback(() => {
    const spot = freeSpot(startingPoint(NOTE), NOTE);
    void write({ upserts: [{ item: { type: "text", text: "Note", ...spot, ...NOTE }, z: nextZ() }] }).catch(report);
  }, [freeSpot, startingPoint, write, nextZ, report]);

  const mode: TidyMode = view?.canvas.layout?.mode ?? "logic";

  /** One write for the whole layout, so a teammate sees it land at once. */
  const tidyUp = useCallback((chosen: TidyMode) => {
    setTidyAt(null);
    if (!view) return;
    const cards: Card[] = flow.getNodes().flatMap((node) => {
      if (node.type !== "card" && node.type !== "note") return [];
      const summary = (node.data as CardData).node;
      return [{
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? CARD_WIDTH,
        height: node.measured?.height ?? node.height ?? 80,
        note: node.type === "note",
        ...(summary
          ? {
              at: summary.at,
              credit: { key: summary.credit.id, label: summary.credit.name },
              ...(summary.typeLabel ? { kind: { key: summary.typeLabel, label: summary.typeLabel } } : {}),
            }
          : {}),
      }];
    });
    const links: RelationLink[] = flow.getEdges().map((edge) => ({
      from: edge.source,
      to: edge.target,
      ...(typeof edge.label === "string" ? { label: edge.label } : {}),
      ...((edge.data as { kind?: string } | undefined)?.kind ? { kind: (edge.data as { kind: string }).kind } : {}),
    }));
    const picked = flow.getNodes().find((node) => node.selected && node.type === "card")?.id;
    const followedCard = flow.getNodes().find((node) => (node.data as CardData).node?.id === followed)?.id;
    const focus = picked ?? followedCard ?? view.canvas.layout?.focus;
    if (chosen === "focus" && !focus) {
      setNotice("Select a card first");
      return;
    }
    const frame = area.current?.getBoundingClientRect();
    const { places, guides } = arrange({
      mode: chosen,
      boxes: cards,
      links,
      frame: frame?.width ? { width: frame.width, height: frame.height } : { width: 800, height: 800 },
      previous: view.canvas.layout?.mode ?? "logic",
      ...(focus ? { focus } : {}),
    });
    const moves = cards.flatMap(({ id }) => {
      const entry = items.current.get(id);
      const spot = places.get(id);
      if (!entry || !spot || "fromNode" in entry.item) return [];
      return [{ id, z: entry.z, item: withoutId({ ...entry.item, ...spot }) }];
    });
    const back = moves.flatMap(({ id }) => {
      const entry = items.current.get(id);
      return entry ? [{ id, z: entry.z, item: withoutId(entry.item) }] : [];
    });
    // A heading that stays keeps its item, so pressing Tidy again changes nothing.
    const oldGuides = [...items.current.values()].filter(({ item }) => (item as { guide?: boolean }).guide);
    const kept = new Map<string, string>();
    const headings = guides.map((guide) => {
      const same = oldGuides.find(({ id, item }) => (item as { label?: string }).label === guide.label && !kept.has(id));
      if (same) kept.set(same.id, guide.label);
      return { ...(same ? { id: same.id } : {}), z: 0, item: { type: "group" as const, guide: true, ...guide } };
    });
    const gone = oldGuides.filter(({ id }) => !kept.has(id)).map(({ id }) => id);
    const movedHeadings = oldGuides.filter(({ id }) => kept.has(id)).map(({ id, z, item }) => ({ id, z, item: withoutId(item) }));
    const before = view.canvas.layout ?? { mode: "logic" as const };
    const next = { mode: chosen, ...(chosen === "focus" && focus ? { focus } : {}) };
    const label = MODES.find((entry) => entry.mode === chosen)!.label;
    void write({ upserts: [...moves, ...headings], removes: gone })
      .then(async ({ ids }) => {
        await call("canvas.setLayout", { id: view.canvas.id, layout: next });
        const added = ids.slice(moves.length).filter((id) => !kept.has(id));
        setUndo({
          label: `Tidied: ${label}`,
          apply: async () => {
            await write({ upserts: [...back, ...movedHeadings], removes: added, restores: gone });
            await call("canvas.setLayout", { id: view.canvas.id, layout: before });
          },
        });
        window.setTimeout(() => void flow.fitView({ maxZoom: 1, minZoom: 0.7, padding: 0.12, duration: 200 }), 120);
      })
      .catch(report);
  }, [call, flow, followed, write, report, view]);

  // Cards placed by a tool arrive stacked on a grid, so the first person to open them tidies.
  const needsLayout = view?.canvas.needsLayout === true;
  const canvasId = view?.canvas.id;
  const tidied = useRef<string | null>(null);
  useEffect(() => {
    if (!needsLayout || !canvasId || tidied.current === canvasId) return undefined;
    tidied.current = canvasId;
    const timer = window.setTimeout(() => tidyUp(mode), 500);
    return () => window.clearTimeout(timer);
  }, [canvasId, mode, needsLayout, tidyUp]);

  const openTidyMenu = useCallback(() => {
    const button = tidyButton.current!.getBoundingClientRect();
    const { x, y } = inFrame(button.left - 40, button.bottom + 4, 280, 420);
    setTidyAt((open) => (open ? null : { left: x, top: y }));
  }, [inFrame]);

  const closeMenus = useCallback(() => {
    setMenu(false);
    setNaming(false);
    setRelationMenu(null);
    setTypeMenu(null);
    setTidyAt(null);
    closeAdd();
  }, [closeAdd]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement).closest?.("input, textarea")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        closeMenus();
        setTool("select");
        setAiOn(false);
      } else if (aiOn) {
        return;
      } else if (key === "n") {
        event.preventDefault();
        openAdd();
      } else if (key === "t") {
        addNote();
      } else if (key === "d") {
        setTool((old) => (old === "draw" ? "select" : "draw"));
      } else if (key === "l") {
        tidyUp(mode);
      } else if (key === "enter") {
        const picked = flow.getNodes().filter((node) => node.selected);
        const node = (picked[0]?.data as CardData | undefined)?.node;
        if (picked.length === 1 && node) actions.reveal(node.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, addNote, aiOn, closeMenus, flow, mode, openAdd, tidyUp]);

  const finishStroke = (): void => {
    const raw = ink.current;
    ink.current = [];
    setTool("select");
    if (raw.length < 2) return;
    const xs = raw.map(([x]) => x!);
    const ys = raw.map(([, y]) => y!);
    const x = Math.floor(Math.min(...xs)) - 4;
    const y = Math.floor(Math.min(...ys)) - 4;
    const outline = getStroke(raw.map(([px, py]) => [px! - x, py! - y]), { size: 5, thinning: 0.4 });
    void write({
      upserts: [{
        item: {
          type: "stroke",
          x,
          y,
          width: Math.ceil(Math.max(...xs)) - x + 4,
          height: Math.ceil(Math.max(...ys)) - y + 4,
          path: pathFrom(outline),
        },
        z: nextZ(),
      }],
    }).catch(report);
  };

  const inkPoint = (event: React.PointerEvent): number[] => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return [point.x, point.y];
  };

  const switchCanvas = (id: string): void => {
    setMenu(false);
    // A canvas on its own page moves by going to the other page.
    if (route.pinned) {
      void call("canvas.show", { id }).catch(report);
      return;
    }
    currentRef.current = id;
    setCurrent(id);
  };

  const startCanvas = async (title: string): Promise<void> => {
    const name = title.trim();
    if (!name) return;
    setNaming(false);
    setCanvasName("");
    try {
      switchCanvas((await call("canvas.create", { title: name })).id);
    } catch (error) {
      report(error);
    }
  };

  const onSelectionChange = useCallback(
    ({ nodes: picked }: { nodes: Node[] }) => {
      const node = picked.length === 1 ? (picked[0]!.data as CardData).node : undefined;
      if (node) void call("focus.set", { node: node.id }).catch(report);
    },
    [call, report],
  );

  // Scores follow the links, so a new relation shows at once, even before tidying.
  const measure = measureOf(mode);
  const scores = useMemo(() => {
    if (!measure) return null;
    const ids = nodes.filter((node) => node.type === "card").map((node) => node.id);
    const links = edges.map((edge) => ({
      from: edge.source,
      to: edge.target,
      ...((edge.data as { kind?: string } | undefined)?.kind ? { kind: (edge.data as { kind: string }).kind } : {}),
    }));
    return scoresFor(measure, ids, leaningOf(links, false));
  }, [edges, measure, nodes]);

  const shown = useMemo(
    () =>
      nodes.map((node) => {
        const score = scores?.get(node.id);
        const scored = measure && score !== undefined ? { ...node, data: { ...node.data, score: scoreLabel(measure, score) } } : node;
        const summary = (node.data as CardData).node;
        const marked = summary && grounded.includes(summary.id) ? { ...scored, data: { ...scored.data, grounded: true } } : scored;
        return followed && summary?.id === followed ? { ...marked, className: "followed" } : marked;
      }),
    [nodes, followed, grounded, measure, scores],
  );

  const pickedNodes = nodes.flatMap((node) => {
    const summary = (node.data as CardData).node;
    return node.selected && summary ? [summary.id] : [];
  });

  // Not a <form>: sandboxed frames block form submission without any error.
  const nameInput = (
    <div className="name-form">
      <input
        data-dg="canvas-name"
        aria-label="Canvas name"
        placeholder="Canvas name"
        autoFocus
        value={canvasName}
        onChange={(event) => setCanvasName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void startCanvas(canvasName);
          if (event.key === "Escape") setNaming(false);
        }}
      />
      <button type="button" data-dg="canvas-create" onClick={() => void startCanvas(canvasName)}>Create</button>
    </div>
  );

  if (!hasCanvas) {
    return (
      <main className="empty">
        <h1>Start a canvas</h1>
        <p>Lay out questions, claims and evidence, and how they connect.</p>
        {nameInput}
        {notice ? <p role="alert">{notice}</p> : null}
      </main>
    );
  }

  const title = canvases.find((canvas) => canvas.id === current)?.title ?? "Canvas";
  const modeLabel = MODES.find((entry) => entry.mode === mode)!.label;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="shell" ref={shell}>
        <div className="picker">
          <button
            type="button"
            className="canvas-button"
            data-dg="canvas-menu"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => {
              setMenu((on_) => !on_);
              setNaming(false);
            }}
          >
            <span>{title}</span>
            <Icon name="chevron" />
          </button>
        </div>
        <div className="tools" role="toolbar" aria-label="Canvas tools">
          <button
            ref={addButton}
            type="button"
            className="tool"
            data-dg="add-node"
            aria-label="Add node"
            title="Add node (N)"
            aria-expanded={adding}
            onClick={() => (adding ? closeAdd() : openAdd())}
          >
            <Icon name="plus" />
            <span className="tool-label">Add node</span>
          </button>
          <button type="button" className="tool" data-dg="add-note" aria-label="Add note" title="Add note (T)" onClick={addNote}>
            <Icon name="note" />
            <span className="tool-label">Note</span>
          </button>
          <button
            type="button"
            className="tool"
            data-dg="draw"
            aria-label="Draw"
            title="Draw (D)"
            aria-pressed={tool === "draw"}
            onClick={() => setTool((old) => (old === "draw" ? "select" : "draw"))}
          >
            <Icon name="pen" />
            <span className="tool-label">Draw</span>
          </button>
          <div className="split" role="group" aria-label="Tidy">
            <button
              type="button"
              className="tool"
              data-dg="tidy"
              aria-label={`Tidy by ${modeLabel}`}
              title={`Tidy by ${modeLabel} (L)`}
              onClick={() => tidyUp(mode)}
            >
              <Icon name="tidy" />
              <span className="tool-label">Tidy</span>
            </button>
            <button
              ref={tidyButton}
              type="button"
              className="tool caret"
              data-dg="tidy-menu"
              aria-label="Choose how to tidy"
              title="Choose how to tidy"
              aria-haspopup="menu"
              aria-expanded={tidyAt !== null}
              onClick={openTidyMenu}
            >
              <Icon name="chevron" />
            </button>
          </div>
          <button
            type="button"
            className="tool"
            data-dg="export"
            aria-label="Export"
            title="Export a paper or selected nodes"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((on_) => !on_)}
          >
            <Icon name="export" />
            <span className="tool-label">Export</span>
          </button>
          <button
            type="button"
            className="tool"
            data-dg="ai"
            aria-label="AI"
            title="Ask about this canvas"
            aria-pressed={aiOn}
            onClick={() => setAiOn((on_) => !on_)}
          >
            <Icon name="ai" />
            <span className="tool-label">AI</span>
          </button>
          <button
            type="button"
            className="tool"
            data-dg="open-context"
            aria-label="Context"
            title="Open the context panel"
            onClick={() => void call("panel.open", { surface: "context" }).catch(report)}
          >
            <Icon name="context" />
            <span className="tool-label">Context</span>
          </button>
        </div>
        <div className="status" role="status">
          <span>{undo?.label ?? notice}</span>
          {undo ? (
            <button
              type="button"
              data-dg="undo"
              onClick={() => void undo.apply().catch(report)}
            >
              Undo
            </button>
          ) : null}
        </div>
        {menu ? (
          <div className="popover canvas-menu">
            <ul role="menu" aria-label="Canvases">
              {canvases.map((canvas) => (
                <li key={canvas.id}>
                  <button
                    type="button"
                    role="menuitem"
                    data-dg={`canvas-${canvas.title}`}
                    aria-current={canvas.id === current}
                    onClick={() => switchCanvas(canvas.id)}
                  >
                    {canvas.title}
                  </button>
                </li>
              ))}
            </ul>
            {naming ? (
              nameInput
            ) : (
              <>
                <button type="button" className="new" data-dg="new-canvas" onClick={() => setNaming(true)}>
                  <Icon name="plus" /> New canvas
                </button>
                <button type="button" className="new" data-dg="upload-paper" onClick={() => { setMenu(false); void call("dialog.open", { surface: "upload" }).catch(report); }}>
                  <Icon name="export" /> Upload a paper
                </button>
                <button type="button" className="new" data-dg="open-library" onClick={() => { setMenu(false); void call("panel.open", { surface: "canvases" }).catch(report); }}>
                  <Icon name="canvas" /> Open the Library
                </button>
              </>
            )}
          </div>
        ) : null}
        {exportOpen && view ? (
          <ExportMenu
            connection={connection}
            view={view}
            picked={pickedNodes}
            onClose={() => setExportOpen(false)}
            onDone={(message) => {
              setExportOpen(false);
              setNotice(message);
            }}
          />
        ) : null}
        {tidyAt ? (
          <div className="popover tidy-menu" role="menu" aria-label="Tidy modes" style={tidyAt}>
            {(["Arrange by", "Centrality"] as const).map((group) => (
              <div key={group} role="group" aria-label={group}>
                <h3>{group}</h3>
                {MODES.filter((entry) => entry.group === group).map((entry) => (
                  <button
                    key={entry.mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry.mode === mode}
                    data-dg={`tidy-${entry.mode}`}
                    onClick={() => tidyUp(entry.mode)}
                  >
                    <strong>{entry.label}</strong>
                    <span>{entry.hint}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {addAt ? (
          <div className="popover add-popover" role="dialog" aria-label="Add a node" style={addAt}>
            <input
              autoFocus
              data-dg="node-search"
              aria-label="Find or name a node"
              placeholder={linking ? "Find or name the next node" : "Find or name a node"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setActive((old) => Math.min(old + 1, results.length - 1));
                if (event.key === "ArrowUp") setActive((old) => Math.max(old - 1, 0));
                if (event.key === "Escape") closeAdd();
                if (event.key === "Enter" && results[active]) void addCard(results[active]!);
              }}
            />
            <ul>
              {results.map((node, index) => (
                <li key={node.id}>
                  <button
                    type="button"
                    data-dg={`result-${node.title}`}
                    data-active={index === active}
                    onClick={() => void addCard(node)}
                  >
                    <Chip node={node} />
                    <span className="result-title">{plain(node.title)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {query.trim() ? (
              <div className="create-row">
                <span>Create “{query.trim()}” as</span>
                {nodeTypeList.map((type) => (
                  <button key={type.id} type="button" data-dg={`create-${type.label}`} onClick={() => void createNode(type.id)}>
                    {type.label}
                  </button>
                ))}
                <button type="button" data-dg="create-untyped" onClick={() => void createNode()}>No type yet</button>
              </div>
            ) : null}
          </div>
        ) : null}
        <div
          ref={area}
          className={measure ? "area links-quiet" : "area"}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const text = event.dataTransfer.getData("text/plain").trim();
            if (!text) return;
            const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            void write({
              upserts: [{ item: { type: "text", text, x: Math.round(point.x), y: Math.round(point.y), ...NOTE }, z: nextZ() }],
            }).catch(report);
          }}
        >
          <ReactFlow
          multiSelectionKeyCode={MULTI_SELECT_KEYS}
            nodes={shown}
            edges={edges}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={36}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(link) => void onConnect(link).catch(report)}
            onConnectEnd={onConnectEnd}
            onSelectionChange={onSelectionChange}
            onPaneClick={() => {
              closeMenus();
              setExportOpen(false);
            }}
            onNodeClick={(_, node) => {
              const summary = (node.data as CardData).node;
              if (!aiOn || !summary) return;
              setGrounded((old) => (old.includes(summary.id) ? old.filter((id) => id !== summary.id) : [...old, summary.id]));
            }}
            onEdgeMouseEnter={(event, edge) => {
              const credit = (edge.data as { credit?: Credit } | undefined)?.credit;
              if (!credit) return;
              const { x, y } = inFrame(event.clientX + 10, event.clientY + 12, 200, 30);
              setEdgeTip({ x, y, credit });
            }}
            onEdgeMouseLeave={() => setEdgeTip(null)}
            onNodeDragStart={(_, node, selected) => {
              for (const item of [node, ...selected]) dragging.current.add(item.id);
            }}
            onNodeDragStop={(_, node, selected) => {
              const moved = selected.length > 0 ? selected : [node];
              for (const item of moved) dragging.current.delete(item.id);
              const upserts = moved.flatMap((item) => {
                const entry = items.current.get(item.id);
                if (!entry || "fromNode" in entry.item) return [];
                return [{
                  id: item.id,
                  z: entry.z,
                  item: withoutId({ ...entry.item, x: Math.round(item.position.x), y: Math.round(item.position.y) }),
                }];
              });
              void write({ upserts }).catch(report);
            }}
            onDelete={({ nodes: gone, edges: lost }) => {
              const ids = [...gone, ...lost].map((item) => item.id);
              void write({ removes: ids })
                .then(() =>
                  setUndo({
                    label: ids.length === 1 ? "Removed 1 item" : `Removed ${ids.length} items`,
                    apply: () => write({ restores: ids }),
                  }),
                )
                .catch(report);
            }}
            deleteKeyCode={["Backspace", "Delete"]}
            // On by default, and it swallows double-clicks meant for cards and notes.
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background gap={24} size={1} />
            <Panel position="bottom-left">
              <ViewBar />
            </Panel>
            <Panel position="bottom-right">
              <Legend edges={edges} labels={view?.relations ?? {}} />
            </Panel>
          </ReactFlow>
          {aiOn && view ? (
            <AiBar
              connection={connection}
              view={view}
              grounded={grounded}
              onClear={() => setGrounded([])}
              onCite={(id) => {
                const card = flow.getNodes().find((node) => (node.data as CardData).node?.id === id);
                if (card) void flow.fitView({ nodes: [card], maxZoom: 1, duration: 220 });
              }}
            />
          ) : null}
          {view && view.items.length === 0 ? (
            <div className="start">
              <strong>Start with a question or claim</strong>
              <span>Press <kbd>N</kbd> to add a node, then drag from its edge to connect the next.</span>
            </div>
          ) : null}
          {tool === "draw" ? (
            <div
              className="ink-layer"
              data-dg="ink-layer"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                ink.current = [inkPoint(event)];
              }}
              onPointerMove={(event) => {
                if (ink.current.length > 0) ink.current.push(inkPoint(event));
              }}
              onPointerUp={finishStroke}
            />
          ) : null}
        </div>
        {edgeTip ? (
          <div className="edge-tip" data-dg="edge-credit" style={{ left: Math.max(0, Math.min(edgeTip.x, (shell.current?.clientWidth ?? edgeTip.x) - TIP_WIDTH)), top: edgeTip.y }}>
            <Mark credit={edgeTip.credit} />
            <span>{edgeTip.credit.kind === "lab" ? `From ${edgeTip.credit.name}` : `By ${edgeTip.credit.name}`}</span>
          </div>
        ) : null}
        {relationMenu ? (
          <div className="popover menu relation-menu" role="menu" style={{ left: relationMenu.x, top: relationMenu.y }}>
            {relationMenu.options.length === 0 ? (
              <p>The grammar has no relation for these two nodes. Check that both have a type.</p>
            ) : (
              relationMenu.options.map((option) => (
                <button key={`${option.type}-${option.flipped}`} type="button" role="menuitem" data-dg={`relation-${option.label}`} onClick={() => void chooseRelation(option)}>
                  {option.label}
                </button>
              ))
            )}
            <button type="button" role="menuitem" className="quiet" onClick={() => setRelationMenu(null)}>Cancel</button>
          </div>
        ) : null}
        {typeMenu ? (
          <div className="popover menu" role="menu" style={{ left: typeMenu.x, top: typeMenu.y }}>
            {nodeTypeList.map((type) => (
              <button
                key={type.id}
                type="button"
                role="menuitem"
                data-dg={`type-${type.label}`}
                onClick={() => {
                  const target = typeMenu.node;
                  setTypeMenu(null);
                  void call("node.setType", { id: target, type: type.id }).catch(report);
                }}
              >
                {type.label}
              </button>
            ))}
            <button type="button" role="menuitem" className="quiet" onClick={() => setTypeMenu(null)}>Cancel</button>
          </div>
        ) : null}
      </div>
    </ActionsContext.Provider>
  );
};
