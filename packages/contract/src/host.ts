import type { Author, DgId, DgRecord, HostRef, Json, SpaceId } from "./records.ts";

export const CONTRACT_VERSION = 1;

export type HostErrorCode =
  | "not-found"
  | "invalid"
  | "conflict"
  | "no-target"
  | "read-only"
  | "unavailable";

export type HostError = {
  code: HostErrorCode;
  message: string;
  /** On `conflict`, the existing unit the caller collided with. */
  ref?: HostRef;
};

/** Host calls never reject. Failure is a value, so it can cross a message channel. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: HostError };

export type Cursor = string;
/**
 * `next` is always present, including on the last page. Keeping it and passing
 * it later returns what was written since. Reads are at-least-once: a host may
 * repeat records after a cursor, but it must never miss one.
 */
export type Page<T> = { items: T[]; next: Cursor; done: boolean };

export type Appearance = "light" | "dark";

/** A base's look. A frame can't read the base's CSS, so the adapter passes it on. */
export type Skin = {
  /** Font stack for controls. */
  font: string;
  /** Font stack for reading. */
  textFont: string;
  /** Control text size, in px. */
  size: number;
  ink: string;
  muted: string;
  page: string;
  panel: string;
  line: string;
  accent: string;
  /** Corner radius, in px. */
  radius: number;
};

export type HostInfo = {
  contract: typeof CONTRACT_VERSION;
  /** For example `roam` or `obsidian`. Surfaces must never branch on this. */
  host: string;
  adapterVersion: string;
  /** Stored in the space, so renaming a graph or vault doesn't change it. */
  space: { id: SpaceId; name: string };
  person: Author;
  appearance: Appearance;
  skin: Skin;
  /** True when other people write to this space, such as a Roam team graph. */
  sharedSpace: boolean;
  /**
   * True where every unit should have a text of its own, so the base's links,
   * search and graph reach all of them. Core then makes the missing ones.
   */
  textForEveryUnit?: boolean;
};

export type TextScope = "page" | "part";

export type TextSummary = {
  ref: HostRef;
  title: string;
  modifiedAt: string;
  /** `page` is a Roam page or Obsidian file; `part` is a block or heading. */
  scope: TextScope;
};

export type TextUnit = TextSummary & {
  /** Markdown. The adapter flattens Roam blocks and resolves embeds. */
  body: string;
  tags: string[];
  links: HostRef[];
};

export type Asset = { name: string; mime: string; dataUrl: string };
export type AssetRef = string;

/** A file the base holds, such as a PDF in a vault. `ref` reads it back with `readAsset`. */
export type FileSummary = {
  ref: AssetRef;
  /** With its extension. */
  name: string;
  mime: string;
  /** Where it sits in the base, for grouping. Absent at the top. */
  folder?: string;
  size?: number;
  modifiedAt?: string;
};

export type Placement = "main" | "side" | "dialog";
export type SurfaceName =
  | "canvas"
  | "canvases"
  /** The holon explorer, for holons without a canvas yet. `id` is `<level>|<id>` or `unit|<id>`. */
  | "holon"
  /** A side panel with the boundary of whichever holon is in focus. */
  | "boundary"
  /** A PDF reader. `id` is the file's asset ref; none shows the choice of PDFs. */
  | "pdf"
  /** Unit search, in a side panel. */
  | "search"
  /** The quick finder, in a pop-up: find a unit, then open it, link it or put it on the canvas. */
  | "find"
  | "context"
  | "upload"
  /** Bringing a source and its highlights in from Zotero. `id` is the canvas to put them on. */
  | "zotero"
  | "welcome"
  | "node"
  | "view"
  | "grammar"
  | "run"
  /** A person's profile. `id` is their DID; none is the viewer's own. */
  | "profile"
  /** Papers laid out by how far they have been worked into each other. `id` is a canvas to open on. */
  | "papers"
  | "check";
export type SurfaceRoute = {
  surface: SurfaceName;
  id?: DgId;
  /** The surface belongs to one page, so going elsewhere means leaving that page. */
  pinned?: boolean;
};

/**
 * Hints that something changed, never the change itself. They can be merged or
 * arrive late, and the host's own writes produce them too, so a listener always
 * re-reads. That gives teammates, file sync and hand edits a single path.
 */
export type HostEvent =
  | { type: "text-changed"; ref: HostRef }
  | { type: "text-renamed"; ref: HostRef; title: string }
  | { type: "text-removed"; ref: HostRef }
  | { type: "records-changed" }
  | { type: "focus-changed"; ref: HostRef | null }
  | { type: "appearance-changed"; appearance: Appearance; skin: Skin };

export type HostListener = (event: HostEvent) => void;

/**
 * What a base must provide. Everything else a plugin does is either native UI
 * or private to its adapter. Arguments and results are plain JSON, except the
 * listener and unsubscribe function, so core could later run across a socket.
 */
export type Host = {
  describe: () => Promise<Result<HostInfo>>;

  listText: (args: {
    after?: Cursor;
    limit: number;
  }) => Promise<Result<Page<TextSummary>>>;
  readText: (args: { ref: HostRef }) => Promise<Result<TextUnit>>;
  searchText: (args: {
    query?: string;
    tag?: string;
    limit: number;
  }) => Promise<Result<TextSummary[]>>;
  listBacklinks: (args: { ref: HostRef }) => Promise<Result<TextSummary[]>>;
  /** Returns the title actually stored, since hosts restrict characters. */
  createText: (args: {
    title: string;
    body?: string;
    /** Stored in the text itself, so a node and its text can always find each other. */
    unit?: DgId;
  }) => Promise<Result<TextSummary>>;
  renameText: (args: {
    ref: HostRef;
    title: string;
  }) => Promise<Result<TextSummary>>;
  /**
   * Makes a ref survive renames and moves, including ones made while the plugin
   * isn't running. Refs from `createText` are already pinned. Refs from
   * `listText` may not be, and the returned ref replaces the one passed in.
   */
  pinText: (args: { ref: HostRef; unit?: DgId }) => Promise<Result<TextSummary>>;
  /** Uses the base's trash where it has one, so a person can still get it back. */
  removeText: (args: { ref: HostRef }) => Promise<Result<null>>;
  /** Groups text the base's own way: a folder in a vault, a page of links in a graph. */
  fileInFolder: (args: { ref: HostRef; folder: string }) => Promise<Result<null>>;

  /** Keeps a file a person asked for, wherever their base keeps files. Says where it went. */
  saveFile: (args: { name: string; mediaType: string; dataBase64: string }) => Promise<Result<{ where: string }>>;

  /** May return several versions of a document. `foldRecords` picks the winner. */
  listRecords: (args: {
    after?: Cursor;
    limit: number;
  }) => Promise<Result<Page<DgRecord>>>;
  /** All or nothing. Writing an identical record again stores nothing. */
  putRecords: (args: {
    records: DgRecord[];
  }) => Promise<Result<{ stored: number }>>;

  readAsset: (args: { ref: AssetRef }) => Promise<Result<Asset>>;
  /** Keeps an asset where the base can read it back. A document goes where a person would look for it. */
  writeAsset: (args: { asset: Asset }) => Promise<Result<{ ref: AssetRef }>>;
  /** Files of these kinds, by extension without the dot, such as `pdf`. Newest first. */
  listFiles: (args: { extensions: string[]; limit: number }) => Promise<Result<FileSummary[]>>;

  getFocus: () => Promise<Result<{ ref: HostRef | null }>>;
  reveal: (args: {
    ref: HostRef;
    placement: Placement;
  }) => Promise<Result<null>>;
  /** Uses the last cursor in the base, because a panel click takes focus away. */
  insertLink: (args: {
    ref: HostRef;
    label?: string;
  }) => Promise<Result<null>>;
  /**
   * Shows a text's relations as the base's own links, so its backlinks, graph
   * and renames follow them. `links` maps a relation's wording to the texts at
   * the other end. Every name in `managed` that `links` leaves out is cleared.
   * One-way: the records stay the source, and a hand edit is put back.
   */
  setLinks: (args: {
    ref: HostRef;
    links: Record<string, HostRef[]>;
    managed: string[];
    /**
     * Plain facts about the unit, such as its type and the day it was made, written beside the links
     * so the base's own tables can sort and filter by them. Every name in `managedFacts` that `facts`
     * leaves out is cleared. One-way, like the links.
     */
    facts?: Record<string, string>;
    managedFacts?: string[];
  }) => Promise<Result<{ written: boolean }>>;
  /**
   * A table of every text whose `property` is `value`, made with the base's own table tool and opened.
   * Absent where the base has none. Making it again opens the one already there.
   */
  openTable?: (args: { name: string; property: string; value: string; columns: { property: string; label: string }[] }) => Promise<Result<{ where: string }>>;
  /** What's selected in the base's editor, or null when nothing is. */
  readSelection: () => Promise<Result<{ text: string } | null>>;
  /** Swaps the selection for a link to this text, in the base's own link form. */
  replaceSelection: (args: { ref: HostRef }) => Promise<Result<null>>;
  openSurface: (args: {
    route: SurfaceRoute;
    placement: Placement;
  }) => Promise<Result<null>>;
  closeDialog: () => Promise<Result<null>>;
  /** Opens a web address in the person's own browser. Only `http` and `https` addresses arrive here. */
  openLink: (args: { url: string }) => Promise<Result<null>>;

  /** Per-device state that is neither shared nor synced: caches, usage log. */
  getLocal: (args: { key: string }) => Promise<Result<Json>>;
  setLocal: (args: { key: string; value: Json }) => Promise<Result<null>>;

  subscribe: (listener: HostListener) => () => void;
};

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

type HostCall = (args?: unknown) => Promise<Result<unknown>>;

/**
 * Keeps the promise that host calls never reject, whatever the base throws.
 * Roam's write rate limit, for example, arrives as a thrown error.
 */
export const neverRejects = (host: Host): Host => {
  const guarded: Record<string, unknown> = { subscribe: host.subscribe };
  for (const [name, call] of Object.entries(host)) {
    if (name === "subscribe") continue;
    guarded[name] = async (args?: unknown): Promise<Result<unknown>> => {
      try {
        return await (call as HostCall)(args);
      } catch (error) {
        return {
          ok: false,
          error: { code: "unavailable", message: String(error) },
        };
      }
    };
  }
  return guarded as Host;
};

export const fail = (
  code: HostErrorCode,
  message: string,
  ref?: HostRef,
): { ok: false; error: HostError } => ({
  ok: false,
  error: { code, message, ...(ref === undefined ? {} : { ref }) },
});
