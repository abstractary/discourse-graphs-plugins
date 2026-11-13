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
import type { Host, HostInfo } from "@dg/contract/host.ts";
import type { Services } from "@dg/contract/services.ts";
import type { Credit, NodeSummary, SurfaceEvent, SurfaceMethod, SurfaceMethods } from "@dg/contract/surface.ts";

export type Handlers = {
  [M in SurfaceMethod]: (params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;
};

export type Stamp = { space: string; by: Author; lab?: string };

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
  anchorOf: (node: DgId) => AnchorRecord | undefined;
  /** The unit or canvas a text in this base belongs to. */
  anchoredAt: (ref: HostRef) => DgId | undefined;
  hasLiveText: (ref: HostRef) => boolean;
  makeCanvas: (title: string, fields?: Parameters<typeof import("@dg/contract/records.ts").createCanvas>[0]["fields"]) => Promise<CanvasRecord>;
  send: (event: SurfaceEvent) => void;
  getLocal: (key: string) => Promise<unknown>;
  setLocal: (key: string, value: unknown) => Promise<void>;
};
