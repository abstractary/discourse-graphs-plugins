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
