import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_PAPERS, lastLine, makeDocx, readNdjson, startTestServer } from './helpers.ts';
import type { Line, TestServer } from './helpers.ts';

const DEMOS = [
  { stem: 'lupus-nephritis-prediction', original: '1-s2.0-S0049017217307229-main.pdf' },
  {
    stem: 'preclinical-sle-mediators',
    original: 'Dysregulation of innate and adaptive serum mediators precedes systemic lupus erythematosus classification and improves prognostic accuracy of autoantibodies.pdf',
  },
];

const savedGraph = (stem: string): Line => JSON.parse(readFileSync(join(DEMO_PAPERS, `${stem}.graph.json`), 'utf8'));
const pdfBase64 = (stem: string): string => readFileSync(join(DEMO_PAPERS, `${stem}.pdf`)).toString('base64');

async function extract(server: TestServer, body: unknown): Promise<Line[]> {
  const response = await server.post('/v1/extract', body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  return readNdjson(response);
}

for (const { stem, original } of DEMOS) {
  test(`demo-replay matches ${stem} by hash under any name, over about 2 seconds`, async (t) => {
    const server = await startTestServer(t, { replayMs: 2000 });
    const started = Date.now();
    const lines = await extract(server, {
      filename: 'renamed-by-someone.pdf',
      mediaType: 'application/pdf',
      dataBase64: pdfBase64(stem),
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 1800 && elapsed < 4000, `took ${elapsed} ms`);
    const status = lines.filter((line) => line.type === 'status');
    assert.ok(status.length >= 3);
    assert.match(status[0].message, /replay of saved output/i);
    assert.deepEqual(lastLine(lines), { type: 'result', data: savedGraph(stem) });
  });

  test(`demo-replay matches ${stem} by its original filename`, async (t) => {
    const server = await startTestServer(t);
    const lines = await extract(server, { filename: original, model: 'demo-replay', schema: 'mira' });
    assert.deepEqual(lastLine(lines).data, savedGraph(stem));
  });

  test(`demo-replay matches ${stem} by its repo filename`, async (t) => {
    const server = await startTestServer(t);
    const lines = await extract(server, { filename: `${stem}.pdf` });
    assert.deepEqual(lastLine(lines).data, savedGraph(stem));
  });
}

test('demo-replay refuses anything else and says why', async (t) => {
  const server = await startTestServer(t);
  const lines = await extract(server, {
    filename: 'other.pdf',
    dataBase64: Buffer.from('%PDF-1.7 not a demo').toString('base64'),
  });
  const line = lastLine(lines);
  assert.equal(line.type, 'error');
  assert.equal(line.code, 'not-a-demo-paper');
  assert.match(line.message, /two demo papers/);
  assert.ok(!lines.some((candidate) => candidate.type === 'result'));
});

test('a legacy .doc returns unsupported-type asking for .docx', async (t) => {
  const server = await startTestServer(t);
  for (const body of [
    { filename: 'paper.doc', model: 'sentence-split', dataBase64: 'AAAA' },
    { filename: 'PAPER.DOC', dataBase64: 'AAAA' },
    { filename: 'paper', mediaType: 'application/msword', model: 'sentence-split', dataBase64: 'AAAA' },
  ]) {
    const line = lastLine(await extract(server, body));
    assert.equal(line.type, 'error');
    assert.equal(line.code, 'unsupported-type');
    assert.match(line.message, /\.docx/);
  }
});

test('extract reports bad requests as error lines', async (t) => {
  const server = await startTestServer(t);
  const cases: [unknown, string][] = [
    [{ filename: 'a.md', model: 'gpt', text: 'x' }, 'unknown-model'],
    [{ filename: 'a.md', schema: 'dublin', text: 'x' }, 'unknown-schema'],
    [{ text: 'x' }, 'no-filename'],
    [{ filename: 'a.xyz', model: 'sentence-split', text: 'x' }, 'unsupported-type'],
    [{ filename: 'a.md', model: 'sentence-split' }, 'no-document'],
    [{ filename: 'a.md', model: 'sentence-split', dataBase64: '@@@' }, 'bad-file'],
    [{ filename: 'a.md', model: 'sentence-split', text: '   ' }, 'no-text'],
    [{ filename: 'a.pdf', model: 'sentence-split', dataBase64: 'AAAA' }, 'unreadable-file'],
    [{ filename: 'a.docx', model: 'sentence-split', dataBase64: 'AAAA' }, 'unreadable-file'],
  ];
  for (const [body, code] of cases) {
    const line = lastLine(await extract(server, body));
    assert.equal(line.type, 'error', JSON.stringify(body));
    assert.equal(line.code, code);
  }
});

const SAMPLE_MD = `# Does sleep change memory?

Does sleep improve memory in adults?

Sleep strengthens new memories overnight. Rest also helps people recall facts later.

Recall rose by 23% in the sleep group, p < 0.05. The control group of 40 people showed no change.

A short nap can help too.

## References

Smith J. 2015;12:34-56.
`;

test('sentence-split turns a .md into a rough graph, offline', async (t) => {
  const server = await startTestServer(t);
  const lines = await extract(server, {
    filename: 'sleep.md',
    mediaType: 'text/markdown',
    model: 'sentence-split',
    dataBase64: Buffer.from(SAMPLE_MD).toString('base64'),
  });
  assert.ok(lines.some((line) => line.type === 'status' && /rough stand-in/i.test(line.message)));
  const graph = lastLine(lines).data;
  assert.deepEqual(Object.keys(graph), ['source', 'models', 'paper', 'nodes', 'edges']);
  assert.equal(graph.source, 'sleep.md');
  assert.deepEqual(graph.models, ['sentence-split']);
  assert.equal(graph.paper.title, 'Does sleep change memory?');

  const byType = (type: string): Line[] => graph.nodes.filter((node: Line) => node.type === type);
  assert.equal(byType('SourceDocument').length, 1);
  assert.match(byType('SourceDocument')[0].description, /rough stand-in/i);
  assert.deepEqual(byType('Question').map((node) => node.text), ['Does sleep improve memory in adults?']);
  assert.deepEqual(byType('Evidence').map((node) => node.text), [
    'Recall rose by 23% in the sleep group, p < 0.05.',
    'The control group of 40 people showed no change.',
  ]);
  assert.deepEqual(byType('Claim').map((node) => node.text), [
    'Sleep strengthens new memories overnight.',
    'Rest also helps people recall facts later.',
    'A short nap can help too.',
  ]);
  assert.ok(!graph.nodes.some((node: Line) => /Smith/.test(node.text)), 'the reference list stays out');

  const claim = byType('Claim');
  const evidence = byType('Evidence');
  const question = byType('Question')[0];
  const edge = (relation: string, subject: string, object: string): boolean =>
    graph.edges.some((candidate: Line) => candidate.relation === relation && candidate.subject === subject && candidate.object === object);
  assert.ok(edge('supports', evidence[0].id, claim[1].id), 'evidence supports the claim just before it');
  assert.ok(edge('supports', evidence[1].id, claim[2].id), 'evidence supports the claim just after it');
  for (const node of claim) assert.ok(edge('addresses', node.id, question.id));
});

test('sentence-split caps Claims at 12', async (t) => {
  const server = await startTestServer(t);
  const text = Array.from({ length: 30 }, (_, index) => `Claim number ${'ab'.repeat(index + 1)} holds here today.`).join(' ');
  const graph = lastLine(await extract(server, { filename: 'a.txt', model: 'sentence-split', text })).data;
  assert.equal(graph.nodes.filter((node: Line) => node.type === 'Claim').length, 12);
});

test('sentence-split keeps abbreviations and decimals inside a sentence', async (t) => {
  const server = await startTestServer(t);
  const text = 'Jones et al. found a strong effect in mice. The value was 0.05 in Fig. 2 of that paper.';
  const graph = lastLine(await extract(server, { filename: 'a.txt', model: 'sentence-split', text })).data;
  assert.deepEqual(graph.nodes.slice(1).map((node: Line) => node.text), [
    'Jones et al. found a strong effect in mice.',
    'The value was 0.05 in Fig. 2 of that paper.',
  ]);
});

test('sentence-split keeps author lists out of the Claims', async (t) => {
  const server = await startTestServer(t);
  const text = 'Rufei Lu a, b, c, Melissa E. Munroe a, Joel M. Guthridge a, Krista M. Bean a, Dustin A. Fife a. '
    + 'Interferon pathways are dysregulated in preclinical disease.';
  const graph = lastLine(await extract(server, { filename: 'a.txt', model: 'sentence-split', text })).data;
  assert.deepEqual(graph.nodes.slice(1).map((node: Line) => node.text), [
    'Interferon pathways are dysregulated in preclinical disease.',
  ]);
});

test('sentence-split reads a .docx built here', async (t) => {
  const server = await startTestServer(t);
  const docx = makeDocx([
    'What causes flares &amp; relapse?',
    'Interferon drives the disease in many patients.',
    'Levels rose 40% before diagnosis.',
  ]);
  const lines = await extract(server, {
    filename: 'notes.docx',
    model: 'sentence-split',
    dataBase64: docx.toString('base64'),
  });
  const graph = lastLine(lines).data;
  assert.deepEqual(graph.nodes.map((node: Line) => [node.type, node.text]), [
    ['SourceDocument', 'notes'],
    ['Question', 'What causes flares & relapse?'],
    ['Claim', 'Interferon drives the disease in many patients.'],
    ['Evidence', 'Levels rose 40% before diagnosis.'],
  ]);
  assert.equal(graph.edges.length, 2);
});

test('sentence-split reads a real PDF through pdfjs', async (t) => {
  const server = await startTestServer(t);
  const lines = await extract(server, {
    filename: 'renamed.pdf',
    model: 'sentence-split',
    dataBase64: pdfBase64('lupus-nephritis-prediction'),
  });
  const graph = lastLine(lines).data;
  const claims = graph.nodes.filter((node: Line) => node.type === 'Claim');
  assert.ok(claims.length > 0 && claims.length <= 12);
  assert.ok(graph.nodes.filter((node: Line) => node.type === 'Evidence').length > 0);
  assert.match(JSON.stringify(graph.nodes), /lupus/i);
});

test('the discourse-graph schema maps the replay onto its own types and relations', async (t) => {
  const server = await startTestServer(t);
  const { stem, original } = DEMOS[0];
  const saved = savedGraph(stem);
  const graph = lastLine(await extract(server, { filename: original, schema: 'discourse-graph' })).data;

  assert.deepEqual([...new Set(graph.nodes.map((node: Line) => node.type))].sort(), ['Claim', 'Evidence', 'Question', 'Source']);
  assert.deepEqual([...new Set(graph.edges.map((edge: Line) => edge.relation))].sort(), ['addresses', 'derivedFrom', 'informs', 'supports']);
  assert.equal(graph.nodes.length, saved.nodes.length);
  assert.equal(graph.edges.length, saved.edges.length);

  const typeOf = (nodes: Line[], id: string): string => nodes.find((node) => node.id === id)?.type;
  const original_types = new Map<string, string>([
    ['Study', 'Source'],
    ['Protocol', 'Source'],
    ['SourceDocument', 'Source'],
    ['Request', 'Question'],
    ['Question', 'Question'],
    ['Claim', 'Claim'],
    ['Evidence', 'Evidence'],
  ]);
  for (const node of saved.nodes) assert.equal(typeOf(graph.nodes, node.id), original_types.get(node.type));

  saved.edges.forEach((edge: Line, index: number) => {
    const mapped = graph.edges[index];
    assert.equal(mapped.anchor, edge.anchor);
    if (edge.relation === 'grounds') {
      assert.deepEqual([mapped.relation, mapped.subject, mapped.object], ['derivedFrom', edge.object, edge.subject]);
      assert.equal(typeOf(graph.nodes, mapped.subject), 'Evidence');
      assert.equal(typeOf(graph.nodes, mapped.object), 'Source');
    } else {
      const expected = new Map([
        ['follows', 'derivedFrom'],
        ['describesActivity', 'informs'],
        ['request_target', 'addresses'],
      ]).get(edge.relation) ?? edge.relation;
      assert.deepEqual([mapped.relation, mapped.subject, mapped.object], [expected, edge.subject, edge.object]);
    }
  });
});

test('a client that hangs up mid-replay does not break the server', async (t) => {
  const server = await startTestServer(t, { replayMs: 2000 });
  const abort = new AbortController();
  const response = await fetch(`${server.url}/v1/extract`, {
    method: 'POST',
    body: JSON.stringify({ filename: `${DEMOS[0].stem}.pdf` }),
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  abort.abort();
  assert.equal((await server.get('/v1/info')).status, 200);
});
