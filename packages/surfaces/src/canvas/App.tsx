import { identifierUrl } from "@dg/contract/scholarly.ts";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  MiniMap,
  Background,
  ConnectionMode,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import type { CanvasItem, CanvasRecord, NodeTypeRecord, TidyMode, WithoutId } from "@dg/contract/records.ts";
import { PDF_CANVAS_FIXED } from "@dg/contract/surface.ts";
import type { CanvasCommand, CanvasItemView, CanvasView, Credit, NodeSummary } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import type { Place } from "../shared/place.ts";
import { Icon, Mark, plain } from "../shared/ui.tsx";
import { scoreLabel, scoresFor } from "@dg/layout/centrality.ts";
import { AiBar } from "./AiBar.tsx";
import { ExportMenu } from "./ExportMenu.tsx";
import { Legend } from "./Legend.tsx";
import { MODES, arrange, leaningOf, measureOf, type Card, type RelationLink } from "@dg/layout/modes.ts";
import { ActionsContext, nodeTypes, type Actions, type Box, type CardData } from "./nodes.tsx";
import { WholeBar, isWhole, useWholeCanvas } from "./wholes.tsx";
import { DRAG_TYPE } from "../shared/drag.ts";
import { Drawer, useUnitsDrawer } from "./Drawer.tsx";
import { Sidebar, type SideTab } from "./Sidebar.tsx";
import { useHistory } from "./history.ts";
import { useFit } from "../shared/fit.ts";
import { CARD_WIDTH, NOTE, cardHeight, clamp, nodeOfItem, toEdge, toNode, withoutId, type Anchor, type FlowNode } from "./items.ts";
import { useCanvasWriter } from "./useCanvasWriter.ts";
import { AddBox } from "./AddBox.tsx";
import { InkLayer } from "./Ink.tsx";
import { RelatedMenu, useRelated } from "./Related.tsx";
import { ViewBar } from "./ViewBar.tsx";
import { RelationMenu, useLinking, type Linking } from "./linking.tsx";
import { FieldsMenu, TypeMenu } from "./menus.tsx";
import { TidyMenu, planTidy, useCrowding } from "./tidy.tsx";
import { useArrivals } from "./useArrivals.ts";
import { CanvasMenu, NameForm, useCanvasMenu } from "./CanvasMenu.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { useClipboard } from "./useClipboard.ts";
import { useDelete } from "./useDelete.ts";
import { LinkAskDialog } from "./LinkAsk.tsx";
import { clipOf, textOfClip, type Clip } from "./clipboard.ts";
import { TRY_AGAIN, canRetry, codeOf, goneOf, messageOf, sayOf } from "../shared/words.ts";

/** Three columns fit the common 725 px frame beside a sidebar. */
// Keeps a link's tooltip inside the frame.
const TIP_WIDTH = 160;
// Shift is what most drawing tools use to add to a selection.
const MULTI_SELECT_KEYS = ["Meta", "Control", "Shift"];

type TypeMenu = { node: string; x: number; y: number };
type EdgeTip = { x: number; y: number; credit: Credit };

/** `Search` is the search panel, which the sidebar shows whole. It is handed in, since one panel does not import another. */
export const App = ({ connection, Search, Library }: { connection: Connection; Search: ComponentType<{ connection: Connection }>; Library: ComponentType<{ connection: Connection; place?: Place }> }) => {
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
  const [current, setCurrent] = useState<string | undefined>(route.id);
  const [view, setView] = useState<CanvasView | null>(null);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodeTypeList, setNodeTypeList] = useState<NodeTypeRecord[]>([]);
  const [tool, setTool] = useState<"select" | "draw">("select");
  const [addAt, setAddAt] = useState<Anchor | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const [typeMenu, setTypeMenu] = useState<TypeMenu | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const dragging = useRef(new Set<string>());
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
    const message = messageOf(error);
    if (message.startsWith(PDF_CANVAS_FIXED)) {
      // Nothing was saved, so the canvas is drawn again as it stands.
      setFixedAsk(true);
      setNotice("");
      void refreshRef.current().catch(() => undefined); // Dropped: the person is already being told the canvas is fixed, and the next change reads it again.
      return;
    }
    setNotice(sayOf(error));
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
    // Dropped: the PDF button then opens the reader without a file, and asks again when pressed.
    void call("canvas.pdf", { id: current }).then((pdf) => setPdfFor(pdf ? { canvas: current, pdf } : null)).catch(() => setPdfFor(null));
  }, [call, current]);

  // Going to another canvas from here stays in this tab.
  const switchTo = useCallback((id: string) => {
    currentRef.current = id;
    setCurrent(id);
  }, []);
  const canvasMenu = useCanvasMenu({
    connection,
    go: (id) => {
      // A canvas on its own page moves by going to the other page.
      if (route.pinned) {
        void call("canvas.show", { id }).catch(report);
        return;
      }
      switchTo(id);
    },
    report,
  });
  const whole = useWholeCanvas({ connection, current, switchTo, report, notify: setNotice });
  const drawerData = useUnitsDrawer({ connection, current, report });
  /** The sidebar: closed, or open on one of its tabs. It reopens on the tab it was last on. */
  const [side, setSide] = useState<SideTab | null>(null);
  const lastSide = useRef<SideTab>("places");
  const openSide = useCallback((tab: SideTab) => {
    lastSide.current = tab;
    setSide(tab);
  }, []);
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
    const next = await call("canvas.get", { id });
    if ((currentRef.current ?? id) === id) setView(next);
  }, [call]);
  refreshRef.current = refresh;

  useEffect(() => {
    void call("grammar.get", {}).then(({ nodeTypes: types }) => setNodeTypeList(types)).catch(report);
  }, [call, report]);

  /** The canvas couldn't be read. One that is gone is said plainly and cleared; a base out of reach can be asked again. */
  const [unread, setUnread] = useState(false);
  const unreadable = useCallback((error: unknown) => {
    if (codeOf(error) !== "not-found") return setUnread(canRetry(error)), report(error);
    setView(null);
    setNotice(goneOf("canvas"));
  }, [report]);
  const read = useCallback(() => void refresh().then(() => setUnread(false), unreadable), [refresh, unreadable]);
  useEffect(read, [read, current]);

  useEffect(() => on("graph-changed", read), [read, on]);
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
      const renaming = call("unit.rename", { id: node, title: after });
      const step = {
        label: `Renamed “${plain(after)}”`,
        ready: renaming,
        undo: () => call("unit.rename", { id: node, title: before }),
        redo: () => call("unit.rename", { id: node, title: after }),
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

  const related = useRelated({ connection, writer, current, inFrame, report });

  const actions = useMemo<Actions>(
    () => ({
      reveal: (node) => {
        // A unit still on its paper's canvas has no text to open, so it opens as context.
        if (viewRef.current?.nodes[node]?.hasText === false) {
          void call("focus.set", { id: node }).then(() => call("panel.open", { surface: "context" })).catch(report);
          return;
        }
        void call("base.reveal", { id: node, placement: "main" }).catch(report);
      },
      react: (node, value) => void call("unit.react", { id: node, value }).catch(report),
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
      fields: whole.prefs.cardFields,
      openIdentifier: (id) => {
        const url = identifierUrl(id);
        if (url) void call("link.open", { url }).catch(report);
      },
      readPassage: (node) => void call("unit.get", { id: node }).then((seen) => (seen.provenance.pdf ? call("pdf.show", { ref: seen.provenance.pdf.ref, unit: node }) : null)).catch(report),
      openLibrary: (url) => void call("link.open", { url }).catch(report),
      image: (node) => call("unit.image", { id: node }).catch(() => null), // Dropped: the card is drawn without its picture.
      observe: (output, item, title) => {
        if (!current) return;
        // The evidence lands to the left of its picture, the way an argument reads toward its claim.
        const card = flow.getNode(item);
        const size = { width: CARD_WIDTH, height: cardHeight(title) };
        const spot = freeSpot({ x: (card?.position.x ?? 0) - CARD_WIDTH - 80, y: card?.position.y ?? 0 }, size);
        void call("output.observe", { output, title, canvas: current, ...spot }).catch(report);
      },
      related: related.open,
    }),
    [call, report, updateItem, inFrame, whole.prefs.cardFields, route.pinned, switchTo, rename, current, flow, freeSpot, related.open],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((previous) => applyNodeChanges(changes, previous));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((previous) => applyEdgeChanges(changes, previous));
  }, []);

  const onLoose = useCallback((loose: Linking, at: Anchor) => {
    setLinking(loose);
    setAddAt(at);
  }, []);
  const links = useLinking({ connection, writer, items, inFrame, onLoose, report });
  const { askRelation, onConnect, onConnectEnd } = links;

  const closeAdd = useCallback(() => {
    setAddAt(null);
    setLinking(null);
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
        void call("unit.get", { id: node }).then((view_) => placeRef.current(view_.node)).catch(report);
      }),
    [on, call, report],
  );

  const createNode = async (title: string, type?: string): Promise<void> => {
    if (!title) return;
    // A PDF canvas takes new units only from its paper, by highlighting. Nothing is made, so nothing is left loose.
    if (viewRef.current?.paper && viewRef.current.canvas.id === current) {
      closeAdd();
      setFixedAsk(true);
      return;
    }
    try {
      await addCard(await call("unit.create", { title, ...(type ? { type } : {}) }));
    } catch (error) {
      report(error);
    }
  };

  const arrivals = useArrivals({ connection, writer, items, area, nodes, current, currentRef, report });
  const { fresh } = arrivals;

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
      arrivals.expect(laid.map((box) => box.id));
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

  const addText = async (text: string, at: { x: number; y: number } | null): Promise<void> => {
    const spot = at ? { x: Math.round(at.x), y: Math.round(at.y) } : freeSpot(startingPoint(NOTE), NOTE);
    try {
      const { ids } = await write({ upserts: [{ item: { type: "text", text, ...spot, ...NOTE }, z: nextZ() }] });
      record({ label: "Added a note", undo: () => write({ removes: ids }), redo: () => write({ restores: ids }) });
    } catch (error) {
      report(error);
    }
  };

  const { linkAsk, beforeDelete, removeItems } = useDelete({ connection, writer, items, view: viewRef, prefs: whole.prefs, report });

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
        arrivals.expect(units.map(({ item }) => unitOf(item)!));
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

  const clipboardPointer = useClipboard({
    copy: () => {
      const clip = clipOf(flow.getNodes().filter((node) => node.selected).map((node) => node.id), items.current, currentRef.current);
      return clip ? { clip, text: textOfClip(clip, viewRef.current) } : null;
    },
    cut: (ids, label) => void removeItems(ids, label),
    paste: (clip, at) => void pasteClip(clip, at),
    pictures: (files, at) => void addPictures(files, at),
    text: (text, at) => void addText(text, at),
    notify: setNotice,
  });

  const adding = addAt !== null;

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
    const plan = planTidy({ chosen, view, nodes: flow.getNodes(), edges: flow.getEdges(), items: items.current, frame: area.current?.getBoundingClientRect(), followed });
    if (!plan) {
      setNotice("Select a card first");
      return;
    }
    const { moves, back, headings, gone, movedHeadings, kept, before, next, label } = plan;
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

  const shownFields = whole.prefs.cardFields.join(",");
  useCrowding({ nodes, fields: shownFields, canvas: canvasId, needsLayout, onCount: setCrowded });
  const closeFields = useCallback(() => setFieldsAt(null), []);

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
    canvasMenu.close();
    setMoreOpen(false);
    links.close();
    setTypeMenu(null);
    related.close();
    setTidyAt(null);
    closeAdd();
  }, [closeAdd, links.close, related.close, canvasMenu.close]);

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

  const setType = (type: NodeTypeRecord): void => {
    if (!typeMenu) return;
    const target = typeMenu.node;
    setTypeMenu(null);
    const before = viewRef.current?.nodes[target]?.type ?? null;
    if (before === type.id) return;
    // A new type renames the note too, so the step is recorded as it starts.
    const typing = call("unit.setType", { id: target, type: type.id });
    const step = {
      label: `Made it a ${type.label}`,
      ready: typing,
      undo: () => call("unit.setType", { id: target, type: before }),
      redo: () => call("unit.setType", { id: target, type: type.id }),
    };
    record(step);
    typing.catch((error: unknown) => {
      drop(step);
      report(error);
    });
  };

  const [pickedCard, setPickedCard] = useState<string | null>(null);
  const onSelectionChange = useCallback(
    ({ nodes: picked }: { nodes: Node[] }) => {
      // One card picked by any means, such as the keyboard, is the card whose links show. None picked clears it.
      setPickedCard((old) => (picked.length === 1 ? picked[0]!.id : picked.length === 0 ? null : old));
      const node = picked.length === 1 ? (picked[0]!.data as CardData).node : undefined;
      if (node) void call("focus.set", { id: node.id }).catch(report);
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

  // A picked card shows what it touches: its links and the cards at their other ends stay bright
  // and the rest steps back, for as long as it is the one picked.
  // The click itself says which card, so the lit set moves with the click whatever the selection
  // is doing at that moment: a second card held with a modifier, or a click that began as a nudge.
  const near = useMemo(() => {
    const picked = nodes.filter((node) => node.selected);
    const at = pickedCard && nodes.some((node) => node.id === pickedCard) ? pickedCard : picked.length === 1 ? picked[0]!.id : null;
    if (!at) return null;
    const links = edges.filter((edge) => edge.source === at || edge.target === at);
    if (links.length === 0) return null;
    return { cards: new Set([at, ...links.flatMap((edge) => [edge.source, edge.target])]), links: new Set(links.map((edge) => edge.id)) };
  }, [nodes, edges, pickedCard]);
  const shownEdges = useMemo(
    () => (near ? edges.map((edge) => ({ ...edge, className: [edge.className, near.links.has(edge.id) ? "near" : "far"].filter(Boolean).join(" ") })) : edges),
    [edges, near],
  );

  const litHere = useMemo(() => whole.lit.length > 0 && nodes.some((node) => whole.lit.includes((node.data as CardData).node?.id ?? "")), [whole.lit, nodes]);
  const shown = useMemo(
    () =>
      nodes.map((node) => {
        const score = scores?.get(node.id);
        const scored = measure && score !== undefined ? { ...node, data: { ...node.data, score: scoreLabel(measure, score) } } : node;
        const summary = (node.data as CardData).node;
        const marked = summary && grounded.includes(summary.id) ? { ...scored, data: { ...scored.data, grounded: true } } : scored;
        // Lit from another panel, such as a gap in the boundary panel. Nothing dims for units shown elsewhere.
        const lit = litHere ? (summary && whole.lit.includes(summary.id) ? "lit" : "dim") : "";
        const arriving = summary && fresh.includes(summary.id) ? "arrived" : "";
        const touched = near ? (near.cards.has(node.id) ? "near" : "far") : "";
        const classes = [followed && summary?.id === followed ? "followed" : "", lit, arriving, touched].filter(Boolean).join(" ");
        const edited = editing === node.id ? { ...marked, data: { ...marked.data, editing: true } } : marked;
        return classes ? { ...edited, className: classes } : edited;
      }),
    [nodes, followed, grounded, measure, scores, whole.lit, litHere, fresh, editing, near],
  );

  const pickedNodes = nodes.flatMap((node) => {
    const summary = (node.data as CardData).node;
    return node.selected && summary ? [summary.id] : [];
  });

  if (!hasCanvas) {
    return (
      <main className="empty">
        <h1>Start a canvas</h1>
        <p>Lay out questions, claims and evidence, and how they connect.</p>
        <NameForm value={canvasMenu.name} onChange={canvasMenu.setName} onCreate={() => void canvasMenu.start()} onCancel={() => canvasMenu.setNaming(false)} />
        {notice ? <p role="alert">{notice}{unread ? <>{" "}<button type="button" className="load-again" data-dg="canvas-again" onClick={() => (setNotice(""), read())}>{TRY_AGAIN}</button></> : null}</p> : null}
      </main>
    );
  }

  const title = canvases.find((canvas) => canvas.id === current)?.title ?? "Canvas";
  /** A PDF canvas stays as its paper was read. */
  const reading = view?.canvas.id === current ? view?.paper : undefined;
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
    // The first is dropped: without knowing the canvas's PDF, the reader still opens, on no file.
    void (current ? call("canvas.pdf", { id: current }).catch(() => null) : Promise.resolve(null))
      .then((pdf) => call("pdf.show", pdf ? { ref: pdf.ref } : {}))
      .catch(report);
  const modeLabel = MODES.find((entry) => entry.mode === mode)!.label;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="shell" ref={shell} data-side={side ? (whole.prefs.sidePinned ? "pinned" : "floating") : undefined}>
        <Toolbar
          refs={{ bar, add: addButton, tidy: tidyButton, fields: fieldsButton }}
          state={{
            fit,
            title,
            sideOpen: side !== null,
            menuOpen: canvasMenu.open,
            reading: Boolean(reading),
            adding,
            drawing: tool === "draw",
            modeLabel,
            tidyOpen: tidyAt !== null,
            fieldsOpen: fieldsAt !== null,
            aiOn,
            moreOpen,
            notice,
            crowded,
            done,
            next,
            parentPdf,
          }}
          actions={{
            toggleSide: () => (side ? setSide(null) : openSide(lastSide.current)),
            toggleCanvasMenu: canvasMenu.toggle,
            openAdd,
            closeAdd,
            addNote,
            toggleDraw: () => setTool((old) => (old === "draw" ? "select" : "draw")),
            tidy: () => tidyUp(mode),
            openTidyMenu,
            openFieldsMenu,
            tidyAfterFields: () => {
              setCrowded(0);
              tidyUp(mode);
            },
            askLinksAgain: () => {
              dismiss();
              void call("prefs.set", { linkDelete: "ask" }).then(() => setNotice("Delete will ask about links again")).catch(report);
            },
            undo: () => void undo(),
            redo: () => void redo(),
            toggleAi: () => setAiOn((on_) => !on_),
            toggleMore: () => setMoreOpen((on_) => !on_),
            closeMore: () => setMoreOpen(false),
            openSearch: () => openSide("search"),
            openContext: () => void call("panel.open", { surface: "context" }).catch(report),
            openPdf,
          }}
        />
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
        <WholeBar
          connection={connection}
          current={current}
          info={whole.info}
          lit={litHere ? whole.lit.filter((id) => nodes.some((node) => (node.data as CardData).node?.id === id)) : []}
          onClearLit={() => whole.setLit([])}
          onOpen={(ref) => void whole.openInside(ref)}
          report={report}
        />
        {canvasMenu.open ? (
          <CanvasMenu connection={connection} menu={canvasMenu} canvases={canvases} current={current} removable={Boolean(view && !view.paper)} onExport={() => setExportOpen(true)} report={report} />
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
        {fieldsAt ? <FieldsMenu connection={connection} at={fieldsAt} fields={whole.prefs.cardFields} button={fieldsButton} onClose={closeFields} report={report} /> : null}
        {tidyAt ? <TidyMenu at={tidyAt} mode={mode} onPick={tidyUp} /> : null}
        {addAt ? <AddBox connection={connection} at={addAt} next={linking !== null} types={nodeTypeList} onPick={(node) => void addCard(node)} onCreate={(title, type) => void createNode(title, type)} onClose={closeAdd} report={report} /> : null}
        <div
          ref={area}
          className={measure ? "area links-quiet" : "area"}
          onDragOver={(event) => {
            event.preventDefault();
            if ([...event.dataTransfer.types].includes(DRAG_TYPE)) event.dataTransfer.dropEffect = "copy";
          }}
          {...clipboardPointer}
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
            edges={shownEdges}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={36}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(link) => void onConnect(link).catch(report)}
            onConnectEnd={onConnectEnd}
            onSelectionChange={onSelectionChange}
            onPaneClick={() => {
              setPickedCard(null);
              closeMenus();
              setExportOpen(false);
              // A floating sidebar goes when the canvas is clicked. A pinned one stays.
              if (!whole.prefs.sidePinned) setSide(null);
            }}
            onNodeClick={(_, node) => {
              setPickedCard(node.id);
              const summary = (node.data as CardData).node;
              // Picking a card shows where it came from: its passage in an open reader, and the Context panel.
              if (summary && !aiOn) {
                // Dropped: a courtesy on every pick of a card, and there may be no reader open to follow.
                void call("pdf.follow", { unit: summary.id }).catch(() => undefined);
                // The panel opening must not take the keyboard: Delete and undo still belong to the picked card.
                void call("panel.open", { surface: "context" })
                  .then(() => window.focus())
                  .catch(() => undefined); // Dropped: the same courtesy, and a base may have no side panel to open.
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
              <ViewBar map={whole.prefs.miniMap !== false} onMap={(miniMap) => void call("prefs.set", { miniMap }).catch(report)} />
            </Panel>
            <Panel position="bottom-center">
              <Legend edges={edges} labels={view?.relations ?? {}} />
            </Panel>
            {whole.prefs.miniMap === false ? null : (
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                ariaLabel="Map of this canvas. The frame is what you see. Drag it to move."
                nodeColor={(node) => (node.data as CardData).node?.color ?? "var(--dg-muted)"}
                nodeClassName={(node) => (near ? (near.cards.has(node.id) ? "near" : "far") : "")}
                nodeStrokeWidth={0}
                nodeBorderRadius={6}
                bgColor="var(--dg-panel)"
                maskColor="color-mix(in srgb, var(--dg-page) 72%, transparent)"
                maskStrokeColor="var(--dg-accent)"
                maskStrokeWidth={6}
                style={{ width: 168, height: 112 }}
              />
            )}
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
          {tool === "draw" ? <InkLayer writer={writer} onDone={() => setTool("select")} report={report} /> : null}
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
            pinned={whole.prefs.sidePinned}
            units={drawerData}
            onTab={openSide}
            onPin={(pinned) => void call("prefs.set", { sidePinned: pinned }).catch(report)}
            onClose={() => setSide(null)}
            onGo={(id) => {
              if (id !== current) switchTo(id);
              if (!whole.prefs.sidePinned) setSide(null);
            }}
            onPlace={(ids) => void placeGroup(ids)}
            Search={Search}
            Library={Library}
          />
        ) : null}
        {edgeTip ? (
          <div className="edge-tip" data-dg="edge-credit" style={{ left: Math.max(0, Math.min(edgeTip.x, (shell.current?.clientWidth ?? edgeTip.x) - TIP_WIDTH)), top: edgeTip.y }}>
            <Mark credit={edgeTip.credit} />
            <span>{edgeTip.credit.kind === "lab" ? `From ${edgeTip.credit.name}` : `By ${edgeTip.credit.name}`}</span>
          </div>
        ) : null}
        {linkAsk ? <LinkAskDialog ask={linkAsk} /> : null}
        {links.menu ? <RelationMenu menu={links.menu} onPick={(option) => void links.choose(option)} onClose={links.close} /> : null}
        {related.menu ? <RelatedMenu menu={related.menu} onPlace={(units) => void related.place(units)} /> : null}
        {typeMenu ? <TypeMenu at={typeMenu} types={nodeTypeList} onPick={setType} onClose={() => setTypeMenu(null)} /> : null}
      </div>
    </ActionsContext.Provider>
  );
};
