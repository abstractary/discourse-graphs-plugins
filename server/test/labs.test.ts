import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { rec, createLab, joinLab, readAllData, startTestServer } from './helpers.ts';
import type { LabFixture, TestServer } from './helpers.ts';

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
    assert.equal((await server.post(`${base}/records`, { records: [rec(1)] }, token)).status, 403);
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

async function makeInvite(server: TestServer, lab: LabFixture, body: object = {}): Promise<{ id: string; code: string; expiresAt: string; usesLeft: number }> {
  const response = await server.post(`/v1/labs/${lab.id}/invites`, body, lab.adminToken);
  assert.equal(response.status, 200);
  return ((await response.json()) as any).invite;
}

function useInvite(server: TestServer, labId: string, code: string, who = person): Promise<Response> {
  return server.post(`/v1/labs/${labId}/invites/accept`, { code, person: who });
}

function labFile(server: TestServer, labId: string): string {
  return join(server.dataDir, 'json', 'labs', `${labId}.json`);
}

test('an invite lets its holder join at once, with a working token', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const before = Date.now();
  const invite = await makeInvite(server, lab);
  assert.deepEqual(Object.keys(invite).sort(), ['code', 'expiresAt', 'id', 'usesLeft']);
  assert.equal(invite.usesLeft, 1);
  const days = (Date.parse(invite.expiresAt) - before) / (24 * 60 * 60 * 1000);
  assert.ok(days > 6.99 && days < 7.01, 'seven days by default');

  const response = await useInvite(server, lab.id, invite.code);
  assert.equal(response.status, 200);
  const joined = (await response.json()) as any;
  assert.deepEqual(Object.keys(joined).sort(), ['lab', 'role', 'token', 'tokenKind']);
  assert.deepEqual(joined.lab, { id: lab.id, name: 'Tension Lab' });
  assert.equal(joined.tokenKind, 'personal');
  assert.equal(joined.role, 'member');

  const members = (await (await server.get(`/v1/labs/${lab.id}/members`, joined.token)).json()) as any;
  assert.deepEqual(members.members[1], { ...person, role: 'member', tokenKind: 'personal' });
  assert.equal((await server.get(`/v1/labs/${lab.id}/invites`, joined.token)).status, 403, 'a member, not an admin');
  const requests = (await (await server.get(`/v1/labs/${lab.id}/requests`, lab.adminToken)).json()) as any;
  assert.deepEqual(requests.requests, [], 'no request to approve');
});

test('an invite carries its uses, days and token kind', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const before = Date.now();
  const invite = await makeInvite(server, lab, { uses: 2, days: 30, tokenKind: 'team' });
  assert.equal(invite.usesLeft, 2);
  const days = (Date.parse(invite.expiresAt) - before) / (24 * 60 * 60 * 1000);
  assert.ok(days > 29.99 && days < 30.01);

  const first = (await (await useInvite(server, lab.id, invite.code, { did: 'did:plc:one', name: 'One' })).json()) as any;
  const second = (await (await useInvite(server, lab.id, invite.code, { did: 'did:plc:two', name: 'Two' })).json()) as any;
  assert.equal(first.tokenKind, 'team');
  assert.notEqual(first.token, second.token);
  const third = await useInvite(server, lab.id, invite.code, { did: 'did:plc:three', name: 'Three' });
  assert.equal(third.status, 403);
  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, second.token)).json()) as any;
  assert.deepEqual(members.map((member: any) => member.did), ['did:plc:admin', 'did:plc:one', 'did:plc:two']);
});

test('bad invite settings are refused, and only the admin can make one', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const path = `/v1/labs/${lab.id}/invites`;
  for (const body of [{ uses: 0 }, { uses: 101 }, { uses: 1.5 }, { uses: '3' }, { days: 0 }, { days: 91 }, { days: -1 }, { tokenKind: 'gold' }]) {
    assert.equal((await server.post(path, body, lab.adminToken)).status, 400, JSON.stringify(body));
  }
  assert.equal((await server.post(path, { uses: 100, days: 90 }, lab.adminToken)).status, 200);
  assert.equal((await server.post(path, {})).status, 401);
  const asMember = await server.post(path, {}, member);
  assert.equal(asMember.status, 403);
  assert.equal(((await asMember.json()) as any).error.code, 'not-admin');
  assert.equal((await server.get(path, member)).status, 403);
  assert.equal((await server.del(`${path}/any`, member)).status, 403);
});

test('wrong, used-up and expired codes all get the same answer', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const used = await makeInvite(server, lab);
  assert.equal((await useInvite(server, lab.id, used.code)).status, 200);
  const expired = await makeInvite(server, lab);
  const stored = JSON.parse(readFileSync(labFile(server, lab.id), 'utf8'));
  stored.invites.find((invite: any) => invite.id === expired.id).expiresAt = new Date(Date.now() - 1000).toISOString();
  writeFileSync(labFile(server, lab.id), JSON.stringify(stored));

  const answers: unknown[] = [];
  for (const code of ['made-up-code', used.code, expired.code]) {
    const response = await useInvite(server, lab.id, code, { did: 'did:plc:late', name: 'Late' });
    assert.equal(response.status, 403);
    answers.push(await response.json());
  }
  assert.equal((answers[0] as any).error.code, 'bad-invite');
  assert.match((answers[0] as any).error.message, /new invite/);
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);

  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, lab.adminToken)).json()) as any;
  assert.equal(members.length, 2, 'nobody got in on a bad code');
});

test('accepting an invite needs a code and a person, and a code only works in its own lab', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const other = await createLab(server, 'Other');
  const invite = await makeInvite(server, lab);
  const path = `/v1/labs/${lab.id}/invites/accept`;
  assert.equal((await server.post(path, { person })).status, 400);
  assert.equal((await server.post(path, { code: invite.code })).status, 400);
  assert.equal((await server.post(path, { code: invite.code, person: { did: 'only' } })).status, 400);
  assert.equal((await useInvite(server, other.id, invite.code)).status, 403);
  assert.equal((await useInvite(server, 'no-such-lab', invite.code)).status, 404);
  assert.equal((await useInvite(server, lab.id, invite.code)).status, 200, 'the failed tries used nothing up');
});

test('two people racing for the last use: only one gets in', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const invite = await makeInvite(server, lab);
  const tries = await Promise.all(
    Array.from({ length: 8 }, (_, index) => useInvite(server, lab.id, invite.code, { did: `did:plc:racer${index}`, name: 'Racer' })),
  );
  assert.equal(tries.filter((response) => response.status === 200).length, 1);
  assert.equal(tries.filter((response) => response.status === 403).length, 7);
});

test('a member who accepts an invite gets a fresh token and stays one person', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const old = await joinLab(server, lab, person.did);
  const invite = await makeInvite(server, lab, { tokenKind: 'team' });
  const joined = (await (await useInvite(server, lab.id, invite.code)).json()) as any;
  assert.notEqual(joined.token, old);

  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, joined.token)).json()) as any;
  assert.deepEqual(members.slice(1), [{ ...person, role: 'member', tokenKind: 'team' }]);
  assert.equal((await server.get(`/v1/labs/${lab.id}/members`, old)).status, 200, 'the older token still works');
});

test('an invite that copies the admin did does not grant admin', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const invite = await makeInvite(server, lab);
  const copycat = (await (await useInvite(server, lab.id, invite.code, { did: 'did:plc:admin', name: 'Copycat' })).json()) as any;
  assert.equal(copycat.role, 'member');
  assert.equal((await server.get(`/v1/labs/${lab.id}/requests`, copycat.token)).status, 403);
  assert.equal((await server.post(`/v1/labs/${lab.id}/invites`, {}, copycat.token)).status, 403);
});

test('the admin can list and delete invites, and the list never shows a code', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const path = `/v1/labs/${lab.id}/invites`;
  const keep = await makeInvite(server, lab, { uses: 2 });
  const drop = await makeInvite(server, lab);
  const spent = await makeInvite(server, lab);
  await useInvite(server, lab.id, spent.code);
  await useInvite(server, lab.id, keep.code, { did: 'did:plc:one', name: 'One' });

  const listed = await server.get(path, lab.adminToken);
  const text = await listed.text();
  for (const invite of [keep, drop, spent]) assert.ok(!text.includes(invite.code));
  const { invites } = JSON.parse(text);
  assert.deepEqual(invites.map((invite: any) => invite.id), [keep.id, drop.id], 'the used-up one is gone');
  assert.deepEqual(Object.keys(invites[0]).sort(), ['by', 'createdAt', 'expiresAt', 'id', 'usesLeft']);
  assert.equal(invites[0].usesLeft, 1);
  assert.equal(invites[0].by, 'did:plc:admin');
  assert.equal(invites[0].expiresAt, keep.expiresAt);

  const deleted = await server.del(`${path}/${drop.id}`, lab.adminToken);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: drop.id });
  assert.equal((await useInvite(server, lab.id, drop.code, { did: 'did:plc:two', name: 'Two' })).status, 403);

  const again = await server.del(`${path}/${drop.id}`, lab.adminToken);
  assert.equal(again.status, 404);
  assert.equal(((await again.json()) as any).error.code, 'no-invite');
  const left = (await (await server.get(path, lab.adminToken)).json()) as any;
  assert.deepEqual(left.invites.map((invite: any) => invite.id), [keep.id]);
});

test('an invite code is not on disk in plain form', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const invite = await makeInvite(server, lab, { uses: 2 });
  const { token } = (await (await useInvite(server, lab.id, invite.code)).json()) as any;
  const disk = readAllData(server.dataDir);
  assert.ok(disk.includes(invite.id), 'the check is reading real data');
  assert.ok(!disk.includes(invite.code));
  assert.ok(!disk.includes(token));
});

const removePath = (labId: string, did: string): string => `/v1/labs/${labId}/members/${encodeURIComponent(did)}`;

test('removing a member takes them off the list and their token says why', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const other = await joinLab(server, lab, 'did:plc:other');
  await server.post(`/v1/labs/${lab.id}/records`, { records: [rec('kept')] }, member);

  const removed = await server.del(removePath(lab.id, 'did:plc:member'), lab.adminToken);
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { removed: 'did:plc:member' });

  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, lab.adminToken)).json()) as any;
  assert.deepEqual(members.map((entry: any) => entry.did), ['did:plc:admin', 'did:plc:other']);

  const base = `/v1/labs/${lab.id}`;
  const tries = [
    await server.get(`${base}/members`, member),
    await server.get(`${base}/records`, member),
    await server.post(`${base}/records`, { records: [rec('late')] }, member),
    await server.get(`${base}/papers`, member),
    await server.get(`${base}/requests`, member),
    await server.post('/v1/ai/ask', { question: 'Why?', units: [] }, member),
  ];
  for (const response of tries) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: { code: 'removed', message: 'You were removed from this lab. Ask its PI if that was a mistake.' },
    });
  }
  assert.equal((await server.get(`${base}/members`, 'made-up-token')).status, 403);
  assert.equal(((await (await server.get(`${base}/members`, 'made-up-token')).json()) as any).error.code, 'wrong-token');

  const { records } = (await (await server.get(`${base}/records`, other)).json()) as any;
  assert.deepEqual(records, [rec('kept')], 'their work stays, and the others carry on');

  const stored = JSON.parse(readFileSync(labFile(server, lab.id), 'utf8'));
  assert.equal(stored.removed.length, 1);
  assert.equal(stored.removed[0].did, 'did:plc:member');
  assert.equal(stored.revoked.length, 1);
  assert.ok(!JSON.stringify(stored).includes(member), 'only the hash of the old token is kept');
});

test('removing a member drops every token of theirs and declines their pending requests', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const first = await joinLab(server, lab);
  const invite = await makeInvite(server, lab);
  const second = ((await (await useInvite(server, lab.id, invite.code, { did: 'did:plc:member', name: 'Member' })).json()) as any).token;
  const waiting = await requestToJoin(server, lab.id, { did: 'did:plc:member', name: 'Member' });
  const bystander = await requestToJoin(server, lab.id);

  assert.equal((await server.del(removePath(lab.id, 'did:plc:member'), lab.adminToken)).status, 200);
  for (const token of [first, second]) {
    const response = await server.get(`/v1/labs/${lab.id}/members`, token);
    assert.equal(((await response.json()) as any).error.code, 'removed');
  }
  const poll = await server.get(`/v1/labs/${lab.id}/join/${waiting.requestId}?secret=${encodeURIComponent(waiting.secret)}`);
  assert.deepEqual(await poll.json(), { state: 'declined' });
  const pending = (await (await server.get(`/v1/labs/${lab.id}/requests`, lab.adminToken)).json()) as any;
  assert.deepEqual(pending.requests.map((request: any) => request.id), [bystander.requestId]);
});

test('an admin cannot remove themself, a member cannot remove anyone, and an unknown member is a 404', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);

  const self = await server.del(removePath(lab.id, 'did:plc:admin'), lab.adminToken);
  assert.equal(self.status, 409);
  assert.equal(((await self.json()) as any).error.code, 'cannot-remove-self');

  const unknown = await server.del(removePath(lab.id, 'did:plc:nobody'), lab.adminToken);
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as any).error.code, 'no-member');

  const asMember = await server.del(removePath(lab.id, 'did:plc:admin'), member);
  assert.equal(asMember.status, 403);
  assert.equal(((await asMember.json()) as any).error.code, 'not-admin');
  assert.equal((await server.del(removePath(lab.id, 'did:plc:member'))).status, 401);
  assert.equal((await server.get(`/v1/labs/${lab.id}/members`, lab.adminToken)).status, 200);
  assert.equal((await server.get(`/v1/labs/${lab.id}/members`, member)).status, 200);
});

test('a removed person can rejoin with a fresh invite, and the old token stays dead', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const old = await joinLab(server, lab);
  await server.del(removePath(lab.id, 'did:plc:member'), lab.adminToken);

  const invite = await makeInvite(server, lab);
  const back = await useInvite(server, lab.id, invite.code, { did: 'did:plc:member', name: 'Member' });
  assert.equal(back.status, 200);
  const { token } = (await back.json()) as any;
  const { members } = (await (await server.get(`/v1/labs/${lab.id}/members`, token)).json()) as any;
  assert.deepEqual(members[1], { did: 'did:plc:member', name: 'Member', role: 'member', tokenKind: 'personal' });
  const stale = await server.get(`/v1/labs/${lab.id}/members`, old);
  assert.equal(((await stale.json()) as any).error.code, 'removed');
});

test('a lab stored before invites and removal still works', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const member = await joinLab(server, lab);
  const stored = JSON.parse(readFileSync(labFile(server, lab.id), 'utf8'));
  for (const key of ['invites', 'removed', 'revoked']) delete stored[key];
  writeFileSync(labFile(server, lab.id), JSON.stringify(stored));

  assert.equal((await server.get(`/v1/labs/${lab.id}/members`, member)).status, 200);
  assert.equal((await server.get(`/v1/labs/${lab.id}/members`, 'made-up-token')).status, 403);
  assert.deepEqual(await (await server.get(`/v1/labs/${lab.id}/invites`, lab.adminToken)).json(), { invites: [] });
  assert.equal((await server.del(`/v1/labs/${lab.id}/invites/none`, lab.adminToken)).status, 404);
  assert.equal((await useInvite(server, lab.id, 'made-up-code')).status, 403);
  const invite = await makeInvite(server, lab);
  assert.equal((await useInvite(server, lab.id, invite.code)).status, 200);
  assert.equal((await server.del(removePath(lab.id, 'did:plc:member'), lab.adminToken)).status, 200);
  assert.equal(((await (await server.get(`/v1/labs/${lab.id}/members`, member)).json()) as any).error.code, 'removed');
});

test('a browser may send DELETE from another origin', async (t) => {
  const server = await startTestServer(t);
  const lab = await createLab(server);
  const preflight = await fetch(`${server.url}${removePath(lab.id, 'did:plc:member')}`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /DELETE/);
});
