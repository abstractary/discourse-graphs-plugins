import { curveOf, pointOn, type Box } from "./edges.ts";

/**
 * The columns of one argument: which column each card sits in, in what order,
 * and at what height. A link that skips a column gets a slot in it, so nothing
 * is placed where the link will run.
 */
export type Card = { id: string; width: number; height: number; y: number };
export type Arrow = { from: number; to: number };

type Slot = {
  card?: number;
  /** For a slot a link passes through, the arrow it belongs to. */
  arrow?: number;
  /** The ends of that arrow. Links sharing an end fan out from it, so they can share a corridor. */
  ends?: [number, number];
  column: number;
  size: number;
  left: number[];
  right: number[];
  y: number;
};

export type Columns = { slots: Slot[]; rows: number[][] };

const ROW_GAP = 28;
const LINK_GAP = 8;
const LINK_SIZE = 12;
const SETTLE_ROUNDS = 28;
const CLEARING_ROUNDS = 3;

/** Turns just enough arrows around to leave no cycles, for working out columns only. */
const withoutCycles = (size: number, arrows: Arrow[]): Arrow[] => {
  const leaving = Array.from({ length: size }, () => [] as number[]);
  const arriving = new Array<number>(size).fill(0);
  arrows.forEach(({ from, to }, index) => {
    leaving[from]!.push(index);
    arriving[to]! += 1;
  });
  const state = new Uint8Array(size);
  const turned = new Set<number>();
  const visit = (card: number): void => {
    state[card] = 1;
    for (const index of leaving[card]!) {
      const next = arrows[index]!.to;
      if (state[next] === 1) turned.add(index);
      else if (state[next] === 0) visit(next);
    }
    state[card] = 2;
  };
  const sourcesFirst = Array.from({ length: size }, (_, card) => card).sort((a, b) => arriving[a]! - arriving[b]!);
  for (const card of sourcesFirst) if (state[card] === 0) visit(card);
  return arrows.map((arrow, index) => (turned.has(index) ? { from: arrow.to, to: arrow.from } : arrow));
};

/**
 * What supports sits left of what it supports. Each card then moves as close to
 * its neighbors as that allows, because short links cross less, and a tie goes
 * to the shorter column.
 */
export const columnsOf = (cards: Card[], arrows: Arrow[]): { columns: number[]; flow: Arrow[] } => {
  const flow = withoutCycles(cards.length, arrows);
  const before = cards.map(() => [] as number[]);
  const after = cards.map(() => [] as number[]);
  for (const { from, to } of flow) {
    after[from]!.push(to);
    before[to]!.push(from);
  }
  const columns = new Array<number>(cards.length).fill(0);
  const waiting = before.map((list) => list.length);
  const ready = cards.flatMap((_, card) => (waiting[card] === 0 ? [card] : []));
  const order: number[] = [];
  while (ready.length > 0) {
    const card = ready.shift()!;
    order.push(card);
    for (const next of after[card]!) {
      columns[next] = Math.max(columns[next]!, columns[card]! + 1);
      waiting[next]! -= 1;
      if (waiting[next] === 0) ready.push(next);
    }
  }
  const load = new Map<number, number>();
  const shift = (card: number, by: number): void => {
    load.set(columns[card]!, (load.get(columns[card]!) ?? 0) + by * cards[card]!.height);
  };
  cards.forEach((_, card) => shift(card, 1));
  for (let pass = 0; pass < 8; pass += 1) {
    let moved = false;
    for (const card of [...order].reverse()) {
      const lowest = before[card]!.length > 0 ? Math.max(...before[card]!.map((other) => columns[other]!)) + 1 : -Infinity;
      const highest = after[card]!.length > 0 ? Math.min(...after[card]!.map((other) => columns[other]!)) - 1 : Infinity;
      if (lowest === highest) continue;
      const around = [...before[card]!, ...after[card]!].map((other) => columns[other]!).sort((a, b) => a - b);
      const clamp = (value: number): number => Math.max(lowest, Math.min(highest, value));
      const low = clamp(around[Math.floor((around.length - 1) / 2)]!);
      const high = clamp(around[Math.ceil((around.length - 1) / 2)]!);
      const best = (load.get(low) ?? 0) <= (load.get(high) ?? 0) ? low : high;
      if (best === columns[card]) continue;
      shift(card, -1);
      columns[card] = best;
      shift(card, 1);
      moved = true;
    }
    if (!moved) break;
  }
  const used = [...new Set(columns)].sort((a, b) => a - b);
  return { columns: columns.map((column) => used.indexOf(column)), flow };
};

/** Gives each link a slot in every column it passes through. */
export const slotsFor = (cards: Card[], flow: Arrow[], columns: number[]): Columns => {
  const slots: Slot[] = cards.map((card, index) => ({
    card: index,
    column: columns[index]!,
    size: card.height,
    left: [],
    right: [],
    y: card.y + card.height / 2,
  }));
  const join = (from: number, to: number): void => {
    slots[from]!.right.push(to);
    slots[to]!.left.push(from);
  };
  flow.forEach(({ from, to }, arrow) => {
    let previous = from;
    const [start, end] = [columns[from]!, columns[to]!];
    for (let column = start + 1; column < end; column += 1) {
      const share = (column - start) / (end - start);
      slots.push({
        arrow,
        ends: [from, to],
        column,
        size: LINK_SIZE,
        left: [],
        right: [],
        y: slots[from]!.y + share * (slots[to]!.y - slots[from]!.y),
      });
      join(previous, slots.length - 1);
      previous = slots.length - 1;
    }
    join(previous, to);
  });
  const rows: number[][] = Array.from({ length: Math.max(...columns) + 1 }, () => []);
  slots.forEach((slot, index) => rows[slot.column]!.push(index));
  return { slots, rows };
};

const positionsOf = (rows: number[][], size: number): Int32Array => {
  const places = new Int32Array(size);
  for (const row of rows) row.forEach((slot, place) => (places[slot] = place));
  return places;
};

export const crossingsOf = (slots: Slot[], rows: number[][]): number => {
  const places = positionsOf(rows, slots.length);
  let total = 0;
  for (let column = 0; column + 1 < rows.length; column += 1) {
    const counts = new Int32Array(rows[column + 1]!.length + 1);
    let seen = 0;
    for (const slot of rows[column]!) {
      const ends = slots[slot]!.right.map((other) => places[other]!).sort((a, b) => a - b);
      for (const end of ends) {
        let below = 0;
        for (let at = end + 1; at > 0; at -= at & -at) below += counts[at]!;
        total += seen - below;
        for (let at = end + 1; at < counts.length; at += at & -at) counts[at]! += 1;
        seen += 1;
      }
    }
  }
  return total;
};

const middleOf = (values: number[], median: boolean): number => {
  if (!median) return values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
};

const shareCorridor = (a: Slot, b: Slot): boolean =>
  Boolean(a.ends && b.ends && (a.ends[0] === b.ends[0] || a.ends[1] === b.ends[1]));

const sweep = (slots: Slot[], rows: number[][], rightward: boolean, median: boolean): void => {
  const places = positionsOf(rows, slots.length);
  const sides = rows.map((_, index) => (rightward ? index : rows.length - 1 - index)).slice(1);
  for (const column of sides) {
    const neighbors = (slot: number): number[] => (rightward ? slots[slot]!.left : slots[slot]!.right);
    const row = rows[column]!;
    const wanted = new Map(row.map((slot) => [slot, neighbors(slot).length ? middleOf(neighbors(slot).map((other) => places[other]!), median) : -1]));
    // Slots with nothing to go by keep their place, and the others sort around them.
    const moving = row.filter((slot) => wanted.get(slot)! >= 0).sort((a, b) => wanted.get(a)! - wanted.get(b)! || places[a]! - places[b]!);
    let next = 0;
    rows[column] = row.map((slot) => (wanted.get(slot)! >= 0 ? moving[next++]! : slot));
    rows[column]!.forEach((slot, place) => (places[slot] = place));
  }
};

/** Swaps neighbors while that removes crossings, which a sweep can't see. */
const swapNeighbors = (slots: Slot[], rows: number[][]): void => {
  const places = positionsOf(rows, slots.length);
  const tangled = (upper: number[], lower: number[]): number => {
    let count = 0;
    for (const a of upper) for (const b of lower) if (places[a]! > places[b]!) count += 1;
    return count;
  };
  const between = (upper: number, lower: number): number =>
    tangled(slots[upper]!.left, slots[lower]!.left) + tangled(slots[upper]!.right, slots[lower]!.right);
  for (let pass = 0, improved = true; improved && pass < 6; pass += 1) {
    improved = false;
    for (const row of rows) {
      for (let at = 0; at + 1 < row.length; at += 1) {
        const [upper, lower] = [row[at]!, row[at + 1]!];
        if (between(lower, upper) >= between(upper, lower)) continue;
        row[at] = lower;
        row[at + 1] = upper;
        places[upper] = at + 1;
        places[lower] = at;
        improved = true;
      }
    }
  }
};

type Order = { rows: number[][]; crossings: number };

const untangle = (slots: Slot[], start: number[][]): Order => {
  const rows = start.map((row) => [...row]);
  const first = crossingsOf(slots, rows);
  let best: Order = { rows: start, crossings: first };
  let quiet = 0;
  for (let round = 0; round < 16 && quiet < 4 && first > 0; round += 1) {
    sweep(slots, rows, round % 2 === 0, round % 4 >= 2);
    swapNeighbors(slots, rows);
    const crossings = crossingsOf(slots, rows);
    quiet = crossings < best.crossings ? 0 : quiet + 1;
    if (crossings <= best.crossings) best = { rows: rows.map((row) => [...row]), crossings };
  }
  return best;
};

/**
 * Finds the orders with the fewest crossings. It starts from the arrangement on
 * the canvas, so a tie keeps what a person already has, then from many shuffles,
 * because a sweep alone settles on the first local answer it meets.
 */
export const bestOrders = ({
  columns,
  shuffles,
  keep,
  random,
}: {
  columns: Columns;
  shuffles: number;
  keep: number;
  random: () => number;
}): number[][][] => {
  const { slots, rows } = columns;
  const asPlaced = rows.map((row) => [...row].sort((a, b) => slots[a]!.y - slots[b]!.y || a - b));
  const shuffled = (): number[][] =>
    rows.map((row) => {
      const copy = [...row].sort((a, b) => a - b);
      for (let at = copy.length - 1; at > 0; at -= 1) {
        const other = Math.floor(random() * (at + 1));
        [copy[at], copy[other]] = [copy[other]!, copy[at]!];
      }
      return copy;
    });
  const found = new Map<string, Order & { found: number }>();
  const remember = (order: Order): void => {
    const key = order.rows.map((row) => row.join(",")).join("|");
    if (!found.has(key)) found.set(key, { ...order, found: found.size });
  };
  remember({ rows: asPlaced, crossings: crossingsOf(slots, asPlaced) });
  remember(untangle(slots, asPlaced));
  for (let attempt = 0; attempt < shuffles; attempt += 1) remember(untangle(slots, shuffled()));
  return [...found.values()]
    .sort((a, b) => a.crossings - b.crossings || a.found - b.found)
    .slice(0, keep)
    .map((order) => order.rows);
};

/**
 * Splits a tall column in two. A link can only pass a column cleanly where it
 * runs nearly level, so the middle of each family moves out, and the cards
 * furthest from what they link to stay close to it.
 */
export const spread = (
  cards: Card[],
  columns: number[],
  rows: number[][],
  slots: Slot[],
  limit: number,
): number[] | null => {
  const cardsIn = rows.map((row) => row.flatMap((slot) => {
    const card = slots[slot]!.card;
    return card === undefined ? [] : [card];
  }));
  const tall = cardsIn.map((row) => row.reduce((sum, card) => sum + cards[card]!.height + ROW_GAP, 0) > limit);
  if (!tall.includes(true)) return null;
  const startOf: number[] = [];
  tall.reduce((start, split, index) => {
    startOf[index] = start;
    return start + (split ? 2 : 1);
  }, 0);
  const endOf = (slot: number): number | undefined => {
    let at = slots[slot]!.right[0];
    while (at !== undefined && slots[at]!.card === undefined) at = slots[at]!.right[0];
    return at;
  };
  const next = [...columns];
  cardsIn.forEach((row, column) => {
    const near = startOf[column]! + (tall[column] ? 1 : 0);
    for (const card of row) next[card] = near;
    if (!tall[column]) return;
    let start = 0;
    while (start < row.length) {
      let end = start + 1;
      while (end < row.length && endOf(row[end]!) === endOf(row[start]!)) end += 1;
      const size = end - start;
      const moving = Math.floor(size / 2);
      const first = start + Math.floor((size - moving) / 2);
      for (let at = first; at < first + moving; at += 1) next[row[at]!] = near - 1;
      start = end;
    }
  });
  return next;
};

/** Stays as near each wanted height as the order and the gaps allow. */
const settle = (row: number[], slots: Slot[], wanted: Float64Array, weight: Float64Array): void => {
  const offsets: number[] = [];
  row.reduce((offset, slot, index) => {
    if (index === 0) {
      offsets.push(0);
      return 0;
    }
    const above = slots[row[index - 1]!]!;
    const here = slots[slot]!;
    const gap = above.card !== undefined && here.card !== undefined ? ROW_GAP : LINK_GAP;
    const next = shareCorridor(above, here) ? offset : offset + (above.size + here.size) / 2 + gap;
    offsets.push(next);
    return next;
  }, 0);
  const blocks: { total: number; weight: number; count: number }[] = [];
  row.forEach((slot, index) => {
    let block = { total: (wanted[slot]! - offsets[index]!) * weight[slot]!, weight: weight[slot]!, count: 1 };
    while (blocks.length > 0) {
      const last = blocks[blocks.length - 1]!;
      if (last.total / last.weight < block.total / block.weight) break;
      blocks.pop();
      block = { total: last.total + block.total, weight: last.weight + block.weight, count: last.count + block.count };
    }
    blocks.push(block);
  });
  let index = 0;
  for (const block of blocks) {
    for (let step = 0; step < block.count; step += 1) {
      slots[row[index]!]!.y = block.total / block.weight + offsets[index]!;
      index += 1;
    }
  }
};

export type Placed = { boxes: Map<string, Box>; width: number; height: number };

/**
 * Sets heights so each card sits level with what it links to, and hubs sit in
 * the middle of their family. Then each link's real curve is traced through the
 * columns it crosses, and cards make room for it.
 */
export const place = (
  cards: Card[],
  flow: Arrow[],
  { slots: source, rows }: Columns,
  order: number[][],
  {
    gap,
    clearing,
    stacked = false,
  }: {
    /** The space after each column, which regions use to set themselves apart. */
    gap: number | ((column: number) => number);
    clearing: boolean;
    /** Keeps each column packed from the top, for an order that means something. */
    stacked?: boolean;
  },
): Placed => {
  const slots = source.map((slot) => ({ ...slot }));
  const thickness = rows.map((row) => Math.max(0, ...row.map((slot) => {
    const card = slots[slot]!.card;
    return card === undefined ? 0 : cards[card]!.width;
  })));
  const lefts: number[] = [];
  thickness.reduce((x, width, column) => {
    lefts[column] = x;
    return x + width + (typeof gap === "number" ? gap : gap(column));
  }, 0);

  const wanted = new Float64Array(slots.length);
  const weight = new Float64Array(slots.length);
  slots.forEach((slot, index) => {
    weight[index] = 1 + (slot.left.length + slot.right.length) / 2;
  });
  order.forEach((row) => {
    const total = row.reduce((sum, slot) => sum + slots[slot]!.size + ROW_GAP, -ROW_GAP);
    let y = stacked ? 0 : -total / 2;
    for (const slot of row) {
      slots[slot]!.y = y + slots[slot]!.size / 2;
      y += slots[slot]!.size + ROW_GAP;
    }
  });

  const pinned = new Map<number, number>();
  const relax = (rounds: number): void => {
    for (let round = 0; round < rounds; round += 1) {
      const rightward = round % 2 === 0;
      const both = round >= rounds - 6;
      const sequence = rightward ? order : [...order].reverse();
      for (const row of sequence) {
        for (const index of row) {
          const slot = slots[index]!;
          const clear = pinned.get(index);
          if (clear !== undefined) {
            wanted[index] = clear;
            continue;
          }
          const near = both ? [...slot.left, ...slot.right] : rightward ? slot.left : slot.right;
          wanted[index] = near.length > 0 ? middleOf(near.map((other) => slots[other]!.y), false) : slot.y;
        }
        settle(row, slots, wanted, weight);
      }
    }
  };
  if (!stacked) relax(SETTLE_ROUNDS);

  const boxOf = (card: number): Box => {
    const slot = slots[card]!;
    return {
      x: lefts[slot.column]!,
      y: slot.y - cards[card]!.height / 2,
      width: cards[card]!.width,
      height: cards[card]!.height,
    };
  };

  // Where a link really runs through a column, from its curve.
  const spanOf = (index: number): [number, number] | null => {
    const slot = slots[index]!;
    const { from, to } = flow[slot.arrow!]!;
    const curve = curveOf(boxOf(from), boxOf(to));
    const [left, right] = [lefts[slot.column]!, lefts[slot.column]! + thickness[slot.column]!];
    let [top, bottom] = [Infinity, -Infinity];
    for (let step = 0; step <= 32; step += 1) {
      const [x, y] = pointOn(curve, step / 32);
      if (x < left || x > right) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return top === Infinity ? null : [top, bottom];
  };

  const hasLinks = slots.some((slot) => slot.arrow !== undefined);
  for (let round = 0; round < CLEARING_ROUNDS && hasLinks && clearing && !stacked; round += 1) {
    for (const row of order) {
      for (let start = 0; start < row.length; ) {
        let end = start + 1;
        if (slots[row[start]!]!.arrow === undefined) {
          start = end;
          continue;
        }
        while (end < row.length && shareCorridor(slots[row[end - 1]!]!, slots[row[end]!]!)) end += 1;
        const corridor = row.slice(start, end);
        const spans = corridor.flatMap((index) => spanOf(index) ?? []);
        if (spans.length > 0) {
          const [top, bottom] = [Math.min(...spans), Math.max(...spans)];
          for (const index of corridor) {
            slots[index]!.size = bottom - top + LINK_SIZE;
            pinned.set(index, (top + bottom) / 2);
            weight[index] = 3;
          }
        }
        start = end;
      }
    }
    relax(10);
  }

  const boxes = new Map(cards.map((card, index) => [card.id, boxOf(index)]));
  const all = [...boxes.values()];
  const top = Math.min(...all.map((box) => box.y));
  for (const box of all) box.y = Math.round(box.y - top);
  for (const box of all) box.x = Math.round(box.x);
  return {
    boxes,
    width: Math.max(...all.map((box) => box.x + box.width)),
    height: Math.max(...all.map((box) => box.y + box.height)),
  };
};
