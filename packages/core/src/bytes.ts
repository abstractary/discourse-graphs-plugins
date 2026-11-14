import type { JsonObject } from "@dg/contract/records.ts";

/**
 * Small conversions every feature that reads a file needs: bytes to and from
 * base64, the text inside a data URL, a file's name without its ending, and
 * the two readings of a JSON-LD value. They are here once so that no two
 * features can come to disagree about them.
 */

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** In pieces, because spreading a whole file into one call overflows the stack. */
export const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 32_768) binary += String.fromCharCode(...bytes.subarray(at, at + 32_768));
  return btoa(binary);
};

export const fromBase64Url = (text: string): Uint8Array => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/"));

/** The text a `data:` URL carries. */
export const textOfDataUrl = (dataUrl: string): string => new TextDecoder().decode(fromBase64(dataUrl.split(",")[1] ?? ""));

/** A file's name without its ending. */
export const stemOf = (name: string): string => name.replace(/\.[^.]+$/, "");

/** A JSON-LD value as a list, whether it was written as one thing, several or nothing. */
export const listOf = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

/** The `@id`s a JSON-LD value points at. */
export const idsOf = (value: unknown): string[] =>
  listOf(value).flatMap((item) => (item && typeof item === "object" && "@id" in item ? [String((item as JsonObject)["@id"])] : typeof item === "string" ? [item] : []));
