// Scores Tidy on the lines as drawn, against the version before it and against
// ELK's layered layout, on real MATSUlab arguments and on generated ones.
//   node harness/tidy-bench.ts
import { mkdirSync, writeFileSync } from "node:fs";
import ELK from "elkjs";
import { tidy as tidyBefore } from "./tidy-before.ts";
import { argument, elkLayout, FRAMES, realCases, sidesBefore, withSizes } from "./tidy-cases.ts";
import { tidy, costOf } from "@dg/layout/tidy.ts";
import { measure, type Quality } from "@dg/layout/measure.ts";

type Row = Quality & { cost: number; ms: number };
const totals = new Map<string, Row[]>();
const note = (key: string, row: Row): void => {
  totals.set(key, [...(totals.get(key) ?? []), row]);
};

const cases = [
  ...realCases(),
  ...[10, 20, 30].flatMap((size) => Array.from({ length: 12 }, (_, seed) => argument(size, seed + 1))),
  ...Array.from({ length: 3 }, (_, seed) => argument(140, seed + 1)),
];

const elk = new ELK();
const started = Date.now();
for (const item of cases) {
  for (const [frameName, frame] of Object.entries(FRAMES)) {
    const key = (method: string): string => `${item.group}|${frameName}|${method}`;
    const old = performance.now();
    const before = tidyBefore(item.cards, item.links);
    const oldMs = performance.now() - old;
    const beforeQuality = measure(withSizes(item.cards, before), item.links, frame, sidesBefore);
    note(key("before"), { ...beforeQuality, cost: costOf(beforeQuality), ms: oldMs });
    const fresh = performance.now();
    const after = tidy(item.cards, item.links, { frame });
    const freshMs = performance.now() - fresh;
    const afterQuality = measure(withSizes(item.cards, after), item.links, frame);
    note(key("now"), { ...afterQuality, cost: costOf(afterQuality), ms: freshMs });
    const reference = performance.now();
    const elkBoxes = await elkLayout(elk, item);
    const elkMs = performance.now() - reference;
    const elkQuality = measure(elkBoxes, item.links, frame);
    note(key("elk"), { ...elkQuality, cost: costOf(elkQuality), ms: elkMs });
  }
}

const mean = (rows: Row[], field: keyof Row): number => rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
const summary = [...totals].map(([key, rows]) => {
  const [group, frame, method] = key.split("|");
  return {
    group, frame, method, cases: rows.length,
    crossings: +mean(rows, "crossings").toFixed(2),
    behindCards: +mean(rows, "behindCards").toFixed(2),
    overlaps: +mean(rows, "overlaps").toFixed(2),
    labelClashes: +mean(rows, "labelClashes").toFixed(2),
    zoom: +mean(rows, "zoom").toFixed(2),
    fill: +mean(rows, "fill").toFixed(2),
    length: Math.round(mean(rows, "length")),
    ms: Math.round(mean(rows, "ms")),
    slowestMs: Math.round(Math.max(...rows.map((row) => row.ms))),
  };
});
console.table(summary);
console.log(`${cases.length} cases in ${Math.round((Date.now() - started) / 1000)} s`);
mkdirSync("reports/tidy", { recursive: true });
writeFileSync("reports/tidy/benchmark.json", JSON.stringify(summary, null, 1));
