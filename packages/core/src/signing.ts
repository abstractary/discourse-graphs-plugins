import { fromBase64Url } from "./bytes.ts";
import * as dagCbor from "@ipld/dag-cbor";
import { p256 } from "@noble/curves/p256";
import { sha256 as hash } from "@noble/hashes/sha256";
import { base32 } from "multiformats/bases/base32";
import { base58btc } from "multiformats/bases/base58";
import { sha256 } from "multiformats/hashes/sha2";
import { canonicalJson, isDocument, type DeviceRecord, type DgRecord, type JsonObject, type PersonRecord } from "@dg/contract/records.ts";
import { signBytes, toBase64Url, type KeyStore } from "./identity.ts";

/**
 * Each version of a record is signed by whoever wrote it, with the key their DID was made from.
 * A labmate checks the signature when the record arrives, so a record that only claims to be
 * someone's is told apart from one that is.
 *
 * A did:plc is the hash of its first signed operation, and that operation names the signing key.
 * So a person's own record is enough to check their signature: nothing is looked up anywhere.
 */


/** What is signed: the record as every replica writes it, without the signature itself. */
const signedBytes = (record: DgRecord): Uint8Array => {
  const { sig: _sig, ...rest } = record;
  return new TextEncoder().encode(canonicalJson(rest));
};

/** Whose signature a version carries: whoever edited it last, or whoever made it. */
export const signerOf = (record: DgRecord): string => (isDocument(record) ? record.editedBy.id : record.by.id);

export const signRecord = async <R extends DgRecord>(record: R, pair: CryptoKeyPair, keys?: Pick<KeyStore, "sign">, sigBy?: string): Promise<R> => {
  // Which key signs is part of what is signed, so a record can't be passed off as another key's.
  const named = sigBy ? { ...record, sigBy } : record;
  return { ...named, sig: toBase64Url(await signBytes(keys, pair, signedBytes(named))) };
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

/** What a vouch signs: this person, and the key being let in. */
const vouchBytes = (did: string, key: string): Uint8Array => new TextEncoder().encode(`dg-device:${did}:${key}`);

const verifyBytes = (bytes: Uint8Array, sig: string, didKey: string): boolean => {
  const point = pointOf(didKey);
  if (!point) return false;
  try {
    return p256.verify(fromBase64Url(sig), hash(bytes), point, { lowS: false });
  } catch {
    return false;
  }
};

/** A trusted device's word for another key: its signature over that key, for this person. */
export const vouchFor = async ({ did, key, by, pair, keys }: { did: string; key: string; by: string; pair: CryptoKeyPair; keys?: Pick<KeyStore, "sign"> }): Promise<{ by: string; sig: string }> => ({
  by,
  sig: toBase64Url(await signBytes(keys, pair, vouchBytes(did, key))),
});

/**
 * Every key that may sign as a person: the one their DID was made with, and each device a trusted
 * key has vouched for, followed as far as the vouches go. A device taken out of use is left out.
 */
export const trustedKeys = async (person: Pick<PersonRecord, "did" | "plc">, devices: DeviceRecord[]): Promise<string[]> => {
  const root = await signingKeyOf(person);
  if (!root) return [];
  const trusted = [root];
  const waiting = devices.filter((device) => device.by.id === person.did && !device.removed && device.vouch);
  for (let found = true; found; ) {
    found = false;
    for (const device of waiting) {
      if (trusted.includes(device.key) || !trusted.includes(device.vouch!.by)) continue;
      // An agent's key speaks for nobody else: it can't let another device in.
      if (devices.some((other) => other.key === device.vouch!.by && other.role === "agent")) continue;
      if (!verifyBytes(vouchBytes(person.did!, device.key), device.vouch!.sig, device.vouch!.by)) continue;
      trusted.push(device.key);
      found = true;
    }
  }
  return trusted;
};

/**
 * Sorts arriving records into those to keep, those to refuse and those to hold.
 *
 * A record whose writer's keys are known must carry a signature from one of them. A writer nobody
 * here has a key for can't be checked, and can't pass for a labmate either, since a labmate's key
 * is known. The one gap is a labmate whose own record hasn't arrived yet: what they wrote is held
 * until it does, and checked then.
 */
export const checkSignatures = async (
  incoming: DgRecord[],
  known: { persons: PersonRecord[]; devices?: DeviceRecord[]; members?: Set<string> },
): Promise<{ kept: DgRecord[]; refused: DgRecord[]; held: DgRecord[] }> => {
  const persons = [...known.persons, ...incoming.filter((record): record is PersonRecord => record.kind === "person")];
  const devices = [...(known.devices ?? []), ...incoming.filter((record): record is DeviceRecord => record.kind === "device")];
  const keys = new Map<string, string[]>();
  for (const person of persons) {
    if (!person.did || keys.has(person.did)) continue;
    const trusted = await trustedKeys(person, devices);
    if (trusted.length > 0) keys.set(person.did, trusted);
  }
  const kept: DgRecord[] = [];
  const refused: DgRecord[] = [];
  const held: DgRecord[] = [];
  const agents = new Set(devices.filter((device) => device.role === "agent").map((device) => device.key));
  for (const record of incoming) {
    const writer = signerOf(record);
    const theirs = keys.get(writer);
    // What an agent proposed stays with its person. It never arrives from a lab as anything.
    if (record.sigBy !== undefined && agents.has(record.sigBy) && record.kind !== "device") refused.push(record);
    else if (!theirs) (known.members?.has(writer) ? held : kept).push(record);
    // A device asking to be let in is signed with its own key, which nobody trusts yet. It says only that someone asked.
    else if (record.kind === "device" && !record.vouch && verifyRecord(record, record.key)) kept.push(record);
    // A record that names its key must verify with that key. One that doesn't is tried against the person's own devices, never an agent's.
    else if (record.sigBy !== undefined) (theirs.includes(record.sigBy) && verifyRecord(record, record.sigBy) ? kept : refused).push(record);
    else (theirs.some((key) => !agents.has(key) && verifyRecord(record, key)) ? kept : refused).push(record);
  }
  return { kept, refused, held };
};
