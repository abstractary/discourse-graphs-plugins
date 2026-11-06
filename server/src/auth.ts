import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ApiError } from './http.ts';
import { hashOf } from './store.ts';
import type { Store } from './store.ts';
import type { Person } from './types.ts';

export type TokenKind = 'personal' | 'team';
export type Role = 'admin' | 'member';

export type Member = Person & { role: Role; tokenKind: TokenKind };

// The role sits on the token, not the person. A join request can name any did, so
// a request that copies the admin's did must not inherit the admin's powers.
export type LabToken = { hash: string; did: string; kind: TokenKind; role: Role };

export type JoinRequest = {
  id: string;
  person: Person;
  at: string;
  state: 'pending' | 'accepted' | 'declined';
  secretHash: string;
  tokenHash?: string;
  sealedToken?: string;
  tokenKind?: TokenKind;
};

export type Lab = {
  id: string;
  name: string;
  labDid?: string;
  createdAt: string;
  members: Member[];
  tokens: LabToken[];
  requests: JoinRequest[];
};

export type Caller = { lab: Lab; token: LabToken };

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function sealKey(secret: string, requestId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, requestId, 'dg-join-token', 32));
}

// Tokens are stored hashed, yet a requester collects theirs after the admin accepts.
// So it waits encrypted under the request secret, which the server only keeps as a
// hash. Nothing at rest can reveal the token, and polling again still returns it.
export function sealToken(token: string, secret: string, requestId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey(secret, requestId), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

export function openToken(sealed: string, secret: string, requestId: string): string {
  const raw = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', sealKey(secret, requestId), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

export function readLab(store: Store, id: string): Lab | undefined {
  return /^[a-z0-9-]+$/.test(id) ? store.read<Lab>(`labs/${id}`) : undefined;
}

export function writeLab(store: Store, lab: Lab): void {
  store.write(`labs/${lab.id}`, lab);
}

function bearerToken(req: IncomingMessage): string {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) {
    throw new ApiError(401, 'no-token', 'This needs a lab token. Send it as "Authorization: Bearer <token>".');
  }
  return match[1];
}

function findToken(lab: Lab, token: string): LabToken | undefined {
  const hash = hashOf(token);
  return lab.tokens.find((entry) => hashesMatch(entry.hash, hash));
}

export function requireMember(req: IncomingMessage, store: Store, labId: string): Caller {
  const token = bearerToken(req);
  const lab = readLab(store, labId);
  const entry = lab && findToken(lab, token);
  if (!lab || !entry) {
    throw new ApiError(403, 'wrong-token', `This token is not a member token for lab ${labId}. Check the lab id and the token.`);
  }
  return { lab, token: entry };
}

export function requireAdmin(req: IncomingMessage, store: Store, labId: string): Caller {
  const caller = requireMember(req, store, labId);
  if (caller.token.role !== 'admin') {
    throw new ApiError(403, 'not-admin', 'Only the lab admin can do this. Ask your lab admin.');
  }
  return caller;
}

// The AI route names no lab, so a member token for any lab on this server will do.
export function requireAnyMember(req: IncomingMessage, store: Store): void {
  const token = bearerToken(req);
  const known = store.list('labs').some((id) => {
    const lab = readLab(store, id);
    return lab !== undefined && findToken(lab, token) !== undefined;
  });
  if (!known) {
    throw new ApiError(403, 'wrong-token', 'This token is not a member token for any lab on this server. Check the token.');
  }
}
