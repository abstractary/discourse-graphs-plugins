import * as dagCbor from "@ipld/dag-cbor";
import { p256 } from "@noble/curves/p256";
import { sha256 as hash } from "@noble/hashes/sha256";
import { base32 } from "multiformats/bases/base32";
import { base58btc } from "multiformats/bases/base58";
import { sha256 } from "multiformats/hashes/sha2";
import { canonicalJson, isDocument, type DgRecord, type JsonObject, type PersonRecord } from "@dg/contract/records.ts";

/**
 * Each version of a record is signed by whoever wrote it, with the key their DID was made from.
 * A labmate checks the signature when the record arrives, so a record that only claims to be
 * someone's is told apart from one that is.
 *
 * A did:plc is the hash of its first signed operation, and that operation names the signing key.
 * So a person's own record is enough to check their signature: nothing is looked up anywhere.
 */

const CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): Uint8Array => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));

/** What is signed: the record as every replica writes it, without the signature itself. */
const signedBytes = (record: DgRecord): Uint8Array => {
  const { sig: _sig, ...rest } = record;
  return new TextEncoder().encode(canonicalJson(rest));
};

/** Whose signature a version carries: whoever edited it last, or whoever made it. */
export const signerOf = (record: DgRecord): string => (isDocument(record) ? record.editedBy.id : record.by.id);

export const signRecord = async <R extends DgRecord>(record: R, pair: CryptoKeyPair): Promise<R> => {
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signedBytes(record)));
  // The same form PLC asks for, so one verifier reads both.
  let s = raw.subarray(32).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  if (s > CURVE_ORDER / 2n) s = CURVE_ORDER - s;
  const low = new Uint8Array(64);
  low.set(raw.subarray(0, 32));
  for (let at = 63; at >= 32; at -= 1) {
    low[at] = Number(s & 0xffn);
    s >>= 8n;
  }
  return { ...record, sig: toBase64Url(low) };
};

/** The public key inside a `did:key` for P-256, as the compressed point. */
const pointOf = (didKey: string): Uint8Array | null => {
  if (!didKey.startsWith("did:key:z")) return null;
  try {
    const bytes = base58btc.decode(didKey.slice("did:key:".length));
    return bytes[0] === 0x80 && bytes[1] === 0x24 && bytes.length === 35 ? bytes.subarray(2) : null;
  } catch {
    return null;
  }
};

export const verifyRecord = (record: DgRecord, didKey: string): boolean => {
  const point = pointOf(didKey);
  if (!point || !record.sig) return false;
  try {
    return p256.verify(fromBase64Url(record.sig), hash(signedBytes(record)), point, { lowS: false });
  } catch {
    return false;
  }
};

/**
 * The signing key a person's record proves is theirs, or null when the record doesn't hold up:
 * its DID must be the hash of its own first operation.
 */
export const signingKeyOf = async (person: Pick<PersonRecord, "did" | "plc">): Promise<string | null> => {
  const [first] = person.plc ?? [];
  if (!first || !person.did) return null;
  const digest = await sha256.digest(dagCbor.encode(first));
  if (`did:plc:${base32.baseEncode(digest.digest).slice(0, 24)}` !== person.did) return null;
  const key = (first.verificationMethods as JsonObject | undefined)?.atproto;
  return typeof key === "string" ? key : null;
};

/**
 * Sorts arriving records into those to keep and those to refuse. A record whose writer's key is
 * known must carry that writer's signature. A writer nobody here has a key for can't be checked,
 * and can't pass for a labmate either, since a labmate's key is known.
 */
export const checkSignatures = async (incoming: DgRecord[], known: PersonRecord[]): Promise<{ kept: DgRecord[]; refused: DgRecord[] }> => {
  const keys = new Map<string, string>();
  for (const person of [...known, ...incoming.filter((record): record is PersonRecord => record.kind === "person")]) {
    if (!person.did || keys.has(person.did)) continue;
    const key = await signingKeyOf(person);
    if (key) keys.set(person.did, key);
  }
  const kept: DgRecord[] = [];
  const refused: DgRecord[] = [];
  for (const record of incoming) {
    const key = keys.get(signerOf(record));
    (!key || verifyRecord(record, key) ? kept : refused).push(record);
  }
  return { kept, refused };
};
