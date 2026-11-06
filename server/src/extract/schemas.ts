import type { Graph } from '../types.ts';

export const SCHEMAS = [
  {
    id: 'mira',
    label: 'MIRA',
    description: 'Types: Question, Claim, Evidence, Study, Protocol, SourceDocument, Request. Relations: supports, opposes, addresses, grounds, follows, describesActivity, request_target.',
    default: true,
  },
  {
    id: 'discourse-graph',
    label: 'Discourse Graph',
    description: 'Types: Question, Claim, Evidence, Source. Relations: supports, opposes, addresses, informs, derivedFrom.',
  },
];

const TYPE_MAP = new Map([
  ['Study', 'Source'],
  ['Protocol', 'Source'],
  ['SourceDocument', 'Source'],
  ['Request', 'Question'],
]);

// In MIRA output, a Study grounds Evidence, a Study follows a Protocol, and a
// SourceDocument describes the activity of a Study. Evidence comes out of a study,
// so `grounds` turns around to read "Evidence derivedFrom Source". A study is built
// on its protocol, so `follows` keeps its direction as derivedFrom. A document only
// tells us about a study, so `describesActivity` becomes the weaker `informs`.
const RELATION_MAP = new Map([
  ['grounds', { relation: 'derivedFrom', flip: true }],
  ['follows', { relation: 'derivedFrom', flip: false }],
  ['describesActivity', { relation: 'informs', flip: false }],
  ['request_target', { relation: 'addresses', flip: false }],
]);

export function toSchema(graph: Graph, schema: string): Graph {
  if (schema !== 'discourse-graph') return graph;
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, type: TYPE_MAP.get(node.type) ?? node.type })),
    edges: graph.edges.map((edge) => {
      const mapped = RELATION_MAP.get(edge.relation);
      if (!mapped) return edge;
      const ends = mapped.flip ? { subject: edge.object, object: edge.subject } : {};
      return { ...edge, ...ends, relation: mapped.relation };
    }),
  };
}
