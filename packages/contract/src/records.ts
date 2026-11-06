import { isUnitId, unitId } from "./ids.ts";

export const FORMAT_VERSION = 2;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type DgId = string;
export type SpaceId = string;
/** Opaque to everything except the adapter that issued it. */
export type HostRef = string;
export type Author = { id: string; name: string };

export const BASE_NODE_TYPES = [
  "question",
  "claim",
  "evidence",
  "source",
] as const;
export type BaseNodeType = (typeof BASE_NODE_TYPES)[number];

export const BASE_RELATION_TYPES = [
  "supports",
  "opposes",
  "addresses",
  "informs",
  "derivedFrom",
  "grounds",
  "follows",
  "describesActivity",
  "requestTarget",
] as const;
export type BaseRelationType = (typeof BASE_RELATION_TYPES)[number];

/** Earlier schema documents named the evidence-to-source link differently. */
export const BASE_RELATION_ALIASES: Record<string, BaseRelationType> = {
  interpretedAs: "derivedFrom",
  curatedTo: "derivedFrom",
};

export const DOCUMENT_KINDS = [
  "node",
  "anchor",
  "node-type",
  "relation-type",
  "canvas",
  "canvas-item",
  "snapshot",
  "person",
  "lab",
  "membership",
  "paper",
  "folder",
  "folder-item",
  "reaction",
  "unit-note",
] as const;
export const ASSERTION_KINDS = ["relation", "retraction", "decision"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type AssertionKind = (typeof ASSERTION_KINDS)[number];
export type RecordKind = DocumentKind | AssertionKind;

type Envelope<K extends RecordKind> = {
  v: typeof FORMAT_VERSION;
  id: DgId;
  kind: K;
  /** The space that first wrote this record. */
  space: SpaceId;
  /** When it was first written. Never changes, so authorship survives edits. */
  at: string;
  /** Who wrote it. `by.id` is a DID, which is also the repo that owns the record. */
  by: Author;
  /** The lab's DID, so the lab is credited and its custodian keeps a say. */
  lab?: string;
  ext?: JsonObject;
};

type DocumentFields = { rev: number; editedAt: string; editedBy: Author };

/**
 * `title` is the content alone, with no type prefix, so it reads the same in
 * every base. `type` is absent until someone types the node.
 */
export type NodeRecord = Envelope<"node"> &
  DocumentFields & {
    title: string;
    type?: DgId;
    /** Taken back by its author. The record stays, so nothing else loses its history. */
    removed?: boolean;
    /** Where an extracted unit came from. A hand-made node has none. */
    source?: UnitSource;
  };

export type UnitSource = {
  paper: DgId;
  /** The passage it was read from, word for word. */
  anchor?: string;
  description?: string;
};

/** Ties a node to text in one space. A HostRef means nothing anywhere else. */
export type AnchorRecord = Envelope<"anchor"> &
  DocumentFields & { node: DgId; ref: HostRef };

export type NodeTypeRecord = Envelope<"node-type"> &
  DocumentFields & {
    label: string;
    /** Nearest base type. This, not the label, is what interoperates. */
    base?: BaseNodeType;
    abbreviation?: string;
    /**
     * How this space writes the title in its base, with exactly one
     * `{content}`. It's local presentation, so spaces can differ.
     */
    titleFormat?: string;
    tag?: string;
    color?: string;
    template?: string;
    /** The AT Protocol collection for this type, when its base type isn't enough. */
    lexicon?: string;
  };

export type RelationRule = { source: DgId; target: DgId };

export type RelationTypeRecord = Envelope<"relation-type"> &
  DocumentFields & {
    label: string;
    complement: string;
    base?: BaseRelationType;
    rules: RelationRule[];
    color?: string;
  };

type CanvasBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
};
type CanvasSide = "top" | "right" | "bottom" | "left";

/**
 * JSON Canvas 1.0 plus optional `dg` fields. A discourse node is a text card,
 * so the file still reads as a plain canvas with the `dg` fields ignored.
 */
export type CanvasNode =
  | (CanvasBox & { type: "text"; text: string; dg?: { node: DgId } })
  | (CanvasBox & { type: "file"; file: string; subpath?: string })
  | (CanvasBox & { type: "link"; url: string })
  | (CanvasBox & {
      type: "group";
      label?: string;
      background?: string;
      backgroundStyle?: "cover" | "ratio" | "repeat";
      /** Drawn by Tidy, so the next Tidy can replace it. */
      guide?: boolean;
    });

export type CanvasEdge = {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  color?: string;
  label?: string;
  dg?: { relation: DgId };
};

export type DgCanvas = { nodes: CanvasNode[]; edges: CanvasEdge[] };

/**
 * A freehand mark. JSON Canvas has no such type, so this is DG's own item, and
 * `buildCanvas` leaves it out to keep the output valid.
 */
export type CanvasStroke = {
  id: string;
  type: "stroke";
  x: number;
  y: number;
  width: number;
  height: number;
  /** An SVG path, relative to `x` and `y`. */
  path: string;
  color?: string;
};

export type CanvasItem = CanvasNode | CanvasEdge | CanvasStroke;

/** How Tidy last arranged a canvas. Positions are shared, so this is too. */
export const TIDY_MODES = [
  "logic",
  "debate",
  "timeline",
  "kinds",
  "people",
  "focus",
  "connected",
  "bridges",
  "load",
] as const;
export type TidyMode = (typeof TIDY_MODES)[number];
export type CanvasLayout = { mode: TidyMode; focus?: DgId };

export type CanvasRecord = Envelope<"canvas"> &
  DocumentFields & {
    title: string;
    layout?: CanvasLayout;
    removed?: boolean;
    /** The paper this canvas holds, when it's that paper's own canvas. */
    paper?: DgId;
    /** The lab it's shared with, as a DID. Shared canvases carry notes and reactions. */
    shared?: string;
    /** A person's own workspace, where exports land by default. */
    personal?: boolean;
    /** Cards were placed by a tool, so the next person to open it should tidy it. */
    needsLayout?: boolean;
  };

/** A processed paper. The original file is never in a record. */
export type PaperRecord = Envelope<"paper"> &
  DocumentFields & {
    title: string;
    canvas: DgId;
    filename: string;
    authors: string[];
    doi?: string;
    url?: string;
    /** What made the extraction, so a reader can weigh it. */
    model: string;
    schema: string;
    server: string;
    /** True once the graph and DOI reached Discourse Graphs. Never true without a DOI. */
    stored?: boolean;
    /** Its id in the lab's repository, once someone has uploaded it there. */
    labPaper?: string;
    uploadedBy?: Author;
  };

/** A place to keep units together, chosen by a person. */
export type FolderRecord = Envelope<"folder"> & DocumentFields & { title: string; removed?: boolean };

/** One record per unit, so two people filing at once never overwrite each other. */
export type FolderItemRecord = Envelope<"folder-item"> &
  DocumentFields & { folder: DgId; node: DgId; removed?: boolean };

export const REACTIONS = ["interesting", "agree", "disagree"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** One per person per unit. It carries no weight and tells nobody. */
export type ReactionRecord = Envelope<"reaction"> &
  DocumentFields & { unit: DgId; value: Reaction | null };

/** A note on a unit, kept apart from the unit's own text. */
export type UnitNoteRecord = Envelope<"unit-note"> &
  DocumentFields & { unit: DgId; text: string; removed?: boolean };

/**
 * One record per card or edge, so two people editing different items never
 * overwrite each other. `item.id` equals the record id.
 */
export type CanvasItemRecord = Envelope<"canvas-item"> &
  DocumentFields & {
    canvas: DgId;
    item: CanvasItem;
    z: number;
    removed?: boolean;
  };

/** Text for readers in other spaces. The base stays the source of truth. */
export type SnapshotRecord = Envelope<"snapshot"> &
  DocumentFields & { node: DgId; body: string; format: "markdown" };

/**
 * Display only: it links one person's identities across bases. Withdrawal
 * authority still needs an exact id, because an alias here is an unproven claim.
 */
export type PersonRecord = Envelope<"person"> &
  DocumentFields & {
    name: string;
    orcid?: string;
    aliases: string[];
    /** The person's did:plc, computed on their device. */
    did?: string;
    /** Their id in this base, so a second device finds the same DID. */
    hostId?: string;
    /** The signed PLC operations so far. Public, and needed to register later. */
    plc?: JsonObject[];
  };

/** A lab has its own DID. Its custodian, the PI, holds that DID's rotation key. */
export type LabRecord = Envelope<"lab"> &
  DocumentFields & {
    name: string;
    did: string;
    custodian: string;
    custodianKey: string;
    plc: JsonObject[];
  };

/** A person's choice to work in a lab, which puts the PI's key on their DID. */
export type MembershipRecord = Envelope<"membership"> &
  DocumentFields & { lab: string; member: string };

export type RelationRecord = Envelope<"relation"> & {
  type: DgId;
  source: DgId;
  target: DgId;
  /** A suggestion from a pattern or a tool. It waits for a person's decision. */
  proposed?: true;
};

/** The author withdrawing their own record. */
export type RetractionRecord = Envelope<"retraction"> & {
  target: DgId;
  reason?: string;
};

/** A space's stance on something that arrived from elsewhere. */
export type DecisionRecord = Envelope<"decision"> & {
  target: DgId;
  decision: "accepted" | "rejected";
};

export type DocumentRecord =
  | NodeRecord
  | AnchorRecord
  | NodeTypeRecord
  | RelationTypeRecord
  | CanvasRecord
  | CanvasItemRecord
  | SnapshotRecord
  | PersonRecord
  | LabRecord
  | MembershipRecord
  | PaperRecord
  | FolderRecord
  | FolderItemRecord
  | ReactionRecord
  | UnitNoteRecord;
export type AssertionRecord =
  | RelationRecord
  | RetractionRecord
  | DecisionRecord;
export type DgRecord = DocumentRecord | AssertionRecord;

export const isDocument = (record: DgRecord): record is DocumentRecord =>
  (DOCUMENT_KINDS as readonly string[]).includes(record.kind);

/** Anchors and decisions describe one space, so sync must never carry them. */
export const staysLocal = (record: DgRecord): boolean =>
  record.kind === "anchor" || record.kind === "decision";

export const uuidv7 = (): DgId => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type Stamp = { space: SpaceId; by: Author; at?: string; lab?: string };

const envelope = <K extends RecordKind>({
  kind,
  space,
  by,
  at,
  lab,
}: Stamp & { kind: K }): Envelope<K> => ({
  v: FORMAT_VERSION,
  id: unitId(by.id),
  kind,
  space,
  at: at ?? new Date().toISOString(),
  by,
  ...(lab ? { lab } : {}),
});

const versioned = <K extends DocumentKind>(
  stamp: Stamp & { kind: K },
): Envelope<K> & DocumentFields => {
  const base = envelope(stamp);
  return { ...base, rev: 1, editedAt: base.at, editedBy: base.by };
};

export const createNode = ({
  title,
  type,
  source,
  ...stamp
}: Stamp & { title: string; type?: DgId; source?: UnitSource }): NodeRecord => ({
  ...versioned({ ...stamp, kind: "node" }),
  title,
  ...(type === undefined ? {} : { type }),
  ...(source === undefined ? {} : { source }),
});

export const createPaper = ({
  fields,
  ...stamp
}: Stamp & {
  fields: Omit<PaperRecord, keyof Envelope<"paper"> | keyof DocumentFields>;
}): PaperRecord => ({ ...versioned({ ...stamp, kind: "paper" }), ...fields });

export const createFolder = ({ title, ...stamp }: Stamp & { title: string }): FolderRecord => ({
  ...versioned({ ...stamp, kind: "folder" }),
  title,
});

export const createFolderItem = ({
  folder,
  node,
  ...stamp
}: Stamp & { folder: DgId; node: DgId }): FolderItemRecord => ({
  ...versioned({ ...stamp, kind: "folder-item" }),
  folder,
  node,
});

export const createReaction = ({
  unit,
  value,
  ...stamp
}: Stamp & { unit: DgId; value: Reaction | null }): ReactionRecord => ({
  ...versioned({ ...stamp, kind: "reaction" }),
  unit,
  value,
});

export const createUnitNote = ({
  unit,
  text,
  ...stamp
}: Stamp & { unit: DgId; text: string }): UnitNoteRecord => ({
  ...versioned({ ...stamp, kind: "unit-note" }),
  unit,
  text,
});

export const createAnchor = ({
  node,
  ref,
  ...stamp
}: Stamp & { node: DgId; ref: HostRef }): AnchorRecord => ({
  ...versioned({ ...stamp, kind: "anchor" }),
  node,
  ref,
});

export const createNodeType = ({
  fields,
  ...stamp
}: Stamp & {
  fields: Pick<
    NodeTypeRecord,
    | "label"
    | "base"
    | "abbreviation"
    | "titleFormat"
    | "tag"
    | "color"
    | "template"
    | "lexicon"
  >;
}): NodeTypeRecord => ({
  ...versioned({ ...stamp, kind: "node-type" }),
  ...fields,
});

export const createRelationType = ({
  fields,
  ...stamp
}: Stamp & {
  fields: Pick<
    RelationTypeRecord,
    "label" | "complement" | "base" | "rules" | "color"
  >;
}): RelationTypeRecord => ({
  ...versioned({ ...stamp, kind: "relation-type" }),
  ...fields,
});

export const createCanvas = ({
  title,
  fields = {},
  ...stamp
}: Stamp & {
  title: string;
  fields?: Pick<CanvasRecord, "paper" | "shared" | "personal" | "needsLayout">;
}): CanvasRecord => ({
  ...versioned({ ...stamp, kind: "canvas" }),
  title,
  ...fields,
});

export type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

export const createCanvasItem = ({
  canvas,
  item,
  z,
  ...stamp
}: Stamp & {
  canvas: DgId;
  item: WithoutId<CanvasItem>;
  z: number;
}): CanvasItemRecord => {
  const base = versioned({ ...stamp, kind: "canvas-item" });
  return {
    ...base,
    canvas,
    item: { ...item, id: base.id } as CanvasItem,
    z,
  };
};

export const createSnapshot = ({
  node,
  body,
  ...stamp
}: Stamp & { node: DgId; body: string }): SnapshotRecord => ({
  ...versioned({ ...stamp, kind: "snapshot" }),
  node,
  body,
  format: "markdown",
});

export const createPerson = ({
  name,
  orcid,
  aliases,
  did,
  hostId,
  plc,
  ...stamp
}: Stamp & {
  name: string;
  orcid?: string;
  aliases: string[];
  did?: string;
  hostId?: string;
  plc?: JsonObject[];
}): PersonRecord => ({
  ...versioned({ ...stamp, kind: "person" }),
  name,
  aliases,
  ...(orcid === undefined ? {} : { orcid }),
  ...(did === undefined ? {} : { did }),
  ...(hostId === undefined ? {} : { hostId }),
  ...(plc === undefined ? {} : { plc }),
});

export const createLab = ({
  name,
  did,
  custodian,
  custodianKey,
  plc,
  ...stamp
}: Stamp & Pick<LabRecord, "name" | "did" | "custodian" | "custodianKey" | "plc">): LabRecord => ({
  ...versioned({ ...stamp, kind: "lab" }),
  name,
  did,
  custodian,
  custodianKey,
  plc,
});

export const createMembership = ({
  lab,
  member,
  ...stamp
}: Stamp & { lab: string; member: string }): MembershipRecord => ({
  ...versioned({ ...stamp, kind: "membership" }),
  lab,
  member,
});

export const assertRelation = ({
  type,
  source,
  target,
  proposed,
  ...stamp
}: Stamp & {
  type: DgId;
  source: DgId;
  target: DgId;
  proposed?: boolean;
}): RelationRecord => ({
  ...envelope({ ...stamp, kind: "relation" }),
  type,
  source,
  target,
  ...(proposed ? { proposed: true as const } : {}),
});

export const retract = ({
  target,
  reason,
  ...stamp
}: Stamp & { target: DgId; reason?: string }): RetractionRecord => ({
  ...envelope({ ...stamp, kind: "retraction" }),
  target,
  ...(reason === undefined ? {} : { reason }),
});

export const decide = ({
  target,
  decision,
  ...stamp
}: Stamp & {
  target: DgId;
  decision: DecisionRecord["decision"];
}): DecisionRecord => ({
  ...envelope({ ...stamp, kind: "decision" }),
  target,
  decision,
});

/** A revision replaces the whole document and keeps its original `by` and `at`. */
export const revise = <R extends DocumentRecord>({
  record,
  changes,
  by,
  at,
}: {
  record: R;
  changes: Partial<Omit<R, keyof Envelope<RecordKind> | keyof DocumentFields>>;
  by: Author;
  at?: string;
}): R =>
  ({
    ...record,
    ...changes,
    rev: record.rev + 1,
    editedAt: at ?? new Date().toISOString(),
    editedBy: by,
  }) as R;

export const defaultGrammar = ({
  titleFormat = (abbreviation) => `${abbreviation} - {content}`,
  ...stamp
}: Stamp & {
  /** Lets a base keep its own convention, such as `[[CLM]] - {content}`. */
  titleFormat?: (abbreviation: string) => string;
}): (NodeTypeRecord | RelationTypeRecord)[] => {
  const nodeType = (
    label: string,
    base: BaseNodeType,
    abbreviation: string,
    format: string,
  ): NodeTypeRecord =>
    createNodeType({
      ...stamp,
      fields: { label, base, abbreviation, titleFormat: format },
    });
  const question = nodeType("Question", "question", "QUE", titleFormat("QUE"));
  const claim = nodeType("Claim", "claim", "CLM", titleFormat("CLM"));
  const evidence = nodeType("Evidence", "evidence", "EVD", titleFormat("EVD"));
  const source = nodeType("Source", "source", "SRC", "@{content}");
  const relationType = (
    label: string,
    complement: string,
    base: BaseRelationType,
    rules: RelationRule[],
  ): RelationTypeRecord =>
    createRelationType({
      ...stamp,
      fields: { label, complement, base, rules },
    });
  const evidenceToClaim = { source: evidence.id, target: claim.id };
  const claimToClaim = { source: claim.id, target: claim.id };
  return [
    question,
    claim,
    evidence,
    source,
    relationType("Supports", "Supported by", "supports", [
      evidenceToClaim,
      claimToClaim,
    ]),
    relationType("Opposes", "Opposed by", "opposes", [
      evidenceToClaim,
      claimToClaim,
    ]),
    relationType("Addresses", "Addressed by", "addresses", [
      { source: claim.id, target: question.id },
    ]),
    relationType("Informs", "Informed by", "informs", [
      { source: evidence.id, target: question.id },
    ]),
    relationType("Derived from", "Has derivation", "derivedFrom", [
      { source: evidence.id, target: source.id },
    ]),
  ];
};

export const formatTitle = ({
  format,
  content,
}: {
  format?: string;
  content: string;
}): string => (format ? format.split("{content}").join(content) : content);

/** Returns the content, or null when the title doesn't follow the format. */
export const parseTitle = ({
  format,
  title,
}: {
  format: string;
  title: string;
}): string | null => {
  const [before = "", after = ""] = format.split("{content}");
  if (title.length <= before.length + after.length) return null;
  if (!title.startsWith(before) || !title.endsWith(after)) return null;
  const content = title.slice(before.length, title.length - after.length);
  return content.trim() ? content : null;
};

/**
 * Writing a title in a type's format is an explicit act, so it counts as typing
 * the node. A candidate tag is weaker and only suggests one.
 */
export const recognizeTitle = ({
  title,
  nodeTypes,
}: {
  title: string;
  nodeTypes: NodeTypeRecord[];
}): { type: NodeTypeRecord; content: string } | null => {
  const matches = nodeTypes.flatMap((type) => {
    const content = type.titleFormat
      ? parseTitle({ format: type.titleFormat, title })
      : null;
    return content === null ? [] : [{ type, content }];
  });
  matches.sort((a, b) => a.content.length - b.content.length);
  return matches[0] ?? null;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );

export const isJsonSafe = (value: unknown): boolean => {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonSafe);
  if (typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isJsonSafe);
};

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Positive when `a` beats `b`. The final tie-break is on content, so every
 * replica picks the same winner whatever order the versions arrived in.
 */
export const compareVersions = (a: DgRecord, b: DgRecord): number => {
  if (isDocument(a) && isDocument(b)) {
    return (
      a.rev - b.rev ||
      compareStrings(a.editedAt, b.editedAt) ||
      compareStrings(a.editedBy.id, b.editedBy.id) ||
      compareStrings(canonicalJson(a), canonicalJson(b))
    );
  }
  return compareStrings(canonicalJson(a), canonicalJson(b));
};

export type RelationState = "active" | "pending" | "rejected" | "withdrawn";

export type FoldedGraph = {
  documents: Map<DgId, DocumentRecord>;
  relations: Map<DgId, { record: RelationRecord; state: RelationState }>;
  /** Documents their author has withdrawn. They stay in `documents`. */
  withdrawn: Set<DgId>;
};

const laterDecision = (a: DecisionRecord, b: DecisionRecord): DecisionRecord =>
  (compareStrings(a.at, b.at) || compareStrings(a.id, b.id)) >= 0 ? a : b;

/** Turns any bag of records into one graph. The result ignores input order. */
export const foldRecords = ({
  records,
  localSpace,
  trustedLab,
}: {
  records: DgRecord[];
  localSpace: SpaceId;
  /** Relations from this person's own lab don't wait for a decision. */
  trustedLab?: string;
}): FoldedGraph => {
  const winners = new Map<DgId, DgRecord>();
  for (const record of records) {
    const current = winners.get(record.id);
    if (!current || compareVersions(record, current) > 0) {
      winners.set(record.id, record);
    }
  }

  const documents = new Map<DgId, DocumentRecord>();
  const relations: RelationRecord[] = [];
  const retractions: RetractionRecord[] = [];
  const decisions = new Map<DgId, DecisionRecord>();
  for (const record of winners.values()) {
    if (isDocument(record)) documents.set(record.id, record);
    else if (record.kind === "relation") relations.push(record);
    else if (record.kind === "retraction") retractions.push(record);
    else if (record.space === localSpace) {
      const current = decisions.get(record.target);
      decisions.set(
        record.target,
        current ? laterDecision(record, current) : record,
      );
    }
  }

  const custodianOf = new Map<string, string>();
  for (const record of documents.values()) {
    if (record.kind === "lab") custodianOf.set(record.did, record.custodian);
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

const isString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isAuthor = (value: unknown): value is Author =>
  typeof value === "object" &&
  value !== null &&
  isString((value as Author).id) &&
  typeof (value as Author).name === "string";

const isTimestamp = (value: unknown): value is string =>
  isString(value) && !Number.isNaN(Date.parse(value));

const validateCanvasItem = (item: unknown): string[] => {
  if (typeof item !== "object" || item === null) return ["canvas item is empty"];
  const value = item as Record<string, unknown>;
  if ("fromNode" in value) {
    return isString(value.fromNode) && isString(value.toNode)
      ? []
      : ["canvas edge needs both ends"];
  }
  const problems = ["x", "y", "width", "height"]
    .filter((key) => !Number.isInteger(value[key]))
    .map((key) => `canvas ${key} must be an integer`);
  if (value.type === "stroke" && !isString(value.path)) {
    problems.push("canvas stroke needs a path");
  }
  return problems;
};

const validateTitleFormat = (format: unknown): string[] => {
  if (format === undefined) return [];
  const placeholders = String(format).match(/\{[^}]*\}/g) ?? [];
  return placeholders.length === 1 && placeholders[0] === "{content}"
    ? []
    : ["titleFormat must contain {content} and nothing else in braces"];
};

const requiredByKind: Record<RecordKind, string[]> = {
  node: ["title"],
  anchor: ["node", "ref"],
  "node-type": ["label"],
  "relation-type": ["label", "complement"],
  canvas: ["title"],
  "canvas-item": ["canvas"],
  snapshot: ["node", "format"],
  person: ["name"],
  lab: ["name", "did", "custodian", "custodianKey"],
  membership: ["lab", "member"],
  paper: ["title", "canvas", "filename", "model", "schema", "server"],
  folder: ["title"],
  "folder-item": ["folder", "node"],
  reaction: ["unit"],
  "unit-note": ["unit", "text"],
  relation: ["type", "source", "target"],
  retraction: ["target"],
  decision: ["target", "decision"],
};

/** An empty array means valid. Unknown fields are allowed and must be kept. */
export const validateRecord = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null) return ["not an object"];
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  if (record.v !== FORMAT_VERSION) problems.push("unknown format version");
  if (!isUnitId(record.id)) problems.push("id must be a DID and a TID");
  if (!isString(record.space)) problems.push("missing space");
  if (!isTimestamp(record.at)) problems.push("at must be a timestamp");
  if (!isAuthor(record.by)) problems.push("by must be an author");
  const kind = record.kind as RecordKind;
  const required = requiredByKind[kind];
  if (!required) return [...problems, `unknown kind ${String(record.kind)}`];
  for (const key of required) {
    if (!isString(record[key])) problems.push(`${kind} needs ${key}`);
  }
  if ((DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    if (!Number.isInteger(record.rev) || (record.rev as number) < 1) {
      problems.push("rev must be a positive integer");
    }
    if (!isTimestamp(record.editedAt)) problems.push("editedAt is required");
    if (!isAuthor(record.editedBy)) problems.push("editedBy is required");
  }
  if (kind === "decision" && !["accepted", "rejected"].includes(record.decision as string)) {
    problems.push("decision must be accepted or rejected");
  }
  if (kind === "relation-type" && !Array.isArray(record.rules)) {
    problems.push("relation-type needs rules");
  }
  if (kind === "node-type") {
    problems.push(...validateTitleFormat(record.titleFormat));
  }
  if (kind === "canvas-item") {
    problems.push(...validateCanvasItem(record.item));
    if (typeof record.z !== "number") problems.push("canvas-item needs z");
  }
  if (kind === "snapshot" && typeof record.body !== "string") {
    problems.push("snapshot needs a body");
  }
  if (kind === "person" && !Array.isArray(record.aliases)) {
    problems.push("person needs aliases");
  }
  return problems;
};
