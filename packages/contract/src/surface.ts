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
  "canvas.export": { params: { id: DgId }; result: DgCanvas };
  "grammar.get": {
    params: Record<string, never>;
    result: { nodeTypes: NodeTypeRecord[]; relationTypes: RelationTypeRecord[] };
  };
  "base.reveal": { params: { id: DgId; placement: Placement }; result: null };
  /** Opens a panel in the base's side area. */
  "panel.open": { params: { surface: "context" | "canvases" }; result: null };
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
  | { event: "focus-changed"; node: DgId | null }
  | { event: "appearance-changed"; appearance: Appearance; skin: Skin }
  | { event: "place-node"; node: DgId }
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
