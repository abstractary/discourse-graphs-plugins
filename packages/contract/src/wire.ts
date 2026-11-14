/**
 * What crosses between the client and a server, written once: the body each route takes and
 * the JSON it answers with. `routes.ts` says where a route is, and this file says what goes
 * over it. The `Wire` type at the end pairs every route name with its shapes.
 *
 * The client in `@dg/sync` types its calls with these. The reference server stands alone and
 * imports nothing from here, so `scripts/gen-routes.mjs` copies this file whole into
 * `server/src/wire.gen.ts`. That is why this file imports nothing: every type it needs is
 * written here. After a change, run `npm run gen:routes`. `npm run check:routes` fails when
 * the copy is behind.
 *
 * Each shape says what the reference server really sends, and what it really takes. Where the
 * server takes more than the plugins ever send, the comment says so.
 */

// ---- Shared parts ----

export type Person = { did: string; name: string };

export type TokenKind = "personal" | "team";

export type LabRole = "admin" | "member";

/** Id and name of a lab: all that is told to someone who is not a member yet. */
export type LabName = { id: string; name: string };

/** What a server says it is. A server never calls itself `lab`: that is a name the plugins give one they got from a lab's settings. */
export type HostKind = "local" | "managed" | "custom";

export type AiMode = "model" | "search-only";

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

/**
 * A graph as it travels. The graph store takes any graph that has `nodes` and `edges`, so
 * the rest is optional here. The server's own extractors always fill in `source`, `models`
 * and `paper.title`.
 */
export type ExtractionGraph = {
  source?: string;
  models?: string[];
  paper?: { title?: string; doi?: string; url?: string; license?: string; authors?: { name: string }[] };
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
};

export type JoinRequest = { id: string; person: Person; at: string };

export type LabMember = Person & { role: LabRole; tokenKind: TokenKind };

type InviteCore = { id: string; expiresAt: string; usesLeft: number };

/** An invitation as it is answered when made: the only time its code is shown. It has no `createdAt` and no `by`. */
export type NewInvite = InviteCore & { code: string };

/** An invitation as the list shows it: when it was made and the did of the admin who made it, and never its code. */
export type ListedInvite = InviteCore & { createdAt: string; by: string };

/** A standing invitation, from either of the two answers above. Whoever holds its code joins at once. */
export type LabInvite = InviteCore & { code?: string; createdAt?: string; by?: string };

export type Breadcrumb = Person & { at: string };

/** What a member sends about a paper they share. The server refuses a paper with no `id`, and keeps the other fields as they come. */
export type SharedPaper = {
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
};

/** A paper as the lab keeps it. `mediaType` is there once a file came with it. */
export type LabPaper = SharedPaper & {
  uploadedAt: string;
  hasFile: boolean;
  breadcrumbs: Breadcrumb[];
  mediaType?: string;
};

/**
 * A unit sent with a question. The server refuses one without an `id` and a `title`, and
 * needs nothing else: `type` may be left out. The plugins always send it. The whole unit
 * goes to the model as it stands.
 */
export type AiUnit = { id: string; type?: string; title: string; description?: string; anchor?: string; paper?: string };

export type AiAnswer = { answer: string; citations: string[]; mode: AiMode; model?: string };

/** The least a server asks of a record before it keeps it. It reads nothing else in one. */
export type WireRecord = { id: string; kind: string; at: string; by: { id: string } };

/** One notification an inbox holds, in the few fields a list needs. `Sent` is the notification exactly as it arrived. */
export type NotificationRow<Sent = Record<string, unknown>> = {
  id: string;
  types: string[];
  /** What it is about: the `object`'s id, or for a relationship its subject and object. */
  about: string[];
  /** The work it concerns, when the notification names one: `context.id`. */
  context?: string;
  from: string;
  actor?: string;
  receivedAt: string;
  notification: Sent;
};

// ---- Compute ----

export type ServerInfo = {
  name: string;
  kind: HostKind;
  version: string;
  demo: boolean;
  ai: { mode: AiMode; model?: string };
};

export type ModelsResponse = { models: ServerOption[] };

export type SchemasResponse = { schemas: ServerOption[] };

/** Send `dataBase64` or `text`. Without `model` or `schema` the server uses its default, and it reads the file's kind from `filename` when `mediaType` is left out. */
export type ExtractRequest = {
  filename: string;
  mediaType?: string;
  dataBase64?: string;
  text?: string;
  model?: string;
  schema?: string;
};

/** One line of the extraction stream. `ping` only keeps a long run's connection open. */
export type ExtractLine =
  | { type: "status"; message: string }
  | { type: "ping" }
  | { type: "result"; data: ExtractionGraph }
  | { type: "error"; message: string; code: string };

// ---- Graph store ----

/** The file itself never goes here: a body with `file`, `fileBase64` or `dataBase64` is refused. */
export type StoreGraphRequest = { doi: string; graph: ExtractionGraph; schema: string; model: string };

/** `stored` is false when this very graph was already kept for this DOI. `doi` is the DOI in its bare, lower-case form. */
export type StoreGraphResponse = { stored: boolean; doi: string };

/** `nodes` and `edges` are counts. `graph` is there only when the list was asked for one DOI. */
export type StoredGraphSummary = {
  doi: string;
  title?: string;
  schema: string;
  model: string;
  storedAt: string;
  nodes: number;
  edges: number;
  graph?: ExtractionGraph;
};

export type ListGraphsResponse = { graphs: StoredGraphSummary[] };

// ---- Notifications ----

/** The front door: the addresses of the info and of the inbox. */
export type RootResponse = { name: string; info: string; inbox: string };

/** The answer to a notification that was taken in: its own id, and where it can be read back. */
export type SendNotificationResponse = { id: string; location: string };

export type NotificationsResponse<Sent = Record<string, unknown>> = { notifications: NotificationRow<Sent>[] };

// ---- Labs ----

export type CreateLabRequest = { name: string; person: Person; labDid?: string };

export type CreateLabResponse = { lab: LabName; token: string };

export type AskToJoinRequest = { person: Person };

export type AskToJoinResponse = { requestId: string; secret: string };

/** `token` and `tokenKind` come only with `accepted`. */
export type PollJoinResponse = { state: "pending" | "accepted" | "declined"; token?: string; tokenKind?: TokenKind };

export type MembersResponse = { members: LabMember[] };

export type RequestsResponse = { requests: JoinRequest[] };

/** Without `tokenKind` the new member gets a personal token. */
export type DecideRequest = { decision: "accept" | "decline"; tokenKind?: TokenKind };

/** `tokenKind` comes only with `accepted`. */
export type DecideResponse = { id: string; state: "accepted" | "declined"; tokenKind?: TokenKind };

/** Without them: one use, seven days, a personal token. */
export type CreateInviteRequest = { uses?: number; days?: number; tokenKind?: TokenKind };

export type CreateInviteResponse = { invite: NewInvite };

export type ListInvitesResponse = { invites: ListedInvite[] };

export type AcceptInviteRequest = { code: string; person: Person };

export type AcceptInviteResponse = { lab: LabName; token: string; tokenKind: TokenKind; role: "member" };

export type RevokeInviteResponse = { id: string };

/** `removed` is the did of the member who was taken out. */
export type RemoveMemberResponse = { removed: string };

// ---- Sync ----

export type PushRecordsRequest<Rec = WireRecord> = { records: Rec[] };

/** `stored` counts the records the lab did not have yet. `now` is the server's own time. */
export type PushRecordsResponse = { stored: number; now: string };

/** `next` is the place to send back as `?after=`. `now` is the server's own time, so a device can tell when its clock is off. */
export type PullRecordsResponse<Rec = WireRecord> = { records: Rec[]; next: number; done: boolean; now: string };

// ---- Lab papers ----

/** `mediaType` is kept only when `fileBase64` comes with it. */
export type UploadPaperRequest = { paper: SharedPaper; graph: ExtractionGraph; fileBase64?: string; mediaType?: string };

export type UploadPaperResponse = { paper: LabPaper };

export type LabPapersResponse = { papers: LabPaper[] };

export type GetPaperResponse = LabPaper & { graph: ExtractionGraph };

export type LeaveBreadcrumbRequest = { person: Person };

export type LeaveBreadcrumbResponse = { breadcrumbs: Breadcrumb[] };

// ---- AI ----

/** A member's own model. The server picks the provider's address itself, uses the key for this one question, and keeps nothing. */
export type AskProvider = { kind: "anthropic" | "openai" | "gemini"; model: string; key: string };

/** `grounded` narrows the units to those ids. Left out or empty, it narrows nothing. */
export type AskRequest = { question: string; units: AiUnit[]; grounded?: string[]; provider?: AskProvider };

/** One line of an answer's stream. The `result` line carries the whole answer again. */
export type AskLine =
  | { type: "status"; message: string }
  | { type: "delta"; text: string }
  | ({ type: "result" } & AiAnswer)
  | { type: "error"; message: string };

// ---- Every route and its shapes ----

/**
 * One line for every route in `routes.ts`, by the same name. `request` is the JSON body it
 * takes, `response` the JSON it answers with, and `stream` one line of an NDJSON answer. A
 * line with nothing takes no body and answers with something that is not JSON of ours: a
 * file, a page, or a notification exactly as it was sent. Query strings are not listed.
 *
 * Keep each route on one line. `scripts/gen-routes.mjs` reads the names from these lines for
 * the table in `docs/services.md`, and fails when a route is missing here or extra.
 */
export type Wire = {
  info: { response: ServerInfo };
  models: { response: ModelsResponse };
  schemas: { response: SchemasResponse };
  extract: { request: ExtractRequest; stream: ExtractLine };

  storeGraph: { request: StoreGraphRequest; response: StoreGraphResponse };
  listGraphs: { response: ListGraphsResponse };

  work: {};

  root: { response: RootResponse };
  sendNotification: { response: SendNotificationResponse };
  notifications: { response: NotificationsResponse };
  inboxOptions: {};
  readNotification: {};

  createLab: { request: CreateLabRequest; response: CreateLabResponse };
  findLab: { response: LabName };
  askToJoin: { request: AskToJoinRequest; response: AskToJoinResponse };
  pollJoin: { response: PollJoinResponse };
  members: { response: MembersResponse };
  requests: { response: RequestsResponse };
  decide: { request: DecideRequest; response: DecideResponse };
  createInvite: { request: CreateInviteRequest; response: CreateInviteResponse };
  listInvites: { response: ListInvitesResponse };
  acceptInvite: { request: AcceptInviteRequest; response: AcceptInviteResponse };
  revokeInvite: { response: RevokeInviteResponse };
  removeMember: { response: RemoveMemberResponse };

  pushRecords: { request: PushRecordsRequest; response: PushRecordsResponse };
  pullRecords: { response: PullRecordsResponse };

  uploadPaper: { request: UploadPaperRequest; response: UploadPaperResponse };
  labPapers: { response: LabPapersResponse };
  getPaper: { response: GetPaperResponse };
  paperFile: {};
  leaveBreadcrumb: { request: LeaveBreadcrumbRequest; response: LeaveBreadcrumbResponse };

  ask: { request: AskRequest; stream: AskLine };
};

export type WireName = keyof Wire;

/** The JSON body a route takes, by the route's name. `never` for a route that takes none. */
export type RequestOf<Name extends WireName> = Wire[Name] extends { request: infer Body } ? Body : never;

/** The JSON a route answers with, by the route's name. `never` for a route that streams or answers with something else. */
export type ResponseOf<Name extends WireName> = Wire[Name] extends { response: infer Answer } ? Answer : never;

/** One line of a route's NDJSON stream, by the route's name. `never` for a route that does not stream. */
export type LineOf<Name extends WireName> = Wire[Name] extends { stream: infer Line } ? Line : never;
