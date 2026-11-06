import * as dagCbor from "@ipld/dag-cbor";
import { base32 } from "multiformats/bases/base32";
import { base58btc } from "multiformats/bases/base58";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import type { JsonObject } from "@dg/contract/records.ts";

/**
 * A did:plc is the hash of its signed first operation, so it can be computed on
 * a device with nothing sent anywhere. Registering it later keeps the same DID,
 * which is what lets a unit's id stay the same when someone opts into a network.
 */
export type Identity = {
  did: string;
  /** The key that can change this DID, as a did:key. */
  rotationKey: string;
  plc: JsonObject[];
};

export type KeyStore = {
  get: (name: string) => Promise<CryptoKeyPair | null>;
  put: (name: string, pair: CryptoKeyPair) => Promise<void>;
};

export const memoryKeys = (): KeyStore => {
  const pairs = new Map<string, CryptoKeyPair>();
  return {
    get: async (name) => pairs.get(name) ?? null,
    put: async (name, pair) => {
      pairs.set(name, pair);
    },
  };
};

const STORE = "keys";

/**
 * Private keys are created unextractable and kept in IndexedDB, so no script can
 * read them, and they stay out of the vault or graph, which may sync elsewhere.
 * The cost is that a key can't be backed up: the custodian is the way back.
 */
export const browserKeys = (): KeyStore => {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("discourse-graphs-keys", 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  };
  return {
    get: async (name) => ((await run("readonly", (store) => store.get(name))) as CryptoKeyPair | undefined) ?? null,
    put: async (name, pair) => {
      await run("readwrite", (store) => store.put(pair, name));
    },
  };
};

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const CURVE_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_MULTICODEC = [0x80, 0x24];

const newKeys = (): Promise<CryptoKeyPair> =>
  crypto.subtle.generateKey(ECDSA, false, ["sign", "verify"]) as Promise<CryptoKeyPair>;

const didKeyOf = async (pair: CryptoKeyPair): Promise<string> => {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const compressed = new Uint8Array(33);
  compressed[0] = raw[64]! % 2 === 0 ? 0x02 : 0x03;
  compressed.set(raw.subarray(1, 33), 1);
  return `did:key:${base58btc.encode(new Uint8Array([...P256_MULTICODEC, ...compressed]))}`;
};

const toBigInt = (bytes: Uint8Array): bigint =>
  bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);

const toBytes = (value: bigint, length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
};

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PLC verifiers reject high-S signatures, and WebCrypto produces both kinds. */
const signOperation = async (operation: JsonObject, pair: CryptoKeyPair): Promise<JsonObject> => {
  const bytes = dagCbor.encode(operation);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes),
  );
  const s = toBigInt(signature.subarray(32));
  const low = s > CURVE_ORDER / 2n ? CURVE_ORDER - s : s;
  const canonical = new Uint8Array(64);
  canonical.set(signature.subarray(0, 32));
  canonical.set(toBytes(low, 32), 32);
  return { ...operation, sig: base64url(canonical) };
};

const didFrom = async (signed: JsonObject): Promise<string> => {
  const digest = await sha256.digest(dagCbor.encode(signed));
  return `did:plc:${base32.baseEncode(digest.digest).slice(0, 24)}`;
};

const cidOfOperation = async (signed: JsonObject): Promise<string> =>
  CID.createV1(dagCbor.code, await sha256.digest(dagCbor.encode(signed))).toString();

const genesis = async ({
  rotationKeys,
  signingKey,
  signer,
}: {
  rotationKeys: string[];
  signingKey: string;
  signer: CryptoKeyPair;
}): Promise<JsonObject> =>
  signOperation(
    {
      type: "plc_operation",
      rotationKeys,
      verificationMethods: { atproto: signingKey },
      alsoKnownAs: [],
      services: {},
      prev: null,
    },
    signer,
  );

/** A person's own identity. Their key is the only rotation key until they join a lab. */
export const createIdentity = async (keys: KeyStore): Promise<Identity> => {
  const rotation = await newKeys();
  const signing = await newKeys();
  const rotationKey = await didKeyOf(rotation);
  const operation = await genesis({
    rotationKeys: [rotationKey],
    signingKey: await didKeyOf(signing),
    signer: rotation,
  });
  const did = await didFrom(operation);
  await keys.put(`rotation:${did}`, rotation);
  await keys.put(`signing:${did}`, signing);
  return { did, rotationKey, plc: [operation] };
};

/** A lab's DID. Only the PI's rotation key can change it, which is the custody. */
export const createLabIdentity = async ({
  keys,
  custodian,
}: {
  keys: KeyStore;
  custodian: Identity;
}): Promise<Identity> => {
  const rotation = await keys.get(`rotation:${custodian.did}`);
  if (!rotation) throw new Error("Only the device holding the PI's key can create the lab.");
  const signing = await newKeys();
  const operation = await genesis({
    rotationKeys: [custodian.rotationKey],
    signingKey: await didKeyOf(signing),
    signer: rotation,
  });
  const did = await didFrom(operation);
  await keys.put(`signing:${did}`, signing);
  return { did, rotationKey: custodian.rotationKey, plc: [operation] };
};

/**
 * Puts the custodian's key ahead of the member's. PLC ranks keys by position, so
 * the PI can recover this DID, and can undo a change within the 72-hour window.
 */
export const addCustodian = async ({
  keys,
  identity,
  custodianKey,
}: {
  keys: KeyStore;
  identity: Identity;
  custodianKey: string;
}): Promise<Identity> => {
  const rotation = await keys.get(`rotation:${identity.did}`);
  if (!rotation) throw new Error("This device doesn't hold your rotation key.");
  const previous = identity.plc[identity.plc.length - 1]!;
  const { sig: _sig, ...fields } = previous;
  const existing = (fields.rotationKeys as string[]).filter((key) => key !== custodianKey);
  const next = await signOperation(
    { ...fields, rotationKeys: [custodianKey, ...existing], prev: await cidOfOperation(previous) },
    rotation,
  );
  return { ...identity, plc: [...identity.plc, next] };
};
