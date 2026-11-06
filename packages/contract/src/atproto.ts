import * as dagCbor from "@ipld/dag-cbor";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { splitUnitId } from "./ids.ts";
import type {
  BaseNodeType,
  DgId,
  DgRecord,
  FoldedGraph,
  JsonObject,
  NodeRecord,
  NodeTypeRecord,
  RelationRecord,
  RelationTypeRecord,
} from "./records.ts";

/**
 * Shared science goes in `science.mira.*`, so DG speaks the same schema as the
 * rest of the field. Tool data has no place there, and uses `org.discoursegraphs.*`.
 * Anchors and decisions stay local, so they never become AT records.
 */
const NODE_COLLECTIONS: Record<BaseNodeType, string> = {
  question: "science.mira.question",
  claim: "science.mira.claim",
  evidence: "science.mira.evidence",
  source: "science.mira.sourceDocument",
};
const DRAFT = "org.discoursegraphs.draft";
const RELATION = "science.mira.relation";

const TOOL_COLLECTIONS: Partial<Record<DgRecord["kind"], string>> = {
  "node-type": "org.discoursegraphs.nodeType",
  "relation-type": "org.discoursegraphs.relationType",
  canvas: "org.discoursegraphs.canvas",
  "canvas-item": "org.discoursegraphs.canvasItem",
  retraction: "org.discoursegraphs.retraction",
  person: "org.discoursegraphs.person",
  lab: "org.discoursegraphs.lab",
  membership: "org.discoursegraphs.membership",
  snapshot: "org.discoursegraphs.snapshot",
  relation: RELATION,
};

export type AtRecord = { uri: string; collection: string; rkey: string; value: JsonObject };

const typeOf = (graph: FoldedGraph, id: DgId | undefined): NodeTypeRecord | undefined => {
  const record = id ? graph.documents.get(id) : undefined;
  return record?.kind === "node-type" ? record : undefined;
};

/** A node's collection follows its type, while its record key never changes. */
const nodeCollection = (node: NodeRecord, graph: FoldedGraph): string => {
  const type = typeOf(graph, node.type);
  if (type?.lexicon) return type.lexicon;
  return type?.base ? NODE_COLLECTIONS[type.base] : DRAFT;
};

export const collectionOf = (record: DgRecord, graph: FoldedGraph): string | null =>
  record.kind === "node" ? nodeCollection(record, graph) : (TOOL_COLLECTIONS[record.kind] ?? null);

export const atUriOf = (id: DgId, graph: FoldedGraph): string | null => {
  const record: DgRecord | undefined =
    graph.documents.get(id) ?? graph.relations.get(id)?.record;
  const collection = record ? collectionOf(record, graph) : null;
  if (!collection) return null;
  const { did, rkey } = splitUnitId(id);
  return `at://${did}/${collection}/${rkey}`;
};

const reference = (id: DgId, graph: FoldedGraph): JsonObject => ({ uri: atUriOf(id, graph) ?? id });

/** The lab is credited on every unit, beside the person who made it. */
const attributed = (record: DgRecord): JsonObject[] => [
  { uri: record.by.id },
  ...(record.lab ? [{ uri: record.lab }] : []),
];

const dates = (record: DgRecord): JsonObject => ({
  createdAt: record.at,
  ...("editedAt" in record && record.rev > 1 ? { updatedAt: record.editedAt } : {}),
});

const predicateOf = (record: RelationRecord, graph: FoldedGraph): string => {
  const type = graph.documents.get(record.type) as RelationTypeRecord | undefined;
  return type?.base ?? type?.label ?? "relatedTo";
};

const valueOf = (record: DgRecord, graph: FoldedGraph): JsonObject | null => {
  switch (record.kind) {
    case "node":
      return { title: record.title, attributedTo: attributed(record), ...dates(record) };
    case "relation":
      return {
        predicate: predicateOf(record, graph),
        source: reference(record.source, graph),
        destination: reference(record.target, graph),
        attributedTo: attributed(record),
        // A pattern match isn't anyone's assertion, so it says it was machine-made.
        ...(record.proposed ? { provenance: { method: "imported", agent: "Discourse Graphs import" } } : {}),
        ...dates(record),
      };
    case "node-type":
      return {
        label: record.label,
        ...(record.abbreviation ? { abbreviation: record.abbreviation } : {}),
        ...(record.base ? { base: record.base } : {}),
        ...(record.color ? { color: record.color } : {}),
        ...(record.lexicon ? { lexicon: record.lexicon } : {}),
        ...dates(record),
      };
    case "relation-type":
      return {
        label: record.label,
        complement: record.complement,
        ...(record.base ? { base: record.base } : {}),
        rules: record.rules.map(({ source, target }) => ({
          source: atUriOf(source, graph) ?? source,
          target: atUriOf(target, graph) ?? target,
        })),
        ...dates(record),
      };
    case "canvas":
      return { title: record.title, ...dates(record) };
    case "canvas-item":
      return {
        canvas: atUriOf(record.canvas, graph) ?? record.canvas,
        z: record.z,
        item: record.item as unknown as JsonObject,
        ...(record.removed ? { removed: true } : {}),
        ...dates(record),
      };
    case "retraction":
      return {
        target: atUriOf(record.target, graph) ?? record.target,
        ...(record.reason ? { reason: record.reason } : {}),
        ...dates(record),
      };
    case "person":
      return {
        name: record.name,
        aliases: record.aliases,
        ...(record.orcid ? { orcid: record.orcid } : {}),
        ...dates(record),
      };
    case "lab":
      return { name: record.name, did: record.did, custodian: record.custodian, ...dates(record) };
    case "membership":
      return { lab: record.lab, member: record.member, ...dates(record) };
    case "snapshot":
      return {
        node: atUriOf(record.node, graph) ?? record.node,
        format: record.format,
        text: record.body,
        ...dates(record),
      };
    default:
      return null;
  }
};

/** Null for what stays local. Records are written this way only when published. */
export const toAtRecord = (record: DgRecord, graph: FoldedGraph): AtRecord | null => {
  const collection = collectionOf(record, graph);
  const value = collection ? valueOf(record, graph) : null;
  if (!collection || !value) return null;
  const { did, rkey } = splitUnitId(record.id);
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    collection,
    rkey,
    value: { $type: collection, ...value },
  };
};

/** The same CID a repo would give this record: DAG-CBOR, then SHA-256. */
export const cidOf = async (value: JsonObject): Promise<string> =>
  CID.createV1(dagCbor.code, await sha256.digest(dagCbor.encode(value))).toString();

/** AT URI back to our id. Works for anyone's repo, not only ours. */
export const unitIdOf = (uri: string): DgId => {
  const [did = "", , rkey = ""] = uri.replace("at://", "").split("/");
  return `${did}#${rkey}`;
};
