/**
 * Every route of the services API, written once.
 *
 * The client in `@dg/sync` builds its addresses from this table. The reference server stands
 * alone and imports nothing from here, so `scripts/gen-routes.mjs` copies the table into
 * `server/src/routes.gen.ts` and into the route table of `docs/services.md`. After a change
 * here, run `npm run gen:routes`. `npm run check:routes` fails when either copy is behind.
 *
 * A path template names its parts with `:name`. A last part written `*name` takes the rest of
 * the path, slashes included, because a DOI has a slash in it. Query strings are not part of a
 * template: the caller adds them.
 *
 * What each route takes and answers with is in `wire.ts`, under the same names.
 */
import type { Wire } from "./wire.ts";

export type RouteMethod = "GET" | "POST" | "DELETE" | "OPTIONS";

export type RouteGroup = "Compute" | "Graph store" | "Landing pages" | "Notifications" | "Labs" | "Sync" | "Lab papers" | "AI";

export type RouteEntry = {
  method: RouteMethod;
  path: string;
  group: RouteGroup;
  /** One line, for the docs. */
  description: string;
  /**
   * `false` when the client never builds this address from the table: the server answers it,
   * and whoever calls it found the address another way or is not this client.
   */
  client: boolean;
};

export const ROUTES = {
  // Compute
  info: { method: "GET", path: "/v1/info", group: "Compute", client: true, description: "Name, kind and version of the server, and whether it can answer with a model" },
  models: { method: "GET", path: "/v1/models", group: "Compute", client: true, description: "The models the server can extract with" },
  schemas: { method: "GET", path: "/v1/schemas", group: "Compute", client: true, description: "The schemas the server can extract into" },
  extract: { method: "POST", path: "/v1/extract", group: "Compute", client: true, description: "Extract a graph from a document, as an NDJSON stream" },

  // Graph store
  storeGraph: { method: "POST", path: "/v1/graphs", group: "Graph store", client: true, description: "Keep the extraction graph of a paper that has a DOI" },
  listGraphs: { method: "GET", path: "/v1/graphs", group: "Graph store", client: false, description: "List the stored graphs, or read one with `?doi=`" },

  // Landing pages and signposting
  work: { method: "GET", path: "/works/*doi", group: "Landing pages", client: false, description: "Landing page of a stored paper, and its `graph.json`, `ro-crate-metadata.json` and `linkset.json`" },

  // Notifications
  root: { method: "GET", path: "/", group: "Notifications", client: false, description: "The front door: where the info and the inbox are" },
  sendNotification: { method: "POST", path: "/v1/notify/inbox", group: "Notifications", client: false, description: "Take in a COAR Notify notification. A sender posts to the inbox address it found in a `Link` header" },
  notifications: { method: "GET", path: "/v1/notify/inbox", group: "Notifications", client: true, description: "List the notifications received, newest first. `?about=` narrows it" },
  inboxOptions: { method: "OPTIONS", path: "/v1/notify/inbox", group: "Notifications", client: false, description: "Say which content types the inbox takes" },
  readNotification: { method: "GET", path: "/v1/notify/inbox/:key", group: "Notifications", client: false, description: "One stored notification, exactly as it was sent" },

  // Labs
  createLab: { method: "POST", path: "/v1/labs", group: "Labs", client: true, description: "Make a lab. The creator becomes its admin" },
  findLab: { method: "GET", path: "/v1/labs/:id", group: "Labs", client: true, description: "Id and name of a lab, to confirm it before asking to join" },
  askToJoin: { method: "POST", path: "/v1/labs/:id/join", group: "Labs", client: true, description: "Ask to join a lab" },
  pollJoin: { method: "GET", path: "/v1/labs/:id/join/:requestId", group: "Labs", client: true, description: "Whether a request to join was answered. Takes `?secret=`" },
  members: { method: "GET", path: "/v1/labs/:id/members", group: "Labs", client: true, description: "The members of a lab" },
  requests: { method: "GET", path: "/v1/labs/:id/requests", group: "Labs", client: true, description: "The pending requests to join" },
  decide: { method: "POST", path: "/v1/labs/:id/requests/:requestId", group: "Labs", client: true, description: "Accept or decline a request to join" },
  createInvite: { method: "POST", path: "/v1/labs/:id/invites", group: "Labs", client: true, description: "Make an invite code" },
  listInvites: { method: "GET", path: "/v1/labs/:id/invites", group: "Labs", client: true, description: "The invites that still work, without their codes" },
  acceptInvite: { method: "POST", path: "/v1/labs/:id/invites/accept", group: "Labs", client: true, description: "Join a lab with an invite code" },
  revokeInvite: { method: "DELETE", path: "/v1/labs/:id/invites/:inviteId", group: "Labs", client: true, description: "Take back an invite" },
  removeMember: { method: "DELETE", path: "/v1/labs/:id/members/:did", group: "Labs", client: true, description: "Remove a member and every token of theirs" },

  // Sync
  pushRecords: { method: "POST", path: "/v1/labs/:id/records", group: "Sync", client: true, description: "Share records with the lab" },
  pullRecords: { method: "GET", path: "/v1/labs/:id/records", group: "Sync", client: true, description: "Read what the lab shared. Takes `?after=` and `?limit=`" },

  // Lab paper repository
  uploadPaper: { method: "POST", path: "/v1/labs/:id/papers", group: "Lab papers", client: true, description: "Add a paper, its graph and optionally its file to the lab" },
  labPapers: { method: "GET", path: "/v1/labs/:id/papers", group: "Lab papers", client: true, description: "The papers of a lab" },
  getPaper: { method: "GET", path: "/v1/labs/:id/papers/:paperId", group: "Lab papers", client: false, description: "One paper with its graph" },
  paperFile: { method: "GET", path: "/v1/labs/:id/papers/:paperId/file", group: "Lab papers", client: true, description: "The original file of a paper" },
  leaveBreadcrumb: { method: "POST", path: "/v1/labs/:id/papers/:paperId/breadcrumbs", group: "Lab papers", client: true, description: "Say that a person read this paper" },

  // AI
  ask: { method: "POST", path: "/v1/ai/ask", group: "AI", client: true, description: "Ask a question about the units on a canvas, as an NDJSON stream" },
} as const satisfies Record<string, RouteEntry>;

export type RouteName = keyof typeof ROUTES;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type Holds<Check extends true> = Check;
/** Does not compile when a route has no line in `Wire`, or `Wire` has a line that is no route. */
export type EveryRouteHasShapes = Holds<Same<RouteName, keyof Wire>>;

/** The names a path template asks for: `"id" | "requestId"` for `/v1/labs/:id/join/:requestId`. */
type ParamsOf<Path extends string> = Path extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamsOf<`/${Rest}`>
  : Path extends `${string}:${infer Name}`
    ? Name
    : Path extends `${string}*${infer Name}`
      ? Name
      : never;

export type RouteParams<Name extends RouteName> = Record<ParamsOf<(typeof ROUTES)[Name]["path"]>, string>;

/** A route with no named part takes no second argument, and one with named parts needs them all. */
type ParamArgs<Name extends RouteName> = [ParamsOf<(typeof ROUTES)[Name]["path"]>] extends [never] ? [] : [params: RouteParams<Name>];

/**
 * The path of a route with its named parts filled in and percent-encoded. A `*name` part keeps
 * its slashes. Join it to a server's address, and add any query string after it.
 */
export const pathOf = <Name extends RouteName>(name: Name, ...[params]: ParamArgs<Name>): string => {
  const given = (params ?? {}) as Record<string, string>;
  const value = (key: string): string => {
    const found = given[key];
    if (found === undefined) throw new Error(`The route "${name}" needs "${key}".`);
    return found;
  };
  return ROUTES[name].path
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) return encodeURIComponent(value(part.slice(1)));
      if (part.startsWith("*")) return value(part.slice(1)).split("/").map(encodeURIComponent).join("/");
      return part;
    })
    .join("/");
};
