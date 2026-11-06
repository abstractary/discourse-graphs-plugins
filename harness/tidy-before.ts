type Box = { id: string; x: number; y: number; width: number; height: number };
type Link = { from: string; to: string };

const COLUMN_GAP = 96;
const ROW_GAP = 28;

/**
 * Lays an argument out in columns: what supports on the left, what's supported
 * to its right. Each item keeps its size, and items without links go last.
 */
export const tidy = (boxes: Box[], links: Link[]): Map<string, { x: number; y: number }> => {
  const known = new Set(boxes.map((box) => box.id));
  const edges = links.filter(({ from, to }) => known.has(from) && known.has(to) && from !== to);
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const { from, to } of edges) {
    out.set(from, [...(out.get(from) ?? []), to]);
    into.set(to, [...(into.get(to) ?? []), from]);
  }

  // The longest path to a node sets its column. The guard stops at cycles.
  const depths = new Map<string, number>();
  const depthOf = (id: string, path: Set<string>): number => {
    const seen = depths.get(id);
    if (seen !== undefined) return seen;
    if (path.has(id)) return 0;
    path.add(id);
    const depth = Math.max(-1, ...(into.get(id) ?? []).map((parent) => depthOf(parent, path))) + 1;
    path.delete(id);
    depths.set(id, depth);
    return depth;
  };
  const linked = boxes.filter(({ id }) => out.has(id) || into.has(id));
  const loose = boxes.filter(({ id }) => !out.has(id) && !into.has(id));
  for (const { id } of linked) depthOf(id, new Set());

  const columns: Box[][] = [];
  for (const box of [...linked].sort((a, b) => a.y - b.y)) {
    const depth = depths.get(box.id) ?? 0;
    columns[depth] = [...(columns[depth] ?? []), box];
  }
  if (loose.length > 0) columns.push([...loose].sort((a, b) => a.y - b.y));

  // A few sweeps, each sorting by the average place of neighbors, untangle most crossings.
  const rankOf = new Map<string, number>();
  const rank = (): void => {
    for (const column of columns) column?.forEach((box, index) => rankOf.set(box.id, index));
  };
  const average = (id: string, neighbors: Map<string, string[]>): number => {
    const places = (neighbors.get(id) ?? []).map((other) => rankOf.get(other) ?? 0);
    return places.length === 0 ? (rankOf.get(id) ?? 0) : places.reduce((sum, place) => sum + place, 0) / places.length;
  };
  rank();
  for (let sweep = 0; sweep < 6; sweep += 1) {
    const neighbors = sweep % 2 === 0 ? into : out;
    const order = sweep % 2 === 0 ? columns : [...columns].reverse();
    for (const column of order) {
      column?.sort((a, b) => average(a.id, neighbors) - average(b.id, neighbors));
      rank();
    }
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const heights = columns.map((column) =>
    (column ?? []).reduce((sum, box) => sum + box.height + ROW_GAP, -ROW_GAP),
  );
  const tallest = Math.max(0, ...heights);
  const places = new Map<string, { x: number; y: number }>();
  let x = left;
  columns.forEach((column, index) => {
    if (!column) return;
    let y = top + (tallest - heights[index]!) / 2;
    for (const box of column) {
      places.set(box.id, { x: Math.round(x), y: Math.round(y) });
      y += box.height + ROW_GAP;
    }
    x += Math.max(...column.map((box) => box.width)) + COLUMN_GAP;
  });
  return places;
};
