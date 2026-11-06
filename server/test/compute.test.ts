import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLab, joinLab, startTestServer } from './helpers.ts';

test('GET /v1/info says what this server is', async (t) => {
  const server = await startTestServer(t);
  const response = await server.get('/v1/info');
  assert.equal(response.status, 200);
  const info = await response.json();
  assert.deepEqual(Object.keys(info as object).sort(), ['ai', 'demo', 'kind', 'name', 'version']);
  assert.deepEqual(
    { kind: (info as any).kind, demo: (info as any).demo, ai: (info as any).ai },
    { kind: 'local', demo: true, ai: { mode: 'search-only' } },
  );
});

test('GET /v1/info reports the configured kind and model', async (t) => {
  const server = await startTestServer(t, { kind: 'managed', anthropicKey: 'test-key' });
  const info = (await (await server.get('/v1/info')).json()) as any;
  assert.equal(info.kind, 'managed');
  assert.deepEqual(info.ai, { mode: 'model', model: 'claude-sonnet-5-5' });
});

test('GET /v1/models lists all three with one default', async (t) => {
  const server = await startTestServer(t);
  const { models } = (await (await server.get('/v1/models')).json()) as { models: any[] };
  assert.deepEqual(models.map((model) => model.id), ['demo-replay', 'sentence-split', 'mira-hosted']);
  assert.deepEqual(models.filter((model) => model.default).map((model) => model.id), ['demo-replay']);
  assert.match(models[0].label, /saved output/i);
  assert.match(models[1].label, /rough stand-in/i);
});

test('GET /v1/schemas lists both with mira as default', async (t) => {
  const server = await startTestServer(t);
  const { schemas } = (await (await server.get('/v1/schemas')).json()) as { schemas: any[] };
  assert.deepEqual(schemas.map((schema) => schema.id), ['mira', 'discourse-graph']);
  assert.deepEqual(schemas.filter((schema) => schema.default).map((schema) => schema.id), ['mira']);
});

test('CORS is open on normal, error and preflight responses', async (t) => {
  const server = await startTestServer(t);
  const normal = await server.get('/v1/info');
  assert.equal(normal.headers.get('access-control-allow-origin'), '*');
  const missing = await server.get('/v1/nothing');
  assert.equal(missing.headers.get('access-control-allow-origin'), '*');
  const preflight = await fetch(`${server.url}/v1/labs`, {
    method: 'OPTIONS',
    headers: { origin: 'app://obsidian.md', 'access-control-request-method': 'POST' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Authorization/);
});

test('errors use the documented shape and a matching status', async (t) => {
  const server = await startTestServer(t);
  const missing = await server.get('/v1/nothing');
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as any;
  assert.equal(body.error.code, 'not-found');
  assert.equal(typeof body.error.message, 'string');

  const wrongMethod = await server.get('/v1/extract');
  assert.equal(wrongMethod.status, 405);

  const badJson = await fetch(`${server.url}/v1/labs`, { method: 'POST', body: '{nope' });
  assert.equal(badJson.status, 400);
  assert.equal(((await badJson.json()) as any).error.code, 'bad-json');

  const notObject = await fetch(`${server.url}/v1/labs`, { method: 'POST', body: '[1]' });
  assert.equal(notObject.status, 400);
});

test('an unparsable path is a 404, not a crash', async (t) => {
  const server = await startTestServer(t);
  assert.equal((await server.get('/v1/labs/%E0%A4%A')).status, 404);
  const { port } = new URL(server.url);
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '//' }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 404);
});

test('an oversized body gets a 413 that the client can read', async (t) => {
  const server = await startTestServer(t, { maxBodyBytes: 1024 });
  const declared = await server.post('/v1/extract', { filename: 'a.txt', text: 'x'.repeat(5000) });
  assert.equal(declared.status, 413);
  assert.equal(((await declared.json()) as any).error.code, 'too-big');

  // Chunked, so the size is only known while reading.
  const chunks = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`{"text":"${'x'.repeat(5000)}"}`));
      controller.close();
    },
  });
  const chunked = await fetch(`${server.url}/v1/extract`, { method: 'POST', body: chunks, duplex: 'half' } as RequestInit);
  assert.equal(chunked.status, 413);
});

// Repeated because closing the socket early only broke about 1 upload in 8.
test('the 40 MB default cap holds on a real body, and the client always reads the 413', async (t) => {
  const server = await startTestServer(t);
  const text = 'x'.repeat(41 * 1024 * 1024);
  for (let round = 0; round < 20; round += 1) {
    const response = await server.post('/v1/extract', { filename: 'a.txt', text });
    assert.equal(response.status, 413);
    assert.equal(((await response.json()) as any).error.code, 'too-big');
  }
});

test('a server failure gives a plain 500, and the log never quotes what failed to parse', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  // JSON.parse quotes the input in its error message, so this is what a leak would look like.
  const privateText = 'private paper sentence';
  writeFileSync(join(server.dataDir, 'json', 'labs', `${lab.id}.json`), privateText);
  const logged = t.mock.method(console, 'error', () => {});

  const response = await server.get(`/v1/labs/${lab.id}`);
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, 'internal');
  assert.ok(!body.includes(privateText));

  assert.equal(logged.mock.callCount(), 1);
  const line = logged.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
  assert.match(line, /SyntaxError/);
  assert.ok(!line.includes('private'), line);
});

test('main.ts starts for real and keeps tokens and paper text out of the log', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dg-server-main-'));
  const main = join(import.meta.dirname, '..', 'src', 'main.ts');
  const child = spawn(process.execPath, [main], { env: { ...process.env, PORT: '0', DG_DATA: dataDir } });
  t.after(() => {
    child.kill();
    rmSync(dataDir, { recursive: true, force: true });
  });
  let log = '';
  child.stderr.on('data', (chunk: Buffer) => { log += chunk.toString(); });
  const url = await new Promise<string>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      log += chunk.toString();
      const match = /http:\/\/[^\s]+/.exec(log);
      if (match) resolve(match[0]);
    });
  });

  const fixture = {
    url,
    dataDir,
    post: (path: string, body: unknown, token?: string) =>
      fetch(url + path, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    get: (path: string, token?: string) => fetch(url + path, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
  };
  const lab = await createLab(fixture);
  const member = await joinLab(fixture, lab);
  const secretText = 'A distinctive sentence from a private paper that must stay out of logs.';
  await (await fixture.post('/v1/extract', { model: 'sentence-split', filename: 'a.txt', text: secretText })).text();
  await fixture.post('/v1/labs', '{"broken": "not an object'.repeat(3));

  assert.ok(!log.includes(lab.adminToken));
  assert.ok(!log.includes(member));
  assert.ok(!log.includes(secretText));
});
