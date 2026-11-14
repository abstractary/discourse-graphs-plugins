import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_PAPERS, startTestServer } from './helpers.ts';
import type { TestServer } from './helpers.ts';

const graph = JSON.parse(readFileSync(join(DEMO_PAPERS, 'lupus-nephritis-prediction.graph.json'), 'utf8'));
const doi = '10.1016/j.semarthrit.2018.02.012';
const entry = { doi, graph, schema: 'mira', model: 'demo-replay' };
const INBOX_REL = 'http://www.w3.org/ns/ldp#inbox';

type ParsedLink = { href: string; rel: string; type?: string; profile?: string };

// Reads a Link header the way RFC 8288 writes it: <target>; name="value"; ..., <target>; ...
function parseLinks(header: string | null): ParsedLink[] {
  const links: ParsedLink[] = [];
  const text = header ?? '';
  const one = /\s*<([^>]*)>((?:\s*;\s*[A-Za-z*-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^",;\s]+))*)\s*(?:,|$)/y;
  let match = one.exec(text);
  while (match) {
    const link: Record<string, string> = { href: match[1] };
    for (const [, name, quoted, bare] of match[2].matchAll(/;\s*([A-Za-z*-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^",;\s]+))/g)) {
      link[name.toLowerCase()] = quoted !== undefined ? quoted.replace(/\\(.)/g, '$1') : bare;
    }
    links.push(link as ParsedLink);
    if (one.lastIndex >= text.length) return links;
    match = one.exec(text);
  }
  throw new Error(`The Link header does not parse: ${text}`);
}

function byRel(links: ParsedLink[], rel: string): ParsedLink[] {
  return links.filter((link) => link.rel === rel);
}

async function store(server: TestServer, body: unknown = entry): Promise<void> {
  assert.equal((await server.post('/v1/graphs', body)).status, 200);
}

test('the landing page carries the level 1 links on GET and on HEAD', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  const landing = `${server.url}/works/${doi}`;

  for (const method of ['GET', 'HEAD']) {
    const response = await fetch(landing, { method });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    const links = parseLinks(response.headers.get('link'));

    assert.deepEqual(byRel(links, 'cite-as'), [{ href: `https://doi.org/${doi}`, rel: 'cite-as' }]);
    assert.deepEqual(byRel(links, 'type').map((link) => link.href).sort(), ['https://schema.org/AboutPage', 'https://schema.org/Dataset']);
    assert.deepEqual(byRel(links, 'describedby'), [
      { href: `${landing}/ro-crate-metadata.json`, rel: 'describedby', type: 'application/ld+json', profile: 'https://w3id.org/ro/crate' },
    ]);
    assert.deepEqual(byRel(links, 'item'), [{ href: `${landing}/graph.json`, rel: 'item', type: 'application/json' }]);
    assert.deepEqual(byRel(links, 'linkset'), [{ href: `${landing}/linkset.json`, rel: 'linkset', type: 'application/linkset+json' }]);
    assert.deepEqual(byRel(links, INBOX_REL), [{ href: `${server.url}/v1/notify/inbox`, rel: INBOX_REL }]);
    // The demo graph has author names only and no license, so neither link is claimed.
    assert.deepEqual(byRel(links, 'author'), []);
    assert.deepEqual(byRel(links, 'license'), []);

    const body = await response.text();
    if (method === 'HEAD') assert.equal(body, '');
    else {
      assert.ok(body.includes(graph.paper.title));
      assert.ok(body.includes(`${graph.nodes.length} nodes and ${graph.edges.length} edges`));
      assert.ok(body.includes('demo-replay'));
      assert.ok(body.includes(`href="https://doi.org/${doi}"`));
    }
  }
});

test('license and author links appear only when the graph holds them', async (t) => {
  const server = await startTestServer(t);
  const paper = {
    ...graph.paper,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    authors: [{ name: 'Ada', orcid: '0000-0002-1825-0097' }, { name: 'No Orcid' }],
  };
  await store(server, { ...entry, graph: { ...graph, paper } });
  const links = parseLinks((await fetch(`${server.url}/works/${doi}`, { method: 'HEAD' })).headers.get('link'));
  assert.deepEqual(byRel(links, 'license').map((link) => link.href), ['https://creativecommons.org/licenses/by/4.0/']);
  assert.deepEqual(byRel(links, 'author').map((link) => link.href), ['https://orcid.org/0000-0002-1825-0097']);

  const crate = (await (await server.get(`/works/${doi}/ro-crate-metadata.json`)).json()) as any;
  const root = crate['@graph'].find((entity: any) => entity['@type'] === 'Dataset');
  assert.deepEqual(root.license, { '@id': 'https://creativecommons.org/licenses/by/4.0/' });
  const license = crate['@graph'].find((entity: any) => entity['@id'] === root.license['@id']);
  assert.ok(license.name && license.description);
});

test('an unknown DOI is a plain 404, for the page and for its files', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  for (const path of ['/works/10.1000/none', '/works/10.1000/none/graph.json', '/works/not-a-doi', `/works/${doi}/other.json`]) {
    const response = await server.get(path);
    assert.equal(response.status, 404);
    const { error } = (await response.json()) as any;
    assert.equal(error.code, 'not-found');
    assert.match(error.message, /No graph is stored for this DOI/);
  }
  assert.equal((await fetch(`${server.url}/works/10.1000/none`, { method: 'HEAD' })).status, 404);
  assert.equal((await server.post(`/works/${doi}`, {})).status, 405);
});

test('a DOI with slashes and capitals finds the same graph, whole or percent-encoded', async (t) => {
  const server = await startTestServer(t);
  const odd = '10.1000/ABC/Def(1)<2>';
  await store(server, { ...entry, doi: odd });
  const canonical = `${server.url}/works/10.1000/abc/def(1)%3C2%3E`;

  const paths = ['/works/10.1000/ABC/Def(1)%3C2%3E', `/works/${encodeURIComponent(odd)}`, '/works/10.1000/abc/def(1)%3C2%3E'];
  for (const path of paths) {
    const response = await fetch(server.url + path, { method: 'HEAD' });
    assert.equal(response.status, 200, path);
    const links = parseLinks(response.headers.get('link'));
    assert.equal(byRel(links, 'cite-as')[0].href, 'https://doi.org/10.1000/abc/def(1)%3C2%3E');
    assert.equal(byRel(links, 'item')[0].href, `${canonical}/graph.json`);
  }

  // The links the server hands out lead back to the same graph.
  const item = await fetch(`${canonical}/graph.json`);
  assert.equal(item.status, 200);
  assert.deepEqual(await item.json(), graph);
  assert.equal((await fetch(`${server.url}/works/${encodeURIComponent(odd)}/graph.json`)).status, 200);
});

test('the item and the metadata point back at the landing page', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  const landing = `${server.url}/works/${doi}`;

  const item = await fetch(`${landing}/graph.json`, { method: 'HEAD' });
  assert.match(item.headers.get('content-type') ?? '', /^application\/json/);
  const itemLinks = parseLinks(item.headers.get('link'));
  assert.deepEqual(byRel(itemLinks, 'collection'), [{ href: landing, rel: 'collection' }]);
  assert.equal(byRel(itemLinks, 'linkset')[0].href, `${landing}/linkset.json`);

  const metadata = await fetch(`${landing}/ro-crate-metadata.json`);
  assert.match(metadata.headers.get('content-type') ?? '', /^application\/ld\+json/);
  const metadataLinks = parseLinks(metadata.headers.get('link'));
  assert.deepEqual(byRel(metadataLinks, 'describes'), [{ href: landing, rel: 'describes' }]);
  assert.equal(byRel(metadataLinks, 'linkset')[0].href, `${landing}/linkset.json`);
});

test('the linkset has one context for each resource, in the RFC 9264 shape', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  const landing = `${server.url}/works/${doi}`;
  const response = await fetch(`${landing}/linkset.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/linkset\+json/);
  const body = (await response.json()) as any;

  assert.deepEqual(Object.keys(body), ['linkset']);
  assert.deepEqual(body.linkset.map((context: any) => context.anchor), [landing, `${landing}/graph.json`, `${landing}/ro-crate-metadata.json`]);
  for (const context of body.linkset) {
    for (const [rel, targets] of Object.entries(context)) {
      if (rel === 'anchor') continue;
      assert.ok(Array.isArray(targets), rel);
      for (const target of targets as any[]) assert.equal(typeof target.href, 'string');
    }
  }
  const [page, item, metadata] = body.linkset;
  assert.deepEqual(page['cite-as'], [{ href: `https://doi.org/${doi}` }]);
  assert.deepEqual(page.type, [{ href: 'https://schema.org/Dataset' }, { href: 'https://schema.org/AboutPage' }]);
  assert.deepEqual(page.describedby, [
    { href: `${landing}/ro-crate-metadata.json`, type: 'application/ld+json', profile: ['https://w3id.org/ro/crate'] },
  ]);
  assert.deepEqual(page.item, [{ href: `${landing}/graph.json`, type: 'application/json' }]);
  assert.deepEqual(page[INBOX_REL], [{ href: `${server.url}/v1/notify/inbox` }]);
  assert.deepEqual(item, { anchor: `${landing}/graph.json`, collection: [{ href: landing }] });
  assert.deepEqual(metadata, { anchor: `${landing}/ro-crate-metadata.json`, describes: [{ href: landing }] });
});

test('the metadata is a detached RO-Crate 1.2 that matches the served graph', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  const landing = `${server.url}/works/${doi}`;
  const crate = (await (await fetch(`${landing}/ro-crate-metadata.json`)).json()) as any;
  assert.equal(crate['@context'], 'https://w3id.org/ro/crate/1.3/context');
  const find = (id: string): any => crate['@graph'].find((entity: any) => entity['@id'] === id);

  const descriptor = find('ro-crate-metadata.json');
  assert.equal(descriptor['@type'], 'CreativeWork');
  assert.deepEqual(descriptor.conformsTo, { '@id': 'https://w3id.org/ro/crate/1.3' });
  assert.deepEqual(descriptor.about, { '@id': landing });

  const root = find(landing);
  assert.equal(root['@type'], 'Dataset');
  assert.ok(root.name.includes(graph.paper.title));
  assert.match(root.description, /license is not stated/);
  assert.equal(typeof root.license, 'string');
  assert.match(root.license, /^Not stated/);
  assert.ok(!Number.isNaN(Date.parse(root.datePublished)));
  assert.equal(root.identifier, landing);
  assert.deepEqual(root.about, { '@id': `https://doi.org/${doi}` });
  assert.deepEqual(root.isBasedOn, { '@id': `https://doi.org/${doi}` });
  assert.deepEqual(root.hasPart, [{ '@id': `${landing}/graph.json` }]);

  const article = find(`https://doi.org/${doi}`);
  assert.equal(article['@type'], 'ScholarlyArticle');
  assert.equal(article.name, graph.paper.title);
  assert.equal(article.author.length, graph.paper.authors.length);
  const first = find(article.author[0]['@id']);
  assert.deepEqual([first['@type'], first.name], ['Person', graph.paper.authors[0].name]);

  const served = Buffer.from(await (await fetch(`${landing}/graph.json`)).arrayBuffer());
  const file = find(`${landing}/graph.json`);
  assert.equal(file['@type'], 'File');
  assert.equal(file.encodingFormat, 'application/json');
  assert.equal(file.contentSize, String(served.length));
  assert.equal(file.sha256, createHash('sha256').update(served).digest('hex'));

  const action = crate['@graph'].find((entity: any) => entity['@type'] === 'CreateAction');
  assert.deepEqual(action.object, { '@id': `https://doi.org/${doi}` });
  assert.deepEqual(action.result, { '@id': `${landing}/graph.json` });
  assert.equal(action.endTime, root.datePublished);
  const model = find(action.instrument['@id']);
  assert.deepEqual([model['@type'], model.name], ['SoftwareApplication', 'demo-replay']);

  // Every reference inside the crate leads to an entity that is in it.
  const ids = new Set(crate['@graph'].map((entity: any) => entity['@id']));
  const refs = JSON.stringify(crate['@graph']).matchAll(/\{"@id":"([^"]+)"\}/g);
  for (const [, id] of refs) assert.ok(ids.has(id) || id === 'https://w3id.org/ro/crate/1.3', id);
});

test('the newest stored version is the one the landing page is about', async (t) => {
  const server = await startTestServer(t);
  await store(server);
  const smaller = { ...graph, nodes: graph.nodes.slice(1) };
  await store(server, { ...entry, graph: smaller, model: 'second-run' });
  const page = await (await server.get(`/works/${doi}`)).text();
  assert.ok(page.includes(`${smaller.nodes.length} nodes`));
  assert.ok(page.includes('second-run'));
  assert.deepEqual(await (await server.get(`/works/${doi}/graph.json`)).json(), smaller);
});

test('a hostile title, model and license are escaped on the page', async (t) => {
  const server = await startTestServer(t);
  const title = '</title><script>alert("x")</script><img src=x onerror=\'y\'> & co';
  const paper = { ...graph.paper, title, license: 'javascript:alert(1)', authors: [{ name: '<b>Eve</b>' }] };
  await store(server, { ...entry, graph: { ...graph, paper }, model: '<script>m()</script>', schema: '"><svg onload=s()>' });
  const response = await server.get(`/works/${doi}`);
  const page = await response.text();
  assert.ok(!page.includes('<script'));
  assert.ok(!page.includes('<img'));
  assert.ok(!page.includes('<svg'));
  assert.ok(!page.includes('<b>'));
  assert.ok(!page.includes('href="javascript:'));
  assert.ok(page.includes('&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(page.includes('&amp; co'));
  // A license that is not a web address is shown as text and never becomes a link.
  assert.deepEqual(byRel(parseLinks(response.headers.get('link')), 'license'), []);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('DG_PUBLIC_URL names the server in every link', async (t) => {
  const server = await startTestServer(t, { publicUrl: 'https://graphs.example.org/' });
  await store(server);
  const links = parseLinks((await fetch(`${server.url}/works/${doi}`, { method: 'HEAD' })).headers.get('link'));
  assert.equal(byRel(links, 'item')[0].href, `https://graphs.example.org/works/${doi}/graph.json`);
  assert.equal(byRel(links, INBOX_REL)[0].href, 'https://graphs.example.org/v1/notify/inbox');
});
