import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasItemView } from "@dg/contract/surface.ts";
import { arrange, type Card, type RelationLink } from "@dg/layout/modes.ts";
import type { Connection } from "../shared/rpc.ts";
import { CARD_WIDTH, nodeOfItem, withoutId, type FlowNode } from "./items.ts";
import type { CardData } from "./nodes.tsx";
import type { CanvasWriter } from "./useCanvasWriter.ts";

/**
 * Units that have just been put on the canvas, or pointed at from elsewhere,
 * come into view and are marked for a moment. Ones another panel sent are
 * also moved to a clear spot, and recorded as an edit that can be undone.
 */
export const useArrivals = ({
  connection,
  writer,
  items,
  area,
  nodes,
  current,
  currentRef,
  report,
}: {
  connection: Connection;
  writer: CanvasWriter;
  items: RefObject<Map<string, CanvasItemView>>;
  area: RefObject<HTMLDivElement | null>;
  /** The drawn nodes: an arrival waits until its cards have been measured. */
  nodes: FlowNode[];
  current: string | undefined;
  /** The canvas as of the last switch, which can be ahead of `current` by a render. */
  currentRef: RefObject<string | undefined>;
  report: (error: unknown) => void;
}) => {
  const { call, on } = connection;
  const { write, record, freeSpot, startingPoint } = writer;
  const flow = useReactFlow();
  /** Units this canvas is placing itself, which record their own undo step. */
  const placingHere = useRef(new Set<string>());
  /** Units just put on this canvas, waiting for their cards to draw; `fromHere` when this canvas placed them. */
  const [arrived, setArrived] = useState<{ units: string[]; fromHere: boolean }>({ units: [], fromHere: true });
  const [fresh, setFresh] = useState<string[]>([]);

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

  /** Says these units are about to be placed by this canvas, so their arrival isn't taken for another panel's. */
  const expect = useCallback((units: string[]) => {
    for (const unit of units) placingHere.current.add(unit);
  }, []);

  return { fresh, expect };
};
