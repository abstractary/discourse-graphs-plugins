import type { UnitFacts } from "./records.ts";
import type { AiModel, AiProviderKind, AiRoute, AiSettings, AiSource } from "./llm.ts";
import type { ComputeServer, ExtractionGraph, JoinRequest, LabLink, LabMember, LabPaper, ServerInfo, ServerOption } from "./services.ts";
import type {
  BaseNodeType,
  BaseRelationType,
  RelationRule,
  CanvasItem,
  CanvasLayout,
  CanvasRecord,
  DgCanvas,
  DgId,
  NodeRecord,
  NodeTypeRecord,
  RelationRecord,
  RelationState,
  RelationTypeRecord,
  Reaction,
  WithoutId,
} from "./records.ts";
import type { Appearance, HostError, Placement, Skin } from "./host.ts";
import type { TextMarks } from "./words.ts";
import type { CardFacts, CardField, Identifier, LibraryAnnotation, LibraryItem, LibraryStatus, Notification, NotificationSummary, WorkMetadata, WorkStanding } from "./scholarly.ts";

/**
 * Who a unit is credited to, from where this person sits. Inside a lab it's the
 * contributor. Work that came from another lab is credited to that lab.
 */
export type Credit = { kind: "person" | "lab"; id: string; name: string };

export type NodeSummary = {
  id: DgId;
  title: string;
  credit: Credit;
  /** When it was first written. */
  at: string;
  type?: DgId;
  typeLabel?: string;
  abbreviation?: string;
  base?: BaseNodeType;
  /** The node type's own color, when it has one. */
  color?: string;
  /** Its address in AT Protocol terms. Follows the type, so `id` is what stays fixed. */
  uri?: string;
  /** False when the text was removed, or lives in another space. */
  hasText: boolean;
  /** Extracted from a paper and not exported yet, so it has no note or page. */
  staged?: boolean;
  /** Written by this person, so they may rename it. Teammates' units are theirs to rename. */
  mine?: true;
  /** Read from this paper. `label` is how it's cited in a few words, such as "Carroll 2020". */
  paper?: { id: DgId; label: string; title: string };
  /** What its card can show beyond the title. The same facts, in the same order, head the context panel. */
  card: CardFacts;
};

export type ContextEntry = {
  relation: RelationRecord;
  /** Reads from this node, so an incoming relation shows its complement. */
  label: string;
  state: RelationState;
  other: NodeSummary;
};

export type NodeView = {
  node: NodeSummary;
  /** Null when the text was removed in the base or lives in another space. */
  body: string | null;
  context: ContextEntry[];
  mentionedIn: { title: string }[];
  attribution: { person: string; lab?: string };
  provenance: Provenance;
  social?: UnitSocial;
};

/** Where a unit came from, and everywhere it lives now. */
/** The published work behind a unit, as the graph holds it: its paper, or the source unit itself. */
export type WorkView = {
  target: "paper" | "unit";
  title: string;
  identifiers: Identifier[];
  published?: string;
  venue?: string;
  /** Absent until someone has looked it up. */
  standing?: WorkStanding;
};

/** What a lookup found. `saved` is false when nothing answered, or the unit is a teammate's to change. */
export type WorkLookup = { work: WorkMetadata; saved: boolean; target: "paper" | "unit"; title: string };

/** A library item as the graph sees it: `held` is the Source unit that already stands for it. */
export type LibraryHit = { item: LibraryItem; label: string; held?: DgId };

/** An item with its annotations, each with the type it would most likely be and whether it is here already. */
export type LibraryItemView = LibraryHit & {
  types: { id: DgId; label: string; abbreviation?: string; base?: BaseNodeType }[];
  annotations: (LibraryAnnotation & { suggested?: DgId; held?: DgId; /** False for a picture or drawing, which has no words to bring. */ usable: boolean })[];
};

export type LibraryImported = { source: NodeSummary; made: number; already: number; units: DgId[]; canvas?: DgId; /** The source was in the graph before this. */ wasHere: boolean };

/** Who can see a piece of a person's work: only them, or their lab. Everyone else sees counts alone. */
export type ProfileAudience = "private" | "lab";

/** One thing a person did. `text` reads after their name, and `unit` or `canvas` is what it was done to. */
export type ProfileEvent = {
  id: string;
  at: string;
  action: "made" | "changed" | "withdrew" | "related" | "read" | "canvas" | "noted" | "reacted" | "reviewed" | "decided";
  text: string;
  audience: ProfileAudience;
  unit?: { id: DgId; title: string; abbreviation?: string; base?: BaseNodeType; color?: string };
  /** For a relation: the unit it points to. */
  other?: { id: DgId; title: string; abbreviation?: string; base?: BaseNodeType; color?: string };
  canvas?: { id: DgId; title: string };
};

/** Counts alone. Nothing in here names a unit, a paper or a canvas, so it is safe for anyone to see. */
export type ProfileStats = {
  units: number;
  /** Units the person wrote or highlighted themselves. */
  written: number;
  /** Units a model read from a paper at the person's request. */
  read: number;
  byType: { label: string; base?: string; count: number }[];
  relations: number;
  papers: number;
  canvases: number;
  activeDays: number;
  /** How much was made in each of the last 26 weeks, oldest first. */
  weeks: number[];
  since?: string;
  lastActive?: string;
};

export type ProfilePerson = { id: string; name: string; me: boolean; orcid?: string; lab?: string };

export type Profile = {
  person: ProfilePerson;
  /** What this viewer may see of this person, widest last. */
  audiences: (ProfileAudience | "public")[];
  public: ProfileStats;
  lab?: { stats: ProfileStats; history: ProfileEvent[]; more: number };
  private?: { stats: ProfileStats; history: ProfileEvent[]; more: number };
  /** The viewer and their labmates, to move between profiles. */
  people: ProfilePerson[];
};

/** A person in a few facts, for the card that shows on hovering their initials. */
export type ProfileCard = ProfilePerson & { units: number; written: number; read: number; relations: number; papers: number; since?: string; lastActive?: string };

/** An announcement, built and waiting for the person to read it. Nothing has been sent. */
export type NotifyDraft = { ready: true; inbox: string; paper: string; notification: Notification } | { ready: false; why: string };

/** What a crate export wrote. `added` counts the units pulled in because the chosen ones rest on them. */
export type CrateExported = {
  where: string;
  name: string;
  units: number;
  added: number;
  files: number;
  pdfs: number;
  papers: number;
  version: string;
  /** Output files packed with the crate, each checked against its recorded hash. */
  outputs: number;
  /** Outputs left out because the file in the base no longer matches the hash on record. */
  changed: number;
};
/** A draft on Zenodo with the crate in it. `page` is where the person reviews and publishes it. */
export type CrateDeposited = CrateExported & { page: string; doi?: string; sandbox: boolean };
/** Whether a Zenodo token is kept, and the last characters of it. Never the token. */
export type DepositSettings = { live: { kept: boolean; hint?: string }; sandbox: { kept: boolean; hint?: string }; canKeep: boolean; reachable: boolean; drafts: { name: string; page: string; doi?: string; at: string; sandbox: boolean }[] };

/** `own`: a crate this app made, restored record for record. `foreign`: another tool's, read into units. */
export type CrateImported = { name: string; kind: "own" | "foreign"; units: number; fresh: number; canvas?: DgId; skipped: number; /** Arguments between the units that were read. */ relations?: number; /** Files whose bytes were found and hashed. */ hashed?: number };

export type Provenance = {
  /** Where the unit sits in the person's reference library, to open it there. */
  library?: { app: "zotero"; open: string; what: "item" | "passage"; /** The words marked there, and what the reader wrote beside them. */ exact?: string; comment?: string };
  /** The published work this unit was read from or stands for, when there is one to look up. */
  work?: WorkView;

  created: { credit: Credit; at: string };
  edited?: { name: string; at: string };
  paper?: {
    id: DgId;
    title: string;
    canvas: DgId;
    doi?: string;
    url?: string;
    model: string;
    server: string;
    schema: string;
    extractedBy: string;
    at: string;
    /** The paper's own authors, who made the claim. Whoever extracted it only read it. */
    authors?: string[];
    license?: string;
    anchor?: string;
    description?: string;
    /** The model's own wording, when a person has since reworded the unit. */
    asRead?: string;
  };
  /** The PDF it was highlighted or extracted from, when the base holds that file. */
  pdf?: { ref: string; name: string; page?: number; exact?: string };
  lives: {
    text: { title: string } | null;
    canvases: { id: DgId; title: string; shared: boolean }[];
    folders: { id: DgId; title: string }[];
    lab?: string;
  };
};

export type UnitSocial = {
  who: Record<Reaction, string[]>;
  mine: Reaction | null;
  notes: { id: DgId; text: string; credit: Credit; at: string; mine: boolean }[];
};

export type PaperSummary = {
  id: DgId;
  title: string;
  canvas: DgId;
  filename: string;
  authors: string[];
  doi?: string;
  model: string;
  server: string;
  schema: string;
  units: number;
  relations: number;
  at: string;
  credit: Credit;
  stored: boolean;
  /** Set once it's in the lab's repository. */
  labPaper?: string;
};

/** An extraction someone already ran and saved as a file, such as `paper.graph.json` from MIRA extraction. */
export type SavedExtraction = { name: string; title?: string; model?: string; units: number; relations: number };

/** A PDF the base holds, and what the graph knows about it. */
export type PdfDocument = {
  ref: string;
  name: string;
  /** The paper's or source unit's title, or else the file name. */
  title: string;
  folder?: string;
  size?: number;
  modifiedAt?: string;
  paper?: { id: DgId; title: string; canvas: DgId };
  /** The source unit that stands for this file, once anything was read from it. */
  source?: DgId;
  /** Units read from it, by highlight or by extraction. */
  units: number;
};

/** The passage a unit was read from, as a W3C text quote: matched by its words, not by position. */
export type PdfMark = { unit: NodeSummary; exact: string; page?: number };

export type PdfOpened = {
  document: PdfDocument;
  dataBase64: string;
  marks: PdfMark[];
  /** A unit to scroll to, asked for before this reader opened. */
  reveal?: DgId;
};

export type PdfCut = {
  ref: string;
  /** The highlighted words, as selected. */
  exact: string;
  page: number;
  /** The unit's title. It starts as the highlight. */
  title: string;
  type?: DgId;
  /** Null keeps it in the graph only. */
  canvas: DgId | null;
  /** Makes this canvas first, and puts the unit there. */
  newCanvas?: string;
  /** The PDF's own title, from its metadata, for its source unit. */
  documentTitle?: string;
};

/** Units grouped by where else they live. A unit in two places is in both groups. */
export type UnitsSegment = {
  kind: "canvas" | "folder" | "loose";
  /** A canvas or folder id, or `loose`. */
  id: string;
  title: string;
  holon?: HolonLevel;
  units: DgId[];
};

export type AvailableUnit = NodeSummary & {
  /** Relations, active or pending, to cards already on this canvas. */
  links: number;
};

export type UnitsAvailable = {
  units: Record<DgId, AvailableUnit>;
  segments: UnitsSegment[];
  /** Relations among the units listed, active or pending, so a group can be laid out before it's placed. */
  relations: { source: DgId; target: DgId; label: string; kind?: string }[];
};

export type ExportTarget =
  | { kind: "workspace" }
  | { kind: "lab" }
  | { kind: "canvas"; id: DgId }
  | { kind: "folder"; id: DgId }
  | { kind: "new-folder"; title: string };

export type LabView = {
  link: LabLink | null;
  identity: IdentityView;
  members: LabMember[];
  requests: JoinRequest[];
  papers: LabPaper[];
  breadcrumbs: BreadcrumbDefault;
};

export type BreadcrumbDefault = "ask" | "always" | "never";

/** `source` says whose model answers: a person's own key, the lab's, or none (the closest units are quoted). */
export type AiStatus = {
  ready: boolean;
  mode?: "model" | "search-only";
  model?: string;
  why?: string;
  source?: "own" | "lab" | "none";
  provider?: AiProviderKind;
  route?: AiRoute;
  /** A model server on this computer, which needs no key and sends nothing off the device. */
  local?: boolean;
  /** Whether this base can keep a key and call a provider. */
  canSetUp?: boolean;
};

/** How a refusal to put something foreign on a PDF canvas begins. A surface offers "Build on it" when it sees it. */
export const PDF_CANVAS_FIXED = "This is a PDF canvas";

/** Whose work a paper map counts: one canvas, the person's own workspace, a lab's, or everything this device holds. */
export type PaperScope = { kind: "canvas"; id: DgId } | { kind: "own" } | { kind: "lab"; id: string } | { kind: "everyone" };
export type PaperScopeChoice = { scope: PaperScope; label: string; hint: string };
export type PaperMapUnit = { id: DgId; title: string; paper: DgId; abbreviation?: string; base?: string };
/** One relation someone drew between a unit of one paper and a unit of another. */
export type PaperMapLink = { relation: DgId; label: string; stance?: "supports" | "opposes"; from: PaperMapUnit; to: PaperMapUnit };
export type PaperMapPaper = {
  id: DgId;
  title: string;
  /** The paper in a few words: "Carroll 2020". */
  label: string;
  /** Its PDF canvas. */
  canvas: DgId;
  units: number;
  /** How many of its units are linked to a unit of another paper in this scope. */
  reaching: number;
  /** How many other papers it is tied to in this scope. */
  tiedTo: number;
  /** The sum of its ties' strengths. */
  weight: number;
  x: number;
  y: number;
  /** Tied to nothing in this scope. */
  apart?: true;
};
export type PaperMapTie = {
  a: DgId;
  b: DgId;
  /** From 0 to 1: links people drew, each further one adding less, and whether either paper cites the other. */
  strength: number;
  supports: number;
  opposes: number;
  other: number;
  /** Which way a citation runs between them. */
  cites?: "a-b" | "b-a" | "both";
  /** What the links between them say, taken together. `cites` is a citation and no drawn link. */
  stance: "agree" | "conflict" | "mixed" | "linked" | "cites";
  links: PaperMapLink[];
};
export type PaperMap = { scope: PaperScope; papers: PaperMapPaper[]; ties: PaperMapTie[]; card: { width: number; height: number } };

/** Where something lives: the person's own workspace, their lab's, or one that isn't theirs. */
export type WorkspaceRef = { kind: "own" | "lab" | "other"; id: string; name: string };

/** A paper or other source the cards of a canvas were read from, with how many of them. */
export type CanvasSource = { id: DgId; title: string; label: string; units: number };

export type CanvasSummary = {
  id: DgId;
  title: string;
  /** `paper`: one reading of one paper, which stays as it was read. `canvas`: laid out by people. */
  kind: "paper" | "canvas";
  cards: number;
  links: number;
  editedAt: string;
  credit: Credit;
};

/**
 * Holons: every level of the argument holarchy is shown the same way. A lab
 * holds questions, a question holds the claims that address it, a claim holds
 * the evidence for and against it, and evidence holds the outputs it rests on.
 * Containment isn't exclusive: a claim can sit inside two questions. Each
 * holon is drawn as a canvas, authored when someone has arranged one.
 */
export type HolonLevel = "lab" | "question" | "claim" | "evidence" | "output";
/** A lab is named by its DID; every other holon by its unit's id. */
export type HolonRef = { level: HolonLevel; id: string };
/** Whose arguments count as active: only mine, my lab's, or everyone's. */
export type Stance = "mine" | "lab" | "everyone";
export type Privacy = "private" | "lab" | "published";

export type HolonPart = {
  id: DgId;
  title: string;
  /** Its base type, such as `claim` or `run`. */
  base: string;
  label: string;
  credit: Credit;
  privacy: Privacy;
  /** Set when the part is itself a holon you can open into. */
  ref?: HolonRef;
  /** How many parts that holon holds. */
  holds?: number;
  /** Short gap names that apply to this part, such as `single run`. */
  flags: string[];
};

export type HolonEdge = {
  id: string;
  from: DgId;
  to: DgId;
  /** An argument (`supports`, `opposes`, `addresses`, `informs`) or a provenance field. */
  kind: string;
  /** Arguments have a state; provenance fields are always `field`. */
  state: "active" | "pending" | "field";
  by?: string;
};

export type Crossing = {
  id: DgId;
  title: string;
  base: string;
  /** In: something this holon rests on from elsewhere. Out: something of it used elsewhere. */
  direction: "in" | "out";
  why: string;
  /** The other holon, when there is one to open. */
  other?: { ref: HolonRef; title: string };
};

export type Gap = {
  rule: string;
  severity: "violation" | "warning";
  message: string;
  units: DgId[];
};

export type HolonCanvasCard = {
  /** The canvas item id, or the unit id on a generated canvas. */
  id: string;
  unit?: DgId;
  /** A nested canvas shown as a card. */
  canvas?: DgId;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HolonCanvas = {
  /** Null for a canvas laid out from the graph that nobody has saved. */
  id: DgId | null;
  title: string;
  cards: HolonCanvasCard[];
  links: { id: string; from: string; to: string; label?: string; relation?: DgId }[];
  /** Other canvases of the same holon. */
  others: { id: DgId; title: string }[];
};

export type HolonEvent = { at: string; by: string; what: string; unit?: DgId };

/** What Delete does to a link between two cards: ask, take it off this canvas, or withdraw the relation. */
export type LinkDelete = "ask" | "canvas" | "withdraw";

/** Per-device choices. */
export type Prefs = {
  linkDelete: LinkDelete;
  /** The key that makes a node from selected text in a note. Empty turns it off; the command stays. */
  captureKey: string;
  /** Whether reading a notebook also keeps printed text and plain results as outputs. */
  notebookText: boolean;
  /** Which facts every card shows under its title, on this device. */
  cardFields: CardField[];
  /** Whether the canvas sidebar stays open beside the canvas, or floats over it and goes. */
  sidePinned: boolean;
};

/** One rule a unit breaks, from the process shapes. The same rule names as `ontology/dg_process.shacl.ttl`. */
export type MethodProblem = { rule: string; severity: "Violation" | "Warning" | "Info"; message: string };

/** One step of how a result was produced, from the question down to the claim it argues for. */
export type MethodStep = {
  role: "question" | "study" | "protocol" | "code" | "run" | "output" | "evidence" | "claim" | "source";
  /** The unit, when this graph holds it. A pin can name something that isn't here. */
  unit?: NodeSummary;
  id: string;
  /** A few words of its facts: a run's status and date, a code version, an output's kind. */
  detail?: string;
  /** `changed`: the unit was edited after the run pinned it. `missing`: the pin names something this graph doesn't hold. */
  drift?: "changed" | "missing";
};

/** The method behind one piece of evidence, in the order it happened. */
export type MethodChain = {
  evidence: NodeSummary;
  /** Set when the chain is shown for a claim. */
  stance?: "supports" | "opposes";
  steps: MethodStep[];
  /** True when nothing stands behind the evidence: no output, run or source. */
  ungrounded: boolean;
};

export type MethodView = {
  unit: NodeSummary;
  chains: MethodChain[];
  /** For a claim: what the replication and drift checks see. */
  flags?: { singleRun: boolean; replicated: boolean; singleMethod: boolean; drift: boolean; staleOutput: boolean; failedRuns: number; ungrounded: number; runs: number; protocols: number };
  problems: MethodProblem[];
  /** The run to open for the full record, when there is exactly one. */
  run?: DgId;
  /**
   * For a claim that other claims support: everything beneath it, followed
   * through those claims down to evidence, and the papers it was all read from.
   */
  rests?: { claims: number; evidence: number; runs: number; opposing: number; own: number; papers: { id: DgId; label: string; title: string; units: number }[] };
};

/** A unit elsewhere whose words are close to this one's: a candidate to relate, never a relation. */
export type SimilarUnit = { node: NodeSummary; score: number; shared: string[] };

export type RunOutput = {
  unit: NodeSummary;
  kind?: string;
  mediaType?: string;
  size?: number;
  cid?: string;
  caption?: string;
  /** Where it sat in the notebook: the cell, counted from 1, and its label. */
  cell?: number;
  label?: string;
  /** Evidence that rests on it, and whether its pin still matches these bytes. */
  evidence: { unit: NodeSummary; pinned: boolean; changed: boolean }[];
  /** The bytes, read from the notebook on this device, when they still hash to the recorded CID. Never from a record. */
  preview?: string;
  /** The notebook on this device no longer holds these bytes. */
  stale?: boolean;
};

export type RunCell = { index: number; id?: string; kind: "code" | "markdown"; source: string; label?: string; outputs: DgId[] };

/** Everything recorded about one execution, as a page. */
export type RunPage = {
  run: NodeSummary;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  agents: string[];
  condition?: string;
  deviations: string[];
  /** Each parameter the protocol declares or the run set. */
  parameters: { name: string; value?: string; unit?: string; default?: string; declared: boolean }[];
  environment: { name: string; value: string }[];
  seeAlso: string[];
  study?: { unit: NodeSummary; question?: NodeSummary; design?: string; hypothesis?: string; conditions: string[]; variables: { name: string; role: string; unit?: string }[] };
  protocol?: { unit?: NodeSummary; id: string; version?: string; drift?: "changed" | "missing"; pinned?: string; steps: string[]; materials: string[] };
  /** Further methods the run followed, as a paper's run often names several. */
  alsoFollowed: NodeSummary[];
  /** The paper that reports this run, when it was read from one. */
  reportedIn?: { source?: NodeSummary; paper?: { id: DgId; label: string; title: string; canvas: DgId } };
  code: { unit?: NodeSummary; id: string; drift?: "changed" | "missing"; pinned?: string; repo?: string; commit?: string; path?: string; language?: string }[];
  inputs: { id: string; unit?: NodeSummary; pinned?: string }[];
  outputs: RunOutput[];
  claims: { unit: NodeSummary; stance: "supports" | "opposes"; through: DgId }[];
  /** The notebook's cells, when the file is on this device. `current` is false when its sources changed since the run. */
  notebook?: { ref: string; current: boolean; cells: RunCell[] };
  problems: MethodProblem[];
};

export type NotebookFile = {
  ref: string;
  name: string;
  folder?: string;
  modifiedAt?: string;
  /** Set once imported: its Code unit and how many runs of it the graph holds. */
  code?: DgId;
  runs: number;
};

export type NotebookImported = {
  code: NodeSummary;
  run: NodeSummary;
  outputs: NodeSummary[];
  /** This exact execution was already here, so nothing was written. */
  known: boolean;
  /** The code changed since the last import, so this is a new version of the same Code unit. */
  revised: boolean;
  status: string;
};

/** A canvas's place in the holarchy, for the canvas tab's breadcrumb. */
export type CanvasHolon = {
  ref: HolonRef | null;
  path: { ref: HolonRef; title: string }[];
  /** Holons this canvas could be tied to: the lab and the holon units on it. */
  candidates: { ref: HolonRef; title: string }[];
};

export type HolonView = {
  ref: HolonRef;
  title: string;
  label: string;
  base: string;
  /** One path up to the lab, for the breadcrumb. */
  path: { ref: HolonRef; title: string }[];
  /** Every holon this one sits in. */
  within: { ref: HolonRef; title: string }[];
  parts: HolonPart[];
  /** What stands behind evidence or an output: runs, protocols, code, sources. */
  behind: HolonPart[];
  edges: HolonEdge[];
  boundary: {
    crossings: Crossing[];
    gaps: Gap[];
    privacy: { counts: Record<Privacy, number>; next: string };
    stance: { stance: Stance; active: number; pending: number; pendingBy: string[] };
  };
  canvas: HolonCanvas;
  history: HolonEvent[];
  /** Gap names that apply to the holon's own unit. */
  flags: string[];
  /** Titles for every unit the boundary names, including ones a level or two down. */
  names: Record<DgId, { title: string; base: string; label: string; ref?: HolonRef }>;
};

export type ReleaseSummary = {
  id: DgId;
  canvas: DgId;
  name: string;
  note?: string;
  at: string;
  by: string;
  units: number;
  published: boolean;
};

export type RepositoryCanvas = {
  id: DgId;
  title: string;
  holon?: { ref: HolonRef; title: string };
  cards: number;
  links: number;
  /** Units on it by base type. */
  units: Record<string, number>;
  people: string[];
  editedAt: string;
  /** Edits in the log for this canvas and its items. */
  edits: number;
  releases: ReleaseSummary[];
  forkOf?: { id: DgId; title: string; release: string };
  forks: number;
  /** Canvases embedded in this one, and canvases this one is embedded in. */
  nested: DgId[];
  nestedIn: DgId[];
  gaps: number;
  privacy: Privacy;
  /** `paper`: made by reading a PDF, and it holds that paper's units. `workspace`: made by a person to build an argument. */
  kind: "paper" | "canvas";
  /** The workspace it lives in. */
  workspace: WorkspaceRef;
  /** The papers most of its cards were read from, most first, three at most. */
  sources: CanvasSource[];
  /** How many papers its cards were read from in all. */
  sourceCount: number;
  /** Who did most on it, most first, four at most, with how many people in all. */
  contributors: (Credit & { edits: number })[];
  contributorCount: number;
  /** The paper it was read from, for a paper canvas. */
  paper?: string;
  /** Who made it, and whether that is the person looking. */
  by: string;
  mine: boolean;
  /** The lab it belongs to or is shared with. */
  lab?: string;
  /** The canvas's real layout, small: each card where it sits, coloured by its unit's type, and the links between them. */
  thumb: { width: number; height: number; cards: { x: number; y: number; w: number; h: number; base: string }[]; links: [number, number][] };
};

export type CanvasDiff = {
  from: string;
  to: string;
  added: { unit: DgId; title: string }[];
  removed: { unit: DgId; title: string }[];
  /** Units whose content changed between the two. */
  changed: { unit: DgId; title: string }[];
  moved: { unit: DgId; title: string }[];
};

/** The parts of a unit a search reads: its title, the text of its note, and the PDF passage it came from. */
export type SearchField = "title" | "text" | "passage";
export type SearchSort = "relevance" | "edited" | "created" | "title";

export type SearchQuery = {
  text?: string;
  /** Node type ids, or `none` for units without a type yet. */
  types?: DgId[];
  /** People or labs a unit is credited to, by credit id. */
  credits?: string[];
  /** All three when absent. */
  fields?: SearchField[];
  sort?: SearchSort;
  limit: number;
};

/** A search a panel hands to another, such as the quick finder opening the search panel. */
export type SearchCarry = Omit<SearchQuery, "limit">;

/** Character ranges to mark, end exclusive. */
export type { TextMarks } from "./words.ts";

export type SearchHit = {
  node: NodeSummary;
  titleMarks: TextMarks;
  /** Where the words were found besides the title, for the row's second line. */
  match?: { field: Exclude<SearchField, "title">; snippet: string; marks: TextMarks };
  canvases: { id: DgId; title: string }[];
  editedAt: string;
};

export type SearchFacet = { id: string; label: string; count: number };

export type SearchResults = {
  hits: SearchHit[];
  /** Every match, before the limit. */
  total: number;
  /** Counted over what the words matched, before the type and credit filters. */
  types: SearchFacet[];
  credits: (SearchFacet & { kind: Credit["kind"]; mine?: true })[];
  /** False while the notes are still being read for the first time. Titles and passages are searched meanwhile. */
  textReady: boolean;
};

export type NodeQuery = {
  text?: string;
  types?: DgId[];
  limit: number;
};

export type RelationOption = {
  type: DgId;
  label: string;
  /** True when the chosen wording needs the source and target swapped. */
  flipped: boolean;
};

export type IdentityView = {
  did: string;
  name: string;
  lab?: { name: string; did: string; custodian: string };
  /** A lab in this graph or vault that this person hasn't joined. */
  availableLab?: { name: string; custodian: string };
};

/** `credit` and `at` say who put the item there and when: what a note shows under its text. */
export type CanvasItemView = { id: DgId; z: number; item: CanvasItem; credit: Credit; at: string };

export type CanvasView = {
  canvas: CanvasRecord;
  items: CanvasItemView[];
  nodes: Record<DgId, NodeSummary>;
  /** `mine` when this person asserted it, so they're the one who can withdraw it. */
  relations: Record<DgId, { label: string; state: RelationState; kind?: string; credit: Credit; mine?: true; type: DgId; source: DgId; target: DgId }>;
  /** Reactions and notes, by node. Only shared canvases have them. */
  social: Record<DgId, UnitSocial>;
  /** Set on a PDF canvas: the reading it shows. Such a canvas stays as it was read. */
  paper?: PaperSummary;
};

export type CanvasUpsert = {
  /** Absent for a new item. */
  id?: DgId;
  item: WithoutId<CanvasItem>;
  z: number;
};

/**
 * Surfaces see nodes, relations and canvases, and never a HostRef, so they
 * can't depend on a base.
 */
export type SurfaceMethods = {
  "node.view": { params: { id: DgId }; result: NodeView };
  "node.query": { params: NodeQuery; result: NodeSummary[] };
  /** Questions, claims and evidence in other papers and canvases that read close to this unit, closest first. */
  "node.similar": { params: { id: DgId; limit?: number }; result: SimilarUnit[] };
  "node.create": {
    params: { title: string; type?: DgId };
    result: NodeSummary;
  };
  /** Null takes the type away again, for undo. */
  "node.setType": { params: { id: DgId; type: DgId | null }; result: NodeSummary };
  /** Renames a unit and its note or page. Only its author can. */
  "node.rename": { params: { id: DgId; title: string }; result: NodeSummary };
  /**
   * Takes back a unit its author made. It leaves every canvas, its links stop counting, and its note
   * goes to the base's trash. The record stays, so nothing that named it loses its history.
   */
  "node.remove": { params: { id: DgId }; result: null };
  /** Puts a link to the unit's note at the last cursor in the base. */
  "node.insertLink": { params: { id: DgId }; result: null };
  /** Titles, note text and PDF passages, ranked, with what the results hold by type and by person or lab. */
  "search.query": { params: SearchQuery; result: SearchResults };
  /** Opens the search panel with this search in it. */
  "search.show": { params: { query?: SearchCarry }; result: null };
  /** The search handed over by `search.show`, once, for a panel that just opened. */
  "search.take": { params: Record<string, never>; result: SearchCarry | null };
  "relation.options": {
    params: { source: DgId; target: DgId };
    result: RelationOption[];
  };
  /** `made` when this call asserted it, rather than finding it already there. */
  "relation.assert": {
    /** `draw` also draws it on each of the person's canvases that holds both units. A canvas draws its own, so it leaves this off. */
    params: { type: DgId; source: DgId; target: DgId; draw?: boolean };
    result: RelationRecord & { made?: true };
  };
  "relation.withdraw": { params: { id: DgId; reason?: string }; result: null };
  "relation.decide": {
    params: { id: DgId; decision: "accepted" | "rejected" };
    result: null;
  };
  "canvas.list": { params: Record<string, never>; result: CanvasRecord[] };
  /** Every canvas with what a person needs to recognize it. */
  /** One holon, drawn the same way at every level. */
  "holon.view": { params: { ref: HolonRef; stance: Stance }; result: HolonView };
  /** The holon in focus: the active canvas's holon, or the holon of the note being read. */
  "holon.focus.get": { params: Record<string, never>; result: { ref: HolonRef | null; canvas: DgId | null } };
  /** A canvas tab or the explorer says which holon it's showing. */
  "holon.focus.set": { params: { canvas?: DgId; ref?: HolonRef }; result: null };
  "holon.ofCanvas": { params: { id: DgId }; result: CanvasHolon };
  /** The holon's own canvas, made from its laid-out view if it has none yet. */
  "holon.canvas": { params: { ref: HolonRef }; result: { id: DgId; made: boolean } };
  /** Ties a canvas to a holon, so it becomes that holon's view. */
  "canvas.setHolon": { params: { id: DgId; holon: string | null }; result: null };
  /** Lights these units on whatever canvas shows them, from any panel. */
  /** Marks units on the open canvases. `brief` lets the mark go by itself after a moment, for pointing something out. */
  "canvas.highlight": { params: { units: DgId[]; brief?: boolean }; result: null };
  "prefs.get": { params: Record<string, never>; result: Prefs };
  "prefs.set": { params: Partial<Prefs>; result: Prefs };
  /** The holon a unit opens as. A run or protocol opens as the evidence it stands behind. */
  "holon.locate": { params: { id: DgId }; result: HolonRef | null };
  /** The top of the holarchy: the labs and spaces in this graph. */
  "holon.roots": { params: Record<string, never>; result: { ref: HolonRef; title: string; holds: number }[] };
  /** Every canvas, with its versions, forks, nesting and gaps. */
  "repository.canvases": { params: Record<string, never>; result: RepositoryCanvas[] };
  /** A canvas as it stood at a moment in its history. */
  "canvas.at": { params: { id: DgId; at: string }; result: HolonCanvas };
  "canvas.history": { params: { id: DgId }; result: { events: HolonEvent[]; releases: ReleaseSummary[] } };
  /** Saves a holon's laid-out canvas, so it can be arranged, versioned and released. */
  "canvas.saveHolon": { params: { ref: HolonRef }; result: { id: DgId } };
  "canvas.release": { params: { id: DgId; name: string; note?: string }; result: ReleaseSummary };
  "canvas.fork": { params: { release: DgId; title?: string }; result: { id: DgId } };
  /** `now` stands for the live canvas. */
  "canvas.diff": { params: { canvas: DgId; from: DgId | "now"; to: DgId | "now" }; result: CanvasDiff };
  "canvas.summaries": { params: Record<string, never>; result: CanvasSummary[] };
  /** Goes to a canvas in the base, in the base's own way. */
  "canvas.show": { params: { id: DgId }; result: null };
  /** Opens a canvas and points at one unit on it: the canvas brings its card into view and marks it for a moment. */
  "canvas.reveal": { params: { id: DgId; unit: DgId }; result: null };
  /** The unit a canvas was just asked to point at, handed over once, for a canvas that wasn't open when asked. */
  "canvas.revealed": { params: { id: DgId }; result: DgId | null };
  /** Layouts are shared, so a teammate sees the same headings and scores. */
  "canvas.setLayout": { params: { id: DgId; layout: CanvasLayout }; result: null };
  "canvas.create": { params: { title: string }; result: CanvasRecord };
  "canvas.open": { params: { id: DgId }; result: CanvasView };
  /** The canvas last opened on this device, so a remounted panel can return to it. */
  "canvas.last": { params: Record<string, never>; result: DgId | null };
  /** Removing an edge takes it off the canvas. The relation itself stays. */
  "canvas.write": {
    params: {
      canvas: DgId;
      upserts?: CanvasUpsert[];
      removes?: DgId[];
      /** Brings back items removed earlier, with their ids, so edges still attach. */
      restores?: DgId[];
    };
    result: { ids: DgId[] };
  };
  /** Asks any open canvas to add this node. Null when no canvas is open. */
  "canvas.place": { params: { node: DgId }; result: null };
  /** Puts units on a canvas where the caller laid them out, with their relations to each other and to what's there. */
  "canvas.placeUnits": {
    params: { canvas: DgId; places: { node: DgId; x: number; y: number; width: number; height: number }[] };
    result: { ids: DgId[] };
  };
  /**
   * Puts units on a canvas from another panel, such as search. They go beside what's there, and an
   * open canvas brings them to where the person is looking. Units already on it are only lit.
   */
  "units.put": { params: { canvas: DgId; nodes: DgId[] }; result: { placed: DgId[]; already: DgId[] } };
  /** Units not on this canvas yet, grouped by the other canvases and folders that hold them. */
  "units.available": { params: { canvas: DgId }; result: UnitsAvailable };
  /** PDFs the base holds: papers first, then the rest, newest first. */
  "pdf.list": { params: Record<string, never>; result: PdfDocument[] };
  /** With `data: false`, only what the graph knows changes: the marks, for a re-read after an edit. */
  "pdf.open": { params: { ref: string; data?: boolean }; result: PdfOpened };
  /** Keeps a dropped or chosen PDF in the base, where a person would look for it. */
  "pdf.add": { params: { name: string; dataBase64: string }; result: PdfDocument };
  /** Makes a unit from a highlight, and puts it on a canvas if one was chosen. */
  "pdf.cut": { params: PdfCut; result: { node: NodeSummary; canvas: DgId | null } };
  /** Takes back a unit just made from a highlight, and its card. */
  "pdf.uncut": { params: { node: DgId }; result: null };
  /** Opens the reader beside the canvas, at a unit's passage if given. With no file, it offers the choice of PDFs. */
  /** The PDF most of a canvas's cards were read from, when the file is here: its own paper's for a PDF canvas. */
  "canvas.pdf": { params: { id: DgId }; result: { ref: string; name: string } | null };
  "pdf.show": { params: { ref?: string; unit?: DgId }; result: null };
  /** A reader that is already open and holds this unit's passage scrolls to it and marks it for a moment. Opens nothing. */
  "pdf.follow": { params: { unit: DgId }; result: null };
  "canvas.export": { params: { id: DgId }; result: DgCanvas };
  "grammar.get": {
    params: Record<string, never>;
    result: {
      nodeTypes: NodeTypeRecord[];
      relationTypes: RelationTypeRecord[];
      /** How many live units have each node type, and how many active relations each relation type. */
      uses?: Record<DgId, number>;
      /** Whether this base can make a table of the units of one type. */
      tables?: boolean;
    };
  };
  /**
   * Adds a node type, or changes one when `id` is given. A type always sits on one of the nine bases:
   * the base is what other tools understand, and the label is the lab's own word for it.
   */
  "grammar.saveNodeType": {
    params: { id?: DgId; label: string; base: BaseNodeType; abbreviation?: string; titleFormat?: string; color?: string; template?: string };
    result: NodeTypeRecord;
  };
  /** Takes a type out of use. Refused while units still have it, so nothing is left untyped by accident. */
  "grammar.removeNodeType": { params: { id: DgId }; result: null };
  /** Adds a relation type, or changes one. `rules` are the pairs of node types it may join, source first. */
  "grammar.saveRelationType": {
    params: { id?: DgId; label: string; complement: string; base?: BaseRelationType; rules: RelationRule[]; color?: string };
    result: RelationTypeRecord;
  };
  "grammar.removeRelationType": { params: { id: DgId }; result: null };
  /** Saves the types, relations, allowed pairs and templates as one JSON file, named by label so another base can read it. */
  "grammar.export": { params: Record<string, never>; result: { where: string; name: string; nodeTypes: number; relationTypes: number } };
  /** JSON files in the base that could be a schema, newest first. */
  "grammar.files": { params: Record<string, never>; result: { ref: string; name: string; folder?: string }[] };
  /**
   * Reads a schema file: ours, or one exported by the official Discourse Graphs plugin for Obsidian.
   * Adds what is missing and never changes or removes what is here.
   */
  "grammar.import": { params: { ref: string }; result: { nodeTypes: number; relationTypes: number; rules: number; kept: number; from: "discourse-graphs" | "official-plugin" } };
  /** Opens the base's own table of every unit of one type. */
  "table.open": { params: { type: DgId }; result: { where: string } };
  /** Takes a canvas away. Its units stay, and so do their links. Only its maker can. */
  "canvas.remove": { params: { id: DgId }; result: null };
  "base.reveal": { params: { id: DgId; placement: Placement }; result: null };
  /** Opens where an identifier resolves, or any `http` or `https` address, in the person's browser. */
  "link.open": { params: { url: string }; result: null };
  /** Whether the Zotero app on this computer can be read, and what to do when it can't. */
  "zotero.status": { params: Record<string, never>; result: LibraryStatus };
  "zotero.search": { params: { text: string; limit?: number }; result: LibraryHit[] };
  "zotero.item": { params: { ref: string }; result: LibraryItemView };
  /** Brings an item in as a Source, with the annotations chosen as units that quote it. Reads Zotero; never writes to it. */
  "zotero.import": { params: { ref: string; annotations?: { key: string; type?: DgId }[]; canvas?: DgId }; result: LibraryImported };
  /** A person's work as this viewer may see it. Without an id, the viewer's own. */
  "profile.view": { params: { id?: string }; result: Profile };
  "profile.card": { params: { id: string }; result: ProfileCard };
  /** Papers placed by how tied they are, in one scope, with the scopes on offer. */
  "papers.map": { params: { scope?: PaperScope }; result: PaperMap & { scopes: PaperScopeChoice[] } };
  /** Opens the paper map, on a canvas's scope when one is given. */
  "papers.show": { params: { canvas?: DgId }; result: null };
  /** Opens a person's profile in the base. */
  "profile.show": { params: { id?: string }; result: null };
  /** Builds the COAR Notify announcement that would tell a paper's repository about a unit. Sends nothing. */
  "notify.draft": { params: { unit: DgId }; result: NotifyDraft };
  /** Sends the announcement the person just read, under the same `id`, to the paper's own inbox. */
  "notify.send": { params: { unit: DgId; id: string }; result: { status: number; location?: string; inbox: string } };
  /** Notifications the lab's server holds about a unit or the paper it was read from. */
  "notify.about": { params: { unit: DgId }; result: NotificationSummary[] };
  /**
   * Packs a canvas, or the units named, as an RO-Crate: metadata, a preview page, the graph as JSON-LD,
   * its records, the canvas and DataCite metadata. `eln` is the lab-notebook archive form of the same crate.
   * The papers' PDFs go in only when asked, since their licenses may not allow passing them on.
   */
  "crate.export": {
    params: { canvas?: DgId; nodes?: DgId[]; name?: string; description?: string; license?: string; pdfs?: boolean; outputs?: boolean; format?: "zip" | "eln" };
    result: CrateExported;
  };
  /**
   * Packs the same crate and puts it in a new draft on Zenodo, with the DOI Zenodo reserved written into it.
   * The draft is never published from here: the person reviews it on Zenodo and publishes it there.
   */
  "crate.deposit": {
    params: { canvas?: DgId; nodes?: DgId[]; name?: string; description?: string; license?: string; pdfs?: boolean; outputs?: boolean; sandbox?: boolean };
    result: CrateDeposited;
  };
  "deposit.settings": { params: Record<string, never>; result: DepositSettings };
  /** `token` saves a Zenodo token, and null removes it. The token is never sent back. */
  "deposit.configure": { params: { sandbox?: boolean; token: string | null }; result: DepositSettings };
  /** Reads a crate the base holds: a `.zip`, an `.eln`, or a bare `ro-crate-metadata.json`. */
  "crate.import": { params: { ref: string }; result: CrateImported };
  "crate.licenses": { params: Record<string, never>; result: { url: string; name: string }[] };
  /** Asks the open registries about the work behind a unit, and keeps what they say. Only identifiers and the title are sent. */
  "work.lookup": { params: { unit: DgId }; result: WorkLookup };
  /** Adds or takes away what else names a unit. `add` takes identifiers as people paste them. */
  "unit.identify": { params: { node: DgId; add?: (string | Identifier)[]; remove?: Identifier[] }; result: NodeSummary };
  /** Opens a panel in the base's side area. */
  "panel.open": { params: { surface: "context" | "canvases" | "boundary" | "search" }; result: null };
  /** Opens a pop-up over the base. `find` is the quick finder. */
  "dialog.open": { params: { surface: "upload" | "welcome" | "find" | "zotero" | "grammar"; /** For upload: a file the base already holds. */ id?: string }; result: null };
  "dialog.close": { params: Record<string, never>; result: null };

  "server.list": { params: Record<string, never>; result: ComputeServer[] };
  "server.add": { params: { name: string; url: string; kind: "local" | "managed" | "custom" }; result: ComputeServer };
  "server.remove": { params: { id: string }; result: null };
  "server.check": { params: { url: string }; result: ServerInfo };
  "server.options": { params: { url: string }; result: { models: ServerOption[]; schemas: ServerOption[] } };

  /**
   * Reads a paper into a graph and makes its canvas. The paper is a file picked
   * here or one the base already holds. With a saved extraction it uses that and
   * needs no server; otherwise a server reads it, and progress arrives as `job-status`.
   */
  "paper.extract": {
    params: {
      file?: { name: string; mediaType: string; dataBase64: string };
      /** A file the base already holds, in place of `file`. */
      ref?: string;
      /** A saved extraction to use in place of a server: one picked with the file, or `true` for the one beside it in the base. */
      saved?: { name: string; text: string } | true;
      server?: string;
      model?: string;
      schema?: string;
      share?: { includeFile: boolean };
    };
    result: PaperSummary;
  };
  /** The saved extraction beside a paper's file, when the base holds one, or the one in `text`. */
  "paper.saved": { params: { name: string; ref?: string; text?: string }; result: SavedExtraction | null };
  "paper.importGraph": { params: { graph: ExtractionGraph; filename: string; model?: string; server?: string; schema?: string }; result: PaperSummary };
  "paper.loadDemo": { params: Record<string, never>; result: PaperSummary[] };
  "paper.list": { params: Record<string, never>; result: PaperSummary[] };
  "paper.share": { params: { id: DgId; includeFile: boolean }; result: PaperSummary };
  "paper.getFile": { params: { id: string }; result: { where: string } };

  /** Gives units their own notes or pages, then puts them where the person chose. */
  "units.export": { params: { nodes: DgId[]; target: ExportTarget }; result: { canvas?: DgId; folder?: DgId; made: number } };
  "folder.list": { params: Record<string, never>; result: { id: DgId; title: string; units: number }[] };
  "folder.create": { params: { title: string }; result: { id: DgId; title: string; units: number } };

  "unit.react": { params: { unit: DgId; value: Reaction | null }; result: null };
  "unit.note": { params: { unit: DgId; text: string }; result: null };
  "unit.removeNote": { params: { id: DgId }; result: null };

  "lab.view": { params: Record<string, never>; result: LabView };
  "lab.find": { params: { server: string; id: string }; result: { id: string; name: string } };
  "lab.register": { params: { server: string; name: string }; result: LabView };
  "lab.requestJoin": { params: { server: string; id: string }; result: LabView };
  "lab.check": { params: Record<string, never>; result: LabView };
  "lab.decide": { params: { requestId: string; decision: "accept" | "decline"; tokenKind?: "personal" | "team" }; result: LabView };
  "lab.setBreadcrumbs": { params: { value: BreadcrumbDefault }; result: LabView };
  "canvas.share": { params: { id: DgId }; result: null };
  /** Who would see a canvas if it moved to the lab's workspace. */
  "canvas.audience": { params: { id: DgId }; result: { workspace: WorkspaceRef; lab?: { name: string; members: string[] } } };
  /** A canvas of the person's own showing the same cards as a PDF canvas, to build on. */
  "canvas.buildOn": { params: { id: DgId; title?: string }; result: { id: DgId; title: string } };

  /** How a unit was produced: the chain behind evidence, or behind each piece of evidence for a claim. */
  "process.method": { params: { id: DgId }; result: MethodView };
  /** One run as a page: what it followed, ran, took in and produced, and what rests on it. */
  "process.run": { params: { id: DgId; previews?: boolean }; result: RunPage };
  /** Opens a run's page in the main area. With no run, it lists the notebooks to import and the runs already here. */
  "run.show": { params: { id?: DgId }; result: null };
  /** Every run in the graph, newest first, for the list beside the notebooks. */
  "run.list": { params: Record<string, never>; result: { run: NodeSummary; status?: string; at: string; /** Read from a paper, so `at` is when it was imported and not when it ran. */ reported?: true; outputs: number; evidence: number }[] };
  /** Sets the facts a person fills in by hand on a protocol, study or run. Own units only. */
  "process.setFacts": {
    params: {
      id: DgId;
      facts: Partial<Pick<UnitFacts, "steps" | "materials" | "version" | "hypothesis" | "design" | "conditions" | "sampleSize" | "preregistration" | "condition" | "deviations">>;
      links?: { question?: DgId | null; partOf?: DgId | null; follows?: DgId | null; protocols?: DgId[] };
    };
    result: MethodView;
  };
  /** Jupyter notebooks in the base, and which are already in the graph. */
  "notebook.list": { params: Record<string, never>; result: NotebookFile[] };
  /** Reads a saved notebook into Code, a Run and its Outputs. The same execution twice writes nothing. */
  "notebook.import": { params: { ref: string; text?: boolean; study?: DgId; protocol?: DgId }; result: NotebookImported };
  /** Makes evidence that rests on an output, pinned to its bytes, and offers it to the open canvas. */
  "evidence.fromOutput": { params: { output: DgId; title?: string }; result: NodeSummary };
  "ai.status": { params: Record<string, never>; result: AiStatus };
  /** Answers about a canvas. The words stream as `ai-delta`. */
  "ai.ask": {
    params: { canvas: DgId; question: string; grounded?: DgId[]; requestId: string };
    result: { answer: string; citations: DgId[]; mode: "model" | "search-only"; model?: string; source?: "own" | "lab" | "none"; stopped?: boolean };
  };
  /** Stops an answer that is still arriving. What arrived is kept. */
  "ai.cancel": { params: { requestId: string }; result: null };
  /** The setup, without the key: only whether one is kept and its last four characters. */
  "ai.settings": { params: Record<string, never>; result: AiSettings };
  /** `key` saves a key for the provider, and null removes it. The key is never sent back. */
  "ai.configure": {
    params: { source?: AiSource; provider?: AiProviderKind; model?: string; baseUrl?: string; route?: AiRoute; key?: string | null };
    result: AiSettings;
  };
  /** The models a key can use. With no key given, the saved one is used. */
  "ai.models": { params: { provider?: AiProviderKind; baseUrl?: string; key?: string }; result: AiModel[] };
  "ai.test": { params: Record<string, never>; result: { ok: boolean; message: string; model?: string } };
  "identity.get": { params: Record<string, never>; result: IdentityView };
  "lab.create": { params: { name: string }; result: IdentityView };
  "lab.join": { params: Record<string, never>; result: IdentityView };
  "identity.setName": { params: { name: string }; result: IdentityView };
  "focus.get": { params: Record<string, never>; result: DgId | null };
  /** Selecting a card moves focus, so other surfaces can follow it. */
  "focus.set": { params: { node: DgId | null }; result: null };
};

export type SurfaceMethod = keyof SurfaceMethods;

export type SurfaceRequest<M extends SurfaceMethod = SurfaceMethod> = {
  id: string;
  method: M;
  params: SurfaceMethods[M]["params"];
};

export type SurfaceResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: HostError };

export type SurfaceEvent =
  | { event: "graph-changed" }
  | { event: "holon-focus-changed"; ref: HolonRef | null; canvas: DgId | null }
  | { event: "highlight"; units: DgId[]; brief?: boolean }
  | { event: "prefs-changed"; prefs: Prefs }
  | { event: "focus-changed"; node: DgId | null }
  | { event: "appearance-changed"; appearance: Appearance; skin: Skin }
  | { event: "place-node"; node: DgId }
  /** Units just put on a canvas from another panel, so that canvas can bring them into view. */
  | { event: "units-placed"; canvas: DgId; units: DgId[] }
  | { event: "reveal-unit"; canvas: DgId; unit: DgId }
  /** The search panel takes this search, from the quick finder or a command. */
  | { event: "search-set"; query: SearchCarry }
  /** Notes have been read, so a search can now match their text. */
  | { event: "search-ready" }
  /** Scroll an open reader to a unit's passage. */
  | { event: "pdf-reveal"; ref: string; unit: DgId }
  | { event: "pdf-follow"; unit: DgId }
  /** Progress on something slow, such as an extraction. */
  | { event: "job-status"; message: string }
  | { event: "ai-delta"; requestId: string; text: string }
  /** The model setup changed, in a panel or in the base's settings. */
  | { event: "ai-changed" }
  /** Asks where something sits in a surface, for a walkthrough to point at it. */
  | { event: "locate"; selector: string; requestId: number };

/** A surface's answer to "locate", in frame coordinates. */
export type SurfaceLocated = {
  event: "located";
  requestId: number;
  surface: string;
  box: { x: number; y: number; width: number; height: number } | null;
};

export type SurfaceMessage = SurfaceRequest | SurfaceResponse | SurfaceEvent | SurfaceLocated;

/** A MessagePort today. A socket can stand in for the optional browser tab. */
export type SurfacePort = {
  send: (message: SurfaceMessage) => void;
  onMessage: (listener: (message: SurfaceMessage) => void) => () => void;
};
