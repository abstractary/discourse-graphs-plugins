import { randomBytes, randomInt } from 'node:crypto';
import { hashesMatch, newSecret, openToken, readLab, requireAdmin, requireMember, sealToken, writeLab } from './auth.ts';
import type { Invite, JoinRequest, Lab, TokenKind } from './auth.ts';
import { ApiError, requirePerson, requireString } from './http.ts';
import type { Context, Route, Sent } from './http.ts';
import { at } from './routes.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';
import type {
  AcceptInviteRequest,
  AcceptInviteResponse,
  AskToJoinRequest,
  AskToJoinResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  CreateLabRequest,
  CreateLabResponse,
  DecideRequest,
  DecideResponse,
  LabName,
  ListInvitesResponse,
  MembersResponse,
  PollJoinResponse,
  RemoveMemberResponse,
  RequestsResponse,
  RevokeInviteResponse,
} from './wire.gen.ts';

const SUFFIX_LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INVITE_USES = 1;
const MAX_INVITE_USES = 100;
const DEFAULT_INVITE_DAYS = 7;
const MAX_INVITE_DAYS = 90;

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

function parseWhole(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ApiError(400, `bad-${field}`, `Send "${field}" as a whole number from 1 to ${max}, or leave it out.`);
  }
  return value;
}

function liveInvites(lab: Lab): Invite[] {
  const now = Date.now();
  return (lab.invites ?? []).filter((invite) => invite.usesLeft > 0 && Date.parse(invite.expiresAt) > now);
}

function badInvite(): ApiError {
  return new ApiError(403, 'bad-invite', 'This invite does not work. Ask the lab admin for a new invite.');
}

async function createLab({ readJson }: Context, store: Store): Promise<CreateLabResponse> {
  const body: Sent<CreateLabRequest> = await readJson();
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

async function askToJoin({ params, readJson }: Context, store: Store): Promise<AskToJoinResponse> {
  labOr404(store, params.id);
  const body: Sent<AskToJoinRequest> = await readJson();
  const person = requirePerson(body.person);
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

function pollJoin({ params, query }: Context, store: Store): PollJoinResponse {
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

async function decide({ req, params, readJson }: Context, store: Store): Promise<DecideResponse> {
  requireAdmin(req, store, params.id);
  const body: Sent<DecideRequest> = await readJson();
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
  return { id: request.id, state: body.decision === 'accept' ? 'accepted' : 'declined', tokenKind: request.tokenKind };
}

async function createInvite({ req, params, readJson }: Context, store: Store): Promise<CreateInviteResponse> {
  requireAdmin(req, store, params.id);
  const body: Sent<CreateInviteRequest> = await readJson();
  const uses = parseWhole(body.uses, 'uses', DEFAULT_INVITE_USES, MAX_INVITE_USES);
  const days = parseWhole(body.days, 'days', DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS);
  const tokenKind = parseTokenKind(body.tokenKind);
  // Read again after the await, so a change made in the meantime is not overwritten.
  const { lab, token } = requireAdmin(req, store, params.id);
  const code = newSecret();
  const now = Date.now();
  const invite: Invite = {
    id: randomBytes(9).toString('base64url'),
    codeHash: hashOf(code),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    usesLeft: uses,
    by: token.did,
    tokenKind,
  };
  lab.invites = [...liveInvites(lab), invite];
  writeLab(store, lab);
  return { invite: { id: invite.id, code, expiresAt: invite.expiresAt, usesLeft: invite.usesLeft } };
}

function listInvites({ req, params }: Context, store: Store): ListInvitesResponse {
  const { lab } = requireAdmin(req, store, params.id);
  const invites = liveInvites(lab).map(({ id, createdAt, expiresAt, usesLeft, by }) => ({ id, createdAt, expiresAt, usesLeft, by }));
  return { invites };
}

function deleteInvite({ req, params }: Context, store: Store): RevokeInviteResponse {
  const { lab } = requireAdmin(req, store, params.id);
  const invites = lab.invites ?? [];
  if (!invites.some((invite) => invite.id === params.inviteId)) {
    throw new ApiError(404, 'no-invite', 'There is no such invite. List the invites to see the ones that are left.');
  }
  lab.invites = invites.filter((invite) => invite.id !== params.inviteId);
  writeLab(store, lab);
  return { id: params.inviteId };
}

async function acceptInvite({ params, readJson }: Context, store: Store): Promise<AcceptInviteResponse> {
  labOr404(store, params.id);
  const body: Sent<AcceptInviteRequest> = await readJson();
  const codeHash = hashOf(requireString(body.code, 'code'));
  const person = requirePerson(body.person);
  // Read after the await, so two people using the last use at once cannot both get in.
  const lab = labOr404(store, params.id);
  const invite = liveInvites(lab).find((candidate) => hashesMatch(candidate.codeHash, codeHash));
  if (!invite) throw badInvite();
  const token = newSecret();
  invite.usesLeft -= 1;
  lab.invites = liveInvites(lab);
  lab.tokens.push({ hash: hashOf(token), did: person.did, kind: invite.tokenKind, role: 'member' });
  const member = lab.members.find((candidate) => candidate.did === person.did);
  if (member) Object.assign(member, { name: person.name, tokenKind: invite.tokenKind });
  else lab.members.push({ ...person, role: 'member', tokenKind: invite.tokenKind });
  writeLab(store, lab);
  return { lab: { id: lab.id, name: lab.name }, token, tokenKind: invite.tokenKind, role: 'member' };
}

function removeMember({ req, params }: Context, store: Store): RemoveMemberResponse {
  const { lab, token } = requireAdmin(req, store, params.id);
  const { did } = params;
  if (did === token.did) {
    throw new ApiError(409, 'cannot-remove-self', 'You cannot remove yourself from your own lab. Remove other members only.');
  }
  if (!lab.members.some((member) => member.did === did)) {
    throw new ApiError(404, 'no-member', 'There is no such member in this lab. List the members to check the did.');
  }
  const at = new Date().toISOString();
  const theirs = lab.tokens.filter((entry) => entry.did === did);
  lab.revoked = [...(lab.revoked ?? []), ...theirs.map(({ hash }) => ({ hash, did, at }))];
  lab.tokens = lab.tokens.filter((entry) => entry.did !== did);
  lab.members = lab.members.filter((member) => member.did !== did);
  lab.removed = [...(lab.removed ?? []), { did, at }];
  for (const request of lab.requests) {
    if (request.person.did === did && request.state === 'pending') decline(request);
  }
  writeLab(store, lab);
  return { removed: did };
}

export function labRoutes(store: Store): Route[] {
  return [
    { ...at('createLab'), handler: (context) => createLab(context, store) },
    {
      ...at('findLab'),
      handler: ({ params }): LabName => {
        const { id, name } = labOr404(store, params.id);
        return { id, name };
      },
    },
    { ...at('askToJoin'), handler: (context) => askToJoin(context, store) },
    { ...at('pollJoin'), handler: (context) => pollJoin(context, store) },
    {
      ...at('members'),
      handler: ({ req, params }): MembersResponse => ({ members: requireMember(req, store, params.id).lab.members }),
    },
    {
      ...at('requests'),
      handler: ({ req, params }): RequestsResponse => {
        const { lab } = requireAdmin(req, store, params.id);
        const pending = lab.requests.filter((request) => request.state === 'pending');
        return { requests: pending.map(({ id, person, at }) => ({ id, person, at })) };
      },
    },
    { ...at('decide'), handler: (context) => decide(context, store) },
    { ...at('createInvite'), handler: (context) => createInvite(context, store) },
    { ...at('listInvites'), handler: (context) => listInvites(context, store) },
    { ...at('acceptInvite'), handler: (context) => acceptInvite(context, store) },
    { ...at('revokeInvite'), handler: (context) => deleteInvite(context, store) },
    { ...at('removeMember'), handler: (context) => removeMember(context, store) },
  ];
}
