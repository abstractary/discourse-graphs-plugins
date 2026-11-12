import { atUriOf } from "@dg/contract/atproto.ts";
import type {
  DgId,
  FoldedGraph,
  JsonObject,
  NodeRecord,
  Pin,
  RelationTypeRecord,
} from "@dg/contract/records.ts";
import { baseOf } from "./process.ts";

/**
 * The PROV-O publishing view: every unit and its provenance links as JSON-LD,
 * read through `ontology/dg_process.context.jsonld`. Arguments come out as
 * plain triples, active ones only; who stated them stays in the record log.
 */

const CLASS: Record<string, string> = {
  question: "Question",
  claim: "Claim",
  evidence: "Evidence",
  source: "Source",
  protocol: "Protocol",
  study: "Study",
  run: "Run",
  code: "Code",
  output: "Output",
};

const ARGUMENTS = new Set(["supports", "opposes", "addresses", "informs"]);

export const iriOf = (graph: FoldedGraph, id: DgId): string => atUriOf(id, graph) ?? `urn:dg:${id}`;

const pinOf = (graph: FoldedGraph, pin: Pin): JsonObject => ({
  type: "Pin",
  target: graph.documents.has(pin.uri) ? iriOf(graph, pin.uri) : pin.uri,
  ...(pin.cid ? { cid: pin.cid } : {}),
});

const clean = (value: Record<string, unknown>): JsonObject =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && !(Array.isArray(item) && item.length === 0)),
  ) as JsonObject;

const nodeJson = (graph: FoldedGraph, node: NodeRecord): JsonObject | null => {
  const base = baseOf(graph, node);
  if (!base) return null;
  const prov = node.prov ?? {};
  const facts = node.facts ?? {};
  const ref = (id: DgId | undefined) => (id ? iriOf(graph, id) : undefined);
  return clean({
    id: iriOf(graph, node.id),
    type: CLASS[base],
    title: node.title,
    attributedTo: [node.by.id, ...(node.lab ? [node.lab] : [])],
    created: node.at,
    // Logic
    question: ref(prov.question),
    protocols: prov.protocols?.map((id) => iriOf(graph, id)),
    implementedBy: prov.implementedBy?.map((id) => iriOf(graph, id)),
    conditions: facts.conditions,
    version: facts.version,
    sameAs: facts.sameAs,
    // Execution
    partOf: ref(prov.partOf),
    follows: prov.follows ? pinOf(graph, prov.follows) : undefined,
    instrument: prov.instrument?.map((pin) => pinOf(graph, pin)),
    used: prov.used?.map((pin) => pinOf(graph, pin)),
    status: facts.status,
    startedAt: facts.startedAt,
    endedAt: facts.endedAt,
    agents: facts.agents,
    fingerprint: facts.fingerprint,
    parameterValues: facts.parameterValues,
    environment: facts.environment,
    // Code
    repo: facts.repo,
    commit: facts.commit,
    path: facts.path,
    sourceCid: facts.sourceCid,
    language: facts.language,
    swhid: facts.swhid,
    // Observation
    generatedBy: ref(prov.generatedBy),
    derivedFrom: prov.derivedFrom?.map((pin) => pinOf(graph, pin)),
    cid: facts.cid,
    uri: facts.uri,
    mediaType: facts.mediaType,
    byteSize: facts.size,
    outputKind: facts.outputKind,
    locator: facts.locator,
    caption: facts.caption,
    // Argument and sources
    observationBase: prov.observationBase?.map((pin) => pinOf(graph, pin)),
    isGroundedIn: ref(prov.isGroundedIn),
    sourceDocument: ref(prov.sourceDocument),
    describesActivity: prov.describesActivity?.map((id) => iriOf(graph, id)),
    anchor: facts.anchor,
    doi: facts.doi ? `https://doi.org/${facts.doi}` : undefined,
    provenance: facts.provenance,
  });
};

export const toProcessJsonLd = (graph: FoldedGraph, context: JsonObject | string): JsonObject => {
  const nodes = new Map<DgId, JsonObject>();
  for (const record of graph.documents.values()) {
    if (record.kind !== "node" || record.removed || graph.withdrawn.has(record.id)) continue;
    const json = nodeJson(graph, record);
    if (json) nodes.set(record.id, json);
  }
  for (const { record, state } of graph.relations.values()) {
    if (state !== "active") continue;
    const base = (graph.documents.get(record.type) as RelationTypeRecord | undefined)?.base;
    const from = nodes.get(record.source);
    if (!base || !ARGUMENTS.has(base) || !from || !nodes.has(record.target)) continue;
    const list = (from[base] as string[] | undefined) ?? [];
    from[base] = [...list, iriOf(graph, record.target)];
  }
  return { "@context": context, "@graph": [...nodes.values()] };
};
