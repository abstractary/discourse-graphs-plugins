import type {
  AnchorRecord,
  Author,
  CanvasRecord,
  DgId,
  DgRecord,
  FoldedGraph,
  HostRef,
  LabRecord,
  NodeRecord,
  NodeTypeRecord,
  RelationTypeRecord,
} from "@dg/contract/records.ts";
import type { Asset, Host, HostInfo, Result } from "@dg/contract/host.ts";
import type { Services } from "@dg/contract/services.ts";
import type { Credit, NodeSummary, SurfaceEvent, SurfaceMethod, SurfaceMethods, Prefs } from "@dg/contract/surface.ts";

export type Handlers = {
  [M in SurfaceMethod]: (params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;
};

export type Stamp = { space: string; by: Author; lab?: string };

/**
 * What one feature lets the others use. A feature puts its part here when it is made, and whoever
 * needs it reads it when called, so the order features are made in doesn't matter. A part that
 * isn't there yet reads as absent.
 */
export type Offers = {
  /** Sign-offs on a unit. */
  checks?: {
    stateOf: (unit: DgId) => import("@dg/contract/surface.ts").CheckState | undefined;
    checksOf: (unit: DgId) => import("@dg/contract/surface.ts").UnitCheck[];
    standing: (unit: DgId) => import("@dg/contract/records.ts").EvaluationRecord[];
  };
  prefs?: () => Promise<Prefs>;
  /** The note of this unit or canvas came to the front. */
  followNote?: (node: DgId) => unknown;
  /** A text in the base changed, or went. */
  textChanged?: (ref: HostRef, gone?: boolean) => void;
};

/**
 * What a feature gets from the core. Features add behavior without reaching into
 * each other, and only the core itself holds the graph.
 */
export type Context = {
  host: Host;
  info: HostInfo;
  services: Services | undefined;
  localSpace: string;
  titleFormat: ((abbreviation: string) => string) | undefined;
  graph: () => FoldedGraph;
  /** Every record read so far, every version of each: the log, for history and diffs. */
  records: () => DgRecord[];
  documents: <K extends DgRecord["kind"]>(kind: K) => Extract<DgRecord, { kind: K }>[];
  put: (records: DgRecord[]) => Promise<void>;
  stamp: () => Stamp;
  me: () => Author;
  nodeOf: (id: DgId) => NodeRecord | undefined;
  canvasOf: (id: DgId) => CanvasRecord | undefined;
  typeOf: (id: DgId | undefined) => NodeTypeRecord | undefined;
  relationTypeOf: (id: DgId) => RelationTypeRecord | undefined;
  nodeTypes: () => NodeTypeRecord[];
  relationTypes: () => RelationTypeRecord[];
  summarize: (node: NodeRecord) => NodeSummary;
  creditFor: (record: { by: Author; lab?: string }) => Credit;
  myLab: () => LabRecord | undefined;
  /** The lab a record was made in. */
  labOf: (record: { lab?: string }) => LabRecord | undefined;
  /** A person's current name, so work done before they set one reads correctly too. */
  nameOf: (author: Author) => string;
  /** A relation type's label, as read from source to target. */
  relationLabel: (type: DgId) => string;
  /** Every text in this base that belongs to a unit or canvas. */
  anchors: () => Iterable<AnchorRecord>;
  anchorOf: (node: DgId) => AnchorRecord | undefined;
  /** The unit or canvas a text in this base belongs to. */
  anchoredAt: (ref: HostRef) => DgId | undefined;
  hasLiveText: (ref: HostRef) => boolean;
  makeCanvas: (title: string, fields?: Parameters<typeof import("@dg/contract/records.ts").createCanvas>[0]["fields"]) => Promise<CanvasRecord>;
  send: (event: SurfaceEvent) => void;
  /** This device's preferences. */
  prefs: () => Promise<Prefs>;
  /**
   * A file by its ref, wherever it lives: in the base, or in the reference library when the ref says so.
   * A library's file is read where the library keeps it and never copied.
   */
  readFile: (ref: string) => Promise<Result<Asset>>;
  offers: Offers;
  /** Runs after every change to the graph, before panels are told. */
  afterChange: (run: () => void) => void;
  getLocal: (key: string) => Promise<unknown>;
  setLocal: (key: string, value: unknown) => Promise<void>;
};
