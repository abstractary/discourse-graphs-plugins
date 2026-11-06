import assert from "node:assert/strict";
import test from "node:test";
import { tidy, type TidyBox } from "@dg/layout/tidy.ts";
import { measure, type Link } from "@dg/layout/measure.ts";
import { curveOf, sidesFor, type Box } from "@dg/layout/edges.ts";
import { argument } from "../harness/tidy-cases.ts";

const FRAME = { width: 725, height: 800 };

const box = (id: string, y = 0, height = 80, extra: Partial<TidyBox> = {}): TidyBox => ({ id, x: 0, y, width: 240, height, ...extra });

const laidOut = (boxes: TidyBox[], places: ReturnType<typeof tidy>): Map<string, Box> =>
  new Map(boxes.map(({ id, width, height }) => [id, { ...places.get(id)!, width, height }]));

const qualityOf = (boxes: TidyBox[], links: Link[]) =>
  measure(laidOut(boxes, tidy(boxes, links, { frame: FRAME })), links, FRAME);

test("supporting items sit left of what they support, with no overlaps", () => {
  const boxes = [box("claim", 0, 200), box("a", 10, 300), box("b", 20), box("note", 30)];
  const links = [{ from: "a", to: "claim" }, { from: "b", to: "claim" }];
  const places = tidy(boxes, links);
  assert.ok(places.get("a")!.x < places.get("claim")!.x);
  assert.equal(places.get("a")!.x, places.get("b")!.x);
  assert.equal(measure(laidOut(boxes, places), links, FRAME).overlaps, 0);
});

test("crossed pairs come out straight", () => {
  const boxes = [box("a", 0), box("b", 100), box("x", 0), box("y", 100)];
  const links = [{ from: "a", to: "y" }, { from: "b", to: "x" }];
  assert.equal(qualityOf(boxes, links).crossings, 0);
});

test("a cycle still gets a layout", () => {
  const boxes = [box("a"), box("b")];
  const links = [{ from: "a", to: "b" }, { from: "b", to: "a" }];
  const places = tidy(boxes, links);
  assert.equal(places.size, 2);
  assert.equal(measure(laidOut(boxes, places), links, FRAME).overlaps, 0);
});

test("a crossing that lands exactly on a sampled point still counts", () => {
  // Both curves pass through the same middle, which is where sampling looks.
  const boxes = new Map<string, Box>([
    ["a", { x: 0, y: 0, width: 100, height: 40 }],
    ["b", { x: 0, y: 200, width: 100, height: 40 }],
    ["c", { x: 300, y: 0, width: 100, height: 40 }],
    ["d", { x: 300, y: 200, width: 100, height: 40 }],
  ]);
  const links = [{ from: "a", to: "d" }, { from: "b", to: "c" }];
  assert.equal(measure(boxes, links, FRAME).crossings, 1);
});

test("the curve measured is the curve React Flow draws", () => {
  const [start, near, far, end] = curveOf(
    { x: 0, y: 0, width: 240, height: 80 },
    { x: 336, y: 200, width: 240, height: 80 },
  );
  assert.deepEqual(start, [240, 40]);
  assert.deepEqual(end, [336, 240]);
  assert.deepEqual(near, [288, 40]);
  assert.deepEqual(far, [288, 240]);
});

test("cards in different columns join side to side, however far apart", () => {
  const from = { x: 0, y: 0, width: 240, height: 80 };
  assert.deepEqual(sidesFor(from, { x: 336, y: 700, width: 240, height: 80 }), ["r", "l"]);
  assert.deepEqual(sidesFor(from, { x: 40, y: 300, width: 240, height: 80 }), ["b", "t"]);
});

test("a link that skips a column doesn't run behind the cards in it", () => {
  const boxes = ["a", "b", "c", "d", "e"].map((id, index) => box(id, index * 100));
  const links = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "a", to: "c" },
    { from: "d", to: "b" },
    { from: "e", to: "b" },
  ];
  assert.equal(qualityOf(boxes, links).behindCards, 0);
});

test("the same canvas gets the same layout, in any order", () => {
  const { cards, links } = argument(20, 3);
  const once = tidy(cards, links, { frame: FRAME });
  const again = tidy([...cards].reverse(), [...links].reverse(), { frame: FRAME });
  assert.deepEqual([...once].sort(), [...again].sort());
});

test("pressing Tidy again moves nothing", () => {
  for (const size of [10, 20, 30]) {
    for (let seed = 1; seed <= 4; seed += 1) {
      const { cards, links } = argument(size, seed);
      const first = tidy(cards, links, { frame: FRAME });
      const second = tidy(cards.map((card) => ({ ...card, ...first.get(card.id)! })), links, { frame: FRAME });
      assert.deepEqual([...second].sort(), [...first].sort(), `${size} cards, seed ${seed}`);
    }
  }
});

test("hand placement is tidied even when it already has no crossings", () => {
  const boxes = [box("a", 0, 80, { x: 13 }), box("b", 400, 80, { x: 700 }), box("c", 150, 80, { x: 301 })];
  const places = tidy(boxes, [{ from: "a", to: "b" }, { from: "c", to: "b" }], { frame: FRAME });
  assert.equal(places.get("a")!.x, places.get("c")!.x);
});

test("the top left of the layout stays where it was", () => {
  const boxes = [box("a", 500, 80, { x: 900 }), box("b", 620, 80, { x: 900 }), box("c", 560, 80, { x: 1400 })];
  const places = tidy(boxes, [{ from: "a", to: "c" }, { from: "b", to: "c" }], { frame: FRAME });
  assert.equal(Math.min(...[...places.values()].map(({ x }) => x)), 900);
  assert.equal(Math.min(...[...places.values()].map(({ y }) => y)), 500);
});

test("separate arguments stay apart, and loose cards stay out of them", () => {
  const boxes = [box("a"), box("b"), box("c"), box("d"), box("loose")];
  const links = [{ from: "a", to: "b" }, { from: "c", to: "d" }];
  const placed = laidOut(boxes, tidy(boxes, links, { frame: FRAME }));
  const gapBetween = (one: Box, other: Box): number =>
    Math.max(one.x - (other.x + other.width), other.x - (one.x + one.width), one.y - (other.y + other.height), other.y - (one.y + one.height));
  assert.ok(gapBetween(placed.get("a")!, placed.get("c")!) >= 90);
  assert.ok(gapBetween(placed.get("a")!, placed.get("d")!) >= 90);
  assert.ok(gapBetween(placed.get("loose")!, placed.get("b")!) >= 90);
});

test("a note beside a card stays with it, and one on its own doesn't", () => {
  const boxes = [
    box("a", 0),
    box("claim", 300, 80, { x: 600 }),
    box("about", 390, 60, { x: 600, note: true }),
    box("elsewhere", 900, 60, { x: 1500, note: true }),
  ];
  const links = [{ from: "a", to: "claim" }];
  const places = tidy(boxes, links, { frame: FRAME });
  const [claim, about] = [places.get("claim")!, places.get("about")!];
  assert.equal(about.x, claim.x);
  assert.ok(about.y >= claim.y + 80 && about.y <= claim.y + 100);
  assert.equal(measure(laidOut(boxes, places), links, FRAME).overlaps, 0);
});

test("an argument of ten fits the usual frame at a readable zoom", () => {
  const scores = Array.from({ length: 6 }, (_, seed) => {
    const { cards, links } = argument(10, seed + 1);
    return qualityOf(cards, links).zoom;
  });
  assert.ok(scores.reduce((sum, zoom) => sum + zoom, 0) / scores.length >= 0.6, scores.join(", "));
});

test("tangled arguments stay readable, and quickly", () => {
  let [crossings, behind] = [0, 0];
  const started = performance.now();
  const rounds = 6;
  for (let seed = 1; seed <= rounds; seed += 1) {
    const { cards, links } = argument(30, seed);
    const quality = qualityOf(cards, links);
    assert.equal(quality.overlaps, 0);
    crossings += quality.crossings;
    behind += quality.behindCards;
  }
  assert.ok(crossings / rounds <= 5, `${crossings / rounds} crossings`);
  assert.ok(behind / rounds <= 8, `${behind / rounds} behind cards`);
  assert.ok((performance.now() - started) / rounds < 800, "too slow");
});

test("a large canvas still finishes", () => {
  const { cards, links } = argument(140, 1);
  const started = performance.now();
  const places = tidy(cards, links, { frame: FRAME });
  assert.equal(places.size, 140);
  assert.ok(performance.now() - started < 3000);
});
