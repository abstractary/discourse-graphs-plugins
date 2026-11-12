import type { ComputeServer, ExtractionGraph, JoinRequest, LabLink, LabMember, LabPaper, ServerInfo, ServerOption } from "./services.ts";
import type {
  BaseNodeType,
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
export type Provenance = {
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
    anchor?: string;
    description?: string;
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

export type AiStatus = { ready: boolean; mode?: "model" | "search-only"; model?: string; why?: string };

export type CanvasSummary = {
  id: DgId;
  title: string;
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

/** How a card's holon opens. Every way also has the card's own "open inside" button. */
export type HolonGesture = "button" | "doubleClick" | "semantic";
/** Per-device choices. */
export type Prefs = { holonGesture: HolonGesture };

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

export type CanvasItemView = { id: DgId; z: number; item: CanvasItem };

export type CanvasView = {
  canvas: CanvasRecord;
  items: CanvasItemView[];
  nodes: Record<DgId, NodeSummary>;
  relations: Record<DgId, { label: string; state: RelationState; kind?: string; credit: Credit }>;
  /** Reactions and notes, by node. Only shared canvases have them. */
  social: Record<DgId, UnitSocial>;
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
  "node.create": {
    params: { title: string; type?: DgId };
    result: NodeSummary;
  };
  "node.setType": { params: { id: DgId; type: DgId }; result: NodeSummary };
  "relation.options": {
    params: { source: DgId; target: DgId };
    result: RelationOption[];
  };
  "relation.assert": {
    params: { type: DgId; source: DgId; target: DgId };
    result: RelationRecord;
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
  "canvas.highlight": { params: { units: DgId[] }; result: null };
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
  /** Opens the reader beside the canvas, at a unit's passage if given. */
  "pdf.show": { params: { ref: string; unit?: DgId }; result: null };
  "canvas.export": { params: { id: DgId }; result: DgCanvas };
  "grammar.get": {
    params: Record<string, never>;
    result: { nodeTypes: NodeTypeRecord[]; relationTypes: RelationTypeRecord[] };
  };
  "base.reveal": { params: { id: DgId; placement: Placement }; result: null };
  /** Opens a panel in the base's side area. */
  "panel.open": { params: { surface: "context" | "canvases" | "boundary" }; result: null };
  /** Opens a pop-up over the base. */
  "dialog.open": { params: { surface: "upload" | "welcome" }; result: null };
  "dialog.close": { params: Record<string, never>; result: null };

  "server.list": { params: Record<string, never>; result: ComputeServer[] };
  "server.add": { params: { name: string; url: string; kind: "local" | "managed" | "custom" }; result: ComputeServer };
  "server.remove": { params: { id: string }; result: null };
  "server.check": { params: { url: string }; result: ServerInfo };
  "server.options": { params: { url: string }; result: { models: ServerOption[]; schemas: ServerOption[] } };

  /** Runs an extraction and makes the paper's canvas. Progress arrives as `job-status`. */
  "paper.extract": {
    params: {
      file: { name: string; mediaType: string; dataBase64: string };
      server: string;
      model: string;
      schema: string;
      share?: { includeFile: boolean };
    };
    result: PaperSummary;
  };
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

  "ai.status": { params: Record<string, never>; result: AiStatus };
  /** Answers about a canvas. The words stream as `ai-delta`. */
  "ai.ask": {
    params: { canvas: DgId; question: string; grounded?: DgId[]; requestId: string };
    result: { answer: string; citations: DgId[]; mode: "model" | "search-only"; model?: string };
  };
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
  | { event: "highlight"; units: DgId[] }
  | { event: "prefs-changed"; prefs: Prefs }
  | { event: "focus-changed"; node: DgId | null }
  | { event: "appearance-changed"; appearance: Appearance; skin: Skin }
  | { event: "place-node"; node: DgId }
  /** Units just put on a canvas from another panel, so that canvas can bring them into view. */
  | { event: "units-placed"; canvas: DgId; units: DgId[] }
  /** Scroll an open reader to a unit's passage. */
  | { event: "pdf-reveal"; ref: string; unit: DgId }
  /** Progress on something slow, such as an extraction. */
  | { event: "job-status"; message: string }
  | { event: "ai-delta"; requestId: string; text: string }
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
