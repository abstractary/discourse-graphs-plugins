import { ApiError, isObject } from './http.ts';
import type { Context, Route } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';
import type { Graph } from './types.ts';

const FILE_FIELDS = ['file', 'fileBase64', 'dataBase64'];

type StoredGraph = {
  doi: string;
  title?: string;
  schema: unknown;
  model: unknown;
  storedAt: string;
  hash: string;
  graph: Graph;
};

type GraphLog = { graphs: StoredGraph[] };

function readLog(store: Store): GraphLog {
  return store.read<GraphLog>('graphs') ?? { graphs: [] };
}

// DOIs are case-insensitive and often arrive as a doi.org link.
function normalizeDoi(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bare = value.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare : undefined;
}

function hasFileField(value: Record<string, unknown>): boolean {
  return FILE_FIELDS.some((field) => field in value);
}

function isGraph(value: unknown): value is Graph {
  return isObject(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}

function summary({ doi, title, schema, model, storedAt, graph }: StoredGraph): Record<string, unknown> {
  return { doi, title, schema, model, storedAt, nodes: graph.nodes.length, edges: graph.edges.length };
}

async function storeGraph({ readJson }: Context, store: Store): Promise<unknown> {
  const body = await readJson();
  const doi = normalizeDoi(body.doi);
  if (!doi) {
    throw new ApiError(400, 'no-doi', 'The graph store only keeps papers with a DOI. Send "doi", or keep this graph local.');
  }
  if (hasFileField(body) || (isObject(body.graph) && hasFileField(body.graph))) {
    throw new ApiError(400, 'no-files', 'The graph store never takes the original file. Send the graph on its own.');
  }
  if (!isGraph(body.graph)) {
    throw new ApiError(400, 'bad-graph', 'Send "graph" as an extraction graph with nodes and edges arrays.');
  }
  const hash = hashOf(JSON.stringify(body.graph));
  const log = readLog(store);
  if (log.graphs.some((entry) => entry.doi === doi && entry.hash === hash)) {
    return { stored: false, doi };
  }
  log.graphs.push({
    doi,
    title: body.graph.paper?.title,
    schema: body.schema,
    model: body.model,
    storedAt: new Date().toISOString(),
    hash,
    graph: body.graph,
  });
  store.write('graphs', log);
  return { stored: true, doi };
}

function listGraphs({ query }: Context, store: Store): unknown {
  const { graphs } = readLog(store);
  const asked = query.get('doi');
  if (asked === null) return { graphs: graphs.map(summary) };
  const doi = normalizeDoi(asked);
  const matches = graphs.filter((entry) => entry.doi === doi);
  return { graphs: matches.map((entry) => ({ ...summary(entry), graph: entry.graph })) };
}

export function graphRoutes(store: Store): Route[] {
  return [
    { method: 'POST', path: '/v1/graphs', handler: (context) => storeGraph(context, store) },
    { method: 'GET', path: '/v1/graphs', handler: (context) => listGraphs(context, store) },
  ];
}
