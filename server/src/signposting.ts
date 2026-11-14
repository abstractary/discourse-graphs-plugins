import type { ServerResponse } from 'node:http';
import type { Config } from './config.ts';
import { newestGraph, normalizeDoi } from './graphs.ts';
import type { StoredGraph } from './graphs.ts';
import { ApiError, isObject, publicBase } from './http.ts';
import type { Context, Route } from './http.ts';
import { INBOX_REL, inboxUrl } from './notify.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';

const CRATE_PROFILE = 'https://w3id.org/ro/crate';
const CRATE_VERSION = 'https://w3id.org/ro/crate/1.3';
const NO_LICENSE = 'Not stated. No license came with this graph, so ask the rights holder before reusing it.';
const PARTS = ['graph.json', 'ro-crate-metadata.json', 'linkset.json'];

type Link = { rel: string; href: string; type?: string; profile?: string };

type Work = {
  entry: StoredGraph;
  title: string;
  doiUrl: string;
  landing: string;
  graphUrl: string;
  metadataUrl: string;
  linksetUrl: string;
  inbox: string;
  license?: string;
  licenseUrl?: string;
  authors: { name?: string; orcid?: string }[];
  model?: string;
};

// A DOI can hold almost any character, so each piece between slashes is encoded on its own.
function encodeDoi(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/');
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\/[^\s<>"]+$/i.test(value);
}

function orcidOf(author: Record<string, unknown>): string | undefined {
  for (const field of ['orcid', 'id', '@id', 'url']) {
    const value = author[field];
    const match = typeof value === 'string' ? /^(?:https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dXx])$/.exec(value.trim()) : null;
    if (match) return `https://orcid.org/${match[1].toUpperCase()}`;
  }
  return undefined;
}

function readAuthors(authors: unknown): Work['authors'] {
  if (!Array.isArray(authors)) return [];
  return authors
    .filter(isObject)
    .map((author) => ({ name: typeof author.name === 'string' && author.name ? author.name : undefined, orcid: orcidOf(author) }))
    .filter((author) => author.name || author.orcid);
}

function describeWork(entry: StoredGraph, base: string): Work {
  // Graphs stored by an older plugin may have no paper block at all.
  const paper = isObject(entry.graph.paper) ? entry.graph.paper : undefined;
  const landing = `${base}/works/${encodeDoi(entry.doi)}`;
  const license = typeof paper?.license === 'string' && paper.license.trim() ? paper.license.trim() : undefined;
  const models = Array.isArray(entry.graph.models) ? entry.graph.models.filter((model) => typeof model === 'string') : [];
  return {
    entry,
    title: entry.title || `Paper ${entry.doi}`,
    doiUrl: `https://doi.org/${encodeDoi(entry.doi)}`,
    landing,
    graphUrl: `${landing}/graph.json`,
    metadataUrl: `${landing}/ro-crate-metadata.json`,
    linksetUrl: `${landing}/linkset.json`,
    inbox: inboxUrl(base),
    license,
    licenseUrl: license && isWebUrl(license) ? license : undefined,
    authors: readAuthors(paper?.authors),
    model: typeof entry.model === 'string' && entry.model ? entry.model : models.join(', ') || undefined,
  };
}

// The bytes served as graph.json. The metadata's size and checksum describe exactly these.
function graphBytes(work: Work): Buffer {
  return Buffer.from(JSON.stringify(work.entry.graph), 'utf8');
}

function landingLinks(work: Work): Link[] {
  return [
    { rel: 'cite-as', href: work.doiUrl },
    { rel: 'type', href: 'https://schema.org/Dataset' },
    { rel: 'type', href: 'https://schema.org/AboutPage' },
    ...work.authors.filter((author) => author.orcid).map((author) => ({ rel: 'author', href: author.orcid as string })),
    { rel: 'describedby', href: work.metadataUrl, type: 'application/ld+json', profile: CRATE_PROFILE },
    { rel: 'item', href: work.graphUrl, type: 'application/json' },
    ...(work.licenseUrl ? [{ rel: 'license', href: work.licenseUrl }] : []),
  ];
}

function linksetLink(work: Work): Link {
  return { rel: 'linkset', href: work.linksetUrl, type: 'application/linkset+json' };
}

function quoted(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

function linkHeader(links: Link[]): string {
  return links
    .map(({ rel, href, type, profile }) => {
      const attributes = [`rel="${quoted(rel)}"`];
      if (type) attributes.push(`type="${quoted(type)}"`);
      if (profile) attributes.push(`profile="${quoted(profile)}"`);
      return `<${href}>; ${attributes.join('; ')}`;
    })
    .join(', ');
}

// One link context of an RFC 9264 link set: the links that start at `anchor`, grouped by relation.
function linkContext(anchor: string, links: Link[]): Record<string, unknown> {
  const context: Record<string, unknown> = { anchor };
  for (const { rel, href, type, profile } of links) {
    const target: Record<string, unknown> = { href };
    if (type) target.type = type;
    // RFC 9264 writes an attribute that Web Linking does not define as a list.
    if (profile) target.profile = [profile];
    context[rel] = [...((context[rel] as unknown[] | undefined) ?? []), target];
  }
  return context;
}

function linkset(work: Work): Record<string, unknown> {
  return {
    linkset: [
      linkContext(work.landing, [...landingLinks(work), { rel: INBOX_REL, href: work.inbox }]),
      linkContext(work.graphUrl, [{ rel: 'collection', href: work.landing }]),
      linkContext(work.metadataUrl, [{ rel: 'describes', href: work.landing }]),
    ],
  };
}

function ref(id: string): { '@id': string } {
  return { '@id': id };
}

// A detached RO-Crate 1.2: no folder goes with it, so every data entity is a web address.
function roCrate(work: Work): Record<string, unknown> {
  const { entry } = work;
  const bytes = graphBytes(work);
  const nodes = entry.graph.nodes.length;
  const edges = entry.graph.edges.length;
  const licenseNote = work.license ? '' : ' The license is not stated.';
  const people = work.authors.map((author, index) => ({
    '@id': author.orcid ?? `#author-${index + 1}`,
    '@type': 'Person',
    name: author.name ?? author.orcid,
  }));
  const root = {
    '@id': work.landing,
    '@type': 'Dataset',
    name: `Extraction graph of "${work.title}"`,
    description:
      `A discourse graph of ${nodes} nodes and ${edges} edges, extracted from the paper ${work.doiUrl}` +
      `${work.model ? ` by the model ${work.model}` : ''}.${licenseNote}`,
    datePublished: entry.storedAt,
    license: work.licenseUrl ? ref(work.licenseUrl) : (work.license ?? NO_LICENSE),
    identifier: work.landing,
    about: ref(work.doiUrl),
    isBasedOn: ref(work.doiUrl),
    hasPart: [ref(work.graphUrl)],
    mentions: [ref('#extraction')],
  };
  const article = {
    '@id': work.doiUrl,
    '@type': 'ScholarlyArticle',
    name: work.title,
    identifier: work.doiUrl,
    ...(people.length > 0 ? { author: people.map((person) => ref(person['@id'])) } : {}),
  };
  const file = {
    '@id': work.graphUrl,
    '@type': 'File',
    name: 'Extraction graph',
    description: 'The nodes and edges of the extraction graph, as JSON.',
    encodingFormat: 'application/json',
    contentSize: String(bytes.length),
    sha256: hashOf(bytes),
  };
  const extraction = {
    '@id': '#extraction',
    '@type': 'CreateAction',
    name: 'Extraction of the graph from the paper',
    ...(work.model ? { instrument: ref('#model') } : {}),
    object: ref(work.doiUrl),
    result: ref(work.graphUrl),
    endTime: entry.storedAt,
  };
  const license = work.licenseUrl
    ? [{ '@id': work.licenseUrl, '@type': 'CreativeWork', name: 'License of the paper', description: `The license the paper states: ${work.licenseUrl}` }]
    : [];
  const model = work.model
    ? [{ '@id': '#model', '@type': 'SoftwareApplication', name: work.model, ...(typeof entry.schema === 'string' ? { description: `Run with the ${entry.schema} schema.` } : {}) }]
    : [];
  return {
    '@context': `${CRATE_VERSION}/context`,
    '@graph': [
      { '@id': 'ro-crate-metadata.json', '@type': 'CreativeWork', conformsTo: ref(CRATE_VERSION), about: ref(work.landing) },
      root,
      article,
      ...people,
      file,
      extraction,
      ...model,
      ...license,
    ],
  };
}

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function row(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`;
}

function anchor(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function landingPage(work: Work): string {
  const { entry } = work;
  const schema = typeof entry.schema === 'string' && entry.schema ? entry.schema : 'not recorded';
  const names = work.authors.map((author) => author.name ?? author.orcid).join(', ');
  const rows = [
    row('Paper', anchor(work.doiUrl, `doi:${entry.doi}`)),
    ...(names ? [row('Authors', escapeHtml(names))] : []),
    row('Graph', `${entry.graph.nodes.length} nodes and ${entry.graph.edges.length} edges`),
    row('Schema', escapeHtml(schema)),
    row('Model', escapeHtml(work.model ?? 'not recorded')),
    row('Stored', escapeHtml(entry.storedAt)),
    row('License', work.licenseUrl ? anchor(work.licenseUrl, work.licenseUrl) : escapeHtml(work.license ?? 'not stated')),
    row('Files', `${anchor(work.graphUrl, 'The graph as JSON')} · ${anchor(work.metadataUrl, 'Metadata as an RO-Crate')} · ${anchor(work.linksetUrl, 'All links')}`),
  ];
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(work.title)}</title>`,
    '<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:2rem auto;padding:0 1rem}dt{font-weight:600;margin-top:.75rem}dd{margin:0}</style>',
    '</head><body>',
    '<p>Extraction graph</p>',
    `<h1>${escapeHtml(work.title)}</h1>`,
    `<dl>${rows.join('')}</dl>`,
    '</body></html>',
  ].join('\n');
}

function send(res: ServerResponse, type: string, body: string | Buffer, links: Link[]): void {
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    Link: linkHeader(links),
  });
  res.end(body);
}

// The path is a DOI, or a DOI and then one of the file names. A DOI can itself end
// in something like "/graph.json", so the whole path is tried as a DOI as well.
function findWork(store: Store, path: string): { entry: StoredGraph; part?: string } | undefined {
  const part = PARTS.find((name) => path.endsWith(`/${name}`));
  const doi = part ? normalizeDoi(path.slice(0, -part.length - 1)) : undefined;
  const entry = doi ? newestGraph(store, doi) : undefined;
  if (entry) return { entry, part };
  const whole = normalizeDoi(path);
  const exact = whole ? newestGraph(store, whole) : undefined;
  return exact ? { entry: exact } : undefined;
}

function serveWork({ req, res, params }: Context, config: Config, store: Store): void {
  const found = findWork(store, params.doi);
  if (!found) {
    throw new ApiError(404, 'not-found', 'No graph is stored for this DOI. List the stored ones with GET /v1/graphs.');
  }
  const work = describeWork(found.entry, publicBase(req, config.publicUrl));
  const toLinkset = linksetLink(work);
  if (found.part === 'graph.json') {
    send(res, 'application/json; charset=utf-8', graphBytes(work), [{ rel: 'collection', href: work.landing }, toLinkset]);
  } else if (found.part === 'ro-crate-metadata.json') {
    const body = JSON.stringify(roCrate(work), null, 2);
    send(res, `application/ld+json; profile="${CRATE_PROFILE}"; charset=utf-8`, body, [{ rel: 'describes', href: work.landing }, toLinkset]);
  } else if (found.part === 'linkset.json') {
    send(res, 'application/linkset+json; charset=utf-8', JSON.stringify(linkset(work), null, 2), []);
  } else {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    const links = [...landingLinks(work), toLinkset, { rel: INBOX_REL, href: work.inbox }];
    send(res, 'text/html; charset=utf-8', landingPage(work), links);
  }
}

export function signpostingRoutes(config: Config, store: Store): Route[] {
  return [{ method: 'GET', path: '/works/*doi', handler: (context) => serveWork(context, config, store) }];
}
