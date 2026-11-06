import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLab, joinLab, readAllData, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const person = { did: 'did:plc:new', name: 'New Person' };

async function requestToJoin(server: TestServer, labId: string, who = person): Promise<{ requestId: string; secret: string }> {
  const response = await server.post(`/v1/labs/${labId}/join`, { person: who });
  assert.equal(response.status, 200);
  return (await response.json()) as { requestId: string; secret: string };
}

test('creating a lab returns a readable id and a token, and the creator is admin', async (t) => {
  const server = await startTestServer(t);
  const response = await server.post('/v1/labs', {
    name: 'Tension Lab',
    person: { did: 'did:plc:ada', name: 'Ada' },
    labDid: 'did:plc:lab',
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.deepEqual(Object.keys(body).sort(), ['lab', 'token']);
  assert.equal(body.lab.name, 'Tension Lab');
  assert.match(body.lab.id, /^tension-lab-[a-z0-9]{3}$/);

  const members = (await (await server.get(`/v1/labs/${body.lab.id}/members`, body.token)).json()) as any;
  assert.deepEqual(members, { members: [{ did: 'did:plc:ada', name: 'Ada', role: 'admin', tokenKind: 'personal' }] });
});

test('creating a lab needs a name and a person', async (t) => {
  const server = await startTestServer(t);
  assert.equal((await server.post('/v1/labs', { person })).status, 400);
  assert.equal((await server.post('/v1/labs', { name: 'X' })).status, 400);
  assert.equal((await server.post('/v1/labs', { name: 'X', person: { did: 'only' } })).status, 400);
});

test('anyone can confirm a lab, and only its id and name are shown', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const response = await server.get(`/v1/labs/${lab.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: lab.id, name: 'Tension Lab' });
  assert.equal((await server.get('/v1/labs/no-such-lab')).status, 404);
  assert.equal((await server.get('/v1/labs/..%2F..%2Fetc')).status, 404);
});

test('the full join flow: pending, then accepted with a working token', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const { requestId, secret } = await requestToJoin(server, lab.id);

  const pollUrl = `/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`;
  assert.deepEqual(await (await server.get(pollUrl)).json(), { state: 'pending' });

  const pending = (await (await server.get(`/v1/labs/${lab.id}/requests`, lab.adminToken)).json()) as any;
  assert.equal(pending.requests.length, 1);
  assert.deepEqual(Object.keys(pending.requests[0]).sort(), ['at', 'id', 'person']);
  assert.deepEqual(pending.requests[0].person, person);

  const decided = await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'accept', tokenKind: 'team' }, lab.adminToken);
  assert.equal(decided.status, 200);
  assert.ok(!JSON.stringify(await decided.json()).includes('token":"'), 'the admin never sees the token');

  const accepted = (await (await server.get(pollUrl)).json()) as any;
  assert.equal(accepted.state, 'accepted');
  assert.equal(accepted.tokenKind, 'team');
  assert.equal(typeof accepted.token, 'string');

  const again = (await (await server.get(pollUrl)).json()) as any;
  assert.equal(again.token, accepted.token, 'a lost response can be fetched again');

  const members = (await (await server.get(`/v1/labs/${lab.id}/members`, accepted.token)).json()) as any;
  assert.deepEqual(members.members[1], { ...person, role: 'member', tokenKind: 'team' });

  const remaining = (await (await server.get(`/v1/labs/${lab.id}/requests`, lab.adminToken)).json()) as any;
  assert.deepEqual(remaining.requests, []);
});

test('tokenKind defaults to personal, and a bad one is refused', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const first = await requestToJoin(server, lab.id);
  const bad = await server.post(`/v1/labs/${lab.id}/requests/${first.requestId}`, { decision: 'accept', tokenKind: 'gold' }, lab.adminToken);
  assert.equal(bad.status, 400);
  await server.post(`/v1/labs/${lab.id}/requests/${first.requestId}`, { decision: 'accept' }, lab.adminToken);
  const poll = (await (await server.get(`/v1/labs/${lab.id}/join/${first.requestId}?secret=${encodeURIComponent(first.secret)}`)).json()) as any;
  assert.equal(poll.tokenKind, 'personal');
});

test('a declined request gets no token, and a decided request cannot be decided again', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const { requestId, secret } = await requestToJoin(server, lab.id);
  const decide = (decision: string) => server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision }, lab.adminToken);

  assert.equal((await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'maybe' }, lab.adminToken)).status, 400);
  assert.equal((await decide('decline')).status, 200);
  assert.deepEqual(
    await (await server.get(`/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`)).json(),
    { state: 'declined' },
  );
  const again = await decide('accept');
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as any).error.code, 'already-decided');
  assert.equal((await server.post(`/v1/labs/${lab.id}/requests/nope`, { decision: 'accept' }, lab.adminToken)).status, 404);
});

test('the token is only ever given to the holder of the secret', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const { requestId, secret } = await requestToJoin(server, lab.id);
  await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'accept' }, lab.adminToken);
  const path = `/v1/labs/${lab.id}/join/${requestId}`;

  const noSecret = await server.get(path);
  assert.equal(noSecret.status, 401);
  assert.ok(!('token' in ((await noSecret.json()) as object)));

  const wrongSecret = await server.get(`${path}?secret=wrong`);
  assert.equal(wrongSecret.status, 403);
  assert.ok(!('token' in ((await wrongSecret.json()) as object)));

  const adminWithoutSecret = await server.get(path, lab.adminToken);
  assert.equal(adminWithoutSecret.status, 401);

  const right = (await (await server.get(`${path}?secret=${encodeURIComponent(secret)}`)).json()) as any;
  assert.equal(typeof right.token, 'string');
});

test('a token is not given before acceptance, even with the secret', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const { requestId, secret } = await requestToJoin(server, lab.id);
  const body = (await (await server.get(`/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`)).json()) as object;
  assert.ok(!('token' in body));
});

test('no token gets 401, a wrong token gets 403', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  for (const path of ['members', 'requests', 'records', 'papers']) {
    const none = await server.get(`/v1/labs/${lab.id}/${path}`);
    assert.equal(none.status, 401, path);
    assert.equal(((await none.json()) as any).error.code, 'no-token');
    assert.equal((await server.get(`/v1/labs/${lab.id}/${path}`, 'made-up-token')).status, 403, path);
  }
  const malformed = await fetch(`${server.url}/v1/labs/${lab.id}/members`, { headers: { authorization: lab.adminToken } });
  assert.equal(malformed.status, 401);
});

test('a member cannot reach another lab, on any route', async (t) => {
  const server = await startTestServer(t);
  const mine = await createLab(server, 'Mine');
  const other = await createLab(server, 'Other');
  const member = await joinLab(server, mine);
  const base = `/v1/labs/${other.id}`;

  for (const token of [member, mine.adminToken]) {
    for (const path of ['members', 'requests', 'records', 'papers', 'papers/p1', 'papers/p1/file']) {
      assert.equal((await server.get(`${base}/${path}`, token)).status, 403, path);
    }
    assert.equal((await server.post(`${base}/records`, { records: [1] }, token)).status, 403);
    assert.equal((await server.post(`${base}/papers`, { paper: { id: 'p' }, graph: {} }, token)).status, 403);
    assert.equal((await server.post(`${base}/papers/p1/breadcrumbs`, { person }, token)).status, 403);
    assert.equal((await server.post(`${base}/requests/r1`, { decision: 'accept' }, token)).status, 403);
  }
  assert.equal((await server.get('/v1/labs/no-such-lab/members', member)).status, 403);
});

test('a non-admin member cannot see or decide requests', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const { requestId, secret } = await requestToJoin(server, lab.id);

  const list = await server.get(`/v1/labs/${lab.id}/requests`, member);
  assert.equal(list.status, 403);
  assert.equal(((await list.json()) as any).error.code, 'not-admin');

  const decide = await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'accept' }, member);
  assert.equal(decide.status, 403);
  const state = await (await server.get(`/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`)).json();
  assert.deepEqual(state, { state: 'pending' });
});

test('copying the admin did in a join request does not grant admin', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const copycat = await joinLab(server, lab, 'did:plc:admin');
  assert.equal((await server.get(`/v1/labs/${lab.id}/requests`, copycat)).status, 403);
  assert.equal((await server.get(`/v1/labs/${lab.id}/requests`, lab.adminToken)).status, 200);
  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, lab.adminToken)).json()) as any;
  assert.equal(members.length, 1, 'one person, not two');
});

test('tokens and secrets are not on disk in plain form, and data files are private', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const { requestId, secret } = await requestToJoin(server, lab.id);
  await server.post(`/v1/labs/${lab.id}/requests/${requestId}`, { decision: 'accept' }, lab.adminToken);
  const { token } = (await (await server.get(`/v1/labs/${lab.id}/join/${requestId}?secret=${encodeURIComponent(secret)}`)).json()) as any;

  const disk = readAllData(server.dataDir);
  assert.ok(disk.includes(lab.id), 'the check is reading real data');
  for (const value of [lab.adminToken, token, secret]) {
    assert.ok(!disk.includes(value));
  }
  const labFile = join(server.dataDir, 'json', 'labs', `${lab.id}.json`);
  assert.equal(statSync(labFile).mode & 0o777, 0o600);
});
