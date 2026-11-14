import { type Identifier, type WorkAuthor, type WorkStanding } from "./scholarly.ts";
import { clock, entropy, stampMs, unitId } from "./ids.ts";

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
  "device",
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
  /** Which key signed it, as a `did:key`. It is signed over, so it can't be changed afterwards. */
  sigBy?: string;
  /** The proposal a person's record began as, when they accepted one. */
  acceptedFrom?: DgId;
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

export { clock, entropy };
/** Now, as a record is stamped: on this device's corrected clock. */
export const nowIso = (): string => new Date(stampMs()).toISOString();

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

/**
 * One more key that may sign as a person: a second computer of theirs, or an agent acting for them.
 * A signing key can't be copied off the device that made it, so each device has its own, and a
 * device already trusted vouches for the next. The vouch is a signature over the new key, and it
 * is what a labmate checks. A record a person has not vouched for proves only that someone asked.
 */
export type DeviceRecord = Envelope<"device"> &
  DocumentFields & {
    /** The device's own signing key, as a `did:key`. */
    key: string;
    name: string;
    /** An agent writes proposals for its person to accept. A device writes as the person. */
    role: "device" | "agent";
    /** A trusted key's signature over this one: which key signed, and the signature. */
    vouch?: { by: string; sig: string };
    /** No longer trusted. What it signed before stays as it was taken in. */
    removed?: boolean;
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
  | ReleaseRecord
  | DeviceRecord;
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
  const bytes = entropy.fill(new Uint8Array(16));
  const ms = clock.now();
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

export const createDevice = ({ key, name, role = "device", ...stamp }: Stamp & { key: string; name: string; role?: DeviceRecord["role"] }): DeviceRecord => ({
  ...versioned({ ...stamp, kind: "device" }),
  key,
  name,
  role,
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
  // A new version is signed afresh, by whichever key writes it. The old signature and the old key's name go.
  const { sig: _sig, sigBy: _sigBy, ...unsigned } = record;
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
