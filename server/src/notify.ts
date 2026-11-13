import type { ServerResponse } from 'node:http';
import type { Config } from './config.ts';
import { normalizeDoi } from './graphs.ts';
import { ApiError, isObject, publicBase, sendJson } from './http.ts';
import type { Context, Route } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';

export const INBOX_REL = 'http://www.w3.org/ns/ldp#inbox';

const INBOX_PATH = '/v1/notify/inbox';
const ACCEPT_POST = 'application/ld+json, application/json';
const AS_CONTEXT = 'https://www.w3.org/ns/activitystreams';
const NOTIFY_CONTEXTS = ['https://coar-notify.net', 'https://purl.org/coar/notify'];
const ACTIVITY_TYPES = ['Announce', 'Offer', 'Accept', 'Reject', 'TentativeAccept', 'TentativeReject', 'Undo', 'Flag'];
const NOTIFY_TYPES = ['EndorsementAction', 'ReviewAction', 'RelationshipAction', 'IngestAction', 'UnprocessableNotification'];
const OFFER_TYPES = ['EndorsementAction', 'ReviewAction', 'IngestAction'];
const ACTOR_TYPES = ['Application', 'Group', 'Organization', 'Person', 'Service'];
const MAX_NOTIFICATIONS = 500;
const MAX_NOTIFICATION_BYTES = 256 * 1024;

type StoredNotification = { key: string; receivedAt: string; notification: Record<string, unknown> };

type NotifyLog = { notifications: StoredNotification[] };

export type NotificationSummary = {
  id: string;
  types: string[];
  about: string[];
  context?: string;
  from: string;
  actor?: string;
  receivedAt: string;
  notification: Record<string, unknown>;
};

export function inboxUrl(base: string): string {
  return base + INBOX_PATH;
}

export function inboxLink(base: string): string {
  return `<${inboxUrl(base)}>; rel="${INBOX_REL}"`;
}

function readLog(store: Store): NotifyLog {
  return store.read<NotifyLog>('notify') ?? { notifications: [] };
}

function bad(message: string): ApiError {
  return new ApiError(400, 'bad-notification', message);
}

function isUri(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(value);
}

function isHttpUri(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
}

// A JSON-LD value can be one string or a list of them.
function listOf(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((entry): entry is string => typeof entry === 'string');
}

function isNotifyContext(value: string): boolean {
  return NOTIFY_CONTEXTS.some((context) => value === context || value.startsWith(`${context}/`));
}

function notifyTypes(types: string[]): string[] {
  return types.filter((type) => type.startsWith('coar-notify:')).map((type) => type.slice('coar-notify:'.length));
}

function checkService(value: unknown, field: string, needsInbox: boolean): void {
  if (!isObject(value)) throw bad(`Send "${field}" as an object with id, inbox and type.`);
  if (!isHttpUri(value.id)) throw bad(`"${field}.id" must be the http or https address of the service.`);
  if (listOf(value.type).length === 0) throw bad(`"${field}.type" is missing. Send a type such as "Service".`);
  if (needsInbox && value.inbox === undefined) throw bad(`"${field}.inbox" is missing. Send the address of the ${field}'s inbox.`);
  if (value.inbox !== undefined && !isHttpUri(value.inbox)) {
    throw bad(`"${field}.inbox" must be the http or https address of an inbox.`);
  }
}

function checkRelationship(object: Record<string, unknown>): void {
  if (!listOf(object.type).includes('Relationship')) {
    throw bad('A RelationshipAction needs "object.type" to include "Relationship".');
  }
  for (const part of ['as:subject', 'as:relationship', 'as:object']) {
    if (!isUri(object[part])) throw bad(`A RelationshipAction needs "object.${part}" as a URI.`);
  }
}

// The rules of COAR Notify 1.0.1. The first problem found is the one reported.
function checkNotification(body: Record<string, unknown>): void {
  const contexts = listOf(body['@context']);
  if (!Array.isArray(body['@context']) || !contexts.includes(AS_CONTEXT)) {
    throw bad(`"@context" must be a list that includes "${AS_CONTEXT}".`);
  }
  if (!contexts.some(isNotifyContext)) {
    throw bad(`"@context" must include "${NOTIFY_CONTEXTS[0]}".`);
  }
  if (!isUri(body.id)) throw bad('"id" must be a URI. A "urn:uuid:" id is the usual choice.');

  const types = listOf(body.type);
  const activities = types.filter((type) => ACTIVITY_TYPES.includes(type));
  if (activities.length !== 1) {
    throw bad(`"type" must hold one activity type out of ${ACTIVITY_TYPES.join(', ')}.`);
  }
  const kinds = notifyTypes(types);
  const unknown = kinds.find((kind) => !NOTIFY_TYPES.includes(kind));
  if (unknown) {
    throw bad(`"coar-notify:${unknown}" is not a COAR Notify type. Use one of ${NOTIFY_TYPES.join(', ')}.`);
  }
  if (activities[0] === 'Offer' && !kinds.some((kind) => OFFER_TYPES.includes(kind))) {
    throw bad(`An Offer needs a second type that says what is asked for, such as "coar-notify:${OFFER_TYPES[0]}".`);
  }
  if (activities[0] === 'Flag' && !kinds.includes('UnprocessableNotification')) {
    throw bad('A Flag needs the second type "coar-notify:UnprocessableNotification".');
  }

  checkService(body.origin, 'origin', false);
  checkService(body.target, 'target', true);

  if (!isObject(body.object)) throw bad('Send "object" as an object with an id.');
  if (!isUri(body.object.id)) throw bad('"object.id" must be a URI.');
  if (kinds.includes('RelationshipAction')) checkRelationship(body.object);

  if (body.actor !== undefined) {
    if (!isObject(body.actor) || !isUri(body.actor.id)) throw bad('"actor.id" must be a URI when "actor" is sent.');
    if (!listOf(body.actor.type).some((type) => ACTOR_TYPES.includes(type))) {
      throw bad(`"actor.type" must be one of ${ACTOR_TYPES.join(', ')}.`);
    }
  }
  if (body.context !== undefined && (!isObject(body.context) || !isUri(body.context.id))) {
    throw bad('"context.id" must be a URI when "context" is sent.');
  }
  if (body.inReplyTo !== undefined && !isUri(body.inReplyTo)) {
    throw bad('"inReplyTo" must be the URI of the notification this one answers.');
  }
}

function part(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function summarize({ receivedAt, notification }: StoredNotification): NotificationSummary {
  const types = listOf(notification.type);
  const object = part(notification.object);
  const actor = part(notification.actor);
  const relationship = notifyTypes(types).includes('RelationshipAction');
  return {
    id: String(notification.id),
    types,
    about: listOf(relationship ? [object['as:subject'], object['as:object']] : object.id),
    context: text(part(notification.context).id),
    from: String(part(notification.origin).id),
    actor: text(actor.name) ?? text(actor.id),
    receivedAt,
    notification,
  };
}

// A DOI reads the same as a doi.org link, with "doi:" in front, or bare, in any case.
function sameThing(value: string): string {
  return normalizeDoi(value) ?? value.trim();
}

// A repository often names its own page and gives the DOI as "ietf:cite-as", so that counts too.
function isAbout(entry: StoredNotification, asked: string): boolean {
  const { about, context, notification } = summarize(entry);
  const citeAs = [part(notification.object)['ietf:cite-as'], part(notification.context)['ietf:cite-as']];
  return [...about, context, ...citeAs].some((value) => typeof value === 'string' && sameThing(value) === asked);
}

function isJsonBody(contentType: string | undefined): boolean {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/ld+json' || type === 'application/json';
}

function sendLd(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/ld+json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Nothing in a notification is ever fetched, followed or run. It is checked, kept and handed back.
async function receive({ req, res, readJson }: Context, config: Config, store: Store): Promise<void> {
  if (!isJsonBody(req.headers['content-type'])) {
    res.setHeader('Accept-Post', ACCEPT_POST);
    throw new ApiError(415, 'wrong-type', 'Send the notification as application/ld+json.');
  }
  const body = await readJson();
  checkNotification(body);
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_NOTIFICATION_BYTES) {
    throw new ApiError(413, 'too-big', 'This notification is over the 256 KB limit. Send links to the work, not the work itself.');
  }
  const key = hashOf(String(body.id)).slice(0, 32);
  const log = readLog(store);
  if (!log.notifications.some((entry) => entry.key === key)) {
    log.notifications.push({ key, receivedAt: new Date().toISOString(), notification: body });
    // The oldest go first once the inbox is full.
    store.write('notify', { notifications: log.notifications.slice(-MAX_NOTIFICATIONS) });
  }
  const location = `${inboxUrl(publicBase(req, config.publicUrl))}/${key}`;
  res.setHeader('Location', location);
  sendJson(res, 201, { id: body.id, location });
}

function wantsLd(accept: string | undefined): boolean {
  return (accept ?? '').toLowerCase().includes('application/ld+json');
}

function listInbox({ req, res, query }: Context, config: Config, store: Store): unknown {
  const inbox = inboxUrl(publicBase(req, config.publicUrl));
  const asked = query.get('about');
  const all = [...readLog(store).notifications].reverse();
  const entries = asked === null ? all : all.filter((entry) => isAbout(entry, sameThing(asked)));
  res.setHeader('Accept-Post', ACCEPT_POST);
  res.setHeader('Vary', 'Accept');
  if (!wantsLd(req.headers.accept)) return { notifications: entries.map(summarize) };
  const listing = {
    '@context': 'http://www.w3.org/ns/ldp',
    '@id': inbox,
    contains: entries.map((entry) => `${inbox}/${entry.key}`),
  };
  sendLd(res, 200, listing);
  return undefined;
}

function readOne({ res, params }: Context, store: Store): void {
  const entry = readLog(store).notifications.find((candidate) => candidate.key === params.key);
  if (!entry) {
    throw new ApiError(404, 'not-found', 'There is no such notification. List the inbox to see what it holds.');
  }
  sendLd(res, 200, entry.notification);
}

function inboxOptions({ res }: Context): void {
  res.writeHead(204, { Allow: 'GET, HEAD, POST, OPTIONS', 'Accept-Post': ACCEPT_POST });
  res.end();
}

// The front door only says where things are, and where the inbox is.
function root({ req, res }: Context, config: Config): unknown {
  const base = publicBase(req, config.publicUrl);
  res.setHeader('Link', inboxLink(base));
  return { name: 'Discourse Graphs reference server', info: `${base}/v1/info`, inbox: inboxUrl(base) };
}

export function notifyRoutes(config: Config, store: Store): Route[] {
  return [
    { method: 'GET', path: '/', handler: (context) => root(context, config) },
    { method: 'POST', path: INBOX_PATH, handler: (context) => receive(context, config, store) },
    { method: 'GET', path: INBOX_PATH, handler: (context) => listInbox(context, config, store) },
    { method: 'OPTIONS', path: INBOX_PATH, handler: inboxOptions },
    { method: 'GET', path: `${INBOX_PATH}/:key`, handler: (context) => readOne(context, store) },
  ];
}
