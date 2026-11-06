// The arguments Tidy is judged on, and the layouts it's judged against.
import ELK from "elkjs";
import type { Frame, Link } from "@dg/layout/measure.ts";
import type { Box, Sides } from "@dg/layout/edges.ts";
// @ts-expect-error A plain script, shared with the seeding harness.
import { dataset } from "./matsulab.mjs";

export type Card = Box & { id: string };
export type Case = { name: string; group: string; cards: Card[]; links: Link[] };

const WIDTH = 240;
const heightOf = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));
export const FRAMES: Record<string, Frame> = { beside: { width: 725, height: 800 }, full: { width: 1300, height: 860 } };

// What people saw before: sides picked by slope alone.
export const sidesBefore: Sides = (from, to) => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) * 0.75 >= Math.abs(dy)) return dx >= 0 ? ["r", "l"] : ["l", "r"];
  return dy >= 0 ? ["b", "t"] : ["t", "b"];
};

const scatter = (cards: Omit<Card, "x" | "y">[]): Card[] =>
  cards.map((card, index) => ({ ...card, x: (index % 5) * 300, y: Math.floor(index / 5) * 140 }));

export const realCases = (): Case[] => {
  const { nodes, relations } = dataset() as {
    nodes: { key: string; type: string; content: string }[];
    relations: { relation: string; source: string; target: string }[];
  };
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const words: Record<string, string> = { supports: "supports", derived: "derived from", informs: "informs" };
  const asCase = (name: string, keys: Set<string>): Case => ({
    name,
    group: "real",
    cards: scatter([...keys].map((id) => ({ id, width: WIDTH, height: heightOf(byKey.get(id)!.content) }))),
    links: relations
      .filter(({ source, target }) => keys.has(source) && keys.has(target))
      .map(({ source, target, relation }) => ({ from: source, to: target, label: words[relation]! })),
  });
  const grow = (start: string, size: number): Set<string> => {
    const keys = new Set([start]);
    const queue = [start];
    while (queue.length > 0 && keys.size < size) {
      const key = queue.shift()!;
      for (const { source, target } of relations) {
        const other = source === key ? target : target === key ? source : null;
        if (other && !keys.has(other) && keys.size < size) {
          keys.add(other);
          queue.push(other);
        }
      }
    }
    return keys;
  };
  const cases: Case[] = [];
  for (const claim of nodes.filter((node) => node.type === "claim")) cases.push(asCase(`${claim.key} 12`, grow(claim.key, 12)));
  cases.push(asCase("whole graph", new Set(relations.flatMap(({ source, target }) => [source, target]))));
  return cases;
};

const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

/** Questions, the claims that answer them, evidence, sources and methods, with some shared. */
export const argument = (size: number, seed: number): Case => {
  const random = seeded(seed * 7919 + size);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const tiers: string[][] = [[], [], [], []];
  const cards: Omit<Card, "x" | "y">[] = [];
  const links: Link[] = [];
  const add = (tier: number): string => {
    const id = `n${String(cards.length).padStart(3, "0")}`;
    cards.push({ id, width: WIDTH, height: heightOf("x".repeat(30 + Math.floor(random() * 110))) });
    tiers[tier]!.push(id);
    return id;
  };
  const relate = (from: string, to: string, label: string): void => {
    if (from !== to && !links.some((link) => link.from === from && link.to === to)) links.push({ from, to, label });
  };
  add(3);
  while (cards.length < size) {
    const tier = random() < 0.5 ? 0 : random() < 0.6 ? 1 : random() < 0.75 ? 2 : 3;
    const id = add(tier);
    const above = tiers.slice(tier + 1).flat();
    if (above.length > 0) relate(id, pick(above), pick(["supports", "opposes", "informs"]));
    // Shared evidence is what makes real arguments tangle.
    if (random() < 0.45 && above.length > 1) relate(id, pick(above), pick(["supports", "opposes"]));
  }
  return { name: `${size} cards, seed ${seed}`, group: `generated ${size}`, cards: scatter(cards), links };
};

export const elkLayout = async (elk: InstanceType<typeof ELK>, { cards, links }: Case): Promise<Map<string, Box>> => {
  const laidOut = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "28",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.layered.crossingMinimization.thoroughness": "100",
      "elk.separateConnectedComponents": "true",
    },
    children: cards.map(({ id, width, height }) => ({ id, width, height })),
    edges: links.map(({ from, to }, index) => ({ id: `e${index}`, sources: [from], targets: [to] })),
  });
  return new Map((laidOut.children ?? []).map(({ id, x, y, width, height }) => [id, { x: x!, y: y!, width: width!, height: height! }]));
};

export const withSizes = (cards: Card[], places: Map<string, { x: number; y: number }>): Map<string, Box> =>
  new Map(cards.map(({ id, width, height }) => [id, { ...places.get(id)!, width, height }]));

/** The same argument with what the modes read: dates, types, contributors and relation kinds. */
export const dressed = (item: Case): { cards: (Card & { at: string; kind: { key: string; label: string }; credit: { key: string; label: string } })[]; links: (Link & { kind: string })[] } => {
  const random = seeded(item.cards.length * 31 + item.links.length);
  const people = ["Ana Ruiz", "Ben Okafor", "Chen Wei", "MATSU Lab"];
  const kinds = ["Evidence", "Claim", "Question", "Source"];
  const kindOf = new Map(item.cards.map((card) => {
    const reached = item.links.filter((link) => link.to === card.id).length;
    const leaving = item.links.filter((link) => link.from === card.id).length;
    return [card.id, leaving === 0 ? "Question" : reached === 0 ? (random() < 0.35 ? "Source" : "Evidence") : "Claim"];
  }));
  return {
    cards: item.cards.map((card, index) => ({
      ...card,
      at: new Date(Date.UTC(2025, Math.floor(random() * 3) * 5 + Math.floor(index / 8), 1 + Math.floor(random() * 27))).toISOString(),
      kind: { key: kindOf.get(card.id)!, label: kindOf.get(card.id)! },
      credit: { key: people[Math.floor(random() * people.length)]!, label: people[Math.floor(random() * people.length)]! },
    })).map((card) => ({ ...card, credit: { key: card.credit.key, label: card.credit.key } })),
    links: item.links.map((link) => ({ ...link, kind: link.label === "opposes" ? "opposes" : link.label === "informs" ? "derivedFrom" : "supports" })),
  };
};
