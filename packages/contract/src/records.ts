import { isIdentifier, type Identifier, type WorkAuthor, type WorkStanding } from "./scholarly.ts";
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

/**
 * The four discourse types, then the process layer. Protocol and Study are the
 * logic (a reusable method, and one designed investigation). A Run is one
 * execution. Code is a notebook, script or workflow at a version. An Output is
 * one data item a run produced. Outputs come from runs, never from plans.
 */
export const BASE_NODE_TYPES = [
  "question",
  "claim",
  "evidence",
  "source",
  "protocol",
  "study",
  "run",
  "code",
  "output",
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
  "evaluation",
  "release",
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
  /**
   * The signature of whoever wrote this version, over the record without this field. It is what
   * lets a labmate tell a record from its author apart from one that only says so.
   */
  sig?: string;
};

type DocumentFields = {
  rev: number;
  editedAt: string;
  editedBy: Author;
  /**
   * The version this one replaces, as `versionKey` names it. A version beats every version it
   * replaces, however their clocks and edit counts compare. Only versions made apart, neither
   * having seen the other, are left to a tie-break.
   */
  prev?: string;
};

/**
 * This device's clock, corrected. A lab's server says what time it is with every exchange, and a
 * device whose clock is off stamps its records with the difference added, so its later edit is
 * not read as an earlier one.
 */
export const clock = { offsetMs: 0 };
export const nowIso = (): string => new Date(Date.now() + clock.offsetMs).toISOString();

/** Names one version of a document, for the version that replaces it. */
export const versionKey = (record: { rev: number; editedAt: string; editedBy: Author }): string =>
  `${record.rev}@${record.editedAt}@${record.editedBy.id}`;

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
    /** Provenance links this unit's author states. Arguments stay relation records. */
    prov?: ProvenanceLinks;
    /** What the unit is, beyond its title: a run's times, an output's hash. */
    facts?: UnitFacts;
  };

/**
 * A reference that can name one version. `uri` is a DG id before publishing
 * and an AT URI after. `cid` pins the version the author used, so a later
 * edit to the target shows up as drift instead of silently changing the link.
 */
export type Pin = { uri: string; cid?: string };

/**
 * Links only the unit's author states. They change with the unit, as new
 * versions, so they live on it. Supports, opposes, informs and addresses are
 * different: other people dispute them, so each stays its own signed record.
 */
export type ProvenanceLinks = {
  /** Study: the question it investigates. */
  question?: DgId;
  /** Study: the protocols its design uses. */
  protocols?: DgId[];
  /** Protocol: code that carries it out. */
  implementedBy?: DgId[];
  /** Run: the study it carries out. */
  partOf?: DgId;
  /** Run: the protocol version it followed. */
  follows?: Pin;
  /** Run: the code versions it ran. The pin is the code's `sourceCid`. */
  instrument?: Pin[];
  /** Run: samples, materials and data it took in, by RRID, DOI or `{uri, cid}`. */
  used?: Pin[];
  /** Output: the run that produced it. */
  generatedBy?: DgId;
  /** Output: the outputs it was made from. */
  derivedFrom?: Pin[];
  /** Evidence: the outputs it rests on, pinned by their content hash. */
  observationBase?: Pin[];
  /** Evidence: the run it rests on. Read from its outputs' run when absent. */
  isGroundedIn?: DgId;
  /** Evidence: the paper or document it was read from. */
  sourceDocument?: DgId;
  /** Source: runs the paper reports. */
  describesActivity?: DgId[];
};

export const RUN_STATUSES = ["planned", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const OUTPUT_KINDS = ["dataset", "file", "figure", "table", "text", "image"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/**
 * Where an output sits. None of this is identity: cell ids get regenerated,
 * output indexes shift when a warning prints, labels can be renamed. The
 * output's own `cid` is what stays the same.
 */
export type OutputLocator = {
  path?: string;
  commit?: string;
  cellId?: string;
  cellIndex?: number;
  outputIndex?: number;
  mime?: string;
  label?: string;
};

export type ParameterSpec = { name: string; type?: string; unit?: string; default?: Json };

export const STUDY_DESIGNS = ["experimental", "observational", "computational", "replication", "review"] as const;
export type StudyDesign = (typeof STUDY_DESIGNS)[number];

export const VARIABLE_ROLES = ["independent", "dependent", "controlled"] as const;
/** What a study varies, measures or holds fixed. */
export type StudyVariable = { name: string; role: (typeof VARIABLE_ROLES)[number]; unit?: string };

export const PROVENANCE_METHODS = ["authored", "aiAssisted", "aiGenerated", "imported"] as const;
export type ProvenanceMethod = (typeof PROVENANCE_METHODS)[number];
/** How a unit was made: MIRA's `defs#provenance`. */
export type HowMade = { method: ProvenanceMethod; agent?: string; reviewedBy?: string[] };

/** Small facts only: identifiers and metadata, never full text or files. */
export type UnitFacts = {
  /** Protocol: its version label, as the lab writes it. */
  version?: string;
  /** Protocol: the parameters it declares. */
  parameters?: ParameterSpec[];
  /** Protocol: its steps as short names, in order. The full text stays in the note. */
  steps?: string[];
  /** Protocol: reagents, instruments and software it calls for, as RRIDs where they have one. */
  materials?: string[];
  /** Protocol or Code: the same thing elsewhere, such as a protocols.io DOI. */
  sameAs?: string[];
  /** Study: the conditions or factors it varies. */
  conditions?: string[];
  /** Study: what the design expects to see, in a sentence. */
  hypothesis?: string;
  design?: StudyDesign;
  variables?: StudyVariable[];
  /** Study: the planned sample size. */
  sampleSize?: number;
  /** Study: where the design was registered before it ran, as a DOI or URL. */
  preregistration?: string;
  /** Run. */
  status?: RunStatus;
  startedAt?: string;
  endedAt?: string;
  /** Run: which of its study's conditions it carried out. */
  condition?: string;
  /** Run: where it departed from the protocol version it pins, a sentence each. */
  deviations?: string[];
  /** Run: the values its parameters took. */
  parameterValues?: JsonObject;
  /** Run: who carried it out, as DIDs or ORCID iDs. */
  agents?: string[];
  /** Run: kernel, language and package versions, or an image digest. */
  environment?: JsonObject;
  /** Run: the lab notebook entry, linked by id and never copied. */
  seeAlso?: string[];
  /** Run: the same execution imported twice has the same fingerprint. */
  fingerprint?: string;
  /** Code. */
  repo?: string;
  commit?: string;
  path?: string;
  /** Code: a CID over the sources alone, outputs stripped. */
  sourceCid?: string;
  language?: string;
  /** Code: its Software Heritage id, once archived. */
  swhid?: string;
  license?: string;
  /** Output: a CID over the output's own bytes. */
  cid?: string;
  /** Output: where the bytes live. The file is never in a record. */
  uri?: string;
  mediaType?: string;
  size?: number;
  outputKind?: OutputKind;
  locator?: OutputLocator;
  caption?: string;
  /** Evidence: the passage in its source. */
  anchor?: { source?: string; exact?: string; page?: string; figure?: string; /** What the reader wrote beside the passage. */ comment?: string };
  /** Source. */
  doi?: string;
  /** Source: who wrote it, when and where, for a source that has no paper record behind it. */
  authors?: string[];
  published?: string;
  venue?: string;
  openalex?: string;
  /** Any unit: what else names it, such as a PMID, an arXiv id, an RRID or an accession link. */
  identifiers?: Identifier[];
  /** Source: what the registries said when last asked, such as a retraction. */
  standing?: WorkStanding;
  /** How the unit was made, so a reader can weigh it. */
  provenance?: HowMade;
  /** Any unit that arrived from elsewhere: who first made it. The record's own author is whoever brought it in. */
  creators?: { name: string; orcid?: string }[];
};

export const EVALUATION_METHODS = [
  "quoteChecked",
  "sourceRead",
  "dataReanalyzed",
  "replicated",
  "expertJudgment",
] as const;
export type EvaluationMethod = (typeof EVALUATION_METHODS)[number];

/**
 * A reviewer's judgement of one version of a unit or relation, such as a PI
 * approving a claim. The CID pins what they saw, so an edit afterwards shows
 * the evaluation as out of date instead of carrying it over.
 */
export type EvaluationRecord = Envelope<"evaluation"> &
  DocumentFields & {
    target: DgId;
    targetCid?: string;
    method: EvaluationMethod;
    /** For example `endorsed`, `disputed` or `needsWork`. */
    term?: string;
    note?: string;
    removed?: boolean;
  };

export type UnitSource = {
  paper: DgId;
  /** The passage it was read from, word for word. */
  anchor?: string;
  description?: string;
  /** The wording the model gave it, kept from the first time a person rewords it. */
  asRead?: string;
  /** A source unit that stands for the paper itself, among the sources the paper cites. */
  own?: true;
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
    /** The text a new unit of this type starts with. `{title}`, `{date}`, `{type}` and `{author}` are filled in. */
    template?: string;
    /** The AT Protocol collection for this type, when its base type isn't enough. */
    lexicon?: string;
    /** Taken out of use. Units that have it keep it, and it is no longer offered. */
    removed?: boolean;
    /** The lab's type this one gave way to when its author joined the lab. Read in its place. */
    replacedBy?: DgId;
  };

export type RelationRule = { source: DgId; target: DgId };

export type RelationTypeRecord = Envelope<"relation-type"> &
  DocumentFields & {
    label: string;
    complement: string;
    base?: BaseRelationType;
    rules: RelationRule[];
    color?: string;
    /** Taken out of use. Relations that have it keep it, and it is no longer offered. */
    removed?: boolean;
    /** The lab's type this one gave way to when its author joined the lab. Read in its place. */
    replacedBy?: DgId;
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
  | (CanvasBox & {
      type: "file";
      file: string;
      subpath?: string;
      /** Another canvas, embedded. Obsidian shows a `.canvas` file node as that canvas. */
      dg?: { canvas: DgId };
    })
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
  "sources",
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
    /**
     * The holon this canvas is the inside of: a question, claim or evidence
     * unit, or a lab's DID. A holon can have several canvases.
     */
    holon?: string;
    /** The release this canvas was forked from, pinned. */
    forkOf?: Pin;
  };

/**
 * A named, pinned point in a canvas's history, like a git tag. The log keeps
 * every edit anyway; a release says which versions of which cards belong
 * together, and pins each card's unit, so a fork or a diff has something fixed
 * to start from. Publishing a canvas publishes a release, never the live canvas.
 */
export type ReleaseRecord = Envelope<"release"> &
  DocumentFields & {
    canvas: DgId;
    name: string;
    note?: string;
    /** The release before this one on the same canvas. */
    parent?: DgId;
    /** Each live canvas item at its revision. */
    items: { id: DgId; rev: number }[];
    /** Each card's unit, pinned by its content hash at release time. */
    units: Pin[];
    /** Marked for the public archive. Writing it to a PDS is a separate, explicit step. */
    published?: boolean;
    removed?: boolean;
  };

/** A processed paper. The original file is never in a record. */
export type PaperRecord = Envelope<"paper"> &
  DocumentFields & {
    title: string;
    canvas: DgId;
    filename: string;
    /** The hash of the PDF's bytes when it was read, so the file is known by what it is and not by its name. */
    fileCid?: string;
    authors: string[];
    doi?: string;
    url?: string;
    license?: string;
    /** Everything else that names the work: PMID, PMCID, arXiv id, OpenAlex id. The DOI stays in `doi`. */
    identifiers?: Identifier[];
    /** As precise as the publisher gave it: `2020`, `2020-12` or `2020-12-01`. */
    published?: string;
    venue?: string;
    /** The authors with their ORCID iDs and affiliations, once a registry has been asked. `authors` keeps the names. */
    people?: WorkAuthor[];
    /** What the registries said when last asked: retraction, open access, who registered the DOI. */
    standing?: WorkStanding;
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
/**
 * What a lab's PI sets once and every member inherits. It lives on the lab's own record, which only
 * the PI can change and which every member holds.
 */
export type LabSettings = {
  /** The Zotero group that is the lab's shelf of papers. Its items have the same address for every member. */
  zoteroGroup?: { id: string; name: string };
  /** Model servers the lab offers its members, such as the PI's workstation or the lab's own box. */
  servers?: { name: string; url: string }[];
  /** Which of those a member's reading and questions go to first, by address. Each member can choose otherwise. */
  compute?: string;
  /**
   * How far a paper's text may travel to be read by a model: no further than the member's own
   * computer, no further than the lab's servers, or anywhere the member picks.
   */
  reach?: "device" | "lab" | "anywhere";
};

export type LabRecord = Envelope<"lab"> &
  DocumentFields & {
    name: string;
    did: string;
    custodian: string;
    custodianKey: string;
    plc: JsonObject[];
    settings?: LabSettings;
  };

/** A person's choice to work in a lab, which puts the PI's key on their DID. */
export type MembershipRecord = Envelope<"membership"> &
  DocumentFields & { lab: string; member: string; /** Ended, by the member or by the lab's custodian. */ removed?: boolean };

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
  | UnitNoteRecord
  | EvaluationRecord
  | ReleaseRecord;
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
  at: at ?? nowIso(),
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
  prov,
  facts,
  ...stamp
}: Stamp & {
  title: string;
  type?: DgId;
  source?: UnitSource;
  prov?: ProvenanceLinks;
  facts?: UnitFacts;
}): NodeRecord => ({
  ...versioned({ ...stamp, kind: "node" }),
  title,
  ...(type === undefined ? {} : { type }),
  ...(source === undefined ? {} : { source }),
  ...(prov === undefined ? {} : { prov }),
  ...(facts === undefined ? {} : { facts }),
});

export const createRelease = ({
  fields,
  ...stamp
}: Stamp & {
  fields: Pick<ReleaseRecord, "canvas" | "name" | "note" | "parent" | "items" | "units" | "published">;
}): ReleaseRecord => ({
  ...versioned({ ...stamp, kind: "release" }),
  ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
}) as ReleaseRecord;

export const createEvaluation = ({
  fields,
  ...stamp
}: Stamp & {
  fields: Pick<EvaluationRecord, "target" | "targetCid" | "method" | "term" | "note">;
}): EvaluationRecord => ({
  ...versioned({ ...stamp, kind: "evaluation" }),
  ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
}) as EvaluationRecord;

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
  fields?: Pick<CanvasRecord, "paper" | "shared" | "personal" | "needsLayout" | "holon" | "forkOf">;
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
}): R => {
  // Never stamped earlier than what it replaces, even on a device whose clock ran ahead before.
  const now = at ?? nowIso();
  const after = new Date(new Date(record.editedAt).getTime() + 1).toISOString();
  const { sig: _sig, ...unsigned } = record;
  return {
    ...unsigned,
    ...changes,
    rev: record.rev + 1,
    editedAt: now > record.editedAt ? now : after,
    editedBy: by,
    prev: versionKey(record),
  } as R;
};

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
 * Positive when `a` beats `b`, for two versions made apart, neither replacing the other. The later
 * one stands. The final tie-break is on content, so every replica picks the same winner whatever
 * order the versions arrived in.
 */
export const compareVersions = (a: DgRecord, b: DgRecord): number => {
  if (isDocument(a) && isDocument(b)) {
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
const AUTHOR_ONLY: readonly string[] = ["lab", "node-type", "relation-type", "person", "evaluation"];

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
const standing = (records: DgRecord[], custodianOf: Map<string, string>): ((record: DgRecord) => boolean) => {
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
    if (ok && isDocument(record) && record.editedBy.id !== record.by.id) {
      if (AUTHOR_ONLY.includes(record.kind)) ok = false;
      else if (record.kind === "membership") ok = record.editedBy.id === custodianOf.get(record.lab);
      else if (record.kind === "node") {
        const before = record.prev ? byVersion.get(`${record.id}|${record.prev}`) : undefined;
        ok = before?.kind === "node" && stands(before) && before.title === record.title && Boolean(before.removed) === Boolean(record.removed);
      }
    }
    known.set(record, ok);
    return ok;
  };
  return stands;
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
  // A lab's custodian is fixed when the lab is made, and only the custodian writes the lab's record.
  const custodianOf = new Map<string, string>();
  for (const record of records) {
    if (record.kind === "lab" && record.editedBy.id === record.by.id && record.custodian === record.by.id) custodianOf.set(record.did, record.custodian);
  }
  // What each standing version replaces is out of the running. Of what is left, the latest stands.
  const stands = standing(records, custodianOf);
  const replaced = new Set<string>();
  for (const record of records) {
    if (isKnownRecord(record) && isDocument(record) && record.prev && stands(record)) replaced.add(`${record.id}|${record.prev}`);
  }
  const winners = new Map<DgId, DgRecord>();
  for (const record of records) {
    // A newer client's kinds are kept in the log but never read as something else.
    if (!isKnownRecord(record)) continue;
    if (!stands(record)) continue;
    if (isDocument(record) && replaced.has(`${record.id}|${versionKey(record)}`)) continue;
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
  evaluation: ["target", "method"],
  release: ["canvas", "name"],
  relation: ["type", "source", "target"],
  retraction: ["target"],
  decision: ["target", "decision"],
};

/**
 * An empty array means valid. Unknown fields are allowed and must be kept.
 * So are records a newer client wrote, with a kind or format version this
 * build doesn't know: their envelope is checked, they are stored and synced,
 * and `foldRecords` leaves them out. Rejecting them would make an older device
 * drop a newer device's work.
 */
export const validateRecord = (value: unknown): string[] => {
  if (typeof value !== "object" || value === null) return ["not an object"];
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const newer = Number.isInteger(record.v) && (record.v as number) > FORMAT_VERSION;
  if (record.v !== FORMAT_VERSION && !newer) problems.push("unknown format version");
  if (!isUnitId(record.id)) problems.push("id must be a DID and a TID");
  if (!isString(record.space)) problems.push("missing space");
  if (!isTimestamp(record.at)) problems.push("at must be a timestamp");
  if (!isAuthor(record.by)) problems.push("by must be an author");
  if (!isString(record.kind)) return [...problems, "missing kind"];
  if (newer || !isKnownRecord(record)) return problems;
  const kind = record.kind as RecordKind;
  const required = requiredByKind[kind];
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
  if (kind === "node") {
    problems.push(...validateProvenance(record.prov), ...validateFacts(record.facts));
  }
  if (kind === "release" && !(Array.isArray(record.items) && Array.isArray(record.units))) {
    problems.push("release needs items and units");
  }
  if (kind === "evaluation") {
    if (!(EVALUATION_METHODS as readonly string[]).includes(record.method as string)) {
      problems.push("evaluation method is not one of the known methods");
    }
    if (record.targetCid !== undefined && !isCid(record.targetCid)) problems.push("targetCid must be a CID");
  }
  return problems;
};

/** True for the kinds and format this build reads. Anything else is kept, not read. */
export const isKnownRecord = (record: { v?: unknown; kind?: unknown }): boolean =>
  record.v === FORMAT_VERSION && Object.hasOwn(requiredByKind, String(record.kind));

/** CIDv1 in base32, the form AT Protocol and multiformats print. */
export const isCid = (value: unknown): value is string =>
  typeof value === "string" && /^b[a-z2-7]{20,}$/.test(value);

const isPin = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  isString((value as Pin).uri) &&
  ((value as Pin).cid === undefined || isCid((value as Pin).cid));

const ID_LINKS = ["question", "partOf", "generatedBy", "isGroundedIn", "sourceDocument"] as const;
const ID_LIST_LINKS = ["protocols", "implementedBy", "describesActivity"] as const;
const PIN_LINKS = ["follows"] as const;
const PIN_LIST_LINKS = ["instrument", "used", "derivedFrom", "observationBase"] as const;

const validateProvenance = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null) return ["prov must be an object"];
  const prov = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ID_LINKS) {
    if (prov[key] !== undefined && !isString(prov[key])) problems.push(`prov.${key} must be an id`);
  }
  for (const key of ID_LIST_LINKS) {
    if (prov[key] !== undefined && !(Array.isArray(prov[key]) && (prov[key] as unknown[]).every(isString))) {
      problems.push(`prov.${key} must be a list of ids`);
    }
  }
  for (const key of PIN_LINKS) {
    if (prov[key] !== undefined && !isPin(prov[key])) problems.push(`prov.${key} must be {uri, cid}`);
  }
  for (const key of PIN_LIST_LINKS) {
    if (prov[key] !== undefined && !(Array.isArray(prov[key]) && (prov[key] as unknown[]).every(isPin))) {
      problems.push(`prov.${key} must be a list of {uri, cid}`);
    }
  }
  return problems;
};

const validateFacts = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null) return ["facts must be an object"];
  const facts = value as Record<string, unknown>;
  const problems: string[] = [];
  if (facts.status !== undefined && !(RUN_STATUSES as readonly string[]).includes(facts.status as string)) {
    problems.push("facts.status must be planned, running, completed or failed");
  }
  if (facts.outputKind !== undefined && !(OUTPUT_KINDS as readonly string[]).includes(facts.outputKind as string)) {
    problems.push("facts.outputKind is not a known kind");
  }
  for (const key of ["startedAt", "endedAt"]) {
    if (facts[key] !== undefined && !isTimestamp(facts[key])) problems.push(`facts.${key} must be a timestamp`);
  }
  for (const key of ["cid", "sourceCid"]) {
    if (facts[key] !== undefined && !isCid(facts[key])) problems.push(`facts.${key} must be a CID`);
  }
  if (facts.design !== undefined && !(STUDY_DESIGNS as readonly string[]).includes(facts.design as string)) {
    problems.push("facts.design is not a known design");
  }
  for (const key of ["steps", "materials", "deviations", "conditions"]) {
    if (facts[key] !== undefined && !(Array.isArray(facts[key]) && (facts[key] as unknown[]).every(isString))) {
      problems.push(`facts.${key} must be a list of text`);
    }
  }
  for (const key of ["hypothesis", "condition", "preregistration"]) {
    if (facts[key] !== undefined && !isString(facts[key])) problems.push(`facts.${key} must be text`);
  }
  if (facts.sampleSize !== undefined && !(Number.isInteger(facts.sampleSize) && (facts.sampleSize as number) >= 0)) {
    problems.push("facts.sampleSize must be a whole number");
  }
  if (
    facts.variables !== undefined &&
    !(
      Array.isArray(facts.variables) &&
      (facts.variables as StudyVariable[]).every((item) => isString(item?.name) && (VARIABLE_ROLES as readonly string[]).includes(item?.role))
    )
  ) {
    problems.push("facts.variables must be a list of {name, role}");
  }
  if (facts.identifiers !== undefined && !(Array.isArray(facts.identifiers) && (facts.identifiers as unknown[]).every(isIdentifier))) {
    problems.push("facts.identifiers must be a list of {scheme, value}");
  }
  const provenance = facts.provenance as HowMade | undefined;
  if (provenance !== undefined && !(PROVENANCE_METHODS as readonly string[]).includes(provenance?.method)) {
    problems.push("facts.provenance.method is not a known method");
  }
  return problems;
};
