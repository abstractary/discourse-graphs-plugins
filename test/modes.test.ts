import assert from "node:assert/strict";
import test from "node:test";
import { arrange, leaningOf, type Card, type RelationLink } from "@dg/layout/modes.ts";
import { scoreLabel, scoresFor } from "@dg/layout/centrality.ts";
import { measure } from "@dg/layout/measure.ts";
import { argument, dressed } from "../harness/tidy-cases.ts";
import { TIDY_MODES } from "@dg/contract/records.ts";

const FRAME = { width: 725, height: 800 };
const card = (id: string, extra: Partial<Card> = {}): Card => ({ id, x: 0, y: 0, width: 240, height: 80, ...extra });
const xOf = (places: Map<string, { x: number; y: number }>, id: string): number => places.get(id)!.x;

test("a thing sits right of what it's derived from, whichever way the arrow runs", () => {
  const boxes = [card("result"), card("experiment"), card("protocol")];
  const links: RelationLink[] = [
    { from: "result", to: "experiment", kind: "derivedFrom" },
    { from: "experiment", to: "protocol", kind: "derivedFrom" },
  ];
  const { places, guides } = arrange({ mode: "logic", boxes, links, frame: FRAME });
  assert.ok(xOf(places, "protocol") < xOf(places, "experiment"));
  assert.ok(xOf(places, "experiment") < xOf(places, "result"));
  assert.equal(guides.length, 0);
});

test("logic keeps opposition beside support, and debate puts it on the far side", () => {
  const boxes = [card("claim"), card("for"), card("against")];
  const links: RelationLink[] = [
    { from: "for", to: "claim", kind: "supports" },
    { from: "against", to: "claim", kind: "opposes" },
  ];
  const logic = arrange({ mode: "logic", boxes, links, frame: FRAME }).places;
  assert.ok(xOf(logic, "against") < xOf(logic, "claim"));
  assert.equal(xOf(logic, "against"), xOf(logic, "for"));
  const debate = arrange({ mode: "debate", boxes, links, frame: FRAME }).places;
  assert.ok(xOf(debate, "for") < xOf(debate, "claim"));
  assert.ok(xOf(debate, "claim") < xOf(debate, "against"));
});

test("changing mode rearranges a canvas that was already tidy", () => {
  const links: RelationLink[] = [
    { from: "for", to: "claim", kind: "supports" },
    { from: "against", to: "claim", kind: "opposes" },
  ];
  const start = [card("claim"), card("for"), card("against")];
  const logic = arrange({ mode: "logic", boxes: start, links, frame: FRAME, previous: "logic" }).places;
  const placed = start.map((box) => ({ ...box, ...logic.get(box.id)! }));
  const debate = arrange({ mode: "debate", boxes: placed, links, frame: FRAME, previous: "logic" }).places;
  assert.ok(xOf(debate, "claim") < xOf(debate, "against"));
  const again = arrange({ mode: "debate", boxes: placed.map((box) => ({ ...box, ...debate.get(box.id)! })), links, frame: FRAME, previous: "debate" }).places;
  assert.deepEqual([...again].sort(), [...debate].sort());
});

test("turning a link leaves what it says alone", () => {
  const [turned] = leaningOf([{ from: "a", to: "b", kind: "derivedFrom", label: "derived from" }], false);
  assert.deepEqual(turned, { from: "b", to: "a", kind: "derivedFrom", label: "derived from" });
  const [kept] = leaningOf([{ from: "a", to: "b", kind: "supports" }], true);
  assert.deepEqual(kept, { from: "a", to: "b", kind: "supports" });
});

test("timeline runs oldest to newest, drops empty periods and says how long they were", () => {
  const boxes = [
    card("old", { at: "2024-01-10T00:00:00Z" }),
    card("older", { at: "2024-01-02T00:00:00Z" }),
    card("new", { at: "2024-09-20T00:00:00Z" }),
    card("undated", { note: true, x: 4000, y: 4000 }),
  ];
  const { places, guides } = arrange({ mode: "timeline", boxes, links: [], frame: FRAME });
  assert.ok(xOf(places, "older") < xOf(places, "old"));
  assert.ok(xOf(places, "old") < xOf(places, "new"));
  assert.equal(guides.length, 4);
  assert.match(guides[2]!.label, /8 months later/);
  assert.equal(guides[3]!.label, "No date");
});

test("cards from one period stack in time order", () => {
  const boxes = Array.from({ length: 20 }, (_, index) => card(`c${index}`, { at: `2024-0${(index % 2) * 5 + 1}-${String(28 - index).padStart(2, "0")}T00:00:00Z` }));
  const { places, guides } = arrange({ mode: "timeline", boxes, links: [], frame: FRAME });
  assert.ok(guides.length <= 8);
  assert.ok(places.get("c2")!.y > places.get("c4")!.y);
});

test("a canvas made in a day gets one column, not a stretched axis", () => {
  const boxes = [card("a", { at: "2026-11-06T09:00:00Z" }), card("b", { at: "2026-11-06T17:00:00Z" })];
  const { guides } = arrange({ mode: "timeline", boxes, links: [], frame: FRAME });
  assert.equal(guides.length, 1);
});

test("kinds and people label a region for each group, in the argument's order", () => {
  const boxes = [
    card("e", { kind: { key: "e", label: "Evidence" }, credit: { key: "ana", label: "Ana" } }),
    card("c", { kind: { key: "c", label: "Claim" }, credit: { key: "ana", label: "Ana" } }),
    card("q", { kind: { key: "q", label: "Question" }, credit: { key: "lab", label: "MATSU Lab" } }),
  ];
  const links: RelationLink[] = [{ from: "e", to: "c", kind: "supports" }, { from: "c", to: "q", kind: "addresses" }];
  const kinds = arrange({ mode: "kinds", boxes, links, frame: FRAME });
  assert.deepEqual(kinds.guides.map(({ label }) => label), ["Evidence", "Claim", "Question"]);
  const people = arrange({ mode: "people", boxes, links, frame: FRAME });
  assert.deepEqual(people.guides.map(({ label }) => label), ["Ana", "MATSU Lab"]);
  assert.ok(xOf(people.places, "q") > xOf(people.places, "e"));
});

test("focus puts grounds left, consequences right, and everything else apart", () => {
  const boxes = ["ground", "focus", "next", "sibling", "stranger"].map((id) => card(id));
  const links: RelationLink[] = [
    { from: "ground", to: "focus", kind: "supports" },
    { from: "focus", to: "next", kind: "informs" },
    { from: "ground", to: "sibling", kind: "supports" },
  ];
  const { places, guides } = arrange({ mode: "focus", boxes, links, frame: FRAME, focus: "focus" });
  assert.ok(xOf(places, "ground") < xOf(places, "focus"));
  assert.ok(xOf(places, "focus") < xOf(places, "next"));
  assert.notEqual(xOf(places, "sibling"), xOf(places, "focus"));
  assert.ok(guides.some(({ label }) => label === "Not linked to this card"));
});

test("centrality finds the hub, the bridge and what the argument rests on", () => {
  const ids = ["a", "b", "hub", "bridge", "c", "d", "root"];
  const links = [
    { from: "a", to: "hub" },
    { from: "b", to: "hub" },
    { from: "root", to: "hub" },
    { from: "hub", to: "bridge" },
    { from: "bridge", to: "c" },
    { from: "c", to: "d" },
  ];
  const top = (scores: Map<string, number>): string => [...scores].sort(([, a], [, b]) => b - a)[0]![0];
  assert.equal(top(scoresFor("connected", ids, links)), "hub");
  assert.equal(scoresFor("connected", ids, links).get("hub"), 4);
  assert.equal(top(scoresFor("bridges", ids, links)), "hub");
  assert.ok(scoresFor("bridges", ids, links).get("bridge")! > scoresFor("bridges", ids, links).get("c")!);
  assert.equal(scoresFor("bridges", ids, links).get("a"), 0);
  const load = scoresFor("load", ids, links);
  assert.ok(Math.abs([...load.values()].reduce((sum, score) => sum + score, 0) - 1) < 1e-6);
  assert.ok(load.get("a")! > load.get("d")!, "what comes first bears the most");
  assert.equal(scoreLabel("connected", 1), "1 link");
  assert.equal(scoreLabel("bridges", 0.314), "31%");
});

test("ranked modes put the highest first, and cards with no links apart", () => {
  const boxes = ["a", "b", "hub", "alone"].map((id) => card(id));
  const links: RelationLink[] = [{ from: "a", to: "hub" }, { from: "b", to: "hub" }];
  const { places, guides } = arrange({ mode: "connected", boxes, links, frame: FRAME });
  assert.ok(xOf(places, "hub") < xOf(places, "a"));
  assert.equal(guides[0]!.label, "Most connected");
  assert.equal(guides[guides.length - 1]!.label, "No links");
});

test("every mode lays out a real-sized argument with no overlaps, and the same way twice", () => {
  const { cards, links } = dressed(argument(24, 2));
  for (const mode of TIDY_MODES) {
    const args = { mode, boxes: cards, links, frame: FRAME, focus: cards[5]!.id };
    const first = arrange(args);
    const boxes = new Map(cards.map(({ id, width, height }) => [id, { ...first.places.get(id)!, width, height }]));
    assert.equal(measure(boxes, links, FRAME).overlaps, 0, mode);
    assert.deepEqual([...arrange(args).places].sort(), [...first.places].sort(), mode);
  }
});

test("guides hold every card, and they stay level", () => {
  const { cards, links } = dressed(argument(20, 4));
  const { places, guides } = arrange({ mode: "kinds", boxes: cards, links, frame: FRAME });
  assert.equal(new Set(guides.map(({ y }) => y)).size, 1);
  for (const { id, width, height } of cards) {
    const { x, y } = places.get(id)!;
    const home = guides.filter((guide) => x >= guide.x && x + width <= guide.x + guide.width && y >= guide.y && y + height <= guide.y + guide.height);
    assert.equal(home.length, 1, id);
  }
});
