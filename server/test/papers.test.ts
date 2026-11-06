import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLab, joinLab, startTestServer } from './helpers.ts';

const by = { did: 'did:plc:ada', name: 'Ada' };
const paper = {
  id: 'paper-1',
  title: 'A paper',
  doi: '10.1000/abc',
  filename: 'a paper (1).pdf',
  model: 'demo-replay',
  schema: 'mira',
  server: 'local',
  canvas: 'canvas-1',
  uploadedBy: by,
  extractedBy: by,
};
const graph = { source: 'a.pdf', models: ['m'], paper: { title: 'A paper' }, nodes: [], edges: [] };
const file = Buffer.from('%PDF-1.7 pretend file bytes');

test('a paper with a file can be listed, read and downloaded', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const base = `/v1/labs/${lab.id}/papers`;

  const upload = await server.post(base, {
    paper,
    graph,
    fileBase64: file.toString('base64'),
    mediaType: 'application/pdf',
  }, lab.adminToken);
  assert.equal(upload.status, 200);

  const { papers } = (await (await server.get(base, member)).json()) as any;
  assert.equal(papers.length, 1);
  assert.equal(papers[0].id, 'paper-1');
  assert.equal(papers[0].hasFile, true);
  assert.ok(!Number.isNaN(Date.parse(papers[0].uploadedAt)));
  assert.deepEqual(papers[0].breadcrumbs, []);
  assert.deepEqual(papers[0].uploadedBy, by);
  assert.ok(!('graph' in papers[0]));

  const one = (await (await server.get(`${base}/paper-1`, member)).json()) as any;
  assert.equal(one.title, 'A paper');
  assert.deepEqual(one.graph, graph);

  const download = await server.get(`${base}/paper-1/file`, member);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(download.headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''a%20paper%20\(1\)\.pdf$/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), file);
});

test('a paper without a file says so', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const base = `/v1/labs/${lab.id}/papers`;
  await server.post(base, { paper, graph }, lab.adminToken);
  const { papers } = (await (await server.get(base, lab.adminToken)).json()) as any;
  assert.equal(papers[0].hasFile, false);
  const download = await server.get(`${base}/paper-1/file`, lab.adminToken);
  assert.equal(download.status, 404);
  assert.equal(((await download.json()) as any).error.code, 'no-file');
});

test('uploading the same id again keeps breadcrumbs and the file', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const base = `/v1/labs/${lab.id}/papers`;
  await server.post(base, { paper, graph, fileBase64: file.toString('base64'), mediaType: 'application/pdf' }, lab.adminToken);
  await server.post(`${base}/paper-1/breadcrumbs`, { person: by }, lab.adminToken);
  await server.post(base, { paper: { ...paper, title: 'Renamed' }, graph }, lab.adminToken);

  const { papers } = (await (await server.get(base, lab.adminToken)).json()) as any;
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, 'Renamed');
  assert.equal(papers[0].breadcrumbs.length, 1);
  assert.equal(papers[0].hasFile, true);
  assert.equal((await server.get(`${base}/paper-1/file`, lab.adminToken)).status, 200);
});

test('breadcrumbs keep one per person, with the latest time', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const base = `/v1/labs/${lab.id}/papers`;
  await server.post(base, { paper, graph }, lab.adminToken);
  const path = `${base}/paper-1/breadcrumbs`;

  const first = (await (await server.post(path, { person: by }, member)).json()) as any;
  assert.equal(first.breadcrumbs.length, 1);
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  await server.post(path, { person: { did: 'did:plc:bo', name: 'Bo' } }, member);
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  const third = await server.post(path, { person: by }, member);
  assert.equal(third.status, 200);
  const crumbs = ((await third.json()) as any).breadcrumbs;

  assert.equal(crumbs.length, 2);
  const ada = crumbs.find((crumb: any) => crumb.did === by.did);
  assert.equal(ada.name, 'Ada');
  assert.ok(Date.parse(ada.at) > Date.parse(first.breadcrumbs[0].at));

  const { papers } = (await (await server.get(base, lab.adminToken)).json()) as any;
  assert.equal(papers[0].breadcrumbs.length, 2);
});

test('bad uploads and unknown papers are refused plainly', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const base = `/v1/labs/${lab.id}/papers`;
  assert.equal((await server.post(base, { graph }, lab.adminToken)).status, 400);
  assert.equal((await server.post(base, { paper }, lab.adminToken)).status, 400);
  assert.equal((await server.post(base, { paper: { title: 'no id' }, graph }, lab.adminToken)).status, 400);
  assert.equal((await server.post(base, { paper, graph, fileBase64: '***' }, lab.adminToken)).status, 400);
  assert.equal((await server.get(`${base}/nope`, lab.adminToken)).status, 404);
  assert.equal((await server.post(`${base}/nope/breadcrumbs`, { person: by }, lab.adminToken)).status, 404);
  await server.post(base, { paper, graph }, lab.adminToken);
  assert.equal((await server.post(`${base}/paper-1/breadcrumbs`, {}, lab.adminToken)).status, 400);
});

test('hostile ids and media types stay harmless', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const base = `/v1/labs/${lab.id}/papers`;
  const id = '../../../escape';
  const upload = await server.post(base, {
    paper: { ...paper, id, filename: 'bad\r\nname.pdf' },
    graph,
    fileBase64: file.toString('base64'),
    mediaType: 'text/html\r\nX-Injected: 1',
  }, lab.adminToken);
  assert.equal(upload.status, 200);
  const download = await server.get(`${base}/${encodeURIComponent(id)}/file`, lab.adminToken);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(download.headers.get('x-injected'), null);
});

test('papers stay within their lab', async (t) => {
  const server = await startTestServer(t);
  const first = await createLab(server, 'First');
  const second = await createLab(server, 'Second');
  await server.post(`/v1/labs/${first.id}/papers`, { paper, graph }, first.adminToken);
  const { papers } = (await (await server.get(`/v1/labs/${second.id}/papers`, second.adminToken)).json()) as any;
  assert.deepEqual(papers, []);
});
