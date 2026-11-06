import type { Box } from "./edges.ts";
import { bestOrders, place, slotsFor, type Arrow, type Card, type Columns } from "./layers.ts";
import { boundsOf, measure, type Frame, type Link } from "./measure.ts";
import { NOTE_GAP, READABLE_ZOOM, costOf, notesByCard, randomFrom, type TidyBox } from "./tidy.ts";

/**
 * A semantic substrate: labeled regions that say what a card is by where it
 * sits, with links drawn across them. Regions run left to right in the order given.
 */
export type Region = { key: string; label: string; ids: string[] };
export type Guide = { label: string; x: number; y: number; width: number; height: number };
export type Laid = { boxes: Map<string, Box>; guides: Guide[] };

const ROW_GAP = 28;
const INNER_GAP = 44;
const REGION_GAP = 96;
const PADDING = 16;
const HEADING = 30;

/** A link inside a column runs behind whatever sits between its ends, so they move together. */
const gather = (order: number[][], pairs: [number, number][], columns: number[]): number[][] => {
  const rows = order.map((row) => [...row]);
  for (const [a, b] of pairs) {
    const row = rows[columns[a]!]!;
    if (Math.abs(row.indexOf(a) - row.indexOf(b)) <= 1) continue;
    row.splice(row.indexOf(a), 1);
    row.splice(row.indexOf(b) + 1, 0, a);
  }
  return rows;
};

/** Splits a region into columns that fit the frame, keeping its order. */
const columnsFor = (ids: string[], heightOf: (id: string) => number, tallest: number): string[][] => {
  const total = ids.reduce((sum, id) => sum + heightOf(id) + ROW_GAP, 0);
  const parts = Math.max(1, Math.min(ids.length, Math.ceil(total / tallest)));
  const share = Math.ceil(ids.length / parts);
  return Array.from({ length: parts }, (_, part) => ids.slice(part * share, (part + 1) * share)).filter((column) => column.length > 0);
};

export const layOutRegions = ({
  regions,
  boxes,
  links,
  frame,
  ranked = false,
}: {
  regions: Region[];
  boxes: TidyBox[];
  links: Link[];
  frame: Frame;
  /** The order inside a region is the point, so crossings don't get to change it. */
  ranked?: boolean;
}): Laid => {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const linked = new Set(links.flatMap(({ from, to }) => [from, to]));
  const riders = notesByCard(boxes, linked);
  const riding = new Set([...riders.values()].flat().map((note) => note.id));
  const shown = regions
    .map((region) => ({ ...region, ids: region.ids.filter((id) => byId.has(id) && !riding.has(id)) }))
    .filter((region) => region.ids.length > 0);

  const heightOf = (id: string): number =>
    (riders.get(id) ?? []).reduce((sum, note) => sum + note.height + NOTE_GAP, byId.get(id)!.height);
  const tallest = frame.height / (1.12 * READABLE_ZOOM);
  const cards: Card[] = [];
  const columns: number[] = [];
  const regionColumns: { first: number; last: number }[] = [];
  let column = 0;
  for (const region of shown) {
    const first = column;
    for (const ids of columnsFor(region.ids, heightOf, tallest)) {
      ids.forEach((id, place_) => {
        const box = byId.get(id)!;
        cards.push({
          id,
          width: Math.max(box.width, ...(riders.get(id) ?? []).map((note) => note.width)),
          height: heightOf(id),
          // The region's own order is where the search starts, and what a tie keeps.
          y: place_,
        });
        columns.push(column);
      });
      column += 1;
    }
    regionColumns.push({ first, last: column - 1 });
  }
  const indexOf = new Map(cards.map((card, index) => [card.id, index]));
  // Links inside a column can't cross a column, so only the rest shape the order.
  const flow: Arrow[] = links.flatMap(({ from, to }) => {
    const [a, b] = [indexOf.get(from), indexOf.get(to)];
    if (a === undefined || b === undefined || columns[a] === columns[b]) return [];
    return [columns[a]! < columns[b]! ? { from: a, to: b } : { from: b, to: a }];
  });

  const lastOfRegion = new Set(regionColumns.map(({ last }) => last));
  const gap = (after: number): number => (lastOfRegion.has(after) ? REGION_GAP : INNER_GAP);
  const shape: Columns = slotsFor(cards, flow, columns);
  const within: [number, number][] = links.flatMap(({ from, to }) => {
    const [a, b] = [indexOf.get(from), indexOf.get(to)];
    return a !== undefined && b !== undefined && a !== b && columns[a] === columns[b] ? [[a, b] as [number, number]] : [];
  });
  const found = ranked
    ? [shape.rows]
    : bestOrders({
        columns: shape,
        shuffles: Math.max(2, Math.min(60, Math.round(2_000_000 / Math.max(1, shape.slots.length * (flow.length + shape.slots.length) * 12)))),
        keep: 4,
        random: randomFrom(cards.map((card) => card.id).join("\n")),
      });
  const orders = ranked || within.length === 0 ? found : [...found, ...found.map((order) => gather(order, within, columns))];

  let best: { cost: number; shown: Map<string, Box> } | undefined;
  for (const order of orders) {
    for (const clearing of ranked ? [false] : [true, false]) {
      const placed = place(cards, flow, shape, order, { gap, clearing, stacked: ranked });
      const laid = new Map<string, Box>();
      for (const card of cards) {
        const box = byId.get(card.id)!;
        const spot = placed.boxes.get(card.id)!;
        laid.set(card.id, { ...spot, width: box.width, height: box.height });
        let y = spot.y + box.height + NOTE_GAP;
        for (const note of riders.get(card.id) ?? []) {
          laid.set(note.id, { x: spot.x, y, width: note.width, height: note.height });
          y += note.height + NOTE_GAP;
        }
      }
      const cost = costOf(measure(laid, links, frame));
      if (!best || cost < best.cost) best = { cost, shown: laid };
    }
  }

  const laid = best!.shown;
  const all = boundsOf(laid.values());
  const guides: Guide[] = shown.map((region) => {
    const members = region.ids.flatMap((id) => [id, ...(riders.get(id) ?? []).map((note) => note.id)]);
    const bounds = boundsOf(members.map((id) => laid.get(id)!));
    return {
      label: region.label,
      x: bounds.x - PADDING,
      y: all.y - PADDING - HEADING,
      width: bounds.width + PADDING * 2,
      height: all.height + PADDING * 2 + HEADING,
    };
  });
  return { boxes: laid, guides };
};
