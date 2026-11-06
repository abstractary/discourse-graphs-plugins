import type { Box } from "./edges.ts";
import { bestOrders, columnsOf, place, slotsFor, spread, type Arrow, type Card, type Placed } from "./layers.ts";
import { boundsOf, fitZoom, measure, type Frame, type Link, type Quality } from "./measure.ts";

export type TidyBox = Box & {
  id: string;
  /** A note beside a card reads as being about it, so it stays with that card. */
  note?: boolean;
};

// The common frame for a canvas beside a sidebar.
const USUAL_FRAME: Frame = { width: 800, height: 800 };
export const READABLE_ZOOM = 0.7;
const COLUMN_GAPS = [96, 72, 128];
export const NOTE_GAP = 10;
const NOTE_REACH = 48;
const CLUSTER_GAP = 96;
const LOOSE_GAP = 28;
// Work a layout may spend, so a large canvas stays quick and a small one gets searched hard.
const SEARCH_WORK = 6_000_000;
// A layout this close isn't worth moving a person's cards for.
const WORTH_MOVING = 1;
const MOST_PASSES = 5;

/** Lower reads better. Crossings and hidden links outrank fit, and fit outranks the rest. */
export const costOf = (quality: Quality): number =>
  quality.overlaps * 1000 +
  quality.behindCards * 12 +
  quality.crossings * 14 +
  quality.labelClashes * 2 +
  Math.max(0, READABLE_ZOOM - quality.zoom) * 90 +
  (1 - quality.zoom) * 6 +
  (1 - quality.fill) * 3 +
  quality.length / 3000;

export const randomFrom = (text: string): (() => number) => {
  let state = 2166136261;
  for (let at = 0; at < text.length; at += 1) state = Math.imul(state ^ text.charCodeAt(at), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const gapBetween = (a: Box, b: Box): number =>
  Math.hypot(
    Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width)),
    Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height)),
  );

/** Each unlinked note goes with the nearest card it sits beside. */
export const notesByCard = (boxes: TidyBox[], linked: Set<string>): Map<string, TidyBox[]> => {
  const riders = new Map<string, TidyBox[]>();
  const cards = boxes.filter((box) => !box.note || linked.has(box.id));
  for (const note of boxes) {
    if (!note.note || linked.has(note.id)) continue;
    const nearest = cards
      .map((card) => ({ card, gap: gapBetween(note, card) }))
      .filter(({ gap }) => gap <= NOTE_REACH)
      .sort((a, b) => a.gap - b.gap || (a.card.id < b.card.id ? -1 : 1))[0];
    if (nearest) riders.set(nearest.card.id, [...(riders.get(nearest.card.id) ?? []), note]);
  }
  for (const list of riders.values()) list.sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
  return riders;
};

const groupsOf = (ids: string[], links: Link[]): string[][] => {
  const parent = new Map(ids.map((id) => [id, id]));
  const rootOf = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (const { from, to } of links) parent.set(rootOf(from), rootOf(to));
  const groups = new Map<string, string[]>();
  for (const id of ids) groups.set(rootOf(id), [...(groups.get(rootOf(id)) ?? []), id]);
  return [...groups.values()];
};

/** Tries each way to shape one argument, and keeps what reads best in this frame. */
const layOutGroup = (
  group: TidyBox[],
  links: Link[],
  riders: Map<string, TidyBox[]>,
  frame: Frame,
): Placed => {
  const random = randomFrom(group.map((box) => box.id).join("\n"));
  const cards: Card[] = group.map((box) => ({
    id: box.id,
    width: Math.max(box.width, ...(riders.get(box.id) ?? []).map((note) => note.width)),
    height: (riders.get(box.id) ?? []).reduce((sum, note) => sum + note.height + NOTE_GAP, box.height),
    y: box.y,
  }));
  const indexOf = new Map(cards.map((card, index) => [card.id, index]));
  const arrows: Arrow[] = links.map(({ from, to }) => ({ from: indexOf.get(from)!, to: indexOf.get(to)! }));
  const { columns, flow } = columnsOf(cards, arrows);
  const first = slotsFor(cards, flow, columns);
  const work = Math.max(1, first.slots.length * (flow.length + first.slots.length));
  const shuffles = Math.max(2, Math.min(160, Math.round(SEARCH_WORK / (work * 12))));
  const roomy = work < 40_000;
  const keep = roomy ? 6 : 2;

  const tallest = frame.height / (1.12 * READABLE_ZOOM);
  const shapes = [first];
  if (roomy || work < 400_000) {
    const [order] = bestOrders({ columns: first, shuffles: 4, keep: 1, random });
    const wider = spread(cards, columns, order!, first.slots, tallest);
    if (wider) shapes.push(slotsFor(cards, flow, wider));
  }

  // A label should fit between columns, so narrower gaps only stand in when nothing does.
  const widestLabel = Math.max(0, ...links.map(({ label }) => (label ? label.length * 6 + 8 : 0)));
  const fitting = COLUMN_GAPS.filter((gap) => gap >= widestLabel);
  const gaps = roomy ? (fitting.length > 0 ? fitting : COLUMN_GAPS.slice(-1)) : COLUMN_GAPS.slice(0, 1);

  let best: { cost: number; placed: Placed } | undefined;
  for (const shape of shapes) {
    for (const order of bestOrders({ columns: shape, shuffles, keep, random })) {
      for (const gap of gaps) {
        for (const clearing of [true, false]) {
          const placed = place(cards, flow, shape, order, { gap, clearing });
          const shown = new Map(placed.boxes);
          for (const box of group) {
            const spot = placed.boxes.get(box.id)!;
            shown.set(box.id, { ...spot, width: box.width, height: box.height });
            let y = spot.y + box.height + NOTE_GAP;
            for (const note of riders.get(box.id) ?? []) {
              shown.set(note.id, { x: spot.x, y, width: note.width, height: note.height });
              y += note.height + NOTE_GAP;
            }
          }
          const cost = costOf(measure(shown, links, frame));
          if (!best || cost < best.cost) best = { cost, placed: { ...placed, boxes: shown } };
        }
      }
    }
  }
  return best!.placed;
};

/** Cards with no links stack in even columns, in the order they were in. */
const stackLoose = (loose: TidyBox[], riders: Map<string, TidyBox[]>, frame: Frame): Placed => {
  const heightOf = (box: TidyBox): number =>
    (riders.get(box.id) ?? []).reduce((sum, note) => sum + note.height + NOTE_GAP, box.height);
  const widest = Math.max(...loose.map((box) => box.width));
  const area = loose.reduce((sum, box) => sum + (box.width + LOOSE_GAP) * (heightOf(box) + LOOSE_GAP), 0);
  const count = Math.max(1, Math.min(loose.length, Math.round(Math.sqrt(area * (frame.width / frame.height)) / (widest + LOOSE_GAP))));
  const stacks = Array.from({ length: count }, () => 0);
  const boxes = new Map<string, Box>();
  for (const box of [...loose].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1))) {
    const stack = stacks.indexOf(Math.min(...stacks));
    let y = stacks[stack]!;
    const x = stack * (widest + LOOSE_GAP);
    boxes.set(box.id, { x, y, width: box.width, height: box.height });
    y += box.height + NOTE_GAP;
    for (const note of riders.get(box.id) ?? []) {
      boxes.set(note.id, { x, y, width: note.width, height: note.height });
      y += note.height + NOTE_GAP;
    }
    stacks[stack] = y - NOTE_GAP + LOOSE_GAP;
  }
  return { boxes, width: count * (widest + LOOSE_GAP) - LOOSE_GAP, height: Math.max(...stacks) - LOOSE_GAP };
};

/** Lays blocks out in rows, wrapping at the width that best fits the frame. */
const pack = (blocks: Placed[], frame: Frame): Map<string, Box> => {
  const wrapAt = (limit: number): { spots: { x: number; y: number }[]; width: number; height: number } => {
    const spots: { x: number; y: number }[] = [];
    let [x, y, rowHeight, width, start] = [0, 0, 0, 0, 0];
    const closeRow = (end: number): void => {
      // Shorter blocks sit in the middle of their row.
      for (let index = start; index < end; index += 1) spots[index]!.y += (rowHeight - blocks[index]!.height) / 2;
      start = end;
    };
    blocks.forEach((block, index) => {
      if (x > 0 && x + block.width > limit) {
        closeRow(index);
        x = 0;
        y += rowHeight + CLUSTER_GAP;
        rowHeight = 0;
      }
      spots.push({ x, y });
      x += block.width + CLUSTER_GAP;
      rowHeight = Math.max(rowHeight, block.height);
      width = Math.max(width, x - CLUSTER_GAP);
    });
    closeRow(blocks.length);
    return { spots, width, height: y + rowHeight };
  };
  const widths = [...new Set(blocks.map((_, index) => blocks.slice(0, index + 1).reduce((sum, block) => sum + block.width + CLUSTER_GAP, -CLUSTER_GAP)))];
  const area = (result: { width: number; height: number }): number => result.width * result.height;
  const best = widths
    .map((limit) => wrapAt(limit))
    .sort((a, b) => fitZoom(b, frame) - fitZoom(a, frame) || area(a) - area(b))[0]!;
  const placed = new Map<string, Box>();
  blocks.forEach((block, index) => {
    const spot = best.spots[index]!;
    for (const [id, box] of block.boxes) placed.set(id, { ...box, x: box.x + spot.x, y: box.y + spot.y });
  });
  return placed;
};

const tidyOnce = (boxes: TidyBox[], links: Link[], frame: Frame, fresh: boolean): Map<string, { x: number; y: number }> => {
  if (boxes.length === 0) return new Map();
  const ordered = [...boxes].sort((a, b) => (a.id < b.id ? -1 : 1));
  const known = new Set(ordered.map((box) => box.id));
  const seen = new Set<string>();
  const usable = links
    .filter(({ from, to }) => known.has(from) && known.has(to) && from !== to)
    .filter(({ from, to }) => {
      const key = `${from}\n${to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (`${a.from}\n${a.to}` < `${b.from}\n${b.to}` ? -1 : 1));
  const linked = new Set(usable.flatMap(({ from, to }) => [from, to]));
  const riders = notesByCard(ordered, linked);
  const riding = new Set([...riders.values()].flat().map((note) => note.id));
  const free = ordered.filter((box) => !riding.has(box.id));

  const byId = new Map(ordered.map((box) => [box.id, box]));
  const groups = groupsOf(free.filter((box) => linked.has(box.id)).map((box) => box.id), usable)
    .map((ids) => ids.map((id) => byId.get(id)!))
    .map((group) => {
      const members = new Set(group.map((box) => box.id));
      return layOutGroup(group, usable.filter(({ from }) => members.has(from)), riders, frame);
    })
    .sort((a, b) => b.boxes.size - a.boxes.size || b.height - a.height);
  const loose = free.filter((box) => !linked.has(box.id));
  const blocks = loose.length > 0 ? [...groups, stackLoose(loose, riders, frame)] : groups;

  const placed = pack(blocks, frame);
  const start = boundsOf(boxes);
  const end = boundsOf(placed.values());
  const moved = new Map(
    [...placed].map(([id, box]) => [id, { ...box, x: Math.round(box.x - end.x + start.x), y: Math.round(box.y - end.y + start.y) }]),
  );

  // Pressing Tidy again leaves a tidy canvas alone. Hand placement never counts
  // as tidy, because it won't line up in as few columns.
  const current = new Map(boxes.map((box) => [box.id, box as Box]));
  const columnCount = (layout: Map<string, Box>): number => new Set([...layout.values()].map((box) => Math.round(box.x))).size;
  const settled =
    !fresh &&
    columnCount(current) <= columnCount(moved) &&
    costOf(measure(current, usable, frame)) <= costOf(measure(moved, usable, frame)) + WORTH_MOVING;
  const result = settled ? current : moved;
  return new Map([...result].map(([id, { x, y }]) => [id, { x, y }]));
};

/**
 * Lays an argument out in columns, with what supports on the left. It keeps the
 * layout with the fewest crossings, and among those the one that hides no link
 * behind a card, fits the frame at a readable zoom and fills its space evenly.
 * Separate arguments stay apart. Each pass starts from the last, because a
 * finished layout shows the search routes it couldn't see from a scattered one,
 * and it stops once nothing moves, so pressing Tidy again changes nothing.
 */
export const tidy = (
  boxes: TidyBox[],
  links: Link[],
  {
    frame = USUAL_FRAME,
    fresh = false,
  }: {
    frame?: Frame;
    /** The links mean something new, such as after a mode change, so the old layout can't stand. */
    fresh?: boolean;
  } = {},
): Map<string, { x: number; y: number }> => {
  let layout = boxes;
  for (let pass = 0; pass < MOST_PASSES; pass += 1) {
    const places = tidyOnce(layout, links, frame, fresh && pass === 0);
    const still = layout.every(({ id, x, y }) => places.get(id)?.x === x && places.get(id)?.y === y);
    layout = layout.map((box) => ({ ...box, ...places.get(box.id)! }));
    if (still) break;
  }
  return new Map(layout.map(({ id, x, y }) => [id, { x, y }]));
};
