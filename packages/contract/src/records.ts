/**
 * Everything about records, from one place. The parts are separate files, each
 * depending only on the ones above it:
 *
 * - `record.ts`: what a record is, how one is made and how one is revised.
 * - `json.ts`: JSON written one way only.
 * - `title.ts`: how a unit's title is written in a base.
 * - `validate.ts`: whether something is a well-formed record of a kind this version knows.
 * - `fold.ts`: every record read into one graph, and the rules for whose word stands.
 */
export * from "./record.ts";
export * from "./json.ts";
export * from "./title.ts";
export * from "./validate.ts";
export * from "./fold.ts";
