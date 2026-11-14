import { useRef, type PointerEvent } from "react";
import { useReactFlow } from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import type { CanvasWriter } from "./useCanvasWriter.ts";

const pathFrom = (outline: number[][]): string => {
  if (outline.length === 0) return "";
  const round = (value: number): number => Math.round(value * 10) / 10;
  const [first, ...rest] = outline;
  return `M${round(first![0]!)} ${round(first![1]!)}${rest.map(([x, y]) => `L${round(x!)} ${round(y!)}`).join("")}Z`;
};

/** The layer that takes the pointer while drawing. One stroke, then back to selecting. */
export const InkLayer = ({ writer, onDone, report }: { writer: CanvasWriter; onDone: () => void; report: (error: unknown) => void }) => {
  const { write, record, nextZ } = writer;
  const flow = useReactFlow();
  const ink = useRef<number[][]>([]);

  const finishStroke = (): void => {
    const raw = ink.current;
    ink.current = [];
    onDone();
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

  const inkPoint = (event: PointerEvent): number[] => {
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    return [point.x, point.y];
  };

  return (
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
  );
};
