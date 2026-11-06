// Draws every Tidy mode for one argument, to look at by eye.
//   node harness/modes-sheet.ts <out.svg> <cards> <seed>
import { writeFileSync } from "node:fs";
import { argument, dressed, FRAMES } from "./tidy-cases.ts";
import { arrange, MODES } from "@dg/layout/modes.ts";
import { boundsOf, measure } from "@dg/layout/measure.ts";
import { curveOf, type Box } from "@dg/layout/edges.ts";

const [out, size, seed] = process.argv.slice(2);
const item = argument(Number(size), Number(seed));
const { cards, links } = dressed(item);
const frame = FRAMES.beside!;
const PANEL = 620;
const panels: string[] = [];
MODES.forEach(({ mode, label }, index) => {
  const focus = cards[Math.floor(cards.length / 2)]!.id;
  const started = performance.now();
  const { places, guides } = arrange({ mode, boxes: cards, links, frame, focus });
  const ms = Math.round(performance.now() - started);
  const boxes = new Map<string, Box>(cards.map(({ id, width, height }) => [id, { ...places.get(id)!, width, height }]));
  const quality = measure(boxes, links, frame);
  const bounds = boundsOf([...boxes.values(), ...guides]);
  const scale = Math.min((PANEL - 20) / bounds.width, (PANEL - 50) / bounds.height, 0.6);
  const [x0, y0] = [(index % 3) * PANEL, Math.floor(index / 3) * PANEL];
  const mapX = (value: number): number => x0 + 10 + (value - bounds.x) * scale;
  const mapY = (value: number): number => y0 + 40 + (value - bounds.y) * scale;
  const zones = guides.map((guide) => `<rect x="${mapX(guide.x)}" y="${mapY(guide.y)}" width="${guide.width * scale}" height="${guide.height * scale}" fill="#f6f3ea" stroke="#d8d2bf"/><text x="${mapX(guide.x) + 5}" y="${mapY(guide.y) + 13}" font-size="10" font-family="Helvetica" fill="#665">${guide.label}</text>`);
  const lines = links.map((link) => {
    const [a, b, c, d] = curveOf(boxes.get(link.from)!, boxes.get(link.to)!);
    return `<path d="M${mapX(a[0])} ${mapY(a[1])}C${mapX(b[0])} ${mapY(b[1])} ${mapX(c[0])} ${mapY(c[1])} ${mapX(d[0])} ${mapY(d[1])}" fill="none" stroke="${link.kind === "opposes" ? "#c0392b" : link.kind === "derivedFrom" ? "#2c7fb8" : "#3a9d5d"}" stroke-width="1"/>`;
  });
  const shapes = [...boxes.values()].map((box) => `<rect x="${mapX(box.x)}" y="${mapY(box.y)}" width="${box.width * scale}" height="${box.height * scale}" fill="#e8eef5" fill-opacity="0.9" stroke="#567" stroke-width="0.7" rx="2"/>`);
  panels.push(`<rect x="${x0}" y="${y0}" width="${PANEL}" height="${PANEL}" fill="white" stroke="#ccc"/><text x="${x0 + 8}" y="${y0 + 20}" font-size="13" font-family="Helvetica">${label}: ${quality.crossings} crossings, ${quality.behindCards} behind, zoom ${quality.zoom.toFixed(2)}, ${ms} ms</text>${zones.join("")}${shapes.join("")}${lines.join("")}`);
});
const rows = Math.ceil(MODES.length / 3);
writeFileSync(out!, `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL * 3}" height="${PANEL * rows}" viewBox="0 0 ${PANEL * 3} ${PANEL * rows}"><rect width="100%" height="100%" fill="#fff"/>${panels.join("")}</svg>`);
