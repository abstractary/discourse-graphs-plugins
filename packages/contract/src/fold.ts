import { canonicalJson } from "./json.ts";
import { isDocument, versionKey, type CanvasEdge, type CanvasItem, type CanvasItemRecord, type CanvasNode, type DecisionRecord, type DgCanvas, type DgId, type DgRecord, type DocumentRecord, type EvaluationRecord, type NodeRecord, type RelationRecord, type RetractionRecord, type SpaceId } from "./record.ts";
import { isKnownRecord } from "./validate.ts";

/**
 * Every record read into one graph. This is where the rules live for which
 * version of a record stands, who may change what, and what an agent's key may
 * sign. A rule kept here is kept by every reader of a vault: the plugin, the
 * local app, a labmate's copy, an agent. It is a pure function of the records
 * it is given, and the order they arrive in never changes the result.
 */
const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Positive when `a` beats `b`, for two versions made apart, neither replacing the other. The later
 * one stands. The final tie-break is on content, so every replica picks the same winner whatever
 * order the versions arrived in.
 */
export const compareVersions = (a: DgRecord, b: DgRecord): number => {
  if (isDocument(a) && isDocument(b)) {
    // Removal against an edit, made apart. On a canvas the edit stands: taking a card off removes only
    // what its remover had seen, so nobody's move or rewording is lost to a race, and it can be taken
    // off again. For what grants access, the removal stands. Both rules need every version of such a
    // record to travel, so that "made apart" is read the same on every device.
    const gone = Number(Boolean((a as { removed?: boolean }).removed)) - Number(Boolean((b as { removed?: boolean }).removed));
    if (gone !== 0 && REMOVAL_WINS.includes(a.kind)) return gone;
    if (gone !== 0 && a.kind === "canvas-item") return -gone;
    return (
      compareStrings(a.editedAt, b.editedAt) ||
      a.rev - b.rev ||
      compareStrings(a.editedBy.id, b.editedBy.id) ||
      Number(Boolean(a.sig)) - Number(Boolean(b.sig)) ||
      compareStrings(canonicalJson(a), canonicalJson(b))
    );
  }
  return Number(Boolean(a.sig)) - Number(Boolean(b.sig)) || compareStrings(canonicalJson(a), canonicalJson(b));
};

/** Kinds only their author changes. A version by anyone else is kept in the log and never read. */
const AUTHOR_ONLY: readonly string[] = ["lab", "node-type", "relation-type", "person", "evaluation", "device"];

/** Kinds that grant something. For these a removal made apart from an edit stands, so access is never kept by a race. */
const REMOVAL_WINS: readonly string[] = ["membership", "device"];

/**
 * Whether a version may stand, given the versions it follows. An id carries its author's DID, so a
 * record can't be made under someone else's name.
 *
 * A unit's words and its existence are its author's alone. A labmate may add to what is known about
 * it, such as where its PDF is, and that version stands only if it keeps the title and doesn't
 * remove the unit, and only if the version it replaces stands too.
 *
 * A membership is its member's, and the lab's custodian may end it.
 */
const standing = (records: DgRecord[], custodianOf: Map<string, string>, agentKeys: Set<string>): ((record: DgRecord) => boolean) => {
  const byVersion = new Map<string, DocumentRecord>();
  for (const record of records) if (isKnownRecord(record) && isDocument(record)) byVersion.set(`${record.id}|${versionKey(record)}`, record);
  const known = new Map<DgRecord, boolean>();
  const stands = (record: DgRecord): boolean => {
    const settled = known.get(record);
    if (settled !== undefined) return settled;
    // A version that names itself, or a loop, stands on nothing.
    known.set(record, false);
    const split = record.id.lastIndexOf("#");
    const owner = split > 0 ? record.id.slice(0, split) : "";
    let ok = !(owner.startsWith("did:") && record.by.id.startsWith("did:") && owner !== record.by.id);
    // An agent adds. It never changes what a person wrote: a version it signs stands only as something
    // new, or as a change to something it proposed itself.
    if (ok && record.sigBy !== undefined && agentKeys.has(record.sigBy)) {
      if (!AGENT_MAY_SIGN.includes(record.kind)) ok = false;
      else if (isDocument(record) && record.rev > 1 && record.kind !== "device") {
        const before = record.prev ? byVersion.get(`${record.id}|${record.prev}`) : undefined;
        ok = before !== undefined && before.sigBy === record.sigBy && stands(before);
      }
    }
    if (ok && isDocument(record) && record.editedBy.id !== record.by.id) {
      if (AUTHOR_ONLY.includes(record.kind)) ok = false;
      else if (record.kind === "membership") ok = record.editedBy.id === custodianOf.get(record.lab);
      else if (record.kind === "node") {
        const before = record.prev
          ? byVersion.get(`${record.id}|${record.prev}`)
          : // From before versions named what they replace, and before signing: the author's version just before it.
            record.sig
            ? undefined
            : records.find((other): other is NodeRecord => other.kind === "node" && other.id === record.id && other.rev === record.rev - 1 && other.editedBy.id === other.by.id);
        ok = before?.kind === "node" && stands(before) && before.title === record.title && Boolean(before.removed) === Boolean(record.removed);
      }
    } else if (ok && record.kind === "membership" && !record.removed && record.prev) {
      // Once the lab's custodian has ended a membership, its member can't bring it back. Coming back is a new one.
      const before = byVersion.get(`${record.id}|${record.prev}`);
      if (before?.kind === "membership" && before.removed && before.editedBy.id !== record.by.id) ok = false;
    }
    known.set(record, ok);
    return ok;
  };
  return stands;
};

export type RelationState = "active" | "pending" | "rejected" | "withdrawn";

/** What a proposal can be: a unit, a relation between units, or a check on one. */
export type ProposalRecord = NodeRecord | RelationRecord | EvaluationRecord;

export type FoldedGraph = {
  documents: Map<DgId, DocumentRecord>;
  relations: Map<DgId, { record: RelationRecord; state: RelationState }>;
  /** Documents their author has withdrawn. They stay in `documents`. */
  withdrawn: Set<DgId>;
  /**
   * What an agent proposed, set apart. It is in neither `documents` nor `relations`, so nothing
   * reads it as part of the argument until a person accepts it, which makes a record of their own.
   */
  proposals: Map<DgId, { record: ProposalRecord; decision?: "accepted" | "rejected" }>;
};

/** What an agent's key may sign at all. Everything it signs is a proposal, whatever the record says. */
const AGENT_MAY_SIGN: readonly string[] = ["node", "relation", "evaluation", "device"];

const laterDecision = (a: DecisionRecord, b: DecisionRecord): DecisionRecord =>
  (compareStrings(a.at, b.at) || compareStrings(a.id, b.id)) >= 0 ? a : b;

/** Turns any bag of records into one graph. The result ignores input order. */
export const foldRecords = ({
  records,
  localSpace,
  trustedLab,
  ownKey,
}: {
  records: DgRecord[];
  localSpace: SpaceId;
  /** Relations from this person's own lab don't wait for a decision. */
  trustedLab?: string;
  /** For an agent reading its own vault: what this key signed is read in place, so it can see what it proposed. */
  ownKey?: string;
}): FoldedGraph => {
  // A lab's custodian is fixed when the lab is made, and only the custodian writes the lab's record.
  const custodianOf = new Map<string, string>();
  for (const record of records) {
    if (record.kind === "lab" && record.editedBy.id === record.by.id && record.custodian === record.by.id) custodianOf.set(record.did, record.custodian);
  }
  // What each standing version replaces is out of the running. Of what is left, the latest stands.
  // The keys that belong to agents. What they sign is a proposal.
  const agentKeys = new Set<string>();
  for (const record of records) if (record.kind === "device" && record.role === "agent") agentKeys.add(record.key);
  const fromAgent = (record: DgRecord): boolean => record.sigBy !== undefined && record.sigBy !== ownKey && agentKeys.has(record.sigBy) && record.kind !== "device";
  const stands = standing(records, custodianOf, agentKeys);
  const replaced = new Set<string>();
  for (const record of records) {
    if (isKnownRecord(record) && isDocument(record) && record.prev && stands(record)) replaced.add(`${record.id}|${record.prev}`);
  }
  // Versions from before each named what it replaced say so only by their count of edits: among
  // those, a later count replaced every earlier one. Without this, an old first version would
  // still look like one nobody had replaced, and a card taken off would come back.
  const unnamedTop = new Map<DgId, number>();
  for (const record of records) {
    if (isKnownRecord(record) && isDocument(record) && !record.prev && stands(record)) unnamedTop.set(record.id, Math.max(unnamedTop.get(record.id) ?? 0, record.rev));
  }
  const winners = new Map<DgId, DgRecord>();
  for (const record of records) {
    // A newer client's kinds are kept in the log but never read as something else.
    if (!isKnownRecord(record)) continue;
    if (!stands(record)) continue;
    if (isDocument(record) && replaced.has(`${record.id}|${versionKey(record)}`)) continue;
    if (isDocument(record) && !record.prev && record.rev < (unnamedTop.get(record.id) ?? 0)) continue;
    const current = winners.get(record.id);
    if (!current || compareVersions(record, current) > 0) {
      winners.set(record.id, record);
    }
  }

  const documents = new Map<DgId, DocumentRecord>();
  const relations: RelationRecord[] = [];
  const retractions: RetractionRecord[] = [];
  const decisions = new Map<DgId, DecisionRecord>();
  const proposed: ProposalRecord[] = [];
  for (const record of winners.values()) {
    if (fromAgent(record)) {
      if (record.kind === "node" || record.kind === "relation" || record.kind === "evaluation") proposed.push(record);
      continue;
    }
    if (isDocument(record)) documents.set(record.id, record);
    else if (record.kind === "relation") relations.push(record);
    else if (record.kind === "retraction") retractions.push(record);
    else if (record.kind === "decision" && record.space === localSpace) {
      const current = decisions.get(record.target);
      decisions.set(
        record.target,
        current ? laterDecision(record, current) : record,
      );
    }
  }

  // The author can withdraw their own work, and so can their lab's custodian.
  const mayWithdraw = ({ by, target }: RetractionRecord): boolean => {
    const record = winners.get(target);
    if (!record) return false;
    return by.id === record.by.id || (record.lab !== undefined && by.id === custodianOf.get(record.lab));
  };
  const withdrawnIds = new Set(
    retractions.filter(mayWithdraw).map((retraction) => retraction.target),
  );

  const stateOf = (relation: RelationRecord): RelationState => {
    if (withdrawnIds.has(relation.id)) return "withdrawn";
    const decision = decisions.get(relation.id)?.decision;
    if (decision === "rejected") return "rejected";
    if (decision === "accepted") return "active";
    if (relation.proposed) return "pending";
    if (relation.space === localSpace) return "active";
    return trustedLab !== undefined && relation.lab === trustedLab ? "active" : "pending";
  };

  return {
    documents,
    relations: new Map(
      relations.map((record) => [
        record.id,
        { record, state: stateOf(record) },
      ]),
    ),
    withdrawn: new Set([...withdrawnIds].filter((id) => documents.has(id))),
    proposals: new Map(
      proposed.map((record) => {
        const decision = decisions.get(record.id)?.decision;
        return [record.id, { record, ...(decision ? { decision } : {}) }];
      }),
    ),
  };
};

export const isCanvasEdge = (item: CanvasItem): item is CanvasEdge =>
  "fromNode" in item;

/** Every item a canvas currently shows, in drawing order. */
export const liveCanvasItems = ({
  graph,
  canvas,
}: {
  graph: FoldedGraph;
  canvas: DgId;
}): CanvasItemRecord[] =>
  [...graph.documents.values()]
    .filter(
      (record): record is CanvasItemRecord =>
        record.kind === "canvas-item" &&
        record.canvas === canvas &&
        !record.removed,
    )
    .sort((a, b) => a.z - b.z || compareStrings(a.id, b.id));

/** Assembles items into plain JSON Canvas, dropping edges with a missing end. */
export const buildCanvas = ({
  graph,
  canvas,
}: {
  graph: FoldedGraph;
  canvas: DgId;
}): DgCanvas => {
  const items = liveCanvasItems({ graph, canvas }).map((record) => record.item);
  const nodes = items.filter(
    (item): item is CanvasNode => !isCanvasEdge(item) && item.type !== "stroke",
  );
  const ids = new Set(nodes.map((node) => node.id));
  const edges = items
    .filter(isCanvasEdge)
    .filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode));
  return { nodes, edges };
};
