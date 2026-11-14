import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_PAPERS, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const INBOX = '/v1/notify/inbox';
const INBOX_REL = 'http://www.w3.org/ns/ldp#inbox';
const doi = '10.5555/ABC.123';

function review(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    '@context': ['https://www.w3.org/ns/activitystreams', 'https://coar-notify.net'],
    id: 'urn:uuid:94ecae35-dcfd-4182-8550-22c7164fe23f',
    type: ['Announce', 'coar-notify:ReviewAction'],
    actor: { id: 'https://review-service.com', name: 'Review Service', type: 'Service' },
    context: { id: `https://doi.org/${doi}` },
    object: { id: 'https://review-service.com/review/21', type: ['Page', 'sorg:Review'] },
    origin: { id: 'https://review-service.com/system', inbox: 'https://review-service.com/inbox/', type: 'Service' },
    target: { id: 'https://graphs.example.org', inbox: 'https://graphs.example.org/v1/notify/inbox', type: 'Service' },
    ...overrides,
  };
}

function relationship(overrides: Record<string, unknown> = {}): Record<string, any> {
  return review({
    id: 'urn:uuid:11111111-2222-4333-8444-555555555555',
    type: ['Announce', 'coar-notify:RelationshipAction'],
    context: { id: 'https://data.example.org/item/7' },
    object: {
      id: 'urn:uuid:74ffb356-0632-44d9-b176-888da85758dc',
      type: 'Relationship',
      'as:subject': 'https://data.example.org/item/7',
      'as:relationship': 'http://purl.org/vocab/frbr/core#supplement',
      'as:object': 'https://doi.org/10.7777/other',
    },
    ...overrides,
  });
}

function send(server: TestServer, body: unknown, contentType = 'application/ld+json'): Promise<Response> {
  return fetch(server.url + INBOX, { method: 'POST', headers: { 'content-type': contentType }, body: JSON.stringify(body) });
}

async function summaries(server: TestServer, query = ''): Promise<any[]> {
  const response = await server.get(INBOX + query);
  assert.equal(response.status, 200);
  return ((await response.json()) as any).notifications;
}

test('a valid notification is stored and answered with 201 and its Location', async (t) => {
  const server = await startTestServer(t);
  for (const contentType of ['application/ld+json', 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"', 'application/json']) {
    const id = `urn:uuid:${contentType.length}`;
    const response = await send(server, review({ id }), contentType);
    assert.equal(response.status, 201, contentType);
    const location = response.headers.get('location') ?? '';
    assert.ok(location.startsWith(`${server.url}${INBOX}/`));

    const stored = await fetch(location);
    assert.equal(stored.status, 200);
    assert.match(stored.headers.get('content-type') ?? '', /^application\/ld\+json/);
    assert.deepEqual(await stored.json(), review({ id }));
  }
  assert.equal((await server.get(`${INBOX}/nothing-here`)).status, 404);
});

test('every pattern of the specification is accepted', async (t) => {
  const server = await startTestServer(t);
  const offer = review({ id: 'urn:uuid:offer', type: ['Offer', 'coar-notify:EndorsementAction'] });
  const bodies = [
    review(),
    relationship(),
    offer,
    review({ id: 'urn:uuid:ingest', type: ['Offer', 'coar-notify:IngestAction'] }),
    review({ id: 'urn:uuid:endorse', type: ['Announce', 'coar-notify:EndorsementAction'] }),
    review({ id: 'urn:uuid:result', type: ['Announce'] }),
    review({ id: 'urn:uuid:flag', type: ['Flag', 'coar-notify:UnprocessableNotification'], object: { id: 'urn:uuid:offer' } }),
    ...['Accept', 'Reject', 'TentativeAccept', 'TentativeReject', 'Undo'].map((type) =>
      review({ id: `urn:uuid:${type}`, type, inReplyTo: 'urn:uuid:offer', object: offer }),
    ),
    // Allowed by the specification: no actor, no origin inbox, the old context address, an http id.
    review({ id: 'https://review-service.com/n/1', actor: undefined, origin: { id: 'https://a.org', type: 'Service' } }),
    review({ id: 'urn:uuid:old', '@context': ['https://www.w3.org/ns/activitystreams', 'https://purl.org/coar/notify'] }),
  ];
  for (const body of bodies) {
    const response = await send(server, body);
    assert.equal(response.status, 201, JSON.stringify(body.type));
  }
  assert.equal((await summaries(server)).length, bodies.length);
});

test('each broken rule is refused with 400 and a message that names it', async (t) => {
  const server = await startTestServer(t);
  const service = review().origin;
  const cases: [Record<string, unknown>, RegExp][] = [
    [review({ '@context': undefined }), /"@context" must be a list/],
    [review({ '@context': 'https://www.w3.org/ns/activitystreams' }), /"@context" must be a list/],
    [review({ '@context': ['https://coar-notify.net'] }), /activitystreams/],
    [review({ '@context': ['https://www.w3.org/ns/activitystreams'] }), /coar-notify\.net/],
    [review({ '@context': ['https://www.w3.org/ns/activitystreams', 'https://coar-notify.net.evil.example'] }), /coar-notify\.net/],
    [review({ id: undefined }), /"id" must be a URI/],
    [review({ id: 'not a uri' }), /"id" must be a URI/],
    [review({ id: 42 }), /"id" must be a URI/],
    [review({ type: undefined }), /"type" must hold one activity type/],
    [review({ type: ['Like'] }), /"type" must hold one activity type/],
    [review({ type: ['coar-notify:ReviewAction'] }), /"type" must hold one activity type/],
    [review({ type: ['Announce', 'Offer'] }), /"type" must hold one activity type/],
    [review({ type: ['Announce', 'coar-notify:DanceAction'] }), /not a COAR Notify type/],
    [review({ type: ['Offer'] }), /An Offer needs a second type/],
    [review({ type: ['Flag'] }), /UnprocessableNotification/],
    [review({ origin: undefined }), /"origin" as an object/],
    [review({ origin: { ...service, id: 'urn:uuid:1' } }), /"origin\.id"/],
    [review({ origin: { ...service, type: undefined } }), /"origin\.type"/],
    [review({ origin: { ...service, inbox: 'mailto:a@b.org' } }), /"origin\.inbox"/],
    [review({ target: 'https://graphs.example.org' }), /"target" as an object/],
    [review({ target: { ...service, id: undefined } }), /"target\.id"/],
    [review({ target: { ...service, type: undefined } }), /"target\.type"/],
    [review({ target: { ...service, inbox: undefined } }), /"target\.inbox" is missing/],
    [review({ object: undefined }), /"object" as an object/],
    [review({ object: 'https://review-service.com/review/21' }), /"object" as an object/],
    [review({ object: { type: 'Page' } }), /"object\.id"/],
    [relationship({ object: { ...relationship().object, type: 'Page' } }), /"Relationship"/],
    [relationship({ object: { ...relationship().object, 'as:subject': undefined } }), /as:subject/],
    [relationship({ object: { ...relationship().object, 'as:relationship': undefined } }), /as:relationship/],
    [relationship({ object: { ...relationship().object, 'as:object': 7 } }), /as:object/],
    [review({ actor: { name: 'No id', type: 'Person' } }), /"actor\.id"/],
    [review({ actor: { id: 'https://a.org', type: 'Robot' } }), /"actor\.type"/],
    [review({ context: {} }), /"context\.id"/],
    [review({ inReplyTo: 'not a uri' }), /"inReplyTo"/],
  ];
  for (const [body, message] of cases) {
    const response = await send(server, body);
    assert.equal(response.status, 400, String(message));
    const { error } = (await response.json()) as any;
    assert.equal(error.code, 'bad-notification');
    assert.match(error.message, message);
  }
  assert.deepEqual(await summaries(server), []);
});

test('a body that is not JSON-LD is refused before it is read as a notification', async (t) => {
  const server = await startTestServer(t);
  const wrongType = await send(server, review(), 'text/turtle');
  assert.equal(wrongType.status, 415);
  assert.match(wrongType.headers.get('accept-post') ?? '', /application\/ld\+json/);

  const notJson = await fetch(server.url + INBOX, { method: 'POST', headers: { 'content-type': 'application/ld+json' }, body: '{oops' });
  assert.equal(notJson.status, 400);
  assert.equal(((await notJson.json()) as any).error.code, 'bad-json');

  const huge = await send(server, review({ summary: 'x'.repeat(300 * 1024) }));
  assert.equal(huge.status, 413);
  assert.deepEqual(await summaries(server), []);
});

test('the same id posted twice is stored once and gets the same Location', async (t) => {
  const server = await startTestServer(t);
  const first = await send(server, review());
  const second = await send(server, review({ object: { id: 'https://review-service.com/review/changed' } }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('location'), first.headers.get('location'));

  const all = await summaries(server);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].about, ['https://review-service.com/review/21']);
});

test('the inbox lists as LDN for application/ld+json and as summaries otherwise', async (t) => {
  const server = await startTestServer(t);
  const first = (await send(server, review())).headers.get('location');
  const second = (await send(server, relationship())).headers.get('location');

  const ldn = await fetch(server.url + INBOX, { headers: { accept: 'application/ld+json' } });
  assert.equal(ldn.status, 200);
  assert.match(ldn.headers.get('content-type') ?? '', /^application\/ld\+json/);
  assert.deepEqual(await ldn.json(), {
    '@context': 'http://www.w3.org/ns/ldp',
    '@id': `${server.url}${INBOX}`,
    contains: [second, first],
  });

  const plain = await server.get(INBOX);
  assert.match(plain.headers.get('content-type') ?? '', /^application\/json/);
  const [newest, oldest] = ((await plain.json()) as any).notifications;
  assert.deepEqual(Object.keys(oldest).sort(), ['about', 'actor', 'context', 'from', 'id', 'notification', 'receivedAt', 'types']);
  assert.equal(oldest.id, review().id);
  assert.deepEqual(oldest.types, ['Announce', 'coar-notify:ReviewAction']);
  assert.deepEqual(oldest.about, ['https://review-service.com/review/21']);
  assert.equal(oldest.context, `https://doi.org/${doi}`);
  assert.equal(oldest.from, 'https://review-service.com/system');
  assert.equal(oldest.actor, 'Review Service');
  assert.ok(!Number.isNaN(Date.parse(oldest.receivedAt)));
  assert.deepEqual(oldest.notification, review());
  // A relationship is about both ends of it.
  assert.deepEqual(newest.about, ['https://data.example.org/item/7', 'https://doi.org/10.7777/other']);

  await send(server, review({ id: 'urn:uuid:no-name', actor: { id: 'https://orcid.org/0000-0002-1825-0097', type: 'Person' } }));
  assert.equal((await summaries(server))[0].actor, 'https://orcid.org/0000-0002-1825-0097');
});

test('?about= finds a DOI however it is spelled', async (t) => {
  const server = await startTestServer(t);
  await send(server, review());
  await send(server, relationship());
  await send(server, review({ id: 'urn:uuid:cited', context: undefined, object: { id: 'https://repo.example.org/item/9', 'ietf:cite-as': 'https://doi.org/10.9999/cited' } }));

  for (const spelling of [`https://doi.org/${doi}`, `doi:${doi}`, doi, doi.toLowerCase(), `HTTPS://DOI.ORG/${doi.toUpperCase()}`]) {
    const found = await summaries(server, `?about=${encodeURIComponent(spelling)}`);
    assert.deepEqual(found.map((entry) => entry.id), [review().id], spelling);
  }
  // The object of a relationship, an ordinary address, and a DOI given as cite-as.
  assert.equal((await summaries(server, '?about=doi:10.7777/OTHER')).length, 1);
  assert.equal((await summaries(server, `?about=${encodeURIComponent('https://data.example.org/item/7')}`)).length, 1);
  assert.equal((await summaries(server, '?about=10.9999/cited')).length, 1);
  assert.deepEqual(await summaries(server, '?about=10.1000/none'), []);

  const ldn = await fetch(`${server.url}${INBOX}?about=${doi}`, { headers: { accept: 'application/ld+json' } });
  assert.equal(((await ldn.json()) as any).contains.length, 1);
});

test('the inbox is advertised on the front door, on landing pages and on OPTIONS', async (t) => {
  const server = await startTestServer(t);
  const advert = `<${server.url}${INBOX}>; rel="${INBOX_REL}"`;
  for (const method of ['GET', 'HEAD']) {
    const front = await fetch(`${server.url}/`, { method });
    assert.equal(front.status, 200);
    assert.equal(front.headers.get('link'), advert);
  }

  const graph = JSON.parse(readFileSync(join(DEMO_PAPERS, 'lupus-nephritis-prediction.graph.json'), 'utf8'));
  await server.post('/v1/graphs', { doi: '10.1000/x', graph, schema: 'mira', model: 'm' });
  const landing = await fetch(`${server.url}/works/10.1000/x`, { method: 'HEAD' });
  assert.ok((landing.headers.get('link') ?? '').includes(advert));

  const options = await fetch(server.url + INBOX, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.match(options.headers.get('accept-post') ?? '', /^application\/ld\+json/);
  assert.match(options.headers.get('allow') ?? '', /POST/);
});

test('CORS lets a browser send HEAD and read Link and Location', async (t) => {
  const server = await startTestServer(t);
  const preflight = await fetch(server.url + INBOX, {
    method: 'OPTIONS',
    headers: { origin: 'https://roamresearch.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /HEAD/);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Content-Type/);

  const other = await fetch(`${server.url}/v1/graphs`, { method: 'OPTIONS' });
  assert.equal(other.status, 204);

  const posted = await send(server, review());
  const exposed = (posted.headers.get('access-control-expose-headers') ?? '').split(',').map((name) => name.trim());
  for (const name of ['Link', 'Location', 'Content-Disposition']) assert.ok(exposed.includes(name), name);
});

test('a full inbox keeps the newest 500', async (t) => {
  const server = await startTestServer(t);
  for (let index = 0; index < 503; index += 1) {
    assert.equal((await send(server, review({ id: `urn:uuid:n-${index}` }))).status, 201);
  }
  const all = await summaries(server);
  assert.equal(all.length, 500);
  assert.equal(all[0].id, 'urn:uuid:n-502');
  assert.equal(all.at(-1).id, 'urn:uuid:n-3');
});
