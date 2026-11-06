import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLab, joinLab, startTestServer } from './helpers.ts';

test('records are stored once and handed back unchanged', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const record = { kind: 'node', nested: { a: [1, 2] } };

  const first = await server.post(path, { records: [record, record, { kind: 'edge' }] }, lab.adminToken);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { stored: 2 });

  const repeat = await server.post(path, { records: [record] }, lab.adminToken);
  assert.deepEqual(await repeat.json(), { stored: 0 });

  const pulled = (await (await server.get(path, lab.adminToken)).json()) as any;
  assert.deepEqual(pulled.records, [record, { kind: 'edge' }]);
  assert.equal(pulled.done, true);
});

test('another member sees the same records', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  await server.post(`/v1/labs/${lab.id}/records`, { records: ['from admin'] }, lab.adminToken);
  await server.post(`/v1/labs/${lab.id}/records`, { records: ['from admin', 'from member'] }, member);
  const { records } = (await (await server.get(`/v1/labs/${lab.id}/records`, member)).json()) as any;
  assert.deepEqual(records, ['from admin', 'from member']);
});

test('paging walks every record exactly once', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const all = Array.from({ length: 7 }, (_, index) => ({ index }));
  await server.post(path, { records: all }, lab.adminToken);

  const seen: unknown[] = [];
  const pages: boolean[] = [];
  let after: unknown = '';
  for (let call = 0; call < 10; call += 1) {
    const page = (await (await server.get(`${path}?after=${String(after)}&limit=3`, lab.adminToken)).json()) as any;
    seen.push(...page.records);
    pages.push(page.done);
    after = page.next;
    if (page.done) break;
  }
  assert.deepEqual(seen, all);
  assert.deepEqual(pages, [false, false, true]);

  const caughtUp = (await (await server.get(`${path}?after=${String(after)}`, lab.adminToken)).json()) as any;
  assert.deepEqual(caughtUp, { records: [], next: after, done: true });

  await server.post(path, { records: [{ index: 7 }] }, lab.adminToken);
  const fresh = (await (await server.get(`${path}?after=${String(after)}`, lab.adminToken)).json()) as any;
  assert.deepEqual(fresh.records, [{ index: 7 }]);
});

test('a page that ends exactly on the last record says done', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  await server.post(path, { records: [1, 2, 3] }, lab.adminToken);
  const page = (await (await server.get(`${path}?limit=3`, lab.adminToken)).json()) as any;
  assert.equal(page.done, true);
});

test('bad paging and bad bodies are refused', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  assert.equal((await server.get(`${path}?after=abc`, lab.adminToken)).status, 400);
  assert.equal((await server.get(`${path}?limit=-1`, lab.adminToken)).status, 400);
  assert.equal((await server.get(`${path}?limit=0`, lab.adminToken)).status, 400);
  assert.equal((await server.post(path, { records: 'nope' }, lab.adminToken)).status, 400);
});

test('parallel pushes lose nothing', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, index) => server.post(path, { records: [{ index }] }, lab.adminToken)),
  );
  assert.ok(results.every((response) => response.status === 200));
  const { records } = (await (await server.get(path, lab.adminToken)).json()) as any;
  assert.equal(records.length, 25);
});
