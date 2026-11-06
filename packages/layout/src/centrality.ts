import type { Link } from "./measure.ts";

/**
 * Three questions about a network, each with its own standard measure. Scores
 * cover the links on this canvas, because that's the argument in front of you.
 */
export type Measure = "connected" | "bridges" | "load";

const neighborsOf = (ids: string[], links: Link[]): Map<string, Set<string>> => {
  const around = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const { from, to } of links) {
    if (from === to || !around.has(from) || !around.has(to)) continue;
    around.get(from)!.add(to);
    around.get(to)!.add(from);
  }
  return around;
};

/** Degree: how many cards this one touches. */
const connections = (ids: string[], links: Link[]): Map<string, number> =>
  new Map([...neighborsOf(ids, links)].map(([id, around]) => [id, around.size]));

/**
 * Betweenness, by Brandes' algorithm: the share of shortest paths between other
 * cards that run through this one. A high score joins parts of an argument
 * that would otherwise come apart.
 */
const bridging = (ids: string[], links: Link[]): Map<string, number> => {
  const around = neighborsOf(ids, links);
  const scores = new Map(ids.map((id) => [id, 0]));
  for (const start of ids) {
    const order: string[] = [];
    const before = new Map(ids.map((id) => [id, [] as string[]]));
    const paths = new Map(ids.map((id) => [id, 0]));
    const distance = new Map(ids.map((id) => [id, -1]));
    paths.set(start, 1);
    distance.set(start, 0);
    const queue = [start];
    while (queue.length > 0) {
      const here = queue.shift()!;
      order.push(here);
      for (const next of around.get(here)!) {
        if (distance.get(next)! < 0) {
          distance.set(next, distance.get(here)! + 1);
          queue.push(next);
        }
        if (distance.get(next) === distance.get(here)! + 1) {
          paths.set(next, paths.get(next)! + paths.get(here)!);
          before.get(next)!.push(here);
        }
      }
    }
    const share = new Map(ids.map((id) => [id, 0]));
    for (const here of order.reverse()) {
      for (const earlier of before.get(here)!) {
        const part = (paths.get(earlier)! / paths.get(here)!) * (1 + share.get(here)!);
        share.set(earlier, share.get(earlier)! + part);
      }
      if (here !== start) scores.set(here, scores.get(here)! + share.get(here)!);
    }
  }
  // Each pair was counted from both ends. Dividing by every possible pair gives a share.
  const pairs = Math.max(1, (ids.length - 1) * (ids.length - 2));
  return new Map([...scores].map(([id, score]) => [id, score / pairs]));
};

const DAMPING = 0.85;
const ROUNDS = 60;

/**
 * PageRank with the arrows turned around: weight flows from a card to what it
 * rests on. A high score means a lot of the argument would fall with this card.
 * Links must already run from what's relied on to what relies on it.
 */
const bearing = (ids: string[], links: Link[]): Map<string, number> => {
  const restsOn = new Map(ids.map((id) => [id, [] as string[]]));
  for (const { from, to } of links) {
    if (from !== to && restsOn.has(from) && restsOn.has(to)) restsOn.get(to)!.push(from);
  }
  let scores = new Map(ids.map((id) => [id, 1 / ids.length]));
  for (let round = 0; round < ROUNDS; round += 1) {
    const next = new Map(ids.map((id) => [id, (1 - DAMPING) / ids.length]));
    let spare = 0;
    for (const id of ids) {
      const share = scores.get(id)!;
      const grounds = restsOn.get(id)!;
      if (grounds.length === 0) spare += share;
      else for (const ground of grounds) next.set(ground, next.get(ground)! + (DAMPING * share) / grounds.length);
    }
    for (const id of ids) next.set(id, next.get(id)! + (DAMPING * spare) / ids.length);
    scores = next;
  }
  return scores;
};

export const scoresFor = (measure: Measure, ids: string[], links: Link[]): Map<string, number> => {
  if (ids.length === 0) return new Map();
  if (measure === "connected") return connections(ids, links);
  return measure === "bridges" ? bridging(ids, links) : bearing(ids, links);
};

/** What a card shows beside its title in these modes. */
export const scoreLabel = (measure: Measure, score: number): string => {
  if (measure === "connected") return `${score} ${score === 1 ? "link" : "links"}`;
  return `${Math.round(score * 100)}%`;
};
