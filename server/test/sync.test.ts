import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLab, joinLab, rec, startTestServer } from './helpers.ts';

test('records are stored once and handed back unchanged', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const record = rec('a', { nested: { a: [1, 2] } });
  const edge = rec('b', { kind: 'edge' });

  const first = await server.post(path, { records: [record, record, edge] }, lab.adminToken);
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as any).stored, 2);

  const repeat = await server.post(path, { records: [record] }, lab.adminToken);
  assert.equal(((await repeat.json()) as any).stored, 0);

  const pulled = (await (await server.get(path, lab.adminToken)).json()) as any;
  assert.deepEqual(pulled.records, [record, edge]);
  assert.equal(pulled.done, true);
});

test('another member sees the same records', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  await server.post(`/v1/labs/${lab.id}/records`, { records: [rec('from admin')] }, lab.adminToken);
  await server.post(`/v1/labs/${lab.id}/records`, { records: [rec('from admin'), rec('from member')] }, member);
  const { records } = (await (await server.get(`/v1/labs/${lab.id}/records`, member)).json()) as any;
  assert.deepEqual(records, [rec('from admin'), rec('from member')]);
});

test('paging walks every record exactly once', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const all = Array.from({ length: 7 }, (_, index) => rec(index));
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
  assert.deepEqual({ ...caughtUp, now: undefined }, { records: [], next: after, done: true, now: undefined });

  await server.post(path, { records: [rec(7)] }, lab.adminToken);
  const fresh = (await (await server.get(`${path}?after=${String(after)}`, lab.adminToken)).json()) as any;
  assert.deepEqual(fresh.records, [rec(7)]);
});

test('a page that ends exactly on the last record says done', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  await server.post(path, { records: [rec(1), rec(2), rec(3)] }, lab.adminToken);
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
  // Only what has a record's shape is kept, and one that hasn't refuses the whole push.
  const mixed = await server.post(path, { records: [rec('fine'), { kind: 'node' }] }, lab.adminToken);
  assert.equal(mixed.status, 400);
  assert.equal(((await mixed.json()) as any).error.code, 'bad-record');
  assert.deepEqual(((await (await server.get(path, lab.adminToken)).json()) as any).records, []);
  for (const odd of [1, 'text', null, [], { id: 'x', kind: 'node', at: 'now' }]) {
    assert.equal((await server.post(path, { records: [odd] }, lab.adminToken)).status, 400);
  }
});

test('parallel pushes lose nothing', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, index) => server.post(path, { records: [rec(index)] }, lab.adminToken)),
  );
  assert.ok(results.every((response) => response.status === 200));
  const { records } = (await (await server.get(path, lab.adminToken)).json()) as any;
  assert.equal(records.length, 25);
});

test('push and pull both tell the server time', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/records`;
  const before = Date.now();
  const pushed = (await (await server.post(path, { records: [rec(1)] }, lab.adminToken)).json()) as any;
  const pulled = (await (await server.get(path, lab.adminToken)).json()) as any;
  const after = Date.now();

  assert.deepEqual(Object.keys(pushed).sort(), ['now', 'stored']);
  assert.deepEqual(Object.keys(pulled).sort(), ['done', 'next', 'now', 'records']);
  for (const { now } of [pushed, pulled]) {
    assert.equal(new Date(now).toISOString(), now, 'an ISO string');
    assert.ok(Date.parse(now) >= before && Date.parse(now) <= after);
  }
});
