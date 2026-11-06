import type { BaseNodeType, DgId, HostRef, NodeTypeRecord } from "./records.ts";
import type { Result } from "./host.ts";
import type { SurfacePort } from "./surface.ts";

export type CaptureRequest = {
  text: string;
  /** Absent when the person hasn't chosen a type yet. */
  type?: DgId;
};

export type Captured = { node: DgId; ref: HostRef; title: string };

export type LinkBadge = {
  node: DgId;
  /** Active relations only, so a withdrawn or declined one doesn't count. */
  count: number;
  typeLabel?: string;
  base?: BaseNodeType;
  /** The node type's own color, when it has one. */
  color?: string;
};

/** What a walkthrough made, so it can take exactly that back out. */
export type Examples = {
  texts: HostRef[];
  nodes: DgId[];
  relations: DgId[];
  canvases: DgId[];
};

/** What the adapter's native UI calls. The panel is not involved in any of it. */
export type CoreForAdapter = {
  stop: () => void;
  nodeTypes: () => NodeTypeRecord[];
  capture: (request: CaptureRequest) => Promise<Result<Captured>>;
  /** Turns the editor's selection into a node, and leaves a link in its place. */
  captureSelection: (args: { type?: DgId }) => Promise<Result<Captured>>;
  /** Makes the page in focus a node, and gives it the type's title format. */
  convertFocused: (args: { type?: DgId }) => Promise<Result<Captured>>;
  /**
   * Synchronous because badges render inside the editor's draw path. Returns
   * null when the ref isn't a discourse node, or badges are turned off.
   */
  badgeFor: (args: { ref: HostRef }) => LinkBadge | null;
  /** Opens the context panel on this text's node, and leaves the page where it is. */
  showContext: (args: { ref: HostRef }) => Promise<Result<null>>;
  /** Stored per device. Returns whether badges now show. */
  toggleBadges: () => Promise<boolean>;
  /** Synchronous, for reacting as a page or note opens. */
  canvasOfRef: (args: { ref: HostRef }) => DgId | null;
  /** The page or note that holds a canvas in this base, made if it's missing. */
  canvasHome: (args: { id: DgId }) => Promise<Result<HostRef>>;
  canvasTitle: (args: { id: DgId }) => string | null;
  createCanvas: (args: { title: string }) => Promise<Result<DgId>>;
  /** The last canvas used here, or else the newest one. */
  usualCanvas: () => Promise<DgId | null>;
  /** The node the context panel is following. */
  focusedNode: () => DgId | null;
  /** The name shown beside this person's work. */
  setName: (name: string) => Promise<void>;
  personName: () => string;
  /** Places nodes on a canvas as cards. */
  addToCanvas: (args: { canvas: DgId; nodes: DgId[] }) => Promise<void>;
  /** Asserts a relation the grammar allows, and draws it on a canvas. */
  relateOnCanvas: (args: {
    canvas: DgId;
    source: DgId;
    target: DgId;
    base?: string;
  }) => Promise<Result<DgId>>;
  /** Called as a canvas closes, so a lab paper can offer a breadcrumb. */
  canvasClosed: (args: { id: DgId }) => Promise<void>;
  /** A person chose to leave a breadcrumb, or how to answer from now on. */
  answerBreadcrumb: (args: { paper: string; leave: boolean; remember?: boolean }) => Promise<void>;
  /** Takes back what a walkthrough made. Anything else stays. */
  removeExamples: (examples: Examples) => Promise<void>;
  /** Asks a surface where something is. Null when it isn't showing. */
  locate: (args: {
    surface: string;
    selector: string;
  }) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  onGraphChange: (listener: () => void) => () => void;
  connectSurface: (args: {
    port: SurfacePort;
    onReport?: (report: unknown) => void;
  }) => () => void;
};
