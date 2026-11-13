import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { Person } from './types.ts';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Context = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  readJson: () => Promise<Record<string, unknown>>;
};

// A handler returns the JSON to send, or nothing if it wrote the response itself.
export type Handler = (context: Context) => unknown;

export type Route = { method: string; path: string; handler: Handler };

export type NdjsonStream = {
  write: (line: Record<string, unknown>) => void;
  end: () => void;
  signal: AbortSignal;
};

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function openNdjson(res: ServerResponse): NdjsonStream {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  return {
    write(line) {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(line)}\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
    signal: abort.signal,
  };
}

// Reads a line-based response body from another service, such as MIRA or a model API.
export async function* readLines(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end = buffer.indexOf('\n');
    while (end >= 0) {
      yield buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      end = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer) yield buffer;
}

// Error messages from parsers can quote the input, and the input can be paper text
// or a token. So only the error name and the stack frames reach the log.
export function logFailure(where: string, error: unknown): void {
  const name = error instanceof Error ? error.name : 'Error';
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').filter((line) => line.startsWith('    at ')) : [];
  console.error(`${where} failed with ${name}\n${frames.slice(0, 6).join('\n')}`);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `no-${field}`, `Send "${field}" as a non-empty string.`);
  }
  return value;
}

export function requirePerson(value: unknown): Person {
  if (!isObject(value) || typeof value.did !== 'string' || !value.did || typeof value.name !== 'string' || !value.name) {
    throw new ApiError(400, 'bad-person', 'Send "person" as {did, name}, both non-empty strings.');
  }
  return { did: value.did, name: value.name };
}

export function decodeBase64(value: unknown, field: string): Buffer {
  const compact = typeof value === 'string' ? value.replace(/\s/g, '') : undefined;
  if (compact === undefined || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact)) {
    throw new ApiError(400, 'bad-file', `"${field}" is not valid base64. Encode the file as base64 and send it again.`);
  }
  return Buffer.from(compact, 'base64');
}

// Absolute links need the address people reach this server at. Behind a proxy the
// Host header is the proxy's business, so set DG_PUBLIC_URL there.
export function publicBase(req: IncomingMessage, publicUrl?: string): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  const host = req.headers.host ?? '';
  if (!/^[A-Za-z0-9.-]+(:\d+)?$|^\[[0-9A-Fa-f:.]+\](:\d+)?$/.test(host)) {
    throw new ApiError(400, 'bad-host', 'The Host header is not a valid host name. Send a plain host, or set DG_PUBLIC_URL on the server.');
  }
  return `http://${host}`;
}

function tooBig(limit: number): ApiError {
  const megabytes = Math.floor(limit / (1024 * 1024));
  return new ApiError(413, 'too-big', `This request is over the ${megabytes} MB limit. Send a smaller file.`);
}

// A client that is still uploading can only read the 413 if the socket stays open,
// so the rest of an oversized body is read and dropped. That rules out `for await`,
// which destroys the socket on early exit, and a `Connection: close` on the 413.
function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = Number(req.headers['content-length'] ?? 0) > limit;
    if (over) reject(tooBig(limit));
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (over) return;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(tooBig(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const body = await readBody(req, limit);
  let value: unknown;
  try {
    value = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad-json', 'The request body is not valid JSON. Check it and send it again.');
  }
  if (!isObject(value)) {
    throw new ApiError(400, 'bad-json', 'The request body must be a JSON object.');
  }
  return value;
}

// A last segment such as `*doi` takes the rest of the path, slashes included,
// because a DOI has a slash in it.
function matchRoute(path: string, parts: string[]): Record<string, string> | undefined {
  const pattern = path.split('/');
  const rest = pattern.at(-1)?.startsWith('*') ?? false;
  if (rest ? parts.length < pattern.length : pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, segment] of pattern.entries()) {
    if (rest && index === pattern.length - 1) {
      const value = parts.slice(index).join('/');
      if (!value) return undefined;
      params[segment.slice(1)] = value;
    } else if (segment.startsWith(':')) params[segment.slice(1)] = parts[index];
    else if (segment !== parts[index]) return undefined;
  }
  return params;
}

function parseUrl(raw: string): { parts: string[]; query: URLSearchParams } {
  try {
    const url = new URL(raw, 'http://server.invalid');
    return { parts: url.pathname.split('/').map(decodeURIComponent), query: url.searchParams };
  } catch {
    throw new ApiError(404, 'not-found', 'This path is not valid. Check the URL against the API docs.');
  }
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Authorization, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Accept-Post, Content-Disposition, Link, Location');
  // Chrome asks for this before a public site such as Roam may call localhost.
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendError(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  logFailure(`${req.method} request`, error);
  const message = 'Something went wrong on the server. Try again, and check the server log if it keeps happening.';
  sendJson(res, 500, { error: { code: 'internal', message } });
}

async function dispatch(routes: Route[], limit: number, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { parts, query } = parseUrl(req.url ?? '/');
  const onPath = routes.filter((route) => matchRoute(route.path, parts));
  // HEAD runs the GET handler. Node sends the headers and drops the body.
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = onPath.find((candidate) => candidate.method === method);
  if (!route) {
    // A preflight gets a plain yes unless a route wants to answer OPTIONS itself.
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (onPath.length > 0) {
      res.setHeader('Allow', onPath.map((candidate) => candidate.method).join(', '));
      throw new ApiError(405, 'wrong-method', `This path does not take ${req.method}. Use ${onPath[0].method}.`);
    }
    throw new ApiError(404, 'not-found', 'There is no such route. Check the URL against the API docs.');
  }
  const result = await route.handler({
    req,
    res,
    params: matchRoute(route.path, parts) ?? {},
    query,
    readJson: () => readJsonBody(req, limit),
  });
  if (result !== undefined) sendJson(res, 200, result);
}

export function createHttpServer(routes: Route[], maxBodyBytes: number): Server {
  return createServer((req, res) => {
    setCors(res);
    dispatch(routes, maxBodyBytes, req, res).catch((error: unknown) => sendError(req, res, error));
  });
}
