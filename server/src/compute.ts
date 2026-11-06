import { readFileSync } from 'node:fs';
import { aiStatus } from './ai.ts';
import type { Config } from './config.ts';
import type { DemoPaper } from './extract/demo-replay.ts';
import { documentType } from './extract/document.ts';
import type { UploadedDocument } from './extract/document.ts';
import { MODELS } from './extract/models.ts';
import { SCHEMAS, toSchema } from './extract/schemas.ts';
import { ApiError, decodeBase64, logFailure, openNdjson, requireString } from './http.ts';
import type { Context, Route } from './http.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

function parseDocument(body: Record<string, unknown>): UploadedDocument {
  const filename = requireString(body.filename, 'filename');
  const mediaType = typeof body.mediaType === 'string' ? body.mediaType : undefined;
  documentType(filename, mediaType);
  return {
    filename,
    mediaType,
    data: body.dataBase64 === undefined ? undefined : decodeBase64(body.dataBase64, 'dataBase64'),
    text: typeof body.text === 'string' ? body.text : undefined,
  };
}

function findModel(id: unknown) {
  const model = id === undefined ? MODELS.find((candidate) => candidate.default) : MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new ApiError(400, 'unknown-model', 'This server has no such model. GET /v1/models lists them.');
  return model;
}

function findSchema(id: unknown): string {
  const schema = id === undefined ? SCHEMAS.find((candidate) => candidate.default) : SCHEMAS.find((candidate) => candidate.id === id);
  if (!schema) throw new ApiError(400, 'unknown-schema', 'This server has no such schema. GET /v1/schemas lists them.');
  return schema.id;
}

function errorLine(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) return { type: 'error', message: error.message, code: error.code };
  logFailure('POST /v1/extract', error);
  return {
    type: 'error',
    message: 'Something went wrong on the server. Try again, and check the server log if it keeps happening.',
    code: 'internal',
  };
}

// Once the JSON body is in, the stream is open, so every failure after that point
// is an error line rather than an HTTP status.
async function extract({ res, readJson }: Context, config: Config, demoPapers: DemoPaper[]): Promise<void> {
  const body = await readJson();
  const stream = openNdjson(res);
  try {
    const model = findModel(body.model);
    const schema = findSchema(body.schema);
    const graph = await model.run(parseDocument(body), { config, demoPapers, emit: stream.write, signal: stream.signal });
    stream.write({ type: 'result', data: toSchema(graph, schema) });
  } catch (error) {
    if (!stream.signal.aborted) stream.write(errorLine(error));
  }
  stream.end();
}

export function computeRoutes(config: Config, demoPapers: DemoPaper[]): Route[] {
  return [
    {
      method: 'GET',
      path: '/v1/info',
      handler: () => ({
        name: 'DG reference server',
        kind: config.kind,
        version,
        demo: true,
        ai: aiStatus(config),
      }),
    },
    {
      method: 'GET',
      path: '/v1/models',
      handler: () => ({
        models: MODELS.map(({ id, label, description, default: isDefault }) => (
          isDefault ? { id, label, description, default: true } : { id, label, description }
        )),
      }),
    },
    { method: 'GET', path: '/v1/schemas', handler: () => ({ schemas: SCHEMAS }) },
    { method: 'POST', path: '/v1/extract', handler: (context) => extract(context, config, demoPapers) },
  ];
}
