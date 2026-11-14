import { useCallback, useMemo, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasItem, WithoutId } from "@dg/contract/records.ts";
import type { CanvasItemView } from "@dg/contract/surface.ts";
import type { Connection } from "../shared/rpc.ts";
import type { Step } from "./history.ts";
import { CARD_WIDTH } from "./items.ts";

/**
 * What every edit to the open canvas needs: a way to write items, a way to
 * record the edit so it can be undone, somewhere clear to put a new item, a
 * place to start looking for that, and the layer it goes on.
 */

const GAP = 24;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

export type CanvasWrite = {
  upserts?: { id?: string; item: WithoutId<CanvasItem>; z: number }[];
  removes?: string[];
  restores?: string[];
};

export type CanvasWriter = {
  write: (args: CanvasWrite) => Promise<{ ids: string[] }>;
  record: (step: Step) => void;
  /** Finds room near a spot, so a new item never lands on top of an old one. */
  freeSpot: (start: Point, size: Size, ignore?: Set<string>) => Point;
  /** Beside the one selected card, or else the middle of what's in view. */
  startingPoint: (size: Size) => Point;
  nextZ: () => number;
};

export const useCanvasWriter = ({
  connection,
  current,
  items,
  area,
  record,
  onWrite,
}: {
  connection: Connection;
  current: string | undefined;
  items: RefObject<Map<string, CanvasItemView>>;
  area: RefObject<HTMLDivElement | null>;
  record: (step: Step) => void;
  /** Runs as each write starts, so a notice about the last one doesn't outlive it. */
  onWrite: () => void;
}): CanvasWriter => {
  const { call } = connection;
  const flow = useReactFlow();

  const nextZ = useCallback(
    (): number => Math.max(0, ...[...items.current.values()].map((entry) => entry.z)) + 1,
    [items],
  );

  const write = useCallback(
    async (args: CanvasWrite) => {
      if (!current) return { ids: [] as string[] };
      onWrite();
      return call("canvas.write", { canvas: current, ...args });
    },
    [call, current, onWrite],
  );

  const freeSpot = useCallback(
    (start: Point, size: Size, ignore?: Set<string>) => {
      const taken = flow.getNodes().flatMap((node) =>
        node.type === "ink" || ignore?.has(node.id)
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
    (size: Size) => {
      const picked = flow.getNodes().filter((node) => node.selected && node.type !== "ink");
      if (picked.length === 1) {
        const [node] = picked;
        return { x: node!.position.x + (node!.measured?.width ?? CARD_WIDTH) + 48, y: node!.position.y };
      }
      const box = area.current!.getBoundingClientRect();
      const point = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
      return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
    },
    [flow, area],
  );

  return useMemo(() => ({ write, record, freeSpot, startingPoint, nextZ }), [write, record, freeSpot, startingPoint, nextZ]);
};
