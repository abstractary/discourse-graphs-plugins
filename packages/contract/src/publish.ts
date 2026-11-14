import { toAtRecord } from "./atproto.ts";
import type { FoldedGraph } from "./fold.ts";
import type { DgId, DgRecord, Json as JsonValue, JsonObject } from "./record.ts";

/**
 * What publishing a set of units would write to a person's public repository, worked out
 * without touching the network. Three rules hold here:
 *
 * - A person publishes only what they wrote. Anyone else's unit is left out, and said so.
 * - A unit's id never changes. Its public address is new, and the record carries the id.
 * - A link to something that is not public stays a DG id, never an address that leads nowhere.
 *
 * Until the public names are agreed, records go out under stand-in names: the last word of the
 * collection a record would have, under `SANDBOX`. Nothing published this way claims to be MIRA.
 */
export const SANDBOX = "org.discoursegraphs.sandbox";

/** The most writes one commit takes. A repository refuses more in a single call. */
export const WRITES_PER_COMMIT = 200;

export type PublishWrite = { id: DgId; collection: string; rkey: string; value: JsonObject };
export type LeftOut = { id: DgId; why: "not-yours" | "local-only" | "an-end-is-not-public" };
export type PublishPlan = {
  writes: PublishWrite[];
  leftOut: LeftOut[];
  /** Numbers with a fraction, which a repository can't hold, written as text. */
  fractions: number;
};

export const standInFor = (collection: string): string => `${SANDBOX}.${collection.split(".").at(-1)}`;

export const publicUri = ({ repo, collection, rkey }: { repo: string; collection: string; rkey: string }): string => `at://${repo}/${collection}/${rkey}`;

const AT_URI = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/;

export const planPublication = ({
  graph,
  ids,
  me,
  repo,
  published = new Map(),
}: {
  graph: FoldedGraph;
  ids: DgId[];
  /** The DID that wrote the records. */
  me: string;
  /** The DID of the repository they go to. It need not be `me`: an account made elsewhere has its own. */
  repo: string;
  /** What is public already, by unit id, and where. */
  published?: Map<DgId, string>;
}): PublishPlan => {
  const leftOut: LeftOut[] = [];
  const chosen: { record: DgRecord; collection: string; rkey: string; value: JsonObject }[] = [];
  for (const id of new Set(ids)) {
    const record: DgRecord | undefined = graph.documents.get(id) ?? graph.relations.get(id)?.record;
    if (!record || ("removed" in record && record.removed)) continue;
    if (record.by.id !== me) {
      leftOut.push({ id, why: "not-yours" });
      continue;
    }
    const projected = toAtRecord(record, graph);
    if (!projected) {
      leftOut.push({ id, why: "local-only" });
      continue;
    }
    chosen.push({ record, collection: standInFor(projected.collection), rkey: projected.rkey, value: projected.value });
  }

  // Where each unit will be, or is: what goes out now, and what went out before.
  const address = new Map<DgId, string>(published);
  for (const { record, collection, rkey } of chosen) address.set(record.id, publicUri({ repo, collection, rkey }));

  // A relation with an end that is not public says nothing a reader can follow.
  const kept = chosen.filter(({ record }) => {
    if (record.kind !== "relation") return true;
    if (address.has(record.source) && address.has(record.target)) return true;
    leftOut.push({ id: record.id, why: "an-end-is-not-public" });
    address.delete(record.id);
    return false;
  });

  let fractions = 0;
  const settle = (value: JsonValue): JsonValue => {
    if (typeof value === "number" && !Number.isInteger(value)) {
      fractions += 1;
      return String(value);
    }
    if (typeof value === "string") {
      const match = AT_URI.exec(value);
      if (!match) return value;
      const id: DgId = `${match[1]}#${match[3]}`;
      return address.get(id) ?? id;
    }
    if (Array.isArray(value)) return value.map(settle);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, settle(item as JsonValue)]));
    return value;
  };

  const writes = kept.map(({ record, collection, rkey, value }) => ({
    id: record.id,
    collection,
    rkey,
    value: { ...(settle(value) as JsonObject), $type: collection, dgId: record.id },
  }));
  return { writes, leftOut, fractions };
};

/** The unit a public address stands for, read from the record itself. */
export const idOfPublished = (value: { dgId?: unknown }, uri: string): DgId => {
  if (typeof value.dgId === "string" && value.dgId.includes("#")) return value.dgId as DgId;
  const match = AT_URI.exec(uri);
  return `${match?.[1] ?? ""}#${match?.[3] ?? ""}`;
};
