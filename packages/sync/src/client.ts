import { pathOf } from "@dg/contract/routes.ts";
import { trimmedUrl as trimmed } from "@dg/contract/urls.ts";
import type { ComputeServer, ExtractionGraph, LabLink, Services } from "@dg/contract/services.ts";
import type { LineOf, PullRecordsResponse, PushRecordsRequest, RequestOf, ResponseOf } from "@dg/contract/wire.ts";
import type { DgRecord } from "@dg/contract/records.ts";
import { createScholarly } from "./scholarly.ts";
import { createZenodo } from "./zenodo.ts";
import { createAtRepo } from "./atrepo.ts";
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
const readLines = async <Line>(response: Response, onLine: (line: Line) => void): Promise<void> => {
  if (!response.body) throw new Error("The server sent nothing back.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (line: string): void => {
    if (line.trim()) onLine(JSON.parse(line) as Line);
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
    check: (url) => json<ResponseOf<"info">>(url, pathOf("info")),
    models: async (url) => (await json<ResponseOf<"models">>(url, pathOf("models"))).models,
    schemas: async (url) => (await json<ResponseOf<"schemas">>(url, pathOf("schemas"))).schemas,

    extract: async ({ url, onStatus, ...body }) => {
      const response = await open(url, pathOf("extract"), { body: body satisfies RequestOf<"extract"> });
      let result: ExtractionGraph | null = null;
      let failure: string | null = null;
      await readLines<LineOf<"extract">>(response, (line) => {
        if (line.type === "status") onStatus(String(line.message));
        if (line.type === "result") result = line.data;
        if (line.type === "error") failure = String(line.message);
      });
      if (failure) throw new Error(failure);
      if (!result) throw new Error("The server stopped before finishing. Try again.");
      return result;
    },

    storeGraph: async ({ doi, graph, schema, model }) => {
      const managed = (await serverList()).find((server) => server.kind === "managed");
      if (!managed) throw new Error("No Discourse Graphs service is set up.");
      await json<ResponseOf<"storeGraph">>(managed.url, pathOf("storeGraph"), { body: { doi, graph, schema, model } satisfies RequestOf<"storeGraph"> });
    },

    link: async () => (await store.get(LINK_KEY)) as LabLink | null,
    saveLink: (link) => store.set(LINK_KEY, link),

    createLab: async ({ server, name, person, labDid }) => {
      const made = await json<ResponseOf<"createLab">>(server, pathOf("createLab"), {
        body: { name, person, labDid } satisfies RequestOf<"createLab">,
      });
      return { server: trimmed(server), id: made.lab.id, name: made.lab.name, token: made.token, tokenKind: "personal", role: "admin" };
    },
    findLab: ({ server, id }) => json<ResponseOf<"findLab">>(server, pathOf("findLab", { id })),
    requestToJoin: async ({ server, id, person }) => {
      const lab = await json<ResponseOf<"findLab">>(server, pathOf("findLab", { id }));
      const asked = await json<ResponseOf<"askToJoin">>(server, pathOf("askToJoin", { id }), { body: { person } satisfies RequestOf<"askToJoin"> });
      return { server: trimmed(server), id: lab.id, name: lab.name, pending: asked };
    },
    checkRequest: async (link) => {
      if (!link.pending) return { link, state: "accepted" };
      const { requestId, secret } = link.pending;
      const answer = await json<ResponseOf<"pollJoin">>(
        link.server,
        `${pathOf("pollJoin", { id: link.id, requestId })}?secret=${encodeURIComponent(secret)}`,
      );
      if (answer.state === "pending") return { link, state: "pending" };
      if (answer.state === "declined") return { link: null, state: "declined" };
      const { pending: _done, ...rest } = link;
      return { link: { ...rest, token: answer.token!, tokenKind: answer.tokenKind ?? "personal", role: "member" }, state: "accepted" };
    },
    requests: async (link) => (await json<ResponseOf<"requests">>(link.server, pathOf("requests", { id: link.id }), { token: link.token! })).requests,
    decide: async (link, { requestId, decision, tokenKind }) => {
      await json<ResponseOf<"decide">>(link.server, pathOf("decide", { id: link.id, requestId }), { token: link.token!, body: { decision, tokenKind } satisfies RequestOf<"decide"> });
    },
    members: async (link) => (await json<ResponseOf<"members">>(link.server, pathOf("members", { id: link.id }), { token: link.token! })).members,

    pushRecords: async (link, records) => {
      await json<ResponseOf<"pushRecords">>(link.server, pathOf("pushRecords", { id: link.id }), { token: link.token!, body: { records } satisfies PushRecordsRequest<DgRecord> });
    },
    invite: async (link, { uses, days }) =>
      (await json<ResponseOf<"createInvite">>(link.server, pathOf("createInvite", { id: link.id }), { token: link.token!, body: { ...(uses ? { uses } : {}), ...(days ? { days } : {}) } satisfies RequestOf<"createInvite"> })).invite,
    invites: async (link) => (await json<ResponseOf<"listInvites">>(link.server, pathOf("listInvites", { id: link.id }), { token: link.token! })).invites,
    revokeInvite: async (link, id) => {
      await json<ResponseOf<"revokeInvite">>(link.server, pathOf("revokeInvite", { id: link.id, inviteId: id }), { token: link.token!, method: "DELETE" });
    },
    acceptInvite: async ({ server, id, code, person }) => {
      const joined = await json<ResponseOf<"acceptInvite">>(server, pathOf("acceptInvite", { id }), { body: { code, person } satisfies RequestOf<"acceptInvite"> });
      await store.set(REMOVED_KEY, null);
      return { server: trimmed(server), id: joined.lab.id, name: joined.lab.name, token: joined.token, tokenKind: joined.tokenKind ?? "personal", role: "member" };
    },
    removeMember: async (link, did) => {
      await json<ResponseOf<"removeMember">>(link.server, pathOf("removeMember", { id: link.id, did }), { token: link.token!, method: "DELETE" });
    },
    removedFrom: async () => ((await store.get(REMOVED_KEY)) as string | null) ?? null,
    forgetRemoved: () => store.set(REMOVED_KEY, null),
    pullRecords: async (link, after) => {
      const page = await json<PullRecordsResponse<DgRecord>>(
        link.server,
        `${pathOf("pullRecords", { id: link.id })}?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        { token: link.token! },
      );
      // The server counts its place as a number. Here it is only ever handed back, so it is kept as text.
      const { next, ...rest } = page;
      return { ...rest, ...(next === undefined ? {} : { next: String(next) }) };
    },

    uploadPaper: async (link, body) => {
      await json<ResponseOf<"uploadPaper">>(link.server, pathOf("uploadPaper", { id: link.id }), { token: link.token!, body: body satisfies RequestOf<"uploadPaper"> });
    },
    labPapers: async (link) => (await json<ResponseOf<"labPapers">>(link.server, pathOf("labPapers", { id: link.id }), { token: link.token! })).papers,
    paperFile: async (link, paper) => {
      const response = await open(link.server, pathOf("paperFile", { id: link.id, paperId: paper }), { token: link.token! });
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
      await json<ResponseOf<"leaveBreadcrumb">>(link.server, pathOf("leaveBreadcrumb", { id: link.id, paperId: paper }), { token: link.token!, body: { person } satisfies RequestOf<"leaveBreadcrumb"> });
    },

    ask: async ({ link, question, units, grounded, provider, onDelta }) => {
      // The server picks the address for a provider itself, so a base URL is not sent.
      const own = provider ? { kind: provider.provider, model: provider.model, key: provider.key } : undefined;
      // A provider with no key is sent as it is, and the server refuses it in a sentence the person can act on.
      const asked = { question, units, grounded } satisfies Omit<RequestOf<"ask">, "provider">;
      const response = await open(link.server, pathOf("ask"), { token: link.token!, body: { ...asked, ...(own ? { provider: own } : {}) } });
      let answer: Awaited<ReturnType<Services["ask"]>> | null = null;
      let failure: string | null = null;
      await readLines<LineOf<"ask">>(response, (line) => {
        if (line.type === "delta") onDelta(String(line.text));
        if (line.type === "result") answer = line;
        if (line.type === "error") failure = String(line.message);
      });
      if (failure) throw new Error(failure);
      if (!answer) throw new Error("The server stopped before answering. Try again.");
      return answer;
    },

    ...createScholarly({ fetch: outside ?? send }),
    zotero: createZotero({ fetch: outside ?? send }),
    deposit: createZenodo({ fetch: outside ?? send }),
    repo: createAtRepo({ fetch: outside ?? send }),
  };
};
