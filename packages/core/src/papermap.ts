import { inLibraryOf, paperIdentifiers } from "./card.ts";
import { isCanvasEdge, type CanvasItem, type CanvasRecord, type DgId, type FoldedGraph, type NodeRecord, type PaperRecord } from "@dg/contract/records.ts";
import type { PaperMap, PaperMapLink, PaperMapPaper, PaperMapTie, PaperScope, PaperScopeChoice } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { paperLabel } from "./papers.ts";
import { keyOfPaper, keyOfSource, paperOfWork, sameWork } from "./work.ts";

/**
 * Papers laid out by how far they have been worked into each other.
 *
 * Two papers are tied by what people did and by what the papers say: a
 * relation someone drew between a unit of one and a unit of the other, and
 * one paper citing the other. Nothing is guessed from wording. The more two
 * papers are tied, the closer they sit; a paper tied to nothing sits apart.
 *
 * A scope decides whose work counts: one canvas, the person's own workspace,
 * a lab's, or everything this device holds. The same papers can sit close in
 * one scope and far apart in another, and that difference is the point.
 */

export type PaperMapInput = {
  graph: FoldedGraph;
  me: string;
  /** The lab the person is in, if any. */
  lab?: { did: string; name: string };
  scope: PaperScope;
};

const CARD = { width: 232, height: 104 };
/** How much one citation counts beside drawn links. A citation is the paper's own doing, and nobody here weighed it. */
const CITATION = 0.75;

type Held = { type?: string; dg?: { node?: DgId; relation?: DgId } };

/** How tied two papers are, from 0 to 1. Each further link adds less than the one before. */
export const tieStrength = ({ links, cites }: { links: number; cites: number }): number => {
  const raw = Math.log2(1 + links) + CITATION * cites;
  return raw / (1 + raw);
};

const stanceOf = (tie: { supports: number; opposes: number; other: number; cites: PaperMapTie["cites"] }): PaperMapTie["stance"] =>
  tie.supports && tie.opposes ? "mixed" : tie.supports ? "agree" : tie.opposes ? "conflict" : tie.other ? "linked" : "cites";

/** Readings of one work, however many times it was read, count as one paper: the newest stands for them. */
const oneEach = (papers: PaperRecord[]): Map<DgId, PaperRecord> => {
  const newest = [...papers].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const stands = new Map<DgId, PaperRecord>();
  const kept: PaperRecord[] = [];
  for (const paper of newest) {
    const same = kept.find((other) => sameWork(keyOfPaper(other), keyOfPaper(paper)) === "identifier");
    stands.set(paper.id, same ?? paper);
    if (!same) kept.push(paper);
  }
  return stands;
};

/** The canvases a scope covers. `null` is every canvas there is. */
const canvasesOf = ({ graph, me, scope }: PaperMapInput): Set<DgId> | null => {
  if (scope.kind === "everyone") return null;
  const canvases = [...graph.documents.values()].filter((record): record is CanvasRecord => record.kind === "canvas" && !record.removed);
  if (scope.kind === "canvas") return new Set(canvases.filter(({ id }) => id === scope.id).map(({ id }) => id));
  if (scope.kind === "lab") return new Set(canvases.filter((canvas) => canvas.shared === scope.id).map(({ id }) => id));
  return new Set(canvases.filter((canvas) => !canvas.shared && canvas.by.id === me).map(({ id }) => id));
};

/** Places every paper. Tied papers pull together by how tied they are, and everything else keeps its distance. */
export const layOut = (ids: DgId[], given: { a: DgId; b: DgId; strength: number }[]): Map<DgId, { x: number; y: number }> => {
  // One order whatever order they came in, so the sums below always add up the same way.
  const ties = given.map(({ a, b, strength }) => (a < b ? { a, b, strength } : { a: b, b: a, strength })).sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const tied = new Set(ties.flatMap(({ a, b }) => [a, b]));
  const inside = ids.filter((id) => tied.has(id)).sort();
  const apart = ids.filter((id) => !tied.has(id)).sort();
  const at = new Map<DgId, { x: number; y: number }>();
  // A fixed start, so the same papers and ties always give the same picture.
  const radius = 150 * Math.sqrt(Math.max(1, inside.length));
  inside.forEach((id, index) => {
    const angle = (2 * Math.PI * index) / inside.length;
    at.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
  });
  const REST = 330;
  for (let step = 0; step < 320; step++) {
    const heat = 60 * (1 - step / 320) + 1;
    const push = new Map(inside.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        const p = at.get(inside[i]!)!, q = at.get(inside[j]!)!;
        const dx = p.x - q.x, dy = p.y - q.y, d = Math.max(1, Math.hypot(dx, dy));
        const force = (REST * REST) / d / 6;
        push.get(inside[i]!)!.x += (dx / d) * force;
        push.get(inside[i]!)!.y += (dy / d) * force;
        push.get(inside[j]!)!.x -= (dx / d) * force;
        push.get(inside[j]!)!.y -= (dy / d) * force;
      }
    }
    for (const { a, b, strength } of ties) {
      const p = at.get(a)!, q = at.get(b)!;
      const dx = p.x - q.x, dy = p.y - q.y, d = Math.max(1, Math.hypot(dx, dy));
      // The closest two papers can sit is a card and a gap; the weakest tie rests about three cards away.
      const rest = 280 + (1 - strength) * 460;
      const force = (d - rest) * (0.5 + 1.5 * strength);
      push.get(a)!.x -= (dx / d) * force;
      push.get(a)!.y -= (dy / d) * force;
      push.get(b)!.x += (dx / d) * force;
      push.get(b)!.y += (dy / d) * force;
    }
    for (const id of inside) {
      const p = at.get(id)!, f = push.get(id)!;
      f.x -= p.x * 0.02;
      f.y -= p.y * 0.02;
      const size = Math.max(1, Math.hypot(f.x, f.y));
      p.x += (f.x / size) * Math.min(size, heat);
      p.y += (f.y / size) * Math.min(size, heat);
    }
  }
  // No card covers another.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        const p = at.get(inside[i]!)!, q = at.get(inside[j]!)!;
        const overX = CARD.width + 28 - Math.abs(p.x - q.x), overY = CARD.height + 28 - Math.abs(p.y - q.y);
        if (overX <= 0 || overY <= 0) continue;
        moved = true;
        if (overX < overY) {
          const shift = (overX / 2) * (p.x >= q.x ? 1 : -1);
          p.x += shift;
          q.x -= shift;
        } else {
          const shift = (overY / 2) * (p.y >= q.y ? 1 : -1);
          p.y += shift;
          q.y -= shift;
        }
      }
    }
    if (!moved) break;
  }
  const xs = inside.map((id) => at.get(id)!.x), ys = inside.map((id) => at.get(id)!.y);
  const left = inside.length ? Math.min(...xs) : 0, top = inside.length ? Math.min(...ys) : 0;
  for (const id of inside) {
    const p = at.get(id)!;
    at.set(id, { x: Math.round(p.x - left), y: Math.round(p.y - top) });
  }
  // Papers tied to nothing wait in rows underneath, in a steady order.
  const floor = inside.length ? Math.round(Math.max(...ys) - top) + CARD.height + 120 : 0;
  const width = Math.max(inside.length ? Math.max(...xs) - left + CARD.width : 0, 4 * (CARD.width + 28));
  const across = Math.max(1, Math.floor(width / (CARD.width + 28)));
  apart.forEach((id, index) => at.set(id, { x: (index % across) * (CARD.width + 28), y: floor + Math.floor(index / across) * (CARD.height + 28) }));
  return at;
};

export const paperMap = (input: PaperMapInput): PaperMap => {
  const { graph, scope, me } = input;
  const docs = [...graph.documents.values()];
  const papers = docs.filter((record): record is PaperRecord => record.kind === "paper" && !("removed" in record && record.removed));
  const stands = oneEach(papers);
  const paperOf = (id: DgId | undefined): PaperRecord | undefined => (id ? stands.get(id) : undefined);
  const nodes = docs.filter((record): record is NodeRecord => record.kind === "node" && !record.removed);
  const nodeAt = new Map(nodes.map((node) => [node.id, node]));
  const baseOf = (node: NodeRecord): string | undefined => {
    const type = node.type ? graph.documents.get(node.type) : undefined;
    return type?.kind === "node-type" ? type.base : undefined;
  };
  const abbreviationOf = (node: NodeRecord): string | undefined => {
    const type = node.type ? graph.documents.get(node.type) : undefined;
    return type?.kind === "node-type" ? type.abbreviation : undefined;
  };

  // Which paper a unit belongs to. A source a paper cites belongs to the work it names, when that work was read too.
  const citations: { from: PaperRecord; to: PaperRecord; source: NodeRecord }[] = [];
  const owner = new Map<DgId, PaperRecord>();
  for (const node of nodes) {
    const read = paperOf(node.source?.paper);
    if (baseOf(node) === "source") {
      if (read && node.source?.own) owner.set(node.id, read);
      else {
        const others = papers.filter((paper) => stands.get(paper.id) !== read);
        const names = others.find((paper) => sameWork(keyOfPaper(paper), keyOfSource(node)) !== null);
        const named = names ? stands.get(names.id) : !read ? paperOf(paperOfWork(papers, node)?.id) : undefined;
        if (named) owner.set(node.id, named);
        if (read && named && named !== read) citations.push({ from: read, to: named, source: node });
      }
      continue;
    }
    if (read) {
      owner.set(node.id, read);
      continue;
    }
    // A unit a person highlighted in a paper's file belongs to that paper.
    const from = nodeAt.get((node.facts?.anchor?.source ?? node.prov?.sourceDocument) as DgId);
    const held = from ? paperOf(paperOfWork(papers, from)?.id) : undefined;
    if (held) owner.set(node.id, held);
  }

  // What the scope covers: its canvases, the units carded on them, and the relations drawn on them.
  const canvases = canvasesOf(input);
  const carded = new Set<DgId>();
  const drawn = new Set<DgId>();
  const drawnAnywhere = new Set<DgId>();
  for (const record of docs) {
    if (record.kind !== "canvas-item" || record.removed) continue;
    const item = record.item as CanvasItem & Held;
    const here = !canvases || canvases.has(record.canvas);
    if (isCanvasEdge(item)) {
      if (item.dg?.relation) {
        drawnAnywhere.add(item.dg.relation);
        if (here) drawn.add(item.dg.relation);
      }
    } else if (here && item.dg?.node) carded.add(item.dg.node);
  }
  const shown = new Map<DgId, PaperRecord>();
  for (const paper of papers) {
    const one = stands.get(paper.id)!;
    if (!canvases || canvases.has(paper.canvas)) shown.set(one.id, one);
  }
  if (canvases) for (const unit of carded) if (owner.has(unit)) shown.set(owner.get(unit)!.id, owner.get(unit)!);

  type Tie = { a: DgId; b: DgId; supports: number; opposes: number; other: number; ab: number; ba: number; links: PaperMapLink[] };
  const ties = new Map<string, Tie>();
  const tieOf = (x: DgId, y: DgId): Tie => {
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}|${b}`;
    if (!ties.has(key)) ties.set(key, { a, b, supports: 0, opposes: 0, other: 0, ab: 0, ba: 0, links: [] });
    return ties.get(key)!;
  };
  const unitOf = (node: NodeRecord, paper: PaperRecord): PaperMapLink["from"] => ({
    id: node.id,
    title: node.title,
    paper: paper.id,
    ...(abbreviationOf(node) ? { abbreviation: abbreviationOf(node)! } : {}),
    ...(baseOf(node) ? { base: baseOf(node)! } : {}),
  });
  const reaching = new Map<DgId, Set<DgId>>();
  const reach = (paper: DgId, unit: DgId) => reaching.set(paper, (reaching.get(paper) ?? new Set()).add(unit));

  for (const { record, state } of graph.relations.values()) {
    if (state === "withdrawn" || state === "rejected" || record.proposed) continue;
    // A relation nobody drew anywhere belongs to its author's own workspace, and to everyone.
    const inScope = !canvases || drawn.has(record.id) || (scope.kind === "own" && !drawnAnywhere.has(record.id) && record.by.id === input.me);
    if (!inScope) continue;
    const from = nodeAt.get(record.source), to = nodeAt.get(record.target);
    const p = from ? owner.get(from.id) : undefined, q = to ? owner.get(to.id) : undefined;
    if (!from || !to || !p || !q || p === q || !shown.has(p.id) || !shown.has(q.id)) continue;
    const type = graph.documents.get(record.type);
    const base = type?.kind === "relation-type" ? type.base : undefined;
    const tie = tieOf(p.id, q.id);
    if (base === "supports") tie.supports += 1;
    else if (base === "opposes") tie.opposes += 1;
    else tie.other += 1;
    tie.links.push({ relation: record.id, label: type?.kind === "relation-type" ? type.label : "Related to", ...(base === "supports" || base === "opposes" ? { stance: base } : {}), from: unitOf(from, p), to: unitOf(to, q) });
    reach(p.id, from.id);
    reach(q.id, to.id);
  }
  // A citation is a fact about the two papers, so it counts in every scope that shows both.
  const cited = new Set<string>();
  for (const { from, to } of citations) {
    if (!shown.has(from.id) || !shown.has(to.id) || cited.has(`${from.id}>${to.id}`)) continue;
    cited.add(`${from.id}>${to.id}`);
    const tie = tieOf(from.id, to.id);
    if (tie.a === from.id) tie.ab = 1;
    else tie.ba = 1;
  }

  const told: PaperMapTie[] = [...ties.values()]
    .map((tie) => {
      const cites: PaperMapTie["cites"] = tie.ab && tie.ba ? "both" : tie.ab ? "a-b" : tie.ba ? "b-a" : undefined;
      const count = { supports: tie.supports, opposes: tie.opposes, other: tie.other };
      return {
        a: tie.a,
        b: tie.b,
        strength: Math.round(tieStrength({ links: tie.supports + tie.opposes + tie.other, cites: tie.ab + tie.ba }) * 1000) / 1000,
        ...count,
        ...(cites ? { cites } : {}),
        stance: stanceOf({ ...count, cites }),
        links: tie.links.slice(0, 40),
      };
    })
    .sort((x, y) => y.strength - x.strength || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const places = layOut([...shown.keys()], told);
  const unitCount = new Map<DgId, number>();
  for (const [unit, paper] of owner) if (baseOf(nodeAt.get(unit)!) !== "source") unitCount.set(paper.id, (unitCount.get(paper.id) ?? 0) + 1);
  const ownSource = (paper: PaperRecord): string => nodes.find((node) => node.source?.own && paperOf(node.source.paper) === paper)?.title ?? "";
  const told2: PaperMapPaper[] = [...shown.values()]
    .map((paper) => {
      const mine = told.filter((tie) => tie.a === paper.id || tie.b === paper.id);
      return {
        id: paper.id,
        title: paper.title,
        label: paperLabel(paper, ownSource(paper)),
        ...(inLibraryOf(paperIdentifiers(paper), paper.by, me) ? { library: inLibraryOf(paperIdentifiers(paper), paper.by, me)! } : {}),
        canvas: paper.canvas,
        units: unitCount.get(paper.id) ?? 0,
        reaching: reaching.get(paper.id)?.size ?? 0,
        tiedTo: mine.length,
        weight: Math.round(mine.reduce((sum, tie) => sum + tie.strength, 0) * 1000) / 1000,
        ...places.get(paper.id)!,
        ...(mine.length ? {} : { apart: true as const }),
      };
    })
    .sort((x, y) => y.weight - x.weight || x.label.localeCompare(y.label) || x.id.localeCompare(y.id));

  return { scope, papers: told2, ties: told, card: CARD };
};

export const paperMapFeature = (context: Context): { handlers: Pick<Handlers, "papers.map" | "papers.show"> } => {
  const labOf = () => {
    const lab = context.myLab();
    return lab ? { did: lab.did, name: lab.name } : undefined;
  };
  return {
    handlers: {
      "papers.map": async ({ scope }) => {
        const lab = labOf();
        const canvas = scope?.kind === "canvas" ? context.canvasOf(scope.id) : undefined;
        // A scope that isn't there any more falls back to the person's own workspace.
        const wanted: PaperScope = scope?.kind === "canvas" ? (canvas ? scope : { kind: "own" }) : scope?.kind === "lab" ? (lab && lab.did === scope.id ? scope : { kind: "own" }) : (scope ?? { kind: "own" });
        const scopes: PaperScopeChoice[] = [
          ...(wanted.kind === "canvas" && canvas ? [{ scope: wanted, label: canvas.title, hint: "This canvas alone" }] : []),
          { scope: { kind: "own" as const }, label: "Only you", hint: "Your own workspace" },
          ...(lab ? [{ scope: { kind: "lab" as const, id: lab.did }, label: lab.name, hint: "The lab's workspace" }] : []),
          { scope: { kind: "everyone" as const }, label: "Everyone", hint: "Everything this device holds" },
        ];
        return { ...paperMap({ graph: context.graph(), me: context.me().id, ...(lab ? { lab } : {}), scope: wanted }), scopes };
      },
      "papers.show": async ({ canvas }) => {
        const opened = await context.host.openSurface({ route: { surface: "papers", ...(canvas ? { id: canvas } : {}) }, placement: "main" });
        if (!opened.ok) throw new Error(opened.error.message);
        return null;
      },
    },
  };
};
