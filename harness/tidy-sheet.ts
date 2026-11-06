// Draws layouts side by side, with each link's real curve, to look at by eye.
//   node harness/tidy-sheet.ts <out.svg> <frame> <case name>...
import { writeFileSync } from "node:fs";
import ELK from "elkjs";
import { tidy as tidyBefore } from "./tidy-before.ts";
import { argument, elkLayout, FRAMES, realCases, sidesBefore, withSizes, type Case } from "./tidy-cases.ts";
import { tidy } from "@dg/layout/tidy.ts";
import { boundsOf, measure, type Frame } from "@dg/layout/measure.ts";
import { curveOf, sidesFor, type Box, type Sides } from "@dg/layout/edges.ts";

const [out, frameName, ...names] = process.argv.slice(2);
const frame = FRAMES[frameName!]!;
const all = [...realCases(), ...[10, 20, 30].flatMap((size) => Array.from({ length: 12 }, (_, seed) => argument(size, seed + 1)))];
const elk = new ELK();
const PANEL = 620;

const panel = (title: string, boxes: Map<string, Box>, item: Case, x: number, y: number, sides: Sides): string => {
  const quality = measure(boxes, item.links, frame, sides);
  const bounds = boundsOf(boxes.values());
  const scale = Math.min((PANEL - 20) / bounds.width, (PANEL - 50) / bounds.height, 0.6);
  const mapX = (value: number): number => x + 10 + (value - bounds.x) * scale;
  const mapY = (value: number): number => y + 40 + (value - bounds.y) * scale;
  const lines = item.links.map((link) => {
    const [a, b, c, d] = curveOf(boxes.get(link.from)!, boxes.get(link.to)!, sides);
    return `<path d="M${mapX(a[0])} ${mapY(a[1])}C${mapX(b[0])} ${mapY(b[1])} ${mapX(c[0])} ${mapY(c[1])} ${mapX(d[0])} ${mapY(d[1])}" fill="none" stroke="#c0392b" stroke-width="1"/>`;
  });
  const cards = [...boxes.values()].map((box) => `<rect x="${mapX(box.x)}" y="${mapY(box.y)}" width="${box.width * scale}" height="${box.height * scale}" fill="#e8eef5" fill-opacity="0.85" stroke="#567" stroke-width="0.7" rx="2"/>`);
  const head = `${title}: ${quality.crossings} crossings, ${quality.behindCards} behind cards, ${quality.labelClashes} label clashes, zoom ${quality.zoom.toFixed(2)}, fill ${quality.fill.toFixed(2)}`;
  return `<rect x="${x}" y="${y}" width="${PANEL}" height="${PANEL}" fill="white" stroke="#ccc"/><text x="${x + 8}" y="${y + 20}" font-size="13" font-family="Helvetica">${head}</text>${cards.join("")}${lines.join("")}`;
};

const rows: string[] = [];
let row = 0;
for (const name of names) {
  const item = all.find((entry) => entry.name === name);
  if (!item) throw new Error(`No case ${name}: ${all.map((entry) => entry.name).slice(0, 8).join(", ")}`);
  rows.push(panel("before", withSizes(item.cards, tidyBefore(item.cards, item.links)), item, 0, row * PANEL, sidesBefore));
  rows.push(panel("now", withSizes(item.cards, tidy(item.cards, item.links, { frame })), item, PANEL, row * PANEL, sidesFor));
  rows.push(panel("ELK", await elkLayout(elk, item), item, PANEL * 2, row * PANEL, sidesFor));
  row += 1;
}
writeFileSync(out!, `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL * 3}" height="${PANEL * row}" viewBox="0 0 ${PANEL * 3} ${PANEL * row}"><rect width="100%" height="100%" fill="#fff"/>${rows.join("")}</svg>`);
