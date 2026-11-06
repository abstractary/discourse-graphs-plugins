import { randomBytes, randomInt } from 'node:crypto';
import { hashesMatch, newSecret, openToken, readLab, requireAdmin, requireMember, sealToken, writeLab } from './auth.ts';
import type { JoinRequest, Lab, TokenKind } from './auth.ts';
import { ApiError, requirePerson, requireString } from './http.ts';
import type { Context, Route } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';

const SUFFIX_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function slug(name: string): string {
  const words = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');
  return words.replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'lab';
}

function newLabId(store: Store, name: string): string {
  for (;;) {
    const suffix = Array.from({ length: 3 }, () => SUFFIX_LETTERS[randomInt(SUFFIX_LETTERS.length)]).join('');
    const id = `${slug(name)}-${suffix}`;
    if (!readLab(store, id)) return id;
  }
}

function labOr404(store: Store, id: string): Lab {
  const lab = readLab(store, id);
  if (!lab) throw new ApiError(404, 'no-lab', `There is no lab ${id}. Check the id with whoever invited you.`);
  return lab;
}

function requestOr404(lab: Lab, requestId: string): JoinRequest {
  const request = lab.requests.find((candidate) => candidate.id === requestId);
  if (!request) throw new ApiError(404, 'no-request', 'There is no such join request. Ask to join again.');
  return request;
}

function parseTokenKind(value: unknown): TokenKind {
  if (value === undefined) return 'personal';
  if (value === 'personal' || value === 'team') return value;
  throw new ApiError(400, 'bad-token-kind', 'Send "tokenKind" as "personal" or "team", or leave it out.');
}

function accept(lab: Lab, request: JoinRequest, kind: TokenKind): void {
  lab.tokens.push({ hash: request.tokenHash ?? '', did: request.person.did, kind, role: 'member' });
  const member = lab.members.find((candidate) => candidate.did === request.person.did);
  if (member) member.tokenKind = kind;
  else lab.members.push({ ...request.person, role: 'member', tokenKind: kind });
  request.state = 'accepted';
  request.tokenKind = kind;
}

function decline(request: JoinRequest): void {
  request.state = 'declined';
  delete request.tokenHash;
  delete request.sealedToken;
}

async function createLab({ readJson }: Context, store: Store): Promise<unknown> {
  const body = await readJson();
  const name = requireString(body.name, 'name');
  const person = requirePerson(body.person);
  const token = newSecret();
  const id = newLabId(store, name);
  writeLab(store, {
    id,
    name,
    labDid: typeof body.labDid === 'string' ? body.labDid : undefined,
    createdAt: new Date().toISOString(),
    members: [{ ...person, role: 'admin', tokenKind: 'personal' }],
    tokens: [{ hash: hashOf(token), did: person.did, kind: 'personal', role: 'admin' }],
    requests: [],
  });
  return { lab: { id, name }, token };
}

async function askToJoin({ params, readJson }: Context, store: Store): Promise<unknown> {
  labOr404(store, params.id);
  const person = requirePerson((await readJson()).person);
  const lab = labOr404(store, params.id);
  const requestId = randomBytes(9).toString('base64url');
  const secret = newSecret();
  const token = newSecret();
  lab.requests.push({
    id: requestId,
    person,
    at: new Date().toISOString(),
    state: 'pending',
    secretHash: hashOf(secret),
    tokenHash: hashOf(token),
    sealedToken: sealToken(token, secret, requestId),
  });
  writeLab(store, lab);
  return { requestId, secret };
}

function pollJoin({ params, query }: Context, store: Store): unknown {
  const lab = labOr404(store, params.id);
  const request = requestOr404(lab, params.requestId);
  const secret = query.get('secret');
  if (!secret) {
    throw new ApiError(401, 'no-secret', 'Send the secret you got when you asked to join, as ?secret=');
  }
  if (!hashesMatch(request.secretHash, hashOf(secret))) {
    throw new ApiError(403, 'wrong-secret', 'This secret does not match the join request. Use the one you got when you asked to join.');
  }
  if (request.state !== 'accepted' || !request.sealedToken) return { state: request.state };
  return {
    state: request.state,
    token: openToken(request.sealedToken, secret, request.id),
    tokenKind: request.tokenKind,
  };
}

async function decide({ req, params, readJson }: Context, store: Store): Promise<unknown> {
  requireAdmin(req, store, params.id);
  const body = await readJson();
  if (body.decision !== 'accept' && body.decision !== 'decline') {
    throw new ApiError(400, 'bad-decision', 'Send "decision" as "accept" or "decline".');
  }
  const kind = parseTokenKind(body.tokenKind);
  // Read again after the await, so another decision in the meantime is not overwritten.
  const { lab } = requireAdmin(req, store, params.id);
  const request = requestOr404(lab, params.requestId);
  if (request.state !== 'pending') {
    throw new ApiError(409, 'already-decided', `This request was already ${request.state}. Ask the person to join again if that was a mistake.`);
  }
  if (body.decision === 'accept') accept(lab, request, kind);
  else decline(request);
  writeLab(store, lab);
  return { id: request.id, state: request.state, tokenKind: request.tokenKind };
}

export function labRoutes(store: Store): Route[] {
  return [
    { method: 'POST', path: '/v1/labs', handler: (context) => createLab(context, store) },
    {
      method: 'GET',
      path: '/v1/labs/:id',
      handler: ({ params }) => {
        const { id, name } = labOr404(store, params.id);
        return { id, name };
      },
    },
    { method: 'POST', path: '/v1/labs/:id/join', handler: (context) => askToJoin(context, store) },
    { method: 'GET', path: '/v1/labs/:id/join/:requestId', handler: (context) => pollJoin(context, store) },
    {
      method: 'GET',
      path: '/v1/labs/:id/members',
      handler: ({ req, params }) => ({ members: requireMember(req, store, params.id).lab.members }),
    },
    {
      method: 'GET',
      path: '/v1/labs/:id/requests',
      handler: ({ req, params }) => {
        const { lab } = requireAdmin(req, store, params.id);
        const pending = lab.requests.filter((request) => request.state === 'pending');
        return { requests: pending.map(({ id, person, at }) => ({ id, person, at })) };
      },
    },
    { method: 'POST', path: '/v1/labs/:id/requests/:requestId', handler: (context) => decide(context, store) },
  ];
}
