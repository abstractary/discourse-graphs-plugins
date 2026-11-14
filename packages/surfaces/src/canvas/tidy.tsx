import { useCallback, useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { TidyMode } from "@dg/contract/records.ts";
import type { CanvasItemView, CanvasView } from "@dg/contract/surface.ts";
import { MODES, arrange, type Card, type RelationLink } from "@dg/layout/modes.ts";
import { CARD_WIDTH, withoutId, type Anchor, type FlowNode } from "./items.ts";
import type { CardData } from "./nodes.tsx";

/**
 * Works out a Tidy: where every card and note goes, which headings come, stay
 * and go, and how to put all of it back. Nothing is written here. It answers
 * null when the Focus arrangement has no card to arrange around.
 */
export const planTidy = ({
  chosen,
  view,
  nodes,
  edges,
  items,
  frame,
  followed,
}: {
  chosen: TidyMode;
  view: CanvasView;
  nodes: Node[];
  edges: Edge[];
  items: Map<string, CanvasItemView>;
  frame: { width: number; height: number } | undefined;
  followed: string | null;
}) => {
  const cards: Card[] = nodes.flatMap((node) => {
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
  const links: RelationLink[] = edges.map((edge) => ({
    from: edge.source,
    to: edge.target,
    ...(typeof edge.label === "string" ? { label: edge.label } : {}),
    ...((edge.data as { kind?: string } | undefined)?.kind ? { kind: (edge.data as { kind: string }).kind } : {}),
  }));
  const picked = nodes.find((node) => node.selected && node.type === "card")?.id;
  const followedCard = nodes.find((node) => (node.data as CardData).node?.id === followed)?.id;
  const focus = picked ?? followedCard ?? view.canvas.layout?.focus;
  if (chosen === "focus" && !focus) return null;
  const { places, guides } = arrange({
    mode: chosen,
    boxes: cards,
    links,
    frame: frame?.width ? { width: frame.width, height: frame.height } : { width: 800, height: 800 },
    previous: view.canvas.layout?.mode ?? "logic",
    ...(focus ? { focus } : {}),
  });
  const moves = cards.flatMap(({ id }) => {
    const entry = items.get(id);
    const spot = places.get(id);
    if (!entry || !spot || "fromNode" in entry.item) return [];
    return [{ id, z: entry.z, item: withoutId({ ...entry.item, ...spot }) }];
  });
  const back = moves.flatMap(({ id }) => {
    const entry = items.get(id);
    return entry ? [{ id, z: entry.z, item: withoutId(entry.item) }] : [];
  });
  // A heading that stays keeps its item, so pressing Tidy again changes nothing.
  const oldGuides = [...items.values()].filter(({ item }) => (item as { guide?: boolean }).guide);
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
  return { moves, back, headings, gone, movedHeadings, kept, before, next, label };
};

export const TidyMenu = ({ at, mode, onPick }: { at: Anchor; mode: TidyMode; onPick: (mode: TidyMode) => void }) => (
  <div className="popover tidy-menu" role="menu" aria-label="Tidy modes" style={at}>
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
            onClick={() => onPick(entry.mode)}
          >
            <strong>{entry.label}</strong>
            <span>{entry.hint}</span>
          </button>
        ))}
      </div>
    ))}
  </div>
);

/** Counts cards that cover another, after something made them grow. Nothing is moved for the person; they are told, and offered Tidy. */
export const useCrowding = ({
  nodes,
  fields,
  canvas,
  needsLayout,
  onCount,
}: {
  nodes: FlowNode[];
  /** What cards show, as one string, so a change in it can be seen. */
  fields: string;
  canvas: string | undefined;
  needsLayout: boolean;
  onCount: (covering: number) => void;
}): void => {
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
    onCount(covering);
  }, [onCount]);
  useEffect(() => {
    const before = lastFields.current;
    lastFields.current = fields;
    if (before === null || before === fields) return;
    const timer = window.setTimeout(countCovering, 500);
    return () => window.clearTimeout(timer);
  }, [fields, countCovering]);
  // A canvas laid out when its cards showed less can open with cards over each other. Say so once it is drawn.
  useEffect(() => {
    onCount(0);
    if (!canvas || needsLayout) return;
    const timer = window.setTimeout(countCovering, 1500);
    return () => window.clearTimeout(timer);
  }, [canvas, needsLayout, countCovering, onCount]);
};
