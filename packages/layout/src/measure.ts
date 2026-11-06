import { curveOf, pointOn, sidesFor, type Box, type Point, type Sides } from "./edges.ts";

export type Link = { from: string; to: string; label?: string };
export type Frame = { width: number; height: number };

/** How a layout reads, judged on the lines as they're drawn. */
export type Quality = {
  /** Pairs of links that cross. Links sharing a card fan out, so they don't count. */
  crossings: number;
  /** Links running behind a card that isn't one of their own. */
  behindCards: number;
  overlaps: number;
  /** Labels sitting on another label or on a card. */
  labelClashes: number;
  length: number;
  /** The zoom that fits everything in the frame, up to 100%. */
  zoom: number;
  /** How much of the space in use the cards fill. */
  fill: number;
};

const STEPS = 14;
const LABEL_HEIGHT = 16;
// Matches the padding Tidy asks for when it fits the view.
const FIT_PADDING = 1.12;

export const fitZoom = (size: Frame, frame: Frame): number =>
  Math.min(1, frame.width / (FIT_PADDING * size.width), frame.height / (FIT_PADDING * size.height));

export const boundsOf = (boxes: Iterable<Box>): Box => {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const turn = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const lies = (a: Point, b: Point, point: Point): boolean =>
  turn(a, b, point) === 0 &&
  point[0] >= Math.min(a[0], b[0]) && point[0] <= Math.max(a[0], b[0]) &&
  point[1] >= Math.min(a[1], b[1]) && point[1] <= Math.max(a[1], b[1]);

/** Touching counts, because two curves can cross exactly at a sampled point. */
export const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean =>
  (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) ||
  lies(a, b, c) || lies(a, b, d) || lies(c, d, a) || lies(c, d, b);

const segmentHitsBox = (a: Point, b: Point, box: Box): boolean => {
  // Clips the segment to the box, and it hits if anything is left.
  let [enter, leave] = [0, 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const edges: [number, number][] = [
    [-dx, a[0] - box.x],
    [dx, box.x + box.width - a[0]],
    [-dy, a[1] - box.y],
    [dy, box.y + box.height - a[1]],
  ];
  for (const [direction, room] of edges) {
    if (direction === 0) {
      if (room < 0) return false;
    } else if (direction < 0) enter = Math.max(enter, room / direction);
    else leave = Math.min(leave, room / direction);
    if (enter > leave) return false;
  }
  return true;
};

const touching = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inset = (box: Box, by: number): Box => ({
  x: box.x + by,
  y: box.y + by,
  width: box.width - by * 2,
  height: box.height - by * 2,
});

export const measure = (
  boxes: Map<string, Box>,
  links: Link[],
  frame: Frame,
  sides: Sides = sidesFor,
): Quality => {
  const drawn = links.flatMap((link) => {
    const from = boxes.get(link.from);
    const to = boxes.get(link.to);
    if (!from || !to || link.from === link.to) return [];
    const curve = curveOf(from, to, sides);
    const points = Array.from({ length: STEPS + 1 }, (_, step) => pointOn(curve, step / STEPS));
    const [middleX, middleY] = pointOn(curve, 0.5);
    const labelWidth = link.label ? link.label.length * 6 + 8 : 0;
    return [{
      link,
      points,
      bounds: boundsOf(points.map(([x, y]) => ({ x, y, width: 0, height: 0 }))),
      label: link.label
        ? { x: middleX - labelWidth / 2, y: middleY - LABEL_HEIGHT / 2, width: labelWidth, height: LABEL_HEIGHT }
        : null,
    }];
  });

  let crossings = 0;
  let labelClashes = 0;
  let length = 0;
  let behindCards = 0;
  const reach = (a: Box, b: Box): boolean =>
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

  drawn.forEach((one, index) => {
    for (let step = 1; step < one.points.length; step += 1) {
      length += Math.hypot(one.points[step]![0] - one.points[step - 1]![0], one.points[step]![1] - one.points[step - 1]![1]);
    }
    for (const other of drawn.slice(index + 1)) {
      if (one.label && other.label && touching(one.label, other.label)) labelClashes += 1;
      const shared = [other.link.from, other.link.to].some((id) => id === one.link.from || id === one.link.to);
      if (shared || !reach(one.bounds, other.bounds)) continue;
      const crossed = one.points.some((point, step) =>
        step > 0 && other.points.some((end, at) => at > 0 && segmentsCross(one.points[step - 1]!, point, other.points[at - 1]!, end)),
      );
      if (crossed) crossings += 1;
    }
    for (const [id, box] of boxes) {
      if (one.label && touching(one.label, box)) labelClashes += 1;
      if (id === one.link.from || id === one.link.to || !reach(one.bounds, box)) continue;
      const solid = inset(box, 2);
      if (one.points.some((point, step) => step > 0 && segmentHitsBox(one.points[step - 1]!, point, solid))) behindCards += 1;
    }
  });

  const all = [...boxes.values()];
  let overlaps = 0;
  all.forEach((box, index) => {
    for (const other of all.slice(index + 1)) if (touching(box, other)) overlaps += 1;
  });
  const bounds = boundsOf(all);
  const covered = all.reduce((sum, box) => sum + box.width * box.height, 0);
  return {
    crossings,
    behindCards,
    overlaps,
    labelClashes,
    length: Math.round(length),
    zoom: fitZoom(bounds, frame),
    fill: covered / Math.max(1, bounds.width * bounds.height),
  };
};
