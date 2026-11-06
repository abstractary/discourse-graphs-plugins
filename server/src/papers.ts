import type { ServerResponse } from 'node:http';
import { requireMember } from './auth.ts';
import { ApiError, decodeBase64, isObject, requirePerson, requireString } from './http.ts';
import type { Context, Route } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';
import type { Person } from './types.ts';

const PAPER_FIELDS = ['id', 'title', 'doi', 'filename', 'model', 'schema', 'server', 'canvas', 'uploadedBy', 'extractedBy'];

type Breadcrumb = Person & { at: string };

type StoredPaper = Record<string, unknown> & {
  id: string;
  hasFile: boolean;
  uploadedAt: string;
  breadcrumbs: Breadcrumb[];
  mediaType?: string;
};

type PaperIndex = { papers: StoredPaper[] };

const indexKey = (labId: string): string => `papers/${labId}/index`;

// Paper ids come from clients, so they are hashed before they reach a file name.
const graphKey = (labId: string, paperId: string): string => `papers/${labId}/${hashOf(paperId)}`;

function readIndex(store: Store, labId: string): PaperIndex {
  return store.read<PaperIndex>(indexKey(labId)) ?? { papers: [] };
}

function paperOr404(index: PaperIndex, paperId: string): StoredPaper {
  const paper = index.papers.find((candidate) => candidate.id === paperId);
  if (!paper) throw new ApiError(404, 'no-paper', 'This lab has no such paper. List the lab papers to find its id.');
  return paper;
}

function pickPaperFields(paper: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(PAPER_FIELDS.filter((field) => field in paper).map((field) => [field, paper[field]]));
}

function safeMediaType(value: string | undefined): string {
  return value && /^[\w.+-]+\/[\w.+-]+$/.test(value) ? value : 'application/octet-stream';
}

function sendFile(res: ServerResponse, file: Buffer, paper: StoredPaper): void {
  const name = typeof paper.filename === 'string' ? paper.filename : 'paper';
  res.writeHead(200, {
    'Content-Type': safeMediaType(paper.mediaType),
    'Content-Length': file.length,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name.toWellFormed())}`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(file);
}

async function uploadPaper({ req, params, readJson }: Context, store: Store): Promise<unknown> {
  requireMember(req, store, params.id);
  const body = await readJson();
  if (!isObject(body.paper)) throw new ApiError(400, 'no-paper', 'Send "paper" as an object with at least an id.');
  if (!isObject(body.graph)) throw new ApiError(400, 'no-graph', 'Send "graph" with the extraction graph for this paper.');
  const id = requireString(body.paper.id, 'id');
  const file = body.fileBase64 === undefined ? undefined : decodeBase64(body.fileBase64, 'fileBase64');

  // Read after the await, so two uploads at once cannot overwrite each other.
  const index = readIndex(store, params.id);
  const earlier = index.papers.find((candidate) => candidate.id === id);
  const key = graphKey(params.id, id);
  if (file) store.writeBlob(key, file);
  store.write(key, body.graph);
  const paper: StoredPaper = {
    ...pickPaperFields(body.paper),
    id,
    hasFile: Boolean(file) || (earlier?.hasFile ?? false),
    uploadedAt: new Date().toISOString(),
    breadcrumbs: earlier?.breadcrumbs ?? [],
  };
  const mediaType = file && typeof body.mediaType === 'string' ? body.mediaType : earlier?.mediaType;
  if (mediaType) paper.mediaType = mediaType;
  index.papers = [...index.papers.filter((candidate) => candidate.id !== id), paper];
  store.write(indexKey(params.id), index);
  return { paper };
}

function getPaper({ req, params }: Context, store: Store): unknown {
  requireMember(req, store, params.id);
  const paper = paperOr404(readIndex(store, params.id), params.paperId);
  return { ...paper, graph: store.read(graphKey(params.id, paper.id)) };
}

function getFile({ req, res, params }: Context, store: Store): void {
  requireMember(req, store, params.id);
  const paper = paperOr404(readIndex(store, params.id), params.paperId);
  const file = paper.hasFile ? store.readBlob(graphKey(params.id, paper.id)) : undefined;
  if (!file) throw new ApiError(404, 'no-file', 'This paper was shared without its file. Ask whoever uploaded it.');
  sendFile(res, file, paper);
}

async function leaveBreadcrumb({ req, params, readJson }: Context, store: Store): Promise<unknown> {
  requireMember(req, store, params.id);
  const person = requirePerson((await readJson()).person);
  const index = readIndex(store, params.id);
  const paper = paperOr404(index, params.paperId);
  paper.breadcrumbs = [
    ...paper.breadcrumbs.filter((crumb) => crumb.did !== person.did),
    { ...person, at: new Date().toISOString() },
  ];
  store.write(indexKey(params.id), index);
  return { breadcrumbs: paper.breadcrumbs };
}

export function paperRoutes(store: Store): Route[] {
  return [
    { method: 'POST', path: '/v1/labs/:id/papers', handler: (context) => uploadPaper(context, store) },
    {
      method: 'GET',
      path: '/v1/labs/:id/papers',
      handler: ({ req, params }) => {
        requireMember(req, store, params.id);
        return { papers: readIndex(store, params.id).papers };
      },
    },
    { method: 'GET', path: '/v1/labs/:id/papers/:paperId', handler: (context) => getPaper(context, store) },
    { method: 'GET', path: '/v1/labs/:id/papers/:paperId/file', handler: (context) => getFile(context, store) },
    { method: 'POST', path: '/v1/labs/:id/papers/:paperId/breadcrumbs', handler: (context) => leaveBreadcrumb(context, store) },
  ];
}
