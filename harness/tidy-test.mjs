// Tidies a tangled canvas of real cards in a real host, then judges it on the
// lines the browser actually drew, not on what Tidy predicted.
//   node harness/tidy-test.mjs obsidian|roam
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { obsidian, roam, sleep } from "./hosts.mjs";
import { argument } from "./tidy-cases.ts";
import { measure, segmentsCross } from "@dg/layout/measure.ts";

const target = process.argv[2];
const OUT = resolve("reports/tidy");
mkdirSync(OUT, { recursive: true });
const host = target === "roam" ? await roam() : obsidian();
const s = host.slice;
const q = JSON.stringify;
const results = [];
const check = (id, pass, detail = "") => {
  results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 200) });
  console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail ? ` - ${String(detail).slice(0, 170)}` : ""}`);
};
const until = async (work, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await work();
    if (value || Date.now() > deadline) return value;
    await sleep(200);
  }
};
const mouse = (type, x, y) => host.input("Input.dispatchMouseEvent", {
  type, x, y, buttons: type === "mousePressed" ? 1 : 0, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1,
});
const click = async (selector) => {
  const box = await until(() => s(`s.locate(${q(selector)})`), 6000);
  if (!box) throw new Error(`Couldn't find ${selector}`);
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
};

// Counted from the browser's own paths. Links that meet at a card fan out from one point.
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 4;
const onScreen = ({ links: drawnLinks, cards }) => {
  const links = drawnLinks.map(({ points }) => points);
  let crossings = 0;
  links.forEach((one, index) => {
    links.slice(index + 1).forEach((other) => {
      const ends = [one[0], one[one.length - 1]];
      const shared = ends.some((end) => near(end, other[0]) || near(end, other[other.length - 1]));
      if (shared) return;
      if (one.some((point, step) => step > 0 && other.some((end, at) => at > 0 && segmentsCross(one[step - 1], point, other[at - 1], end)))) crossings += 1;
    });
  });
  const inside = (point, box, by = 3) => point[0] > box.x + by && point[0] < box.x + box.width - by && point[1] > box.y + by && point[1] < box.y + box.height - by;
  const touches = (point, box) => point[0] >= box.x - 6 && point[0] <= box.x + box.width + 6 && point[1] >= box.y - 6 && point[1] <= box.y + box.height + 6;
  let behindCards = 0;
  for (const line of links) {
    for (const box of cards) {
      if (touches(line[0], box) || touches(line[line.length - 1], box)) continue;
      if (line.some((point) => inside(point, box))) behindCards += 1;
    }
  }
  let overlaps = 0;
  cards.forEach((a, index) => {
    for (const b of cards.slice(index + 1)) {
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlaps += 1;
    }
  });
  return { crossings, behindCards, overlaps };
};

await s("s.test(true)");
await s("s.closeAll()");
await sleep(600);

// Real cards with real titles, joined as a tangled argument would be.
const shape = argument(20, 1);
const grammar = await s(`s.call("grammar.get", {})`);
const stamp = Date.now() % 1000000;
const claimType = grammar.nodeTypes.find((type) => type.base === "claim").id;
const made = [];
for (const [index, card] of shape.cards.entries()) {
  const title = `Finding ${index + 1} of a long argument about tension and actin, written the way real claims are ${stamp}`.slice(0, 40 + card.height);
  made.push(await s(`s.call("node.create", ${q({ title, type: claimType })}).then((n) => ({ id: n.id, title: n.title }))`));
}
const canvas = await s(`s.call("canvas.create", ${q({ title: `Tangled ${stamp}` })})`);
const { ids } = await s(`s.call("canvas.write", ${q({
  canvas: canvas.id,
  upserts: shape.cards.map((card, index) => ({ z: index + 1, item: { type: "text", text: made[index].title, x: card.x, y: card.y, width: 240, height: 64, dg: { node: made[index].id } } })),
})})`);
const itemOf = new Map(shape.cards.map((card, index) => [card.id, ids[index]]));
await s(`s.call("canvas.write", ${q({
  canvas: canvas.id,
  upserts: shape.links.map((link, index) => ({ z: 200 + index, item: { fromNode: itemOf.get(link.from), toNode: itemOf.get(link.to), label: link.label } })),
})})`);
await s("s.closeAll()");
await sleep(500);
await s(`s.open(${q(canvas.id)})`);
await until(async () => (await s(`s.count('.card')`)) === shape.cards.length, 12000);
await sleep(1500);
check("tidy.canvas-ready", (await s(`s.count('.react-flow__edge')`)) === shape.links.length, `${shape.cards.length} cards, ${shape.links.length} links`);

for (const [name, width] of [["beside", 725], ["full", null]]) {
  await s(`s.frameWidth(${width === null ? "null" : width})`);
  await sleep(700);
  const scattered = onScreen(await s("s.drawn()"));
  await click('[data-dg="tidy"]');
  await sleep(1600);
  const drawn = await s("s.drawn()");
  const seen = onScreen(drawn);
  console.log(name, "scattered", q(scattered), "tidied", q(seen), `zoom ${drawn.zoom}`);
  check(`tidy.${name}.few-crossings-on-screen`, seen.crossings <= 2 && seen.crossings <= scattered.crossings, q({ scattered: scattered.crossings, tidied: seen.crossings }));
  check(`tidy.${name}.no-overlaps`, seen.overlaps === 0, seen.overlaps);
  check(`tidy.${name}.few-links-behind-cards`, seen.behindCards <= 4, seen.behindCards);

  // What Tidy predicted has to match what got drawn.
  const boxes = new Map(drawn.cards.map(({ id, ...box }) => [id, box]));
  const predicted = measure(boxes, shape.links.map(({ from, to }) => ({ from: itemOf.get(from), to: itemOf.get(to) })), drawn.frame);
  check(`tidy.${name}.prediction-matches-the-screen`, predicted.crossings === seen.crossings, `predicted ${predicted.crossings}, drawn ${seen.crossings}`);
  check(`tidy.${name}.opens-readable`, drawn.zoom >= 0.7, drawn.zoom);
  const lowest = Math.max(...drawn.cards.map((card) => card.y + card.height));
  const furthest = Math.max(...drawn.cards.map((card) => card.x + card.width));
  console.log(`${name}: frame ${drawn.frame.width} x ${drawn.frame.height}, cards reach ${Math.round(furthest)} x ${Math.round(lowest)}`);
  await host.shot(`${OUT}/${host.name}-${name}.png`);

  const before = q(drawn.cards.map(({ id, x, y }) => [id, Math.round(x), Math.round(y)]).sort());
  await click('[data-dg="tidy"]');
  await sleep(1500);
  const after = q((await s("s.drawn()")).cards.map(({ id, x, y }) => [id, Math.round(x), Math.round(y)]).sort());
  check(`tidy.${name}.second-press-moves-nothing`, before === after);
}

await click('[data-dg="undo"]');
await sleep(900);
check("tidy.undo-brings-it-back", (await s(`s.count('.card')`)) === shape.cards.length);

await s("s.frameWidth(null)");
await s("s.closeAll()");
await host.finish();
const passed = results.filter((result) => result.pass).length;
console.log(`=== ${host.name}: ${passed} of ${results.length}`);
writeFileSync(`${OUT}/${host.name}.json`, JSON.stringify({ passed, total: results.length, results }, null, 1));
process.exit(passed === results.length ? 0 : 1);
