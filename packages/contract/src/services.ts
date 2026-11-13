import type { AiCall } from "./llm.ts";
import type { DgRecord } from "./records.ts";
import type { Identifier, LibraryAnnotation, LibraryFile, LibraryItem, LibraryStatus, Notification, NotificationSummary, Signposts, WorkMetadata } from "./scholarly.ts";

/**
 * What the plugins can ask of a server, as listed in docs/services.md. Core
 * depends on this shape and never on the network, so it runs the same with a
 * real server, a test double, or none at all.
 */
/** `lab` is a server the lab offers its members, inherited from the lab's settings. */
export type ServerKind = "local" | "managed" | "custom" | "lab";

export type ComputeServer = { id: string; name: string; url: string; kind: ServerKind };

export type ServerInfo = {
  name: string;
  kind: ServerKind;
  version: string;
  demo?: boolean;
  ai?: { mode: "model" | "search-only"; model?: string };
};

export type ServerOption = { id: string; label: string; description?: string; default?: boolean };

export type ExtractedNode = {
  id: string;
  type: string;
  text: string;
  description?: string;
  doi?: string;
  url?: string;
  anchor?: string;
};

export type ExtractedEdge = { relation: string; subject: string; object: string; anchor?: string };

export type ExtractionGraph = {
  source?: string;
  models?: string[];
  paper?: { title?: string; doi?: string; url?: string; license?: string; authors?: { name: string }[] };
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type Person = { did: string; name: string };

export type LabLink = {
  server: string;
  id: string;
  name: string;
  token?: string;
  tokenKind?: "personal" | "team";
  role?: "admin" | "member";
  /** Waiting on the lab's decision. */
  pending?: { requestId: string; secret: string };
};

export type JoinRequest = { id: string; person: Person; at: string };

export type LabMember = Person & { role: "admin" | "member"; tokenKind?: string };

/** A standing invitation. Whoever holds its code joins at once. The code is shown only when it is made. */
export type LabInvite = { id: string; createdAt?: string; expiresAt: string; usesLeft: number; code?: string };

export type LabPaper = {
  id: string;
  title: string;
  doi?: string;
  filename: string;
  model: string;
  schema: string;
  server: string;
  canvas: string;
  uploadedBy: Person;
  extractedBy: Person;
  uploadedAt: string;
  hasFile: boolean;
  breadcrumbs: (Person & { at: string })[];
};

export type AiUnit = { id: string; type: string; title: string; description?: string; anchor?: string; paper?: string };

export type AiAnswer = {
  answer: string;
  citations: string[];
  mode: "model" | "search-only";
  model?: string;
};

export type Services = {
  servers: () => Promise<ComputeServer[]>;
  addServer: (server: Omit<ComputeServer, "id">) => Promise<ComputeServer>;
  removeServer: (id: string) => Promise<void>;
  check: (url: string) => Promise<ServerInfo>;
  models: (url: string) => Promise<ServerOption[]>;
  schemas: (url: string) => Promise<ServerOption[]>;
  extract: (args: {
    url: string;
    filename: string;
    mediaType: string;
    dataBase64?: string;
    text?: string;
    model: string;
    schema: string;
    onStatus: (message: string) => void;
  }) => Promise<ExtractionGraph>;
  /** Refuses without a DOI. The file itself never goes here. */
  storeGraph: (args: { doi: string; graph: ExtractionGraph; schema: string; model: string }) => Promise<void>;

  link: () => Promise<LabLink | null>;
  saveLink: (link: LabLink | null) => Promise<void>;
  createLab: (args: { server: string; name: string; person: Person; labDid: string }) => Promise<LabLink>;
  findLab: (args: { server: string; id: string }) => Promise<{ id: string; name: string }>;
  requestToJoin: (args: { server: string; id: string; person: Person }) => Promise<LabLink>;
  /** Asks whether a request was decided. Returns the updated link. */
  checkRequest: (link: LabLink) => Promise<{ link: LabLink | null; state: "pending" | "accepted" | "declined" }>;
  requests: (link: LabLink) => Promise<JoinRequest[]>;
  decide: (link: LabLink, args: { requestId: string; decision: "accept" | "decline"; tokenKind?: "personal" | "team" }) => Promise<void>;
  members: (link: LabLink) => Promise<LabMember[]>;

  pushRecords: (link: LabLink, records: DgRecord[]) => Promise<void>;
  /** `now` is the server's own time, so a device can tell when its clock is off. */
  pullRecords: (link: LabLink, after?: string) => Promise<{ records: DgRecord[]; next?: string; done: boolean; now?: string }>;
  invite: (link: LabLink, args: { uses?: number; days?: number }) => Promise<LabInvite>;
  invites: (link: LabLink) => Promise<LabInvite[]>;
  revokeInvite: (link: LabLink, id: string) => Promise<void>;
  acceptInvite: (args: { server: string; id: string; code: string; person: Person }) => Promise<LabLink>;
  removeMember: (link: LabLink, did: string) => Promise<void>;
  /** The lab this device was removed from, once, so the person can be told. */
  removedFrom: () => Promise<string | null>;
  /** The person has read that they were removed. */
  forgetRemoved: () => Promise<void>;

  uploadPaper: (
    link: LabLink,
    args: { paper: Omit<LabPaper, "uploadedAt" | "hasFile" | "breadcrumbs">; graph: ExtractionGraph; fileBase64?: string; mediaType?: string },
  ) => Promise<void>;
  labPapers: (link: LabLink) => Promise<LabPaper[]>;
  paperFile: (link: LabLink, paper: string) => Promise<{ name: string; mediaType: string; dataBase64: string }>;
  leaveBreadcrumb: (link: LabLink, args: { paper: string; person: Person }) => Promise<void>;

  ask: (args: {
    link: LabLink;
    question: string;
    units: AiUnit[];
    grounded?: string[];
    /** A person's own model, called by the lab's server with their key. The server uses it for this one question and keeps nothing. */
    provider?: AiCall;
    onDelta: (text: string) => void;
  }) => Promise<AiAnswer>;

  /**
   * Reads one published work from the open registries: Crossref or DataCite
   * (whichever registered its DOI), OpenAlex and PubMed, plus the landing
   * page's own Signposting links. Only identifiers and a title are sent.
   * Never throws for a service that is down: `services` says how each went.
   */
  lookupWork: (args: { identifiers: Identifier[]; title?: string }) => Promise<WorkMetadata>;
  /** What a landing page says about itself in its `Link` headers and linkset. */
  signposts: (url: string) => Promise<Signposts>;
  /** Posts one COAR Notify notification to an LDN inbox. Only ever called on a person's own click. */
  sendNotification: (args: { inbox: string; notification: Notification }) => Promise<{ status: number; location?: string }>;
  /**
   * The person's Zotero library, read from the Zotero app on this computer. Reads only: nothing
   * here changes the library. Every call is made because the person asked for it.
   */
  zotero: {
    status: () => Promise<LibraryStatus>;
    /** Top-level items whose title, creators or year match. */
    search: (args: { text: string; limit?: number }) => Promise<LibraryItem[]>;
    item: (args: { ref: string }) => Promise<LibraryItem>;
    /** Every annotation on every file of one item, in reading order. */
    annotations: (args: { ref: string }) => Promise<LibraryAnnotation[]>;
    /** Every PDF the library holds, newest first, each with the reference it belongs to. */
    files: (args?: { limit?: number }) => Promise<LibraryFile[]>;
    /** One PDF, by its attachment's address: where it is now, and the reference it belongs to. */
    file: (args: { ref: string }) => Promise<LibraryFile>;
    /** The group libraries this person belongs to, for a PI to pick the lab's shelf from. */
    groups: () => Promise<{ id: string; name: string }[]>;
  };
  /**
   * A repository draft for a crate, on Zenodo. Only ever called on a person's own click. `open` starts a
   * draft with its metadata and reserves a DOI; `upload` adds one file to it. Neither publishes.
   */
  deposit: {
    open: (args: { server: string; token: string; metadata: Record<string, unknown> }) => Promise<{ id: string; bucket: string; page: string; doi?: string }>;
    upload: (args: { bucket: string; token: string; name: string; bytes: Uint8Array }) => Promise<{ checksum?: string; size?: number }>;
  };
  /** The notifications a server's inbox holds, newest first. `about` narrows to one work or unit by its IRI. */
  notifications: (args: { server: string; about?: string }) => Promise<NotificationSummary[]>;
};
