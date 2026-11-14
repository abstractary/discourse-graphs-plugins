import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { CanvasItem, WithoutId } from "@dg/contract/records.ts";
import type { CanvasItemView, CanvasView } from "@dg/contract/surface.ts";
import { sidesFor } from "@dg/layout/edges.ts";
import { relationColor } from "../shared/relations.ts";
import type { Box } from "./nodes.tsx";

/** A canvas's stored items as the cards, notes and links that are drawn, and the sizes they start at. */

export const CARD_WIDTH = 240;
export const NOTE = { width: 200, height: 80 };

/** Median research titles run about 70 characters, and some twice that. */
export const cardHeight = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));

export type FlowData = Record<string, unknown>;
export type FlowNode = Node<FlowData>;

/** One end of a link: the item drawn, and the unit it stands for. */
export type End = { item: string; node: string };
export type Anchor = { left: number; top: number };

export const withoutId = (item: CanvasItem): WithoutId<CanvasItem> => {
  const { id: _id, ...rest } = item;
  return rest as WithoutId<CanvasItem>;
};

export const toNode = ({ id, z, item, credit, at }: CanvasItemView, view: CanvasView): FlowNode | null => {
  if ("fromNode" in item) return null;
  const base = { id, position: { x: item.x, y: item.y }, zIndex: z };
  const sized = { ...base, width: item.width, height: item.height };
  if (item.type === "stroke") return { ...sized, type: "ink", data: { path: item.path, credit, at } };
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
  // Another canvas held inside this one: it opens in place, like going into a holon.
  if (item.type === "file" && item.dg?.canvas) {
    return { ...base, width: item.width, type: "nested", data: { canvas: item.dg.canvas, file: item.file, minHeight: Math.min(item.height, 120) } };
  }
  const text = item.type === "text" ? item.text : item.type === "file" ? item.file : item.url;
  return { ...sized, type: "note", data: { text, credit, at } };
};

export const toEdge = ({ id, item }: CanvasItemView, view: CanvasView, boxes: Map<string, Box>): Edge | null => {
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
    data: { ...(kind ? { kind } : {}), ...(relation ? { credit: relation.credit } : {}), ...(item.dg ? { relation: item.dg.relation } : {}) },
  };
};

export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, Math.max(low, high)));

export const nodeOfItem = (entry: CanvasItemView | undefined): string | undefined =>
  (entry?.item as { dg?: { node?: string } } | undefined)?.dg?.node;
