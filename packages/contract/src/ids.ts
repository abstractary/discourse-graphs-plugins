/**
 * Every discourse unit gets an id made of its author's DID and a TID, such as
 * `did:plc:ewvi7nxzyoun6zhxrhs64oiz#3lz4qk7mfja2c`. The DID says who made it, and
 * the TID is the AT Protocol record key. Neither depends on the unit's type, so
 * giving a thought a type later never changes its id. See `atUri` for the URI.
 */
const SORTABLE = "234567abcdefghijklmnopqrstuvwxyz";
const TID_PATTERN = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

/**
 * Where time and chance come from. A base leaves these alone. A simulation replaces them, so a run
 * can be played again and give the same records, byte for byte.
 *
 * `offsetMs` is this device's correction: a lab's server says what time it is with every exchange,
 * and a device whose clock is off stamps its records with the difference added.
 * `floorMs` is the latest time this device has itself stamped, so a clock set back never stamps
 * something new as older than what it already wrote.
 */
export const clock = { offsetMs: 0, floorMs: 0, now: (): number => Date.now() };
export const entropy = { fill: <T extends Uint8Array | Uint16Array>(into: T): T => crypto.getRandomValues(into) };

/** The time to stamp with: corrected, and never earlier than this device's own last stamp. */
export const stampMs = (): number => {
  const at = Math.max(clock.now() + clock.offsetMs, clock.floorMs);
  clock.floorMs = at;
  return at;
};

/** Random per process, so two devices writing in the same microsecond don't collide. */
let clockId: number | undefined;
let lastMicros = 0;
/** For a simulation starting over: ids begin again from the clock and the seeded chance. */
export const resetIds = (): void => {
  clockId = undefined;
  lastMicros = 0;
  clock.floorMs = 0;
};

/** 53 bits of microseconds and 10 of clock id, always rising within a process. */
export const tid = (): string => {
  clockId ??= entropy.fill(new Uint16Array(1))[0]! % 1024;
  lastMicros = Math.max(stampMs() * 1000, lastMicros + 1);
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
