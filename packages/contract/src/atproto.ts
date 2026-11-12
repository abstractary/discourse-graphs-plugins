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
  Pin,
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
  protocol: "science.mira.protocol",
  // MIRA's Study is one activity that produces evidence, which is DG's Run.
  // DG's Study is the design, and MIRA has no class for it yet.
  study: "org.discoursegraphs.study",
  run: "science.mira.study",
  code: "org.discoursegraphs.code",
  output: "org.discoursegraphs.output",
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
  evaluation: "science.mira.evaluation",
  release: "org.discoursegraphs.canvasRelease",
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

/** A pin, with the DG id swapped for the AT URI once the target is published. */
const pinned = (pin: Pin, graph: FoldedGraph): JsonObject => ({
  uri: atUriOf(pin.uri, graph) ?? pin.uri,
  ...(pin.cid ? { cid: pin.cid } : {}),
});

const link = (id: DgId | undefined, graph: FoldedGraph): JsonObject | undefined =>
  id ? reference(id, graph) : undefined;

const compact = (value: Record<string, unknown>): JsonObject =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;

/** The run an evidence unit rests on, read from its outputs when it doesn't say. */
const groundOf = (node: NodeRecord, graph: FoldedGraph): DgId | undefined => {
  if (node.prov?.isGroundedIn) return node.prov.isGroundedIn;
  for (const pin of node.prov?.observationBase ?? []) {
    const output = graph.documents.get(pin.uri);
    if (output?.kind === "node" && output.prov?.generatedBy) return output.prov.generatedBy;
  }
  return undefined;
};

/**
 * MIRA's field names where MIRA has the field; DG's own names otherwise. A
 * provenance link to an unpublished unit keeps its DG id, so the reader can
 * see that something is behind it without being shown what.
 */
const processFields = (node: NodeRecord, graph: FoldedGraph): JsonObject => {
  const base = typeOf(graph, node.type)?.base;
  const prov = node.prov ?? {};
  const facts = node.facts ?? {};
  const shared = { ...(facts.provenance ? { provenance: facts.provenance as unknown as JsonObject } : {}) };
  switch (base) {
    case "evidence": {
      const ground = groundOf(node, graph);
      return compact({
        ...shared,
        observationBase: prov.observationBase?.map((pin) => pinned(pin, graph)),
        isGroundedIn: link(ground, graph),
        observationOriginActivity: link(ground, graph),
        sourceDocument: link(prov.sourceDocument, graph),
        anchor: facts.anchor as JsonObject | undefined,
      });
    }
    case "run": {
      const code = (prov.instrument ?? []).flatMap((pin) => {
        const record = graph.documents.get(pin.uri);
        return record?.kind === "node" && record.facts?.repo ? [record.facts.repo] : [];
      });
      return compact({
        ...shared,
        follows: prov.follows ? [pinned(prov.follows, graph)] : undefined,
        used: prov.used?.map((pin) => pinned(pin, graph)),
        wasAssociatedWith: facts.agents,
        startedAtTime: facts.startedAt,
        endedAtTime: facts.endedAt,
        codeRepository: code[0],
        seeAlso: facts.seeAlso,
        // DG's own fields, which MIRA's study lexicon doesn't define yet.
        partOf: link(prov.partOf, graph),
        instrument: prov.instrument?.map((pin) => pinned(pin, graph)),
        status: facts.status,
        condition: facts.condition,
        deviations: facts.deviations,
        parameterValues: facts.parameterValues,
        environment: facts.environment,
      });
    }
    case "protocol":
      return compact({
        ...shared,
        sameAs: facts.sameAs,
        version: facts.version,
        parameters: facts.parameters as unknown as JsonObject[] | undefined,
        steps: facts.steps,
        materials: facts.materials,
        implementedBy: prov.implementedBy?.map((id) => reference(id, graph)),
      });
    case "study":
      return compact({
        ...shared,
        question: link(prov.question, graph),
        protocols: prov.protocols?.map((id) => reference(id, graph)),
        conditions: facts.conditions,
        hypothesis: facts.hypothesis,
        design: facts.design,
        variables: facts.variables as unknown as JsonObject[] | undefined,
        sampleSize: facts.sampleSize,
        preregistration: facts.preregistration,
      });
    case "code":
      return compact({
        ...shared,
        repo: facts.repo,
        commit: facts.commit,
        path: facts.path,
        sourceCid: facts.sourceCid,
        language: facts.language,
        swhid: facts.swhid,
        license: facts.license,
      });
    case "output":
      return compact({
        ...shared,
        generatedBy: link(prov.generatedBy, graph),
        derivedFrom: prov.derivedFrom?.map((pin) => pinned(pin, graph)),
        cid: facts.cid,
        uri: facts.uri,
        mediaType: facts.mediaType,
        size: facts.size,
        outputKind: facts.outputKind,
        locator: facts.locator as JsonObject | undefined,
        caption: facts.caption,
      });
    case "source":
      return compact({
        ...shared,
        doi: facts.doi,
        describesActivity: prov.describesActivity?.map((id) => reference(id, graph)),
      });
    default:
      return compact(shared);
  }
};

const valueOf = (record: DgRecord, graph: FoldedGraph): JsonObject | null => {
  switch (record.kind) {
    case "node":
      return {
        title: record.title,
        attributedTo: attributed(record),
        ...processFields(record, graph),
        ...dates(record),
      };
    case "evaluation":
      return compact({
        destination: { uri: atUriOf(record.target, graph) ?? record.target, ...(record.targetCid ? { cid: record.targetCid } : {}) },
        method: record.method,
        term: record.term,
        note: record.note,
        attributedTo: attributed(record),
        ...dates(record),
      });
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
    case "release":
      return compact({
        canvas: atUriOf(record.canvas, graph) ?? record.canvas,
        name: record.name,
        note: record.note,
        parent: record.parent ? (atUriOf(record.parent, graph) ?? record.parent) : undefined,
        units: record.units.map((pin) => pinned(pin, graph)),
        ...dates(record),
      });
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
