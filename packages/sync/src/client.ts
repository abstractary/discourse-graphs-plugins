import type {
  ComputeServer,
  ExtractionGraph,
  LabLink,
  ServerInfo,
  ServerOption,
  Services,
} from "@dg/contract/services.ts";
import type { DgRecord } from "@dg/contract/records.ts";

const SERVERS_KEY = "compute-servers";
const LINK_KEY = "lab-link";
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

const trimmed = (url: string): string => url.replace(/\/+$/, "");

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
}: {
  /** Passed in, so each base can use whichever client gets past its own limits. */
  fetch: typeof fetch;
  store: Store;
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
    const failed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
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
    pullRecords: (link, after) =>
      json<{ records: DgRecord[]; next?: string; done: boolean }>(
        link.server,
        labPath(link, `/records?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`),
        { token: link.token! },
      ),

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

    ask: async ({ link, question, units, grounded, onDelta }) => {
      const response = await open(link.server, "/v1/ai/ask", { token: link.token!, body: { question, units, grounded } });
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
  };
};
