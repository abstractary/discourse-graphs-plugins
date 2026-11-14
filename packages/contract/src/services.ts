import type { AiCall } from "./llm.ts";
import type { DgRecord } from "./records.ts";
import type {
  AiAnswer,
  AiUnit,
  ExtractionGraph,
  HostKind,
  JoinRequest,
  LabMember,
  LabName,
  LabPaper,
  LabRole,
  ListedInvite,
  NewInvite,
  Person,
  PollJoinResponse,
  ServerInfo,
  ServerOption,
  SharedPaper,
  TokenKind,
} from "./wire.ts";
import type { Identifier, LibraryAnnotation, LibraryFile, LibraryItem, LibraryStatus, Notification, NotificationSummary, Signposts, WorkMetadata } from "./scholarly.ts";

/**
 * What the plugins can ask of a server, as listed in docs/services.md. Core
 * depends on this shape and never on the network, so it runs the same with a
 * real server, a test double, or none at all.
 */
/** `lab` is a server the lab offers its members, inherited from the lab's settings. A server never says it of itself. */
export type ServerKind = HostKind | "lab";

export type ComputeServer = { id: string; name: string; url: string; kind: ServerKind };

/**
 * The shapes a server sends and takes are written once, in `wire.ts`, next to the route table.
 * They are handed on from here under the names the rest of the code already uses.
 */
export type {
  AiAnswer,
  AiUnit,
  ExtractedEdge,
  ExtractedNode,
  ExtractionGraph,
  HostKind,
  JoinRequest,
  LabInvite,
  LabMember,
  LabPaper,
  ListedInvite,
  NewInvite,
  Person,
  ServerInfo,
  ServerOption,
  SharedPaper,
} from "./wire.ts";

export type LabLink = {
  server: string;
  id: string;
  name: string;
  token?: string;
  tokenKind?: TokenKind;
  role?: LabRole;
  /** Waiting on the lab's decision. */
  pending?: { requestId: string; secret: string };
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
  findLab: (args: { server: string; id: string }) => Promise<LabName>;
  requestToJoin: (args: { server: string; id: string; person: Person }) => Promise<LabLink>;
  /** Asks whether a request was decided. Returns the updated link. */
  checkRequest: (link: LabLink) => Promise<{ link: LabLink | null; state: PollJoinResponse["state"] }>;
  requests: (link: LabLink) => Promise<JoinRequest[]>;
  decide: (link: LabLink, args: { requestId: string; decision: "accept" | "decline"; tokenKind?: TokenKind }) => Promise<void>;
  members: (link: LabLink) => Promise<LabMember[]>;

  pushRecords: (link: LabLink, records: DgRecord[]) => Promise<void>;
  /** `now` is the server's own time, so a device can tell when its clock is off. */
  pullRecords: (link: LabLink, after?: string) => Promise<{ records: DgRecord[]; next?: string; done: boolean; now?: string }>;
  /** The new invitation, with its code: the only time the code is shown. */
  invite: (link: LabLink, args: { uses?: number; days?: number }) => Promise<NewInvite>;
  /** The invitations that still work, each with when it was made and who made it, and without its code. */
  invites: (link: LabLink) => Promise<ListedInvite[]>;
  revokeInvite: (link: LabLink, id: string) => Promise<void>;
  acceptInvite: (args: { server: string; id: string; code: string; person: Person }) => Promise<LabLink>;
  removeMember: (link: LabLink, did: string) => Promise<void>;
  /** The lab this device was removed from, once, so the person can be told. */
  removedFrom: () => Promise<string | null>;
  /** The person has read that they were removed. */
  forgetRemoved: () => Promise<void>;

  uploadPaper: (
    link: LabLink,
    args: { paper: SharedPaper; graph: ExtractionGraph; fileBase64?: string; mediaType?: string },
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
