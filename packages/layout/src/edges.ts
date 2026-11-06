export type Box = { x: number; y: number; width: number; height: number };
export type Side = "t" | "r" | "b" | "l";
export type Point = [number, number];
export type Curve = [Point, Point, Point, Point];
export type Sides = (from: Box, to: Box) => [Side, Side];

// Beyond this slope a sideways link would run almost straight up a column.
const STEEPEST = 3;

/**
 * Leaves from the side facing the other card. Cards in different columns always
 * join side to side, so a link never drops out of the bottom of a card into the
 * ones stacked under it.
 */
export const sidesFor: Sides = (from, to) => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const apart = to.x >= from.x + from.width || from.x >= to.x + to.width;
  if (apart && Math.abs(dx) * STEEPEST >= Math.abs(dy)) return dx >= 0 ? ["r", "l"] : ["l", "r"];
  return dy >= 0 ? ["b", "t"] : ["t", "b"];
};

const portOf = (box: Box, side: Side): Point => {
  if (side === "t") return [box.x + box.width / 2, box.y];
  if (side === "b") return [box.x + box.width / 2, box.y + box.height];
  if (side === "l") return [box.x, box.y + box.height / 2];
  return [box.x + box.width, box.y + box.height / 2];
};

// React Flow's own bezier, so what gets measured is what gets drawn.
const pull = (distance: number): number => (distance >= 0 ? 0.5 * distance : 6.25 * Math.sqrt(-distance));

const controlOf = ([x, y]: Point, side: Side, [toX, toY]: Point): Point => {
  if (side === "l") return [x - pull(x - toX), y];
  if (side === "r") return [x + pull(toX - x), y];
  if (side === "t") return [x, y - pull(y - toY)];
  return [x, y + pull(toY - y)];
};

export const curveOf = (from: Box, to: Box, sides: Sides = sidesFor): Curve => {
  const [leaving, arriving] = sides(from, to);
  const start = portOf(from, leaving);
  const end = portOf(to, arriving);
  return [start, controlOf(start, leaving, end), controlOf(end, arriving, start), end];
};

export const pointOn = ([a, b, c, d]: Curve, t: number): Point => {
  const u = 1 - t;
  const [wa, wb, wc, wd] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [wa * a[0] + wb * b[0] + wc * c[0] + wd * d[0], wa * a[1] + wb * b[1] + wc * c[1] + wd * d[1]];
};
