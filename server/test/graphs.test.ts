import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_PAPERS, readAllData, startTestServer } from './helpers.ts';

const graph = JSON.parse(readFileSync(join(DEMO_PAPERS, 'lupus-nephritis-prediction.graph.json'), 'utf8'));
const doi = '10.1016/j.semarthrit.2018.02.012';
const entry = { doi, graph, schema: 'mira', model: 'demo-replay' };

test('a graph without a DOI is refused with no-doi', async (t) => {
  const server = await startTestServer(t);
  const bodies = [
    { graph, schema: 'mira', model: 'm' },
    { doi: '', graph },
    { doi: null, graph },
    { doi: 'not a doi', graph },
    { doi: 42, graph },
  ];
  for (const body of bodies) {
    const response = await server.post('/v1/graphs', body);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error.code, 'no-doi');
  }
  const { graphs } = (await (await server.get('/v1/graphs')).json()) as any;
  assert.deepEqual(graphs, []);
});

test('the same DOI and content store once', async (t) => {
  const server = await startTestServer(t);
  const first = await server.post('/v1/graphs', entry);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as any).stored, true);

  const second = await server.post('/v1/graphs', entry);
  assert.equal(((await second.json()) as any).stored, false);

  const asLink = await server.post('/v1/graphs', { ...entry, doi: `https://doi.org/${doi.toUpperCase()}` });
  assert.equal(((await asLink.json()) as any).stored, false);

  const changed = { ...entry, graph: { ...graph, nodes: graph.nodes.slice(1) } };
  assert.equal(((await (await server.post('/v1/graphs', changed)).json()) as any).stored, true);

  const { graphs } = (await (await server.get('/v1/graphs')).json()) as any;
  assert.equal(graphs.length, 2);
});

test('the list is a summary, and ?doi= narrows it and adds the graph', async (t) => {
  const server = await startTestServer(t);
  await server.post('/v1/graphs', entry);
  await server.post('/v1/graphs', { ...entry, doi: '10.1000/other' });

  const { graphs } = (await (await server.get('/v1/graphs')).json()) as any;
  assert.equal(graphs.length, 2);
  assert.deepEqual(Object.keys(graphs[0]).sort(), ['doi', 'edges', 'model', 'nodes', 'schema', 'storedAt', 'title']);
  assert.equal(graphs[0].title, graph.paper.title);
  assert.equal(graphs[0].nodes, graph.nodes.length);
  assert.equal(graphs[0].edges, graph.edges.length);

  const narrowed = (await (await server.get(`/v1/graphs?doi=${encodeURIComponent(doi)}`)).json()) as any;
  assert.equal(narrowed.graphs.length, 1);
  assert.deepEqual(narrowed.graphs[0].graph, graph);

  const none = (await (await server.get('/v1/graphs?doi=10.1000/none')).json()) as any;
  assert.deepEqual(none.graphs, []);
});

test('the graph store never accepts or keeps a file', async (t) => {
  const server = await startTestServer(t);
  const fileBytes = Buffer.from('distinctive bytes of the original file').toString('base64');
  const bodies = [
    { ...entry, fileBase64: fileBytes },
    { ...entry, dataBase64: fileBytes },
    { ...entry, file: fileBytes },
    { ...entry, graph: { ...graph, fileBase64: fileBytes } },
  ];
  for (const body of bodies) {
    const response = await server.post('/v1/graphs', body);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as any).error.code, 'no-files');
  }
  assert.ok(!readAllData(server.dataDir).includes(fileBytes));
});

test('a body without a real graph is refused', async (t) => {
  const server = await startTestServer(t);
  const response = await server.post('/v1/graphs', { doi, graph: { nodes: 'x' } });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as any).error.code, 'bad-graph');
});
