/**
 * Every discourse unit gets an id made of its author's DID and a TID, such as
 * `did:plc:ewvi7nxzyoun6zhxrhs64oiz#3lz4qk7mfja2c`. The DID says who made it, and
 * the TID is the AT Protocol record key. Neither depends on the unit's type, so
 * giving a thought a type later never changes its id. See `atUri` for the URI.
 */
const SORTABLE = "234567abcdefghijklmnopqrstuvwxyz";
const TID_PATTERN = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

/** Random per process, so two devices writing in the same microsecond don't collide. */
const clockId = crypto.getRandomValues(new Uint16Array(1))[0]! % 1024;
let lastMicros = 0;

/** 53 bits of microseconds and 10 of clock id, always rising within a process. */
export const tid = (): string => {
  lastMicros = Math.max(Date.now() * 1000, lastMicros + 1);
  let value = (BigInt(lastMicros) << 10n) | BigInt(clockId);
  let out = "";
  for (let i = 0; i < 13; i += 1) {
    out = SORTABLE[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
};

export const isTid = (value: string): boolean => TID_PATTERN.test(value);

export const unitId = (did: string): string => `${did}#${tid()}`;

export const isUnitId = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  const split = value.lastIndexOf("#");
  return split > 0 && isTid(value.slice(split + 1));
};

export const splitUnitId = (id: string): { did: string; rkey: string } => {
  const split = id.lastIndexOf("#");
  return { did: id.slice(0, split), rkey: id.slice(split + 1) };
};
