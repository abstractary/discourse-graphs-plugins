import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { lastLine, makeDocx, readNdjson, readRequest, startFakeServer, startTestServer } from './helpers.ts';
import type { Line, TestServer } from './helpers.ts';

type Received = { text?: FormDataEntryValue | null; filename?: FormDataEntryValue | null; file?: FormDataEntryValue | null };

async function fakeMira(t: TestContext, lines: unknown[], received: Received[] = []): Promise<string> {
  return startFakeServer(t, async (req, res) => {
    const body = await readRequest(req);
    const form = await new Response(new Uint8Array(body), { headers: { 'content-type': req.headers['content-type'] ?? '' } }).formData();
    received.push({ text: form.get('text'), filename: form.get('filename'), file: form.get('file') });
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const line of lines) res.write(`${JSON.stringify(line)}\n`);
    res.end();
  });
}

async function extract(server: TestServer, body: Record<string, unknown>): Promise<Line[]> {
  return readNdjson(await server.post('/v1/extract', { model: 'mira-hosted', ...body }));
}

const MIRA_DATA = {
  source: 'upstream.txt',
  models: ['some/model'],
  paper: { title: 'A paper', doi: '10.1000/abc', authors: [{ name: 'A. Author' }], journal: 'dropped' },
  nodes: [
    { id: 'g0', type: 'Claim', text: 'A claim', anchor: 'A quote', confidence: 0.9, nested: { dropped: true } },
    { id: 'g1', type: 'Evidence', text: 'A fact', doi: '10.1000/x', url: 'https://example.org', description: 'Why', page: 3 },
  ],
  edges: [{ relation: 'supports', subject: 'g1', object: 'g0', anchor: 'A quote', weight: 2 }],
  usage: { tokens: 123 },
  debug: 'dropped',
};

test('mira-hosted sends text and filename, relays status and ping, and maps the result', async (t) => {
  const received: Received[] = [];
  const miraUrl = await fakeMira(t, [
    { type: 'status', message: 'Extracting claims', extra: 'dropped' },
    { type: 'ping' },
    { type: 'status', message: 'Linking evidence' },
    { type: 'result', data: MIRA_DATA },
  ], received);
  const server = await startTestServer(t, { miraUrl });
  const lines = await extract(server, { filename: 'notes.md', dataBase64: Buffer.from('Some notes here.').toString('base64') });

  assert.equal(received.length, 1);
  assert.equal(received[0].text, 'Some notes here.');
  assert.equal(received[0].filename, 'notes.md');
  assert.equal(received[0].file, null);

  assert.deepEqual(lines.filter((line) => line.type === 'ping'), [{ type: 'ping' }]);
  const relayed = lines.filter((line) => line.type === 'status').map((line) => line.message);
  assert.ok(relayed.includes('Extracting claims'));
  assert.ok(relayed.includes('Linking evidence'));
  assert.ok(lines.filter((line) => line.type === 'status').every((line) => !('extra' in line)));

  assert.deepEqual(lastLine(lines), {
    type: 'result',
    data: {
      source: 'upstream.txt',
      models: ['some/model'],
      paper: { title: 'A paper', doi: '10.1000/abc', authors: [{ name: 'A. Author' }] },
      nodes: [
        { id: 'g0', type: 'Claim', text: 'A claim', anchor: 'A quote' },
        { id: 'g1', type: 'Evidence', text: 'A fact', description: 'Why', doi: '10.1000/x', url: 'https://example.org' },
      ],
      edges: [{ relation: 'supports', subject: 'g1', object: 'g0', anchor: 'A quote' }],
    },
  });
});

test('mira-hosted reads a .docx locally and sends only text', async (t) => {
  const received: Received[] = [];
  const miraUrl = await fakeMira(t, [{ type: 'result', data: MIRA_DATA }], received);
  const server = await startTestServer(t, { miraUrl });
  const docx = makeDocx(['A sentence from a Word file.']);
  await extract(server, { filename: 'notes.docx', dataBase64: docx.toString('base64') });
  assert.equal(received[0].filename, 'notes.docx');
  assert.equal(String(received[0].text).trim(), 'A sentence from a Word file.');
  assert.equal(received[0].file, null);
});

test('mira-hosted passes through the discourse-graph mapping', async (t) => {
  const data = {
    ...MIRA_DATA,
    nodes: [{ id: 'g0', type: 'Study', text: 'A study' }, { id: 'g1', type: 'Evidence', text: 'A fact' }],
    edges: [{ relation: 'grounds', subject: 'g0', object: 'g1' }],
  };
  const miraUrl = await fakeMira(t, [{ type: 'result', data }]);
  const server = await startTestServer(t, { miraUrl });
  const graph = lastLine(await extract(server, { filename: 'a.txt', text: 'Text', schema: 'discourse-graph' })).data;
  assert.equal(graph.nodes[0].type, 'Source');
  assert.deepEqual(graph.edges, [{ relation: 'derivedFrom', subject: 'g1', object: 'g0' }]);
});

test('an error line from MIRA is relayed as an error line', async (t) => {
  const miraUrl = await fakeMira(t, [{ type: 'status', message: 'Working' }, { type: 'error', message: 'Model overloaded' }]);
  const server = await startTestServer(t, { miraUrl });
  const line = lastLine(await extract(server, { filename: 'a.txt', text: 'Text' }));
  assert.equal(line.type, 'error');
  assert.equal(line.message, 'Model overloaded');
});

test('a 413 from MIRA becomes paper-too-big with the sizes', async (t) => {
  const miraUrl = await startFakeServer(t, async (req, res) => {
    await readRequest(req);
    res.writeHead(413, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 'paper-too-big', chars: 500000, limit: 400000 }));
  });
  const server = await startTestServer(t, { miraUrl });
  const line = lastLine(await extract(server, { filename: 'a.txt', text: 'Text' }));
  assert.equal(line.type, 'error');
  assert.equal(line.code, 'paper-too-big');
  assert.match(line.message, /500000/);
  assert.match(line.message, /400000/);
});

test('MIRA failures say what to do next', async (t) => {
  const http500 = await startFakeServer(t, async (req, res) => {
    await readRequest(req);
    res.writeHead(500);
    res.end('stack trace with private things');
  });
  const stopped = await fakeMira(t, [{ type: 'status', message: 'Working' }]);
  const noNodes = await fakeMira(t, [{ type: 'result', data: { paper: {} } }]);
  for (const [miraUrl, code] of [
    [http500, 'mira-failed'],
    [stopped, 'mira-failed'],
    [noNodes, 'bad-result'],
    ['http://127.0.0.1:9/closed', 'mira-unreachable'],
  ]) {
    const server = await startTestServer(t, { miraUrl });
    const line = lastLine(await extract(server, { filename: 'a.txt', text: 'Text' }));
    assert.equal(line.type, 'error');
    assert.equal(line.code, code);
    assert.ok(!line.message.includes('private'));
  }
});
