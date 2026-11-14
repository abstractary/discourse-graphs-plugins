import { trimmedUrl as trimmed } from "@dg/contract/urls.ts";
import type {
  ComputeServer,
  ExtractionGraph,
  LabInvite,
  LabLink,
  ServerInfo,
  ServerOption,
  Services,
} from "@dg/contract/services.ts";
import type { DgRecord } from "@dg/contract/records.ts";
import { createScholarly } from "./scholarly.ts";
import { createZenodo } from "./zenodo.ts";
import { createZotero } from "./zotero.ts";

const SERVERS_KEY = "compute-servers";
const LINK_KEY = "lab-link";
const REMOVED_KEY = "lab-removed";
const CHUNK = 32_768;

/** Both run from the repo with one command. A real install would point at DG's own service. */
const DEFAULT_SERVERS: ComputeServer[] = [
  { id: "local", name: "This computer", url: "http://localhost:8787", kind: "local" },
  { id: "managed", name: "Discourse Graphs service", url: "http://localhost:8788", kind: "managed" },
];

type Store = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
};

type Request = { method?: string; body?: unknown; token?: string };


const headers = ({ body, token }: Request): Record<string, string> => ({
  ...(body === undefined ? {} : { "content-type": "application/json" }),
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** Reads a stream of JSON lines, and hands each one over as it arrives. */
const readLines = async (response: Response, onLine: (line: Record<string, unknown>) => void): Promise<void> => {
  if (!response.body) throw new Error("The server sent nothing back.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (line: string): void => {
    if (line.trim()) onLine(JSON.parse(line) as Record<string, unknown>);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
      take(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
    }
  }
  take(buffer);
};

export const createServices = ({
  fetch: send,
  store,
  outside,
}: {
  /** Passed in, so each base can use whichever client gets past its own limits. */
  fetch: typeof fetch;
  store: Store;
  /**
   * For the registries and landing pages, which are other people's sites: a client that can read
   * their answers and their `Link` headers, where the base's own `fetch` is held back by CORS.
   */
  outside?: typeof fetch;
}): Services => {
  const open = async (url: string, path: string, request: Request = {}): Promise<Response> => {
    let response: Response;
    try {
      response = await send(`${trimmed(url)}${path}`, {
        method: request.method ?? (request.body === undefined ? "GET" : "POST"),
        headers: headers(request),
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
    } catch {
      throw new Error(`Couldn't reach ${url}. Check that the server is running.`);
    }
    if (response.ok) return response;
    const failed = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    if (failed?.error?.code === "removed") {
      // The PI took this person out of the lab. The link is dropped, so nothing more is sent or asked for.
      const link = (await store.get(LINK_KEY)) as LabLink | null;
      if (link && trimmed(link.server) === trimmed(url)) {
        await store.set(REMOVED_KEY, link.name);
        await store.set(LINK_KEY, null);
      }
    }
    throw new Error(failed?.error?.message ?? `The server answered ${response.status}.`);
  };
  const json = async <T>(url: string, path: string, request?: Request): Promise<T> =>
    (await open(url, path, request)).json() as Promise<T>;

  const serverList = async (): Promise<ComputeServer[]> =>
    ((await store.get(SERVERS_KEY)) as ComputeServer[] | null) ?? DEFAULT_SERVERS;

  const labPath = (link: LabLink, rest = ""): string => `/v1/labs/${encodeURIComponent(link.id)}${rest}`;

  return {
    servers: serverList,
    addServer: async (server) => {
      const added = { ...server, url: trimmed(server.url), id: `server-${Date.now().toString(36)}` };
      await store.set(SERVERS_KEY, [...(await serverList()), added]);
      return added;
    },
    removeServer: async (id) => {
      await store.set(SERVERS_KEY, (await serverList()).filter((server) => server.id !== id));
    },
    check: (url) => json<ServerInfo>(url, "/v1/info"),
    models: async (url) => (await json<{ models: ServerOption[] }>(url, "/v1/models")).models,
    schemas: async (url) => (await json<{ schemas: ServerOption[] }>(url, "/v1/schemas")).schemas,

    extract: async ({ url, onStatus, ...body }) => {
      const response = await open(url, "/v1/extract", { body });
      let result: ExtractionGraph | null = null;
      let failure: string | null = null;
      await readLines(response, (line) => {
        if (line.type === "status") onStatus(String(line.message));
        if (line.type === "result") result = line.data as ExtractionGraph;
        if (line.type === "error") failure = String(line.message);
      });
      if (failure) throw new Error(failure);
      if (!result) throw new Error("The server stopped before finishing. Try again.");
      return result;
    },

    storeGraph: async ({ doi, graph, schema, model }) => {
      const managed = (await serverList()).find((server) => server.kind === "managed");
      if (!managed) throw new Error("No Discourse Graphs service is set up.");
      await json(managed.url, "/v1/graphs", { body: { doi, graph, schema, model } });
    },

    link: async () => (await store.get(LINK_KEY)) as LabLink | null,
    saveLink: (link) => store.set(LINK_KEY, link),

    createLab: async ({ server, name, person, labDid }) => {
      const made = await json<{ lab: { id: string; name: string }; token: string }>(server, "/v1/labs", {
        body: { name, person, labDid },
      });
      return { server: trimmed(server), id: made.lab.id, name: made.lab.name, token: made.token, tokenKind: "personal", role: "admin" };
    },
    findLab: ({ server, id }) => json(server, `/v1/labs/${encodeURIComponent(id)}`),
    requestToJoin: async ({ server, id, person }) => {
      const lab = await json<{ id: string; name: string }>(server, `/v1/labs/${encodeURIComponent(id)}`);
      const asked = await json<{ requestId: string; secret: string }>(server, `/v1/labs/${encodeURIComponent(id)}/join`, { body: { person } });
      return { server: trimmed(server), id: lab.id, name: lab.name, pending: asked };
    },
    checkRequest: async (link) => {
      if (!link.pending) return { link, state: "accepted" };
      const { requestId, secret } = link.pending;
      const answer = await json<{ state: "pending" | "accepted" | "declined"; token?: string; tokenKind?: "personal" | "team" }>(
        link.server,
        labPath(link, `/join/${encodeURIComponent(requestId)}?secret=${encodeURIComponent(secret)}`),
      );
      if (answer.state === "pending") return { link, state: "pending" };
      if (answer.state === "declined") return { link: null, state: "declined" };
      const { pending: _done, ...rest } = link;
      return { link: { ...rest, token: answer.token!, tokenKind: answer.tokenKind ?? "personal", role: "member" }, state: "accepted" };
    },
    requests: async (link) => (await json<{ requests: Awaited<ReturnType<Services["requests"]>> }>(link.server, labPath(link, "/requests"), { token: link.token! })).requests,
    decide: async (link, { requestId, decision, tokenKind }) => {
      await json(link.server, labPath(link, `/requests/${encodeURIComponent(requestId)}`), { token: link.token!, body: { decision, tokenKind } });
    },
    members: async (link) => (await json<{ members: Awaited<ReturnType<Services["members"]>> }>(link.server, labPath(link, "/members"), { token: link.token! })).members,

    pushRecords: async (link, records) => {
      await json(link.server, labPath(link, "/records"), { token: link.token!, body: { records } });
    },
    invite: async (link, { uses, days }) =>
      (await json<{ invite: LabInvite }>(link.server, labPath(link, "/invites"), { token: link.token!, body: { ...(uses ? { uses } : {}), ...(days ? { days } : {}) } })).invite,
    invites: async (link) => (await json<{ invites: LabInvite[] }>(link.server, labPath(link, "/invites"), { token: link.token! })).invites,
    revokeInvite: async (link, id) => {
      await json(link.server, labPath(link, `/invites/${encodeURIComponent(id)}`), { token: link.token!, method: "DELETE" });
    },
    acceptInvite: async ({ server, id, code, person }) => {
      const joined = await json<{ lab: { id: string; name: string }; token: string; tokenKind?: "personal" | "team" }>(server, `/v1/labs/${encodeURIComponent(id)}/invites/accept`, { body: { code, person } });
      await store.set(REMOVED_KEY, null);
      return { server: trimmed(server), id: joined.lab.id, name: joined.lab.name, token: joined.token, tokenKind: joined.tokenKind ?? "personal", role: "member" };
    },
    removeMember: async (link, did) => {
      await json(link.server, labPath(link, `/members/${encodeURIComponent(did)}`), { token: link.token!, method: "DELETE" });
    },
    removedFrom: async () => ((await store.get(REMOVED_KEY)) as string | null) ?? null,
    forgetRemoved: () => store.set(REMOVED_KEY, null),
    pullRecords: async (link, after) => {
      const page = await json<{ records: DgRecord[]; next?: string | number; done: boolean; now?: string }>(
        link.server,
        labPath(link, `/records?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`),
        { token: link.token! },
      );
      // The server counts its place as a number. Here it is only ever handed back, so it is kept as text.
      const { next, ...rest } = page;
      return { ...rest, ...(next === undefined ? {} : { next: String(next) }) };
    },

    uploadPaper: async (link, body) => {
      await json(link.server, labPath(link, "/papers"), { token: link.token!, body });
    },
    labPapers: async (link) => (await json<{ papers: Awaited<ReturnType<Services["labPapers"]>> }>(link.server, labPath(link, "/papers"), { token: link.token! })).papers,
    paperFile: async (link, paper) => {
      const response = await open(link.server, labPath(link, `/papers/${encodeURIComponent(paper)}/file`), { token: link.token! });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
      const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(response.headers.get("content-disposition") ?? "")?.[1];
      return {
        name: named ? decodeURIComponent(named) : "paper",
        mediaType: response.headers.get("content-type") ?? "application/octet-stream",
        dataBase64: btoa(binary),
      };
    },
    leaveBreadcrumb: async (link, { paper, person }) => {
      await json(link.server, labPath(link, `/papers/${encodeURIComponent(paper)}/breadcrumbs`), { token: link.token!, body: { person } });
    },

    ask: async ({ link, question, units, grounded, provider, onDelta }) => {
      // The server picks the address for a provider itself, so a base URL is not sent.
      const own = provider ? { kind: provider.provider, model: provider.model, key: provider.key } : undefined;
      const response = await open(link.server, "/v1/ai/ask", { token: link.token!, body: { question, units, grounded, ...(own ? { provider: own } : {}) } });
      let answer: Awaited<ReturnType<Services["ask"]>> | null = null;
      let failure: string | null = null;
      await readLines(response, (line) => {
        if (line.type === "delta") onDelta(String(line.text));
        if (line.type === "result") answer = line as never;
        if (line.type === "error") failure = String(line.message);
      });
      if (failure) throw new Error(failure);
      if (!answer) throw new Error("The server stopped before answering. Try again.");
      return answer;
    },

    ...createScholarly({ fetch: outside ?? send }),
    zotero: createZotero({ fetch: outside ?? send }),
    deposit: createZenodo({ fetch: outside ?? send }),
  };
};
