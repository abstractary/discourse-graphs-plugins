import { standsFor } from "./work.ts";
import type { CanvasItem, CanvasRecord, DgId, FoldedGraph as Graph, NodeRecord, PaperRecord } from "@dg/contract/records.ts";
import { PDF_CANVAS_FIXED } from "@dg/contract/surface.ts";

/**
 * A PDF canvas is one reading of one paper. It can be polished, and it can't
 * drift into being someone's own argument: everything on it comes from that
 * paper. A unit read from the paper can be reworded, retyped, related to
 * another of the paper's units, or taken off. A new unit joins by being
 * highlighted in the paper's own PDF. Units from anywhere else, stickies and
 * drawings are refused, and belong on a canvas built on this one. The headings
 * Tidy draws round groups of cards are allowed: they arrange, and add nothing.
 */

/** The paper a canvas is the reading of, when it is a PDF canvas. */
export const readingOf = (graph: Graph, canvas: DgId): PaperRecord | undefined => {
  const record = graph.documents.get(canvas) as CanvasRecord | undefined;
  if (record?.kind !== "canvas" || !record.paper) return undefined;
  const paper = graph.documents.get(record.paper);
  return paper?.kind === "paper" ? paper : undefined;
};

const unitAt = (graph: Graph, id: DgId | undefined): NodeRecord | undefined => {
  const record = id ? graph.documents.get(id) : undefined;
  return record?.kind === "node" ? record : undefined;
};

/** True for a unit a model read from this paper, and for one a person highlighted in this paper's file. */
export const ofPaper = (graph: Graph, node: NodeRecord, paper: PaperRecord): boolean => {
  if (node.source?.paper === paper.id) return true;
  const source = unitAt(graph, node.facts?.anchor?.source) ?? unitAt(graph, node.prov?.sourceDocument);
  if (!source) return false;
  return standsFor(source, paper);
};

export const refusal = (paper: PaperRecord): Error =>
  new Error(`${PDF_CANVAS_FIXED}. Everything on it comes from ${paper.filename}: reword a card, or highlight in the PDF to add one. For anything else, build on it in a canvas of your own.`);

/** Refuses a unit that isn't this paper's on a PDF canvas. */
export const mustBeOfPaper = (graph: Graph, canvas: DgId, units: DgId[]): void => {
  const paper = readingOf(graph, canvas);
  if (!paper) return;
  for (const id of units) {
    const node = unitAt(graph, id);
    if (!node || !ofPaper(graph, node, paper)) throw refusal(paper);
  }
};

type Held = { dg?: { node?: DgId; relation?: DgId; canvas?: DgId }; fromNode?: DgId };

/** Whether a PDF canvas may take this new item: a card of one of the paper's units, or a relation between two of them. */
export const mayJoin = (graph: Graph, paper: PaperRecord, item: object): boolean => {
  const { dg } = item as Held;
  // A heading Tidy draws round a group of cards says how they are arranged. It adds nothing to what the paper says.
  const drawn = item as { type?: string; guide?: boolean };
  if (drawn.guide === true && drawn.type === "group" && !dg) return true;
  if (dg?.node) {
    const node = unitAt(graph, dg.node);
    return Boolean(node && ofPaper(graph, node, paper));
  }
  if (dg?.relation) {
    const relation = graph.relations.get(dg.relation)?.record;
    const ends = relation ? [unitAt(graph, relation.source), unitAt(graph, relation.target)] : [];
    return ends.length === 2 && ends.every((node) => node && ofPaper(graph, node, paper));
  }
  return false;
};

/** Whether a change to an item already on a PDF canvas keeps it the same thing: moved, resized or retitled, never repointed. */
export const sameThing = (before: CanvasItem, after: object): boolean => {
  const key = ({ dg, fromNode }: Held, edge = Boolean(fromNode)): string => JSON.stringify([edge, dg?.node ?? null, dg?.relation ?? null, dg?.canvas ?? null]);
  return key(before as Held) === key(after as Held);
};
