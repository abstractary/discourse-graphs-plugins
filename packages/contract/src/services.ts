import type { DgRecord } from "./records.ts";

/**
 * What the plugins can ask of a server, as listed in docs/services.md. Core
 * depends on this shape and never on the network, so it runs the same with a
 * real server, a test double, or none at all.
 */
export type ServerKind = "local" | "managed" | "custom";

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
  paper?: { title?: string; doi?: string; authors?: { name: string }[] };
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
  pullRecords: (link: LabLink, after?: string) => Promise<{ records: DgRecord[]; next?: string; done: boolean }>;

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
    onDelta: (text: string) => void;
  }) => Promise<AiAnswer>;
};
