/**
 * Counts and sizes as a person reads them, in one place, so no two panels come
 * to say the same number differently.
 */

import type { HostErrorCode } from "@dg/contract/host.ts";
import { CallError } from "./rpc.ts";

/** "1 unit", "3 units". The plural is given, because English doesn't always add an s. */
export const count = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const IRREGULAR: Record<string, string> = { canvas: "canvases", reply: "replies", person: "people" };
/** `count` for a word whose plural can be worked out. */
export const counted = (n: number, word: string): string => count(n, word, IRREGULAR[word] ?? `${word}s`);

/** A file's size in thousands, as file managers show it. Empty when it isn't known. */
export const sizeOf = (bytes: number | undefined): string =>
  bytes === undefined ? "" : bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

/** What an error says, whatever was thrown. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Which kind of refusal a failed call was, when the core said. Anything else thrown has no code. */
export const codeOf = (error: unknown): HostErrorCode | undefined => (error instanceof CallError ? error.code : undefined);

/** Said first when a thing belongs to someone else or to the lab. The core's own sentence follows and says whose it is. */
export const CANT_CHANGE = "This can't be changed here.";
export const TRY_AGAIN = "Try again";

/** Whether asking again could go differently: the thing asked wasn't reachable, as distinct from refused. */
export const canRetry = (error: unknown): boolean => codeOf(error) === "unavailable";

/**
 * What to tell the person when a call fails. The core's sentence is kept, since it names the thing;
 * the code adds what it means for them.
 */
export const sayOf = (error: unknown): string => {
  const message = messageOf(error);
  return codeOf(error) === "read-only" && !message.startsWith(CANT_CHANGE) ? `${CANT_CHANGE} ${message}` : message;
};

/** A panel that shows one thing, when that thing is no longer there: "This run is gone." Without a word for it, "This is gone." */
export const goneOf = (what?: string): string => `This ${what ? `${what} ` : ""}is gone. It may have been removed.`;
