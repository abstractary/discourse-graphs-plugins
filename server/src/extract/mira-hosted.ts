import { ApiError, isObject, readLines } from '../http.ts';
import type { Graph, GraphEdge, GraphNode, GraphPaper } from '../types.ts';
import { readDocumentText } from './document.ts';
import type { UploadedDocument } from './document.ts';
import type { ExtractContext, ExtractModel } from './model.ts';

// MIRA says a run takes 1 to 5 minutes, so this leaves room before giving up.
const TIMEOUT_MS = 7 * 60 * 1000;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

// Copies only the named string fields, so unknown fields from MIRA stay out.
function pick<T>(source: Record<string, unknown>, fields: string[]): T {
  return Object.fromEntries(fields.flatMap((field) => {
    const value = text(source[field]);
    return value === undefined ? [] : [[field, value]];
  })) as T;
}

function toPaper(value: unknown, filename: string): GraphPaper {
  const paper = isObject(value) ? value : {};
  const authors = Array.isArray(paper.authors) ? { authors: paper.authors } : {};
  return { title: text(paper.title) ?? filename, ...pick<{ doi?: string }>(paper, ['doi']), ...authors };
}

export function toGraph(data: unknown, filename: string): Graph {
  if (!isObject(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new ApiError(502, 'bad-result', 'MIRA sent a result without nodes and edges. Try again.');
  }
  const models = Array.isArray(data.models) ? data.models.filter((model) => typeof model === 'string') : [];
  return {
    source: text(data.source) ?? filename,
    models: models.length > 0 ? models : ['mira-hosted'],
    paper: toPaper(data.paper, filename),
    nodes: data.nodes.filter(isObject).map((node) =>
      pick<GraphNode>(node, ['id', 'type', 'text', 'description', 'doi', 'url', 'anchor'])),
    edges: data.edges.filter(isObject).map((edge) =>
      pick<GraphEdge>(edge, ['relation', 'subject', 'object', 'anchor'])),
  };
}

async function refusal(response: Response): Promise<ApiError> {
  if (response.status !== 413) {
    return new ApiError(502, 'mira-failed', `MIRA answered with HTTP ${response.status}. Try again in a minute.`);
  }
  const body: unknown = await response.json().catch(() => undefined);
  const { chars, limit } = isObject(body) ? body : { chars: undefined, limit: undefined };
  const size = chars && limit ? ` It has ${String(chars)} characters and the limit is ${String(limit)}.` : '';
  return new ApiError(413, 'paper-too-big', `This paper is too long for MIRA.${size} Send a shorter version.`);
}

function parseLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function relay(response: Response, document: UploadedDocument, emit: ExtractContext['emit']): Promise<Graph> {
  if (!response.body) throw new ApiError(502, 'mira-failed', 'MIRA sent an empty answer. Try again in a minute.');
  for await (const raw of readLines(response.body)) {
    const line = parseLine(raw);
    if (line?.type === 'status') emit({ type: 'status', message: line.message });
    else if (line?.type === 'ping') emit({ type: 'ping' });
    else if (line?.type === 'result') return toGraph(line.data, document.filename);
    else if (line?.type === 'error') {
      throw new ApiError(502, text(line.code) ?? 'mira-failed', text(line.message) ?? 'MIRA could not finish this paper. Try again.');
    }
  }
  throw new ApiError(502, 'mira-failed', 'MIRA stopped before sending a result. Try again in a minute.');
}

async function forward(document: UploadedDocument, { config, emit, signal }: ExtractContext): Promise<Graph> {
  emit({ type: 'status', message: 'Reading the document' });
  const form = new FormData();
  form.set('text', await readDocumentText(document));
  form.set('filename', document.filename);
  emit({ type: 'status', message: 'Sending the text to MIRA. A run takes 1 to 5 minutes.' });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(config.miraUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) throw await refusal(response);
    return await relay(response, document, emit);
  } catch (error) {
    if (error instanceof ApiError || signal.aborted) throw error;
    if (timeout.aborted) {
      throw new ApiError(504, 'mira-timeout', 'MIRA took too long and the run was stopped. Try again later.');
    }
    throw new ApiError(502, 'mira-unreachable', 'Could not reach MIRA. Check the network and MIRA_URL, then try again.');
  }
}

export const miraHosted: ExtractModel = {
  id: 'mira-hosted',
  label: 'MIRA (hosted)',
  description: 'Sends the document text to the hosted MIRA extractor. A run takes 1 to 5 minutes and needs a network.',
  run: forward,
};
