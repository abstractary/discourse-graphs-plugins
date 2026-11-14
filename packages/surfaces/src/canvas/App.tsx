import { CARD_FIELDS, CARD_FIELD_IDS, identifierUrl } from "@dg/contract/scholarly.ts";
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
import { PDF_CANVAS_FIXED } from "@dg/contract/surface.ts";
import type { CanvasCommand, CanvasItemView, CanvasView, Credit, LinkDelete, NodeSummary, RelatedUnit, RelationOption, RepositoryCanvas, SearchHit } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import { Chip, Icon, Mark, plain, type IconName } from "../shared/ui.tsx";
import { scoreLabel, scoresFor } from "@dg/layout/centrality.ts";
import { sidesFor } from "@dg/layout/edges.ts";
import { relationColor } from "../shared/relations.ts";
import { AiBar } from "./AiBar.tsx";
import { Thumb } from "../library/Repository.tsx";
import { ExportMenu } from "./ExportMenu.tsx";
import { Legend } from "./Legend.tsx";
import { MODES, arrange, leaningOf, measureOf, type Card, type RelationLink } from "@dg/layout/modes.ts";
import { ActionsContext, nodeTypes, type Actions, type Box, type CardData } from "./nodes.tsx";
import { HolonBar, isHolon, useHolonCanvas } from "./holons.tsx";
import { DRAG_TYPE, Drawer, useUnitsDrawer } from "./Drawer.tsx";
import { Sidebar, type SideTab } from "./Sidebar.tsx";
import { useHistory } from "./history.ts";
import { useFit } from "./fit.ts";
import { CARD_WIDTH, NOTE, cardHeight, clamp, nodeOfItem, toEdge, toNode, withoutId, type Anchor, type End, type FlowNode } from "./items.ts";
import { useCanvasWriter } from "./useCanvasWriter.ts";
import { LinkAskDialog, type LinkAsk } from "./LinkAsk.tsx";
import { CLIP_TYPE, clipFromTransfer, writeClip, type Clip } from "./clipboard.ts";
import { MOD, Marked } from "../search/parts.tsx";

const MOD_KEY = MOD === "Ctrl" ? "Ctrl+" : MOD;

/** Three columns fit the common 725 px frame beside a sidebar. */
// Keeps a link's tooltip inside the frame.
const TIP_WIDTH = 160;
// Shift is what most drawing tools use to add to a selection.
const MULTI_SELECT_KEYS = ["Meta", "Control", "Shift"];

const pathFrom = (outline: number[][]): string => {
  if (outline.length === 0) return "";
  const round = (value: number): number => Math.round(value * 10) / 10;
  const [first, ...rest] = outline;
  return `M${round(first![0]!)} ${round(first![1]!)}${rest.map(([x, y]) => `L${round(x!)} ${round(y!)}`).join("")}Z`;
};

type RelationMenu = { source: End; target: End; options: RelationOption[]; x: number; y: number };
type TypeMenu = { node: string; x: number; y: number };
/** A connection dropped on empty canvas, waiting for the node it should reach. */
type Linking = { from: End | null; item: string; at: { x: number; y: number } };
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
  const [fieldsAt, setFieldsAt] = useState<Anchor | null>(null);
  /** How many cards cover another after cards grew to show more. */
  const [crowded, setCrowded] = useState(0);
  const fieldsButton = useRef<HTMLButtonElement>(null);
  const [edgeTip, setEdgeTip] = useState<EdgeTip | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [grounded, setGrounded] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const flow = useReactFlow();
  const [canvases, setCanvases] = useState<CanvasRecord[]>([]);
  /** Each canvas as a picture of itself, read when the canvas menu opens. */
  const [pictures, setPictures] = useState<Record<string, RepositoryCanvas>>({});
  const [current, setCurrent] = useState<string | undefined>(route.id);
  const [view, setView] = useState<CanvasView | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeTypeList, setNodeTypeList] = useState<NodeTypeRecord[]>([]);
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [addAt, setAddAt] = useState<Anchor | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [menu, setMenu] = useState(false);
  /** Set while the menu asks whether to remove this canvas. */
  const [removeAsk, setRemoveAsk] = useState(false);
  useEffect(() => {
    if (!menu) return;
    void call("repository.canvases", {})
      .then((list) => setPictures(Object.fromEntries(list.map((item) => [item.id, item]))))
      .catch(() => {});
  }, [menu, call]);
  const [moreOpen, setMoreOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [naming, setNaming] = useState(false);
  const [canvasName, setCanvasName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [relationMenu, setRelationMenu] = useState<RelationMenu | null>(null);
  const [typeMenu, setTypeMenu] = useState<TypeMenu | null>(null);
  /** A card's relations, open beside it. `list` is null while it is being read. */
  const [relatedMenu, setRelatedMenu] = useState<{ node: string; item: string; x: number; y: number; list: RelatedUnit[] | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [linkAsk, setLinkAsk] = useState<LinkAsk | null>(null);
  /** Relations Delete should also withdraw, decided before the delete runs. */
  const withdrawing = useRef<string[]>([]);
  /** Where the pointer last was over the canvas, so a paste lands there. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** Units this canvas is placing itself, which record their own undo step. */
  const placingHere = useRef(new Set<string>());
  const [followed, setFollowed] = useState<string | null>(null);
  const dragging = useRef(new Set<string>());
  const ink = useRef<number[][]>([]);
  const items = useRef(new Map<string, CanvasItemView>());
  const fitted = useRef<string | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const tidyButton = useRef<HTMLButtonElement>(null);

  /** Set when someone tried to change a PDF canvas, so the way to build on it is put in front of them. */
  const [fixedAsk, setFixedAsk] = useState(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const report = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(PDF_CANVAS_FIXED)) {
      // Nothing was saved, so the canvas is drawn again as it stands.
      setFixedAsk(true);
      setNotice("");
      void refreshRef.current().catch(() => undefined);
      return;
    }
    setNotice(message);
  }, []);
  const { record, drop, undo, redo, status: done, dismiss, next } = useHistory(current, report);

  const viewRef = useRef(view);
  viewRef.current = view;

  // Read through a ref: a refresh already in flight must not undo a canvas switch.
  const currentRef = useRef(current);
  currentRef.current = current;
  // Units picked for a question belong to the canvas they were picked on.
  useEffect(() => setGrounded([]), [current]);
  useEffect(() => setFixedAsk(false), [current]);
  /** The PDF most of this canvas's cards came from, asked once per canvas and again when the PDF button is pressed. */
  const [pdfFor, setPdfFor] = useState<{ canvas: string; pdf: { ref: string; name: string } } | null>(null);
  useEffect(() => {
    if (!current) return;
    void call("canvas.pdf", { id: current }).then((pdf) => setPdfFor(pdf ? { canvas: current, pdf } : null)).catch(() => setPdfFor(null));
  }, [call, current]);

  // Going to another canvas from here stays in this tab.
  const switchTo = useCallback((id: string) => {
    currentRef.current = id;
    setCurrent(id);
  }, []);
  const holon = useHolonCanvas({ connection, current, switchTo, report, notify: setNotice });
  const drawerData = useUnitsDrawer({ connection, current, report });
  /** The sidebar: closed, or open on one of its tabs. It reopens on the tab it was last on. */
  const [side, setSide] = useState<SideTab | null>(null);
  const lastSide = useRef<SideTab>("places");
  const openSide = useCallback((tab: SideTab) => {
    lastSide.current = tab;
    setSide(tab);
  }, []);
  /** Units just put on this canvas, waiting for their cards to draw; `fromHere` when this canvas placed them. */
  const [arrived, setArrived] = useState<{ units: string[]; fromHere: boolean }>({ units: [], fromHere: true });
  const [fresh, setFresh] = useState<string[]>([]);
  const canvasesRef = useRef(canvases);
  canvasesRef.current = canvases;

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
  refreshRef.current = refresh;

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
  // Labels show while they fit, then icons, then a More menu, measured on this bar.
  const fit = useFit(bar, [hasCanvas, current, canvases, notice, aiOn]);
  // The bar is one tab stop; arrow keys move along it, as a toolbar's should.
  const barFocus = useRef(0);
  const barButtons = (): HTMLButtonElement[] =>
    Array.from(bar.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter((button) => button.offsetParent !== null);
  const rememberBarFocus = (event: React.FocusEvent) => {
    const at = barButtons().indexOf(event.target as HTMLButtonElement);
    if (at >= 0) barFocus.current = at;
  };
  const moveAlongBar = (event: React.KeyboardEvent) => {
    const list = barButtons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !list.length) return;
    const to =
      event.key === "ArrowRight" ? (at + 1) % list.length
      : event.key === "ArrowLeft" ? (at - 1 + list.length) % list.length
      : event.key === "Home" ? 0
      : event.key === "End" ? list.length - 1
      : null;
    if (to === null) return;
    event.preventDefault();
    list[to]!.focus();
  };
  useEffect(() => {
    const list = barButtons();
    const keep = Math.min(barFocus.current, list.length - 1);
    list.forEach((button, index) => {
      button.tabIndex = index === keep ? 0 : -1;
    });
  });
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

  const clearNotice = useCallback(() => setNotice(""), []);
  const writer = useCanvasWriter({ connection, current, items, area, record, onWrite: clearNotice });
  const { write, freeSpot, startingPoint, nextZ } = writer;

  const updateItem = useCallback(
    (id: string, change: (item: CanvasItem) => CanvasItem, label: string) => {
      const entry = items.current.get(id);
      if (!entry) return;
      const { z } = entry;
      const before = withoutId(entry.item);
      const after = withoutId(change(entry.item));
      void write({ upserts: [{ id, item: after, z }] })
        .then(() =>
          record({
            label,
            undo: () => write({ upserts: [{ id, item: before, z }] }),
            redo: () => write({ upserts: [{ id, item: after, z }] }),
          }),
        )
        .catch(report);
    },
    [write, report, record],
  );

  /** Renames a unit from its card. Only its author can, so a teammate's title stays put. */
  const rename = useCallback(
    async (node: string, title: string) => {
      const before = viewRef.current?.nodes[node]?.title;
      const after = title.replace(/\s+/g, " ").trim();
      if (!before || !after || after === before) return;
      // Recorded as it starts: renaming a note can take a moment while the base updates its links.
      const renaming = call("node.rename", { id: node, title: after });
      const step = {
        label: `Renamed “${plain(after)}”`,
        ready: renaming,
        undo: () => call("node.rename", { id: node, title: before }),
        redo: () => call("node.rename", { id: node, title: after }),
      };
      record(step);
      try {
        await renaming;
      } catch (error) {
        drop(step);
        report(error);
      }
    },
    [call, record, drop, report],
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
        updateItem(
          item,
          (old) => ({
            ...old,
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }),
          "Resized",
        ),
      saveText: (item, text) => updateItem(item, (old) => ({ ...old, text }) as CanvasItem, "Edited a note"),
      editTitle: (item) => setEditing(item),
      stopEditing: () => setEditing(null),
      rename: (node, title) => {
        setEditing(null);
        void rename(node, title);
      },
      openCanvas: (id) => (route.pinned ? void call("canvas.show", { id }).catch(report) : switchTo(id)),
      canvasTitle: (id) => canvasesRef.current.find((canvas) => canvas.id === id)?.title ?? null,
      fields: holon.prefs.cardFields,
      openIdentifier: (id) => {
        const url = identifierUrl(id);
        if (url) void call("link.open", { url }).catch(report);
      },
      readPassage: (node) => void call("node.view", { id: node }).then((seen) => (seen.provenance.pdf ? call("pdf.show", { ref: seen.provenance.pdf.ref, unit: node }) : null)).catch(report),
      openLibrary: (url) => void call("link.open", { url }).catch(report),
      image: (node) => call("unit.image", { id: node }).catch(() => null),
      observe: (output, item, title) => {
        if (!current) return;
        // The evidence lands to the left of its picture, the way an argument reads toward its claim.
        const card = flow.getNode(item);
        const size = { width: CARD_WIDTH, height: cardHeight(title) };
        const spot = freeSpot({ x: (card?.position.x ?? 0) - CARD_WIDTH - 80, y: card?.position.y ?? 0 }, size);
        void call("output.observe", { output, title, canvas: current, ...spot }).catch(report);
      },
      related: (node, item, anchor) => {
        const { x, y } = inFrame(anchor.left, anchor.bottom + 4, 320, 320);
        setRelatedMenu({ node, item, x, y, list: null });
        void call("unit.related", { id: node, ...(current ? { canvas: current } : {}) })
          .then((list) => setRelatedMenu((open) => (open && open.node === node ? { ...open, list } : open)))
          .catch(report);
      },
    }),
    [call, report, updateItem, inFrame, holon.prefs.cardFields, route.pinned, switchTo, rename, current, flow, freeSpot],
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
        const { ids } = await write({ upserts: [{ item: { fromNode: from.id, toNode: to.id }, z: nextZ() }] });
        record({ label: "Drew an arrow", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
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
    [askRelation, flow, nextZ, write, record],
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
      const ends = { type: option.type, source: from.node, target: to.node };
      const relation = await call("relation.assert", ends);
      const z = nextZ();
      const edge = (id: string) => ({ fromNode: from.item, toNode: to.item, dg: { relation: id } });
      const { ids } = await write({ upserts: [{ item: edge(relation.id), z }] });
      const item = ids[0]!;
      // Undo takes back a relation this made. One that was already there stays.
      let asserted: string | null = relation.made ? relation.id : null;
      record({
        label: `Linked: ${option.label}`,
        undo: async () => {
          await write({ removes: [item] });
          if (asserted) await call("relation.withdraw", { id: asserted });
        },
        redo: async () => {
          await write({ restores: [item] });
          if (!relation.made) return;
          asserted = (await call("relation.assert", ends)).id;
          await write({ upserts: [{ id: item, item: edge(asserted), z }] });
        },
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
      record({ label: `Added “${plain(node.title)}”`, undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
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
    // A PDF canvas takes new units only from its paper, by highlighting. Nothing is made, so nothing is left loose.
    if (viewRef.current?.paper && viewRef.current.canvas.id === current) {
      closeAdd();
      setFixedAsk(true);
      return;
    }
    try {
      await addCard(await call("node.create", { title, ...(type ? { type } : {}) }));
    } catch (error) {
      report(error);
    }
  };

  /**
   * Units from the drawer, laid out together the way Tidy's Logic mode would,
   * then put in a clear spot, or where they were dropped. Their links come too.
   */
  const placeGroup = async (ids: string[], at?: { x: number; y: number }): Promise<void> => {
    if (!current || !drawerData) return;
    const units = ids.flatMap((id) => (drawerData.units[id] ? [drawerData.units[id]!] : []));
    if (!units.length) return;
    const boxes: Card[] = units.map((unit) => ({
      id: unit.id,
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: cardHeight(unit.title),
      at: unit.at,
      credit: { key: unit.credit.id, label: unit.credit.name },
      ...(unit.typeLabel ? { kind: { key: unit.typeLabel, label: unit.typeLabel } } : {}),
    }));
    const chosen = new Set(ids);
    const links: RelationLink[] = drawerData.relations
      .filter((relation) => chosen.has(relation.source) && chosen.has(relation.target))
      .map((relation) => ({ from: relation.source, to: relation.target, label: relation.label, ...(relation.kind ? { kind: relation.kind } : {}) }));
    const frame = area.current?.getBoundingClientRect();
    const places =
      boxes.length === 1
        ? new Map([[boxes[0]!.id, { x: 0, y: 0 }]])
        : arrange({ mode: "logic", boxes, links, frame: frame?.width ? { width: frame.width, height: frame.height } : { width: 800, height: 600 }, previous: "kinds" }).places;
    const laid = boxes.map((box) => ({ ...box, ...(places.get(box.id) ?? { x: 0, y: 0 }) }));
    const left = Math.min(...laid.map((box) => box.x));
    const top = Math.min(...laid.map((box) => box.y));
    const size = {
      width: Math.max(...laid.map((box) => box.x + box.width)) - left,
      height: Math.max(...laid.map((box) => box.y + box.height)) - top,
    };
    const origin = at ? { x: Math.round(at.x - Math.min(size.width, CARD_WIDTH) / 2), y: Math.round(at.y - 20) } : freeSpot(startingPoint(size), size);
    try {
      for (const box of laid) placingHere.current.add(box.id);
      const { ids: written } = await call("canvas.placeUnits", {
        canvas: current,
        places: laid.map((box) => ({ node: box.id, x: origin.x + box.x - left, y: origin.y + box.y - top, width: box.width, height: box.height })),
      });
      const cards = units.length;
      setNotice("");
      record({ label: cards === 1 ? "Placed 1 unit" : `Placed ${cards} units`, undo: () => write({ removes: written }), redo: () => write({ restores: written }) });
    } catch (error) {
      report(error);
    }
  };

  /** Text pasted or dropped becomes a note where it landed. */
  /** Pictures dropped or pasted in: each is kept in the base and becomes an output, with its card where it landed. */
  const addPictures = async (files: File[], at: { x: number; y: number } | null): Promise<void> => {
    if (!current) return;
    const start = at ?? freeSpot(startingPoint({ width: 280, height: 250 }), { width: 280, height: 250 });
    let added = 0;
    try {
      for (const file of files) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(`${file.name} couldn't be read.`));
          reader.readAsDataURL(file);
        });
        await call("image.add", { canvas: current, file: { name: file.name || "Pasted picture.png", mediaType: file.type, dataBase64: dataUrl.split(",")[1] ?? "" }, x: Math.round(start.x + added * 40), y: Math.round(start.y + added * 40) });
        added += 1;
      }
      setNotice(added === 1 ? "Added 1 picture. Say what it shows to make it evidence." : `Added ${added} pictures`);
    } catch (error) {
      report(error);
    }
  };
  const picturesRef = useRef(addPictures);
  picturesRef.current = addPictures;

  /** Brings units a card is related to onto the canvas, beside it. Their links are drawn with them. */
  const placeRelated = async (units: NodeSummary[]): Promise<void> => {
    if (!current || !relatedMenu || units.length === 0) return;
    const card = flow.getNode(relatedMenu.item);
    let y = card?.position.y ?? 0;
    const x = (card?.position.x ?? 0) + (card?.measured?.width ?? CARD_WIDTH) + 100;
    const places = units.map((unit) => {
      const size = { width: CARD_WIDTH, height: cardHeight(unit.title) };
      const spot = freeSpot({ x, y }, size);
      y = spot.y + size.height + 30;
      return { node: unit.id, ...spot, ...size };
    });
    setRelatedMenu(null);
    try {
      const { ids } = await call("canvas.placeUnits", { canvas: current, places });
      record({ label: units.length === 1 ? "Placed 1 related unit" : `Placed ${units.length} related units`, undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
    } catch (error) {
      report(error);
    }
  };

  const addText = async (text: string, at: { x: number; y: number } | null): Promise<void> => {
    const spot = at ? { x: Math.round(at.x), y: Math.round(at.y) } : freeSpot(startingPoint(NOTE), NOTE);
    try {
      const { ids } = await write({ upserts: [{ item: { type: "text", text, ...spot, ...NOTE }, z: nextZ() }] });
      record({ label: "Added a note", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
    } catch (error) {
      report(error);
    }
  };

  const prefsRef = useRef(holon.prefs);
  prefsRef.current = holon.prefs;
  /** The delete about to run follows a remembered choice, so the status can offer to ask again. */
  const fromRemembered = useRef(false);

  /**
   * Delete on a link asks whether the relation is only coming off this canvas
   * or being withdrawn, unless the person made one answer their default. Links
   * that go because a card went are only taken off.
   */
  const beforeDelete = useCallback(
    async ({ edges: lost }: { nodes: FlowNode[]; edges: Edge[] }): Promise<boolean> => {
      withdrawing.current = [];
      fromRemembered.current = false;
      const shown_ = viewRef.current;
      const chosen = lost.flatMap((edge) => {
        const relation = (edge.data as { relation?: string } | undefined)?.relation;
        const known = relation ? shown_?.relations[relation] : undefined;
        return edge.selected && relation && known && (known.state === "active" || known.state === "pending") ? [{ id: relation, ...known }] : [];
      });
      if (!chosen.length) return true;
      const mine = [...new Set(chosen.filter((relation) => relation.mine).map((relation) => relation.id))];
      const decide = (choice: LinkDelete) => {
        withdrawing.current = choice === "withdraw" ? mine : [];
      };
      const preference = prefsRef.current.linkDelete;
      if (preference !== "ask") {
        decide(preference);
        fromRemembered.current = true;
        return true;
      }
      return new Promise<boolean>((resolve) => {
        setLinkAsk({
          links: chosen.map((relation) => ({
            label: relation.label,
            from: shown_?.nodes[relation.source]?.title ?? "",
            to: shown_?.nodes[relation.target]?.title ?? "",
          })),
          mine: mine.length,
          others: [...new Set(chosen.filter((relation) => !relation.mine).map((relation) => (relation.credit.kind === "lab" ? `its author in ${relation.credit.name}` : relation.credit.name)))],
          answer: (choice, remember) => {
            setLinkAsk(null);
            if (choice === "cancel") return resolve(false);
            if (remember) void call("prefs.set", { linkDelete: choice }).catch(report);
            decide(choice);
            resolve(true);
          },
        });
      });
    },
    [call, report],
  );

  /** Takes items off the canvas, and withdraws the relations Delete was told to. Undo asserts them again. */
  const removeItems = async (ids: string[], label?: string): Promise<void> => {
    if (!ids.length) return;
    const pulled = withdrawing.current;
    withdrawing.current = [];
    const remembered = fromRemembered.current;
    fromRemembered.current = false;
    const ends = new Map(pulled.flatMap((id) => (viewRef.current?.relations[id] ? [[id, viewRef.current.relations[id]!] as const] : [])));
    const drawn = ids.flatMap((id) => {
      const entry = items.current.get(id);
      const relation = entry && "fromNode" in entry.item ? (entry.item as { dg?: { relation?: string } }).dg?.relation : undefined;
      return entry && relation && ends.has(relation) ? [{ id, z: entry.z, item: withoutId(entry.item), relation }] : [];
    });
    const linksOnly = ids.every((id) => {
      const entry = items.current.get(id);
      return entry && "fromNode" in entry.item;
    });
    // The relation each withdrawn one is now, since undo asserts a fresh one.
    const now = new Map(pulled.map((id) => [id, id]));
    const withdraw = async () => {
      for (const id of now.values()) await call("relation.withdraw", { id });
    };
    try {
      await write({ removes: ids });
      await withdraw();
      const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
      record({
        label:
          label ??
          (pulled.length
            ? `Withdrew ${count(pulled.length, "relation", "relations")}`
            : linksOnly
              ? `Took ${count(ids.length, "link", "links")} off this canvas`
              : `Removed ${count(ids.length, "item", "items")}`),
        ...(remembered ? { remembered: true } : {}),
        undo: async () => {
          await write({ restores: ids });
          for (const [original, end] of ends) {
            const again = await call("relation.assert", { type: end.type, source: end.source, target: end.target });
            now.set(original, again.id);
            const edges = drawn.filter((edge) => edge.relation === original);
            if (edges.length) {
              await write({
                upserts: edges.map((edge) => ({ id: edge.id, z: edge.z, item: { ...edge.item, dg: { relation: again.id } } as WithoutId<CanvasItem> })),
              });
            }
          }
        },
        redo: async () => {
          await write({ removes: ids });
          await withdraw();
        },
      });
    } catch (error) {
      report(error);
    }
  };

  /** The selection, with the links between its cards, as a canvas clip. */
  const clipOfSelection = (): Clip | null => {
    const chosen = flow.getNodes().filter((node) => node.selected);
    if (!chosen.length || !currentRef.current) return null;
    const ids = new Set(chosen.map((node) => node.id));
    const entries = [...items.current.values()].filter(
      (entry) => ids.has(entry.id) || ("fromNode" in entry.item && ids.has(entry.item.fromNode) && ids.has(entry.item.toNode)),
    );
    return { v: 1, canvas: currentRef.current, items: entries.map(({ id, z, item }) => ({ id, z, item })) };
  };

  const textOfClip = (clip: Clip): string =>
    clip.items
      .flatMap(({ item }) => {
        if ("fromNode" in item) return [];
        const unit = (item as { dg?: { node?: string } }).dg?.node;
        const title = unit ? viewRef.current?.nodes[unit]?.title : undefined;
        return [plain(title ?? (item.type === "text" ? item.text : item.type === "file" ? item.file : item.type === "link" ? item.url : ""))];
      })
      .filter(Boolean)
      .join("\n");

  /**
   * Puts a clip's items here, keeping their layout, at the pointer if it's over
   * the canvas. A unit stays one card per canvas, so one that's already here is
   * lit instead. Notes and drawings are copied; units keep being the same unit.
   */
  const pasteClip = async (clip: Clip, at: { x: number; y: number } | null): Promise<void> => {
    if (!current) return;
    type Placed = { x: number; y: number; width: number; height: number };
    const boxes = clip.items.filter((entry) => !("fromNode" in entry.item)) as { id: string; z: number; item: CanvasItem & Placed }[];
    if (!boxes.length) return;
    const unitOf = (item: CanvasItem) => (item as { dg?: { node?: string } }).dg?.node;
    const here = new Set([...items.current.values()].flatMap((entry) => (nodeOfItem(entry) ? [nodeOfItem(entry)!] : [])));
    const left = Math.min(...boxes.map(({ item }) => item.x));
    const top = Math.min(...boxes.map(({ item }) => item.y));
    const size = {
      width: Math.max(...boxes.map(({ item }) => item.x + item.width)) - left,
      height: Math.max(...boxes.map(({ item }) => item.y + item.height)) - top,
    };
    const origin = at
      ? { x: Math.round(at.x - Math.min(size.width, CARD_WIDTH) / 2), y: Math.round(at.y - 20) }
      : clip.canvas === current
        ? { x: left + 32, y: top + 32 }
        : freeSpot(startingPoint(size), size);
    const moved = (item: Placed) => ({ x: Math.round(origin.x + item.x - left), y: Math.round(origin.y + item.y - top) });
    const already = boxes.flatMap(({ item }) => (unitOf(item) && here.has(unitOf(item)!) ? [unitOf(item)!] : []));
    const units = boxes.filter(({ item }) => unitOf(item) && !here.has(unitOf(item)!));
    const others = boxes.filter(({ item }) => !unitOf(item) && !(item as { guide?: boolean }).guide);
    const written: string[] = [];
    try {
      if (units.length) {
        for (const { item } of units) placingHere.current.add(unitOf(item)!);
        const { ids } = await call("canvas.placeUnits", {
          canvas: current,
          places: units.map(({ item }) => ({ node: unitOf(item)!, ...moved(item), width: item.width, height: item.height })),
        });
        written.push(...ids);
      }
      if (others.length) {
        let z = nextZ();
        const { ids } = await write({ upserts: others.map(({ item }) => ({ item: withoutId({ ...item, ...moved(item) } as CanvasItem), z: z++ })) });
        written.push(...ids);
        const copied = new Map(others.map((entry, index) => [entry.id, ids[index]!]));
        const arrows = clip.items.filter(
          ({ item }) => "fromNode" in item && !(item as { dg?: unknown }).dg && copied.has(item.fromNode) && copied.has(item.toNode),
        );
        if (arrows.length) {
          const { ids: more } = await write({
            upserts: arrows.map(({ item }) => {
              const edge = item as CanvasItem & { fromNode: string; toNode: string };
              return { item: withoutId({ ...edge, fromNode: copied.get(edge.fromNode)!, toNode: copied.get(edge.toNode)! } as CanvasItem), z: z++ };
            }),
          });
          written.push(...more);
        }
      }
      if (already.length) void call("canvas.highlight", { units: already }).catch(report);
      if (!written.length) {
        setNotice(already.length === 1 ? "That unit is already on this canvas" : "Those units are already on this canvas");
        return;
      }
      const pasted = units.length + others.length;
      record({
        label: `Pasted ${pasted === 1 ? "1 item" : `${pasted} items`}${already.length ? `, ${already.length} already here` : ""}`,
        undo: () => write({ removes: written }),
        redo: () => write({ restores: written }),
      });
    } catch (error) {
      report(error);
    }
  };

  // Copy, cut and paste go through the clipboard, so they work between canvases and tabs.
  const clipboard = useRef({ clipOfSelection, textOfClip, pasteClip, removeItems, addText });
  clipboard.current = { clipOfSelection, textOfClip, pasteClip, removeItems, addText };
  useEffect(() => {
    const typing = (event: Event): boolean => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']")) return true;
      const selection = window.getSelection();
      return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
    };
    const copy = (event: ClipboardEvent, cut: boolean): void => {
      if (typing(event) || !event.clipboardData) return;
      const clip = clipboard.current.clipOfSelection();
      if (!clip) return;
      event.preventDefault();
      writeClip(event.clipboardData, clip, clipboard.current.textOfClip(clip));
      const count = clip.items.filter((entry) => !("fromNode" in entry.item)).length;
      if (cut) void clipboard.current.removeItems(clip.items.map((entry) => entry.id), `Cut ${count === 1 ? "1 item" : `${count} items`}`);
      else setNotice(count === 1 ? "Copied 1 item" : `Copied ${count} items`);
    };
    const onCopy = (event: ClipboardEvent) => copy(event, false);
    const onCut = (event: ClipboardEvent) => copy(event, true);
    const onPaste = (event: ClipboardEvent): void => {
      if (typing(event)) return;
      const at = pointer.current ? flow.screenToFlowPosition(pointer.current) : null;
      const clip = clipFromTransfer(event.clipboardData);
      if (clip) {
        event.preventDefault();
        void clipboard.current.pasteClip(clip, at);
        return;
      }
      const pasted = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (pasted.length) {
        event.preventDefault();
        void picturesRef.current(pasted, at);
        return;
      }
      const text = event.clipboardData?.getData("text/plain").trim();
      if (text) {
        event.preventDefault();
        void clipboard.current.addText(text, at);
      }
    };
    // A keyboard copy with nothing selected as text still copies the cards.
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (!mod || event.altKey || event.shiftKey || (key !== "c" && key !== "x")) return;
      if (typing(event) || !clipboard.current.clipOfSelection()) return;
      event.preventDefault();
      document.execCommand(key === "c" ? "copy" : "cut");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [flow]);

  // Units put here from another panel, such as a PDF highlight, come into view.
  useEffect(() => on("units-placed", ({ canvas, units }) => {
    if (canvas !== currentRef.current) return;
    const fromHere = units.every((unit) => placingHere.current.has(unit));
    for (const unit of units) placingHere.current.delete(unit);
    setArrived({ units, fromHere });
    if (fromHere) return;
    // Units sent from another panel, such as search, are an edit to this canvas too. The step is
    // recorded now, in order; which cards it takes off is worked out when it's undone.
    let taken: string[] = [];
    record({
      label: units.length === 1 ? "Put 1 unit here" : `Put ${units.length} units here`,
      undo: async () => {
        const entries = [...items.current.values()];
        const cards = entries.filter((entry) => units.includes(nodeOfItem(entry) ?? "")).map((entry) => entry.id);
        const links = entries.filter((entry) => "fromNode" in entry.item && (cards.includes(entry.item.fromNode) || cards.includes(entry.item.toNode))).map((entry) => entry.id);
        taken = [...cards, ...links];
        await write({ removes: taken });
      },
      redo: () => write({ restores: taken }),
    });
  }), [on, record, write]);
  useEffect(() => {
    const { units: arriving, fromHere } = arrived;
    if (!arriving.length) return;
    const cards = flow.getNodes().filter((node) => arriving.includes((node.data as CardData).node?.id ?? ""));
    // Their drawn sizes decide where they fit, so wait until each has been measured.
    if (cards.length < arriving.length || cards.some((node) => !node.measured?.height)) return;
    setArrived({ units: [], fromHere: true });
    setFresh(arriving);
    // Pan only as far as it takes to bring them in, so the rest of the argument stays in view.
    const box = area.current?.getBoundingClientRect();
    if (box) {
      const viewport = flow.getViewport();
      const MARGIN = 32;
      const corners = cards.map((node) => {
        const at = flow.flowToScreenPosition(node.position);
        return { left: at.x, top: at.y, right: at.x + (node.measured?.width ?? CARD_WIDTH) * viewport.zoom, bottom: at.y + (node.measured?.height ?? 80) * viewport.zoom };
      });
      const left = Math.min(...corners.map((c) => c.left));
      const right = Math.max(...corners.map((c) => c.right));
      const top = Math.min(...corners.map((c) => c.top));
      const bottom = Math.max(...corners.map((c) => c.bottom));
      const dx = right > box.right - MARGIN ? Math.max(box.right - MARGIN - right, box.left + MARGIN - left) : left < box.left + MARGIN ? box.left + MARGIN - left : 0;
      const dy = bottom > box.bottom - MARGIN ? Math.max(box.bottom - MARGIN - bottom, box.top + MARGIN - top) : top < box.top + MARGIN ? box.top + MARGIN - top : 0;
      const [only] = cards;
      const entry = only ? items.current.get(only.id) : undefined;
      if (!fromHere && cards.length > 1) {
        // Several sent from another panel are laid out together, at their drawn sizes, in a clear spot in view.
        const ids = new Set(cards.map((node) => node.id));
        const boxes: Card[] = cards.map((node) => {
          const summary = (node.data as CardData).node;
          return {
            id: node.id,
            x: 0,
            y: 0,
            width: node.measured?.width ?? CARD_WIDTH,
            height: node.measured?.height ?? 80,
            ...(summary ? { at: summary.at, credit: { key: summary.credit.id, label: summary.credit.name }, ...(summary.paper ? { source: { key: summary.paper.id, label: summary.paper.label } } : {}), ...(summary.typeLabel ? { kind: { key: summary.typeLabel, label: summary.typeLabel } } : {}) } : {}),
          };
        });
        const links: RelationLink[] = flow
          .getEdges()
          .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
          .map((edge) => ({ from: edge.source, to: edge.target, ...((edge.data as { kind?: string } | undefined)?.kind ? { kind: (edge.data as { kind: string }).kind } : {}) }));
        const { places } = arrange({ mode: "logic", boxes, links, frame: { width: box.width, height: box.height }, previous: "kinds" });
        const laid = boxes.map((card) => ({ ...card, ...(places.get(card.id) ?? { x: 0, y: 0 }) }));
        const left = Math.min(...laid.map((card) => card.x));
        const top = Math.min(...laid.map((card) => card.y));
        const size = { width: Math.max(...laid.map((card) => card.x + card.width)) - left, height: Math.max(...laid.map((card) => card.y + card.height)) - top };
        const spot = freeSpot(startingPoint(size), size, ids);
        const upserts = laid.flatMap((card) => {
          const known = items.current.get(card.id);
          return known && !("fromNode" in known.item)
            ? [{ id: card.id, z: known.z, item: withoutId({ ...known.item, x: Math.round(spot.x + card.x - left), y: Math.round(spot.y + card.y - top) }) }]
            : [];
        });
        void write({ upserts }).catch(report);
      } else if (!fromHere && cards.length === 1 && only && entry && !("fromNode" in entry.item)) {
        // One card sent from another panel, such as a highlight, comes to where the person is looking,
        // and never onto another card: where it already sits counts only if that spot is clear.
        const size = { width: only.measured?.width ?? CARD_WIDTH, height: only.measured?.height ?? 80 };
        const spot = freeSpot(dx || dy ? startingPoint(size) : only.position, size, new Set([only.id]));
        if (spot.x !== Math.round(only.position.x) || spot.y !== Math.round(only.position.y)) {
          void write({ upserts: [{ id: only.id, z: entry.z, item: withoutId({ ...entry.item, ...spot }) }] }).catch(report);
        }
      } else if (dx || dy) void flow.setViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, { duration: 280 });
    }
  }, [arrived, nodes, flow, freeSpot, startingPoint, write, report]);
  // A link elsewhere pointed at a unit here: bring its card into view and mark it for a moment.
  useEffect(() => on("reveal-unit", ({ canvas, unit }) => {
    if (canvas !== currentRef.current) return;
    void call("canvas.revealed", { id: canvas }).catch(() => null);
    setArrived({ units: [unit], fromHere: true });
  }), [on, call]);
  useEffect(() => {
    if (!current) return;
    void call("canvas.revealed", { id: current }).then((unit) => (unit && currentRef.current === current ? setArrived({ units: [unit], fromHere: true }) : undefined)).catch(() => undefined);
  }, [call, current]);
  useEffect(() => {
    if (!fresh.length) return;
    const timer = window.setTimeout(() => setFresh([]), 1800);
    return () => window.clearTimeout(timer);
  }, [fresh]);

  const adding = addAt !== null;
  useEffect(() => {
    if (!adding) return;
    setActive(0);
    void call("search.query", { text: query, limit: 8 }).then(({ hits }) => setResults(hits)).catch(report);
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
    void write({ upserts: [{ item: { type: "text", text: "Note", ...spot, ...NOTE }, z: nextZ() }] })
      .then(({ ids }) => record({ label: "Added a note", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) }))
      .catch(report);
  }, [freeSpot, startingPoint, write, nextZ, report, record]);

  // A canvas can carry an arrangement this app no longer has. It is read as Logic.
  const stored = view?.canvas.layout?.mode;
  const mode: TidyMode = stored && MODES.some((entry) => entry.mode === stored) ? stored : "logic";

  /** One write for the whole layout, so a teammate sees it land at once. */
  const tidyUp = useCallback((chosen: TidyMode) => {
    setTidyAt(null);
    // Whatever was covering what, it is about to be put right.
    setCrowded(0);
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
              credit: { key: summary.credit.id, label: summary.credit.name }, ...(summary.paper ? { source: { key: summary.paper.id, label: summary.paper.label } } : {}),
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
        const keptForward = headings.filter((heading) => heading.id);
        record({
          label: `Tidied: ${label}`,
          undo: async () => {
            await write({ upserts: [...back, ...movedHeadings], removes: added, restores: gone });
            await call("canvas.setLayout", { id: view.canvas.id, layout: before });
          },
          redo: async () => {
            await write({ upserts: [...moves, ...keptForward], restores: added, removes: gone });
            await call("canvas.setLayout", { id: view.canvas.id, layout: next });
          },
        });
        window.setTimeout(() => void flow.fitView({ maxZoom: 1, minZoom: 0.7, padding: 0.12, duration: 200 }), 120);
      })
      .catch(report);
  }, [call, flow, followed, write, report, view, record]);

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

  const openFieldsMenu = useCallback(() => {
    const button = fieldsButton.current!.getBoundingClientRect();
    const { x, y } = inFrame(button.left, button.bottom + 4, 290, 300);
    setFieldsAt((open) => (open ? null : { left: x, top: y }));
  }, [inFrame]);

  // Cards grow when they show more. Nothing is moved for the person; they are told, and offered Tidy.
  const shownFields = holon.prefs.cardFields.join(",");
  const lastFields = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const countCovering = useCallback(() => {
    const boxes = nodesRef.current
      .filter((node) => node.type === "card" && node.measured?.height)
      .map((node) => ({ left: node.position.x, top: node.position.y, right: node.position.x + (node.measured?.width ?? CARD_WIDTH), bottom: node.position.y + node.measured!.height! }));
    let covering = 0;
    boxes.forEach((a, index) => {
      if (boxes.some((b, other) => other !== index && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom && (a.top > b.top || (a.top === b.top && index > other)))) covering += 1;
    });
    setCrowded(covering);
  }, []);
  useEffect(() => {
    const before = lastFields.current;
    lastFields.current = shownFields;
    if (before === null || before === shownFields) return;
    const timer = window.setTimeout(countCovering, 500);
    return () => window.clearTimeout(timer);
  }, [shownFields, countCovering]);
  // A canvas laid out when its cards showed less can open with cards over each other. Say so once it is drawn.
  useEffect(() => {
    setCrowded(0);
    if (!canvasId || needsLayout) return;
    const timer = window.setTimeout(countCovering, 1500);
    return () => window.clearTimeout(timer);
  }, [canvasId, needsLayout, countCovering]);

  // The list stays open while its switches are used, and closes on a click anywhere else.
  useEffect(() => {
    if (!fieldsAt) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-dg="card-fields-menu"], [data-dg="card-fields"]')) return;
      setFieldsAt(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFieldsAt(null);
      fieldsButton.current?.focus();
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", escape);
    };
  }, [fieldsAt]);

  // What the base's command palette or a hotkey asks of this canvas. Each does what its button does.
  const commandRef = useRef<(name: CanvasCommand) => void>(() => {});
  commandRef.current = (name) => {
    if (name === "add-unit") openAdd();
    else if (name === "tidy") tidyUp(mode);
    else if (name === "fit") void flow.fitView({ maxZoom: 1, padding: 0.12, duration: 180 });
    else if (name === "export") setExportOpen(true);
    else if (name === "ask-ai") setAiOn((on_) => !on_);
    else if (name === "undo") void undo();
    else if (name === "redo") void redo();
    else if (name === "cards") openFieldsMenu();
    else if (name === "types") void call("dialog.open", { surface: "grammar" }).catch(report);
  };
  useEffect(() => on("command", ({ canvas, name }) => {
    if (canvas === currentRef.current) commandRef.current(name);
  }), [on]);

  const closeMenus = useCallback(() => {
    setFieldsAt(null);
    setMenu(false);
    setMoreOpen(false);
    setNaming(false);
    setRelationMenu(null);
    setTypeMenu(null);
    setRelatedMenu(null);
    setTidyAt(null);
    closeAdd();
  }, [closeAdd]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement).closest?.("input, textarea")) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      // Text being edited keeps its own undo; everything else on the canvas has this one.
      if (mod && !event.altKey && key === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
        return;
      }
      if (event.ctrlKey && !event.metaKey && key === "y") {
        event.preventDefault();
        void redo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (key === "f2") {
        const picked = flow.getNodes().filter((node) => node.selected && node.type === "card");
        const summary = (picked[0]?.data as CardData | undefined)?.node;
        if (picked.length === 1 && summary) {
          event.preventDefault();
          if (summary.mine) setEditing(picked[0]!.id);
          else setNotice(summary.credit.kind === "lab" ? `This unit is from ${summary.credit.name}. Only its author can rename it.` : `Only ${summary.credit.name} can rename this unit.`);
        }
        return;
      }
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
      } else if (key === "u") {
        setSide((old) => (old === "units" ? null : ((lastSide.current = "units"), "units")));
      } else if (key === "enter") {
        const picked = flow.getNodes().filter((node) => node.selected);
        const node = (picked[0]?.data as CardData | undefined)?.node;
        if (picked.length === 1 && node) actions.reveal(node.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, addNote, aiOn, closeMenus, flow, mode, openAdd, tidyUp, undo, redo]);

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
    })
      .then(({ ids }) => record({ label: "Drew a line", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) }))
      .catch(report);
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

  const litHere = useMemo(() => holon.lit.length > 0 && nodes.some((node) => holon.lit.includes((node.data as CardData).node?.id ?? "")), [holon.lit, nodes]);
  const shown = useMemo(
    () =>
      nodes.map((node) => {
        const score = scores?.get(node.id);
        const scored = measure && score !== undefined ? { ...node, data: { ...node.data, score: scoreLabel(measure, score) } } : node;
        const summary = (node.data as CardData).node;
        const marked = summary && grounded.includes(summary.id) ? { ...scored, data: { ...scored.data, grounded: true } } : scored;
        // Lit from another panel, such as a gap in the boundary panel. Nothing dims for units shown elsewhere.
        const lit = litHere ? (summary && holon.lit.includes(summary.id) ? "lit" : "dim") : "";
        const arriving = summary && fresh.includes(summary.id) ? "arrived" : "";
        const classes = [followed && summary?.id === followed ? "followed" : "", lit, arriving].filter(Boolean).join(" ");
        const edited = editing === node.id ? { ...marked, data: { ...marked.data, editing: true } } : marked;
        return classes ? { ...edited, className: classes } : edited;
      }),
    [nodes, followed, grounded, measure, scores, holon.lit, litHere, fresh, editing],
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
  /** A PDF canvas stays as its paper was read. */
  const reading = view?.canvas.id === current ? view?.paper : undefined;
  const fixedWhy = "A PDF canvas holds only what comes from its paper. Build on it to add your own.";
  const buildOn = (): void => {
    if (!current) return;
    void call("canvas.buildOn", { id: current })
      .then(async ({ id, title: made }) => {
        setFixedAsk(false);
        if (route.pinned) await call("canvas.show", { id });
        else switchTo(id);
        setNotice(`Made “${made}” in your workspace. The PDF canvas is unchanged.`);
      })
      .catch(report);
  };
  const parentPdf = pdfFor && pdfFor.canvas === current ? pdfFor.pdf : undefined;
  // Asked again at the press, since cards may have come and gone since the canvas opened.
  const openPdf = (): void =>
    void (current ? call("canvas.pdf", { id: current }).catch(() => null) : Promise.resolve(null))
      .then((pdf) => call("pdf.show", pdf ? { ref: pdf.ref } : {}))
      .catch(report);
  const modeLabel = MODES.find((entry) => entry.mode === mode)!.label;
  /** The panels that work beside a canvas, opened from its bar. */
  // Panels open beside the canvas. Context keeps its word longest, since no icon says "context".
  const panelButtons: { dg: string; label: string; title: string; icon: IconName; keep?: boolean; open: () => void }[] = [
    { dg: "open-search", label: "Search units", title: "Search units, in the sidebar", icon: "search", open: () => openSide("search") },
    { dg: "open-context", label: "Context", title: "Open the context panel", icon: "context", keep: true, open: () => void call("panel.open", { surface: "context" }).catch(report) },
    { dg: "open-pdf", label: "PDF", title: parentPdf ? `Read ${parentPdf.name}, the PDF most of these cards came from. Its title there lists the others` : "Read a PDF beside the canvas", icon: "pdf", open: openPdf },
  ];

  return (
    <ActionsContext.Provider value={actions}>
      <div className="shell" ref={shell} data-side={side ? (holon.prefs.sidePinned ? "pinned" : "floating") : undefined}>
        <header className="bar" ref={bar} data-fit={fit} role="toolbar" aria-label="Canvas" onKeyDown={moveAlongBar} onFocus={rememberBarFocus}>
          <button type="button" className="tool side-toggle" data-dg="side-toggle" aria-label="Library, search units and units to place" aria-expanded={side !== null} title="Library, search units and units to place" onClick={() => (side ? setSide(null) : openSide(lastSide.current))}>
            <Icon name="sidebar" />
          </button>
          <div className="picker" data-fit-min="96">
            <button
              type="button"
              className="canvas-button"
              data-dg="canvas-menu"
              aria-haspopup="menu"
              aria-expanded={menu}
              title={`${title}: canvases, export and more`}
              onClick={() => {
                setMenu((on_) => !on_);
                setNaming(false);
              }}
            >
              <span>{title}</span>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="tool-group create" role="group" aria-label="Add">
            <button
              ref={addButton}
              type="button"
              className="tool"
              data-dg="add-node"
              aria-label={reading ? "Highlight in the PDF" : "Add unit"}
              title={reading ? "Add a unit by highlighting it in this paper's PDF" : "Add unit · N"}
              aria-expanded={reading ? undefined : adding}
              onClick={() => (reading ? openPdf() : adding ? closeAdd() : openAdd())}
            >
              <Icon name={reading ? "pdf" : "plus"} />
              <span className="tool-label">{reading ? "Highlight" : "Add unit"}</span>
            </button>
            {fit !== "more" ? (
              <>
                <button type="button" className="tool" data-dg="add-note" aria-label="Add sticky" disabled={Boolean(reading)} title={reading ? fixedWhy : "Add a sticky · T"} onClick={addNote}>
                  <Icon name="note" />
                  <span className="tool-label">Sticky</span>
                </button>
                <button
                  type="button"
                  className="tool"
                  data-dg="draw"
                  aria-label="Draw"
                  disabled={Boolean(reading)}
                  title={reading ? fixedWhy : "Draw · D"}
                  aria-pressed={tool === "draw"}
                  onClick={() => setTool((old) => (old === "draw" ? "select" : "draw"))}
                >
                  <Icon name="pen" />
                  <span className="tool-label">Draw</span>
                </button>
              </>
            ) : null}
          </div>
          <div className="tool-group split" role="group" aria-label="Tidy">
            <button
              type="button"
              className="tool keep"
              data-dg="tidy"
              aria-label={`Tidy by ${modeLabel}`}
              title={`Tidy by ${modeLabel} · L`}
              onClick={() => tidyUp(mode)}
            >
              <Icon name="tidy" />
              <span className="tool-label">
                Tidy <span className="tool-mode">{modeLabel}</span>
              </span>
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
          <div className="tool-group" role="group" aria-label="Cards">
            <button
              ref={fieldsButton}
              type="button"
              className="tool"
              data-dg="card-fields"
              aria-label="What cards show"
              title="Choose what every card shows"
              aria-haspopup="menu"
              aria-expanded={fieldsAt !== null}
              onClick={openFieldsMenu}
            >
              <Icon name="card" />
              <span className="tool-label">Cards</span>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="status" role="status" data-fit-min="0">
            <span data-dg="status-text">{notice || (crowded ? `${crowded} ${crowded === 1 ? "card now covers" : "cards now cover"} another` : "") || done?.label || ""}</span>
            {!notice && crowded ? (
              <button type="button" className="status-link" data-dg="tidy-after-fields" title={`Tidy by ${modeLabel} to make room`} onClick={() => { setCrowded(0); tidyUp(mode); }}>
                Tidy
              </button>
            ) : null}
            {!notice && !crowded && done?.remembered ? (
              <button
                type="button"
                className="status-link"
                data-dg="link-delete-ask-again"
                title="Ask again each time a link is deleted"
                onClick={() => {
                  dismiss();
                  void call("prefs.set", { linkDelete: "ask" }).then(() => setNotice("Delete will ask about links again")).catch(report);
                }}
              >
                Ask next time
              </button>
            ) : null}
          </div>
          <div className="tool-group history" role="group" aria-label="History">
            <button
              type="button"
              className="tool icon-only"
              data-dg="undo"
              aria-label={next.undo ? `Undo: ${next.undo}` : "Nothing to undo"}
              title={next.undo ? `Undo: ${next.undo} · ${MOD_KEY}Z` : "Nothing to undo"}
              disabled={!next.undo}
              onClick={() => void undo()}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="tool icon-only"
              data-dg="redo"
              aria-label={next.redo ? `Redo: ${next.redo}` : "Nothing to redo"}
              title={next.redo ? `Redo: ${next.redo} · ${MOD_KEY}⇧Z` : "Nothing to redo"}
              disabled={!next.redo}
              onClick={() => void redo()}
            >
              <Icon name="redo" />
            </button>
          </div>
          <div className="tool-group panels" role="group" aria-label="Panels">
            {fit !== "more" ? (
              <button
                type="button"
                className="tool keep"
                data-dg="ai"
                aria-label="Ask AI"
                title="Ask about this canvas"
                aria-pressed={aiOn}
                onClick={() => setAiOn((on_) => !on_)}
              >
                <Icon name="ai" />
                <span className="tool-label">Ask AI</span>
              </button>
            ) : null}
            {panelButtons
              .filter((panel) => fit !== "more" || panel.dg !== "open-pdf")
              .map((panel) => (
                <button key={panel.dg} type="button" className={panel.keep ? "tool keep" : "tool"} data-dg={panel.dg} aria-label={panel.label} title={panel.title} onClick={panel.open}>
                  <Icon name={panel.icon} />
                  <span className="tool-label">{panel.label}</span>
                </button>
              ))}
            {fit === "more" ? (
              <button
                ref={moreButton}
                type="button"
                className="tool icon-only"
                data-dg="toolbar-more"
                aria-label="More tools"
                title="Note, Draw, Ask AI and PDF"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((on_) => !on_)}
              >
                <Icon name="more" />
              </button>
            ) : null}
          </div>
        </header>
        {moreOpen && fit === "more" ? (
          <div className="popover menu more-menu" role="menu" aria-label="More tools">
            <button type="button" role="menuitem" data-dg="add-note" onClick={() => { setMoreOpen(false); addNote(); }}>
              <Icon name="note" /> Note <kbd>T</kbd>
            </button>
            <button type="button" role="menuitem" data-dg="draw" onClick={() => { setMoreOpen(false); setTool((old) => (old === "draw" ? "select" : "draw")); }}>
              <Icon name="pen" /> Draw <kbd>D</kbd>
            </button>
            <hr />
            <button type="button" role="menuitem" data-dg="ai" onClick={() => { setMoreOpen(false); setAiOn((on_) => !on_); }}>
              <Icon name="ai" /> Ask AI
            </button>
            <button type="button" role="menuitem" data-dg="open-pdf" onClick={() => { setMoreOpen(false); openPdf(); }}>
              <Icon name="pdf" /> {parentPdf ? "Read its PDF" : "Read a PDF"}
            </button>
          </div>
        ) : null}
        {reading ? (
          <div className="fixed-strip" data-dg="pdf-canvas-fixed" data-asked={fixedAsk} role={fixedAsk ? "alert" : "note"}>
            <span className="repo-kind" data-kind="paper"><Icon name="pdf" /> PDF canvas</span>
            <span className="fixed-why">
              {fixedAsk ? "That isn't from this paper, so it can't go here. " : ""}
              {reading.filename}, read by {reading.model} on {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(Date.parse(reading.at))}. Reword or retype a card, or highlight in the PDF to add one. Everything here comes from this paper.
            </span>
            <button type="button" className={fixedAsk ? "primary" : undefined} data-dg="build-on" title="Make a canvas of your own with the same cards, and add to that" onClick={buildOn}>
              Build on it
            </button>
          </div>
        ) : null}
        <HolonBar
          connection={connection}
          current={current}
          info={holon.info}
          lit={litHere ? holon.lit.filter((id) => nodes.some((node) => (node.data as CardData).node?.id === id)) : []}
          onClearLit={() => holon.setLit([])}
          onOpen={(ref) => void holon.openInside(ref)}
          report={report}
        />
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
                    {pictures[canvas.id] ? <Thumb thumb={pictures[canvas.id]!.thumb} /> : <span className="thumb thumb-empty" aria-hidden="true" />}
                    <span className="canvas-pick">
                      <span className="canvas-pick-title">{canvas.title}</span>
                      {pictures[canvas.id] ? (
                        <span className="repo-kind" data-kind={pictures[canvas.id]!.kind}>
                          <Icon name={pictures[canvas.id]!.kind === "paper" ? "pdf" : "canvas"} /> {pictures[canvas.id]!.kind === "paper" ? "PDF canvas" : "Canvas"}
                          <span className="cvs-meta"> · {pictures[canvas.id]!.cards} {pictures[canvas.id]!.cards === 1 ? "card" : "cards"}</span>
                        </span>
                      ) : null}
                    </span>
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
                <button type="button" className="new" data-dg="from-zotero" onClick={() => { setMenu(false); void call("dialog.open", { surface: "zotero", ...(current ? { id: current } : {}) }).catch(report); }}>
                  <Icon name="zotero" /> From Zotero…
                </button>
                <button type="button" className="new" data-dg="open-library" onClick={() => { setMenu(false); void call("panel.open", { surface: "canvases" }).catch(report); }}>
                  <Icon name="library" /> Open the Library
                </button>
                <button type="button" className="new" data-dg="export" onClick={() => { setMenu(false); setExportOpen(true); }}>
                  <Icon name="export" /> Export…
                </button>
                <button type="button" className="new" data-dg="open-grammar" onClick={() => { setMenu(false); void call("dialog.open", { surface: "grammar" }).catch(report); }}>
                  <Icon name="card" /> Types and relations…
                </button>
                {current && view && !view.paper ? (
                  removeAsk ? (
                    <div className="remove-ask" data-dg="remove-canvas-ask">
                      <span>Remove this canvas? Its units and their links stay.</span>
                      <button type="button" onClick={() => setRemoveAsk(false)}>Keep it</button>
                      <button
                        type="button"
                        data-dg="remove-canvas-yes"
                        onClick={() => {
                          setRemoveAsk(false);
                          setMenu(false);
                          void call("canvas.remove", { id: current })
                            .then(() => call("panel.open", { surface: "canvases" }))
                            .catch(report);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="new" data-dg="remove-canvas" onClick={() => setRemoveAsk(true)}>
                      <Icon name="close" /> Remove this canvas…
                    </button>
                  )
                ) : null}
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
        {fieldsAt ? (
          <div className="popover menu fields-menu" role="menu" aria-label="What every card shows" data-dg="card-fields-menu" style={fieldsAt}>
            <h3>Show on every card</h3>
            {CARD_FIELDS.map(({ id, label, hint }) => {
              const shown = holon.prefs.cardFields.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={shown}
                  data-dg={`card-field-${id}`}
                  title={hint}
                  onClick={() => {
                    const next = shown ? holon.prefs.cardFields.filter((field) => field !== id) : [...holon.prefs.cardFields, id];
                    void call("prefs.set", { cardFields: CARD_FIELD_IDS.filter((field) => next.includes(field)) }).catch(report);
                  }}
                >
                  <span className="tick" aria-hidden="true">{shown ? <Icon name="check" /> : null}</span>
                  <span className="fields-text">
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </span>
                </button>
              );
            })}
            <p>The context panel always shows them all.</p>
          </div>
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
          <div className="popover add-popover" role="dialog" aria-label="Add a unit" style={addAt}>
            <input
              autoFocus
              data-dg="node-search"
              aria-label="Find or name a unit"
              placeholder={linking ? "Find or name the next unit" : "Find or name a unit"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setActive((old) => Math.min(old + 1, results.length - 1));
                if (event.key === "ArrowUp") setActive((old) => Math.max(old - 1, 0));
                if (event.key === "Escape") closeAdd();
                if (event.key === "Enter" && results[active]) void addCard(results[active]!.node);
              }}
            />
            <ul>
              {results.map((hit, index) => (
                <li key={hit.node.id}>
                  <button
                    type="button"
                    data-dg={`result-${hit.node.title}`}
                    data-active={index === active}
                    onClick={() => void addCard(hit.node)}
                  >
                    <Chip node={hit.node} />
                    <span className="result-text">
                      <span className="result-title"><Marked text={hit.node.title} marks={hit.titleMarks} /></span>
                      {hit.match ? (
                        <span className="result-match"><Marked text={hit.match.snippet} marks={hit.match.marks} /></span>
                      ) : null}
                    </span>
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
          onDragOver={(event) => {
            event.preventDefault();
            if ([...event.dataTransfer.types].includes(DRAG_TYPE)) event.dataTransfer.dropEffect = "copy";
          }}
          onPointerMove={(event) => {
            pointer.current = { x: event.clientX, y: event.clientY };
          }}
          onPointerLeave={() => {
            pointer.current = null;
          }}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
            if (dropped.length) {
              void addPictures(dropped, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              return;
            }
            const units = event.dataTransfer.getData(DRAG_TYPE);
            if (units) {
              void placeGroup(JSON.parse(units) as string[], flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
              return;
            }
            const text = event.dataTransfer.getData("text/plain").trim();
            if (!text) return;
            const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            void addText(text, point);
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
              // A floating sidebar goes when the canvas is clicked. A pinned one stays.
              if (!holon.prefs.sidePinned) setSide(null);
            }}
            onNodeClick={(_, node) => {
              const summary = (node.data as CardData).node;
              // Picking a card shows where it came from: its passage in an open reader, and the Context panel.
              if (summary && !aiOn) {
                void call("pdf.follow", { unit: summary.id }).catch(() => undefined);
                // The panel opening must not take the keyboard: Delete and undo still belong to the picked card.
                void call("panel.open", { surface: "context" })
                  .then(() => window.focus())
                  .catch(() => undefined);
              }
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
              const back: { id: string; z: number; item: WithoutId<CanvasItem> }[] = [];
              const upserts = moved.flatMap((item) => {
                const entry = items.current.get(item.id);
                if (!entry || "fromNode" in entry.item) return [];
                const x = Math.round(item.position.x);
                const y = Math.round(item.position.y);
                if (x === (entry.item as { x: number }).x && y === (entry.item as { y: number }).y) return [];
                back.push({ id: item.id, z: entry.z, item: withoutId(entry.item) });
                return [{ id: item.id, z: entry.z, item: withoutId({ ...entry.item, x, y }) }];
              });
              if (!upserts.length) return;
              void write({ upserts })
                .then(() =>
                  record({
                    label: upserts.length === 1 ? "Moved 1 item" : `Moved ${upserts.length} items`,
                    undo: () => write({ upserts: back }),
                    redo: () => write({ upserts }),
                  }),
                )
                .catch(report);
            }}
            onBeforeDelete={beforeDelete}
            onDelete={({ nodes: gone, edges: lost }) => void removeItems([...gone, ...lost].map((item) => item.id))}
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
              onClose={() => setAiOn(false)}
              onCite={(id) => {
                const card = flow.getNodes().find((node) => (node.data as CardData).node?.id === id);
                if (card) void flow.fitView({ nodes: [card], maxZoom: 1, duration: 220 });
              }}
            />
          ) : null}
          {view && view.items.length === 0 ? (
            <div className="start">
              <strong>Start with a question or claim</strong>
              <span>Press <kbd>N</kbd> to add a unit, then drag from its edge to connect the next.</span>
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
        <Drawer
          data={drawerData}
          open={false}
          onToggle={() => openSide("units")}
          onPlace={(ids) => void placeGroup(ids)}
          height={0}
          onResize={() => undefined}
        />
        {side ? (
          <Sidebar
            connection={connection}
            current={current}
            tab={side}
            pinned={holon.prefs.sidePinned}
            units={drawerData}
            onTab={openSide}
            onPin={(pinned) => void call("prefs.set", { sidePinned: pinned }).catch(report)}
            onClose={() => setSide(null)}
            onGo={(id) => {
              if (id !== current) switchTo(id);
              if (!holon.prefs.sidePinned) setSide(null);
            }}
            onPlace={(ids) => void placeGroup(ids)}
            report={report}
          />
        ) : null}
        {edgeTip ? (
          <div className="edge-tip" data-dg="edge-credit" style={{ left: Math.max(0, Math.min(edgeTip.x, (shell.current?.clientWidth ?? edgeTip.x) - TIP_WIDTH)), top: edgeTip.y }}>
            <Mark credit={edgeTip.credit} />
            <span>{edgeTip.credit.kind === "lab" ? `From ${edgeTip.credit.name}` : `By ${edgeTip.credit.name}`}</span>
          </div>
        ) : null}
        {linkAsk ? <LinkAskDialog ask={linkAsk} /> : null}
        {relationMenu ? (
          <div className="popover menu relation-menu" role="menu" style={{ left: relationMenu.x, top: relationMenu.y }}>
            {relationMenu.options.length === 0 ? (
              <p>The grammar has no relation for these two units. Check that both have a type.</p>
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
        {relatedMenu ? (
          <div className="popover related-menu" role="dialog" aria-label="What this is related to" data-dg="related-menu" style={{ left: relatedMenu.x, top: relatedMenu.y }}>
            {relatedMenu.list === null ? (
              <p className="note">Looking…</p>
            ) : relatedMenu.list.length === 0 ? (
              <p className="note">Nothing is related to this yet. Drag from its edge to another card to say how they relate.</p>
            ) : (
              <>
                <ul>
                  {relatedMenu.list.map((related) => (
                    <li key={related.relation} data-here={related.here}>
                      <span className="related-how">{related.label}{related.state === "pending" ? ", proposed" : ""}</span>
                      <span className="related-what">{plain(related.unit.title)}</span>
                      {related.here ? (
                        <span className="related-here">On this canvas</span>
                      ) : (
                        <button type="button" data-dg={`related-add-${related.unit.title}`} onClick={() => void placeRelated([related.unit])}>Add</button>
                      )}
                    </li>
                  ))}
                </ul>
                {relatedMenu.list.filter((related) => !related.here).length > 1 ? (
                  <button type="button" className="related-all" data-dg="related-add-all" onClick={() => void placeRelated(relatedMenu.list!.filter((related) => !related.here).map((related) => related.unit))}>
                    Add all {relatedMenu.list.filter((related) => !related.here).length} that aren't here
                  </button>
                ) : null}
              </>
            )}
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
                  const before = viewRef.current?.nodes[target]?.type ?? null;
                  if (before === type.id) return;
                  // A new type renames the note too, so the step is recorded as it starts.
                  const typing = call("node.setType", { id: target, type: type.id });
                  const step = {
                    label: `Made it a ${type.label}`,
                    ready: typing,
                    undo: () => call("node.setType", { id: target, type: before }),
                    redo: () => call("node.setType", { id: target, type: type.id }),
                  };
                  record(step);
                  typing.catch((error: unknown) => {
                    drop(step);
                    report(error);
                  });
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
