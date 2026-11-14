import type { RepoSession, Services } from "@dg/contract/services.ts";

/**
 * A person's repository on the AT Protocol network, over XRPC. This is the only file that knows it.
 *
 * - Finding an account asks the handle's own domain first, then the account's DID document.
 * - A session is opened with an app password, which is used here once and returned to no one.
 * - Writes go in one `applyWrites` call, so a set of records is all there or not there.
 * - Reading is the public's reading: no session.
 */

const DIRECTORY = "https://plc.directory";
/** Asked only when a handle's own domain doesn't say who it is. */
const RESOLVER = "https://bsky.social";

type Json = Record<string, unknown>;
const trimmed = (host: string): string => host.replace(/\/+$/, "");

const failure = async (response: Response, doing: string): Promise<Error> => {
  let code = "";
  let said = "";
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    code = body.error ?? "";
    said = body.message ?? "";
  } catch {
    // Not JSON: the status says enough.
  }
  if (code === "AuthenticationRequired" || code === "AccountTakedown" || response.status === 401) return new Error("The account didn't accept that. Check the handle, and use an app password, not the account's own password.");
  if (code === "ExpiredToken" || code === "InvalidToken") return new Error("The sign-in has run out. Connect the account again.");
  if (code === "RateLimitExceeded" || response.status === 429) return new Error("The account's server asks to slow down. Wait a few minutes and try again.");
  return new Error(`The account's server couldn't ${doing} (${response.status}).${said ? ` It said: ${said}` : ""}`);
};

export const createAtRepo = ({ fetch: send, directory = DIRECTORY, resolver = RESOLVER }: { fetch: typeof fetch; directory?: string; resolver?: string }): Services["repo"] => {
  const ask = async (url: string, doing: string, init?: RequestInit): Promise<Response> => {
    let response: Response;
    try {
      response = await send(url, init);
    } catch {
      throw new Error("The account's server couldn't be reached. Check the connection and try again.");
    }
    if (!response.ok) throw await failure(response, doing);
    return response;
  };
  // A call that takes nothing is sent with no body at all: a repository refuses an empty one.
  const post = (host: string, method: string, doing: string, body: Json | null, token?: string): Promise<Response> =>
    ask(`${trimmed(host)}/xrpc/${method}`, doing, {
      method: "POST",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const session = async (response: Response): Promise<RepoSession> => {
    const body = (await response.json()) as { did?: string; handle?: string; accessJwt?: string; refreshJwt?: string };
    if (!body.did || !body.accessJwt || !body.refreshJwt) throw new Error("The account's server answered without a session.");
    return { did: body.did, handle: body.handle ?? "", access: body.accessJwt, refresh: body.refreshJwt };
  };

  const didOf = async (handle: string): Promise<string> => {
    try {
      const own = await send(`https://${handle}/.well-known/atproto-did`);
      const text = own.ok ? (await own.text()).trim() : "";
      if (/^did:(plc|web):[a-zA-Z0-9._:%-]+$/.test(text)) return text;
    } catch {
      // The domain doesn't answer for itself. Ask a resolver.
    }
    const response = await ask(`${trimmed(resolver)}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`, "find that handle");
    const { did } = (await response.json()) as { did?: string };
    if (!did) throw new Error(`No account answers to ${handle}.`);
    return did;
  };

  return {
    find: async ({ handle }) => {
      const name = handle.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(name)) throw new Error("A handle looks like name.bsky.social, or a domain of your own.");
      const did = await didOf(name);
      const where = did.startsWith("did:web:") ? `https://${decodeURIComponent(did.slice("did:web:".length))}/.well-known/did.json` : `${trimmed(directory)}/${did}`;
      const document = (await (await ask(where, "find where that account is kept")).json()) as { service?: { id?: string; type?: string; serviceEndpoint?: string }[] };
      const host = document.service?.find((entry) => entry.id?.endsWith("#atproto_pds") || entry.type === "AtprotoPersonalDataServer")?.serviceEndpoint;
      if (!host) throw new Error(`${name} has no repository to publish to.`);
      return { did, host };
    },
    open: async ({ host, identifier, password }) => session(await post(host, "com.atproto.server.createSession", "sign in", { identifier, password })),
    renew: async ({ host, refresh }) => session(await post(host, "com.atproto.server.refreshSession", "renew the sign-in", null, refresh)),
    write: async ({ host, access, repo, writes }) => {
      const response = await post(
        host,
        "com.atproto.repo.applyWrites",
        "take the records",
        {
          repo,
          // The names are stand-ins with no published schema, so the server is told not to look for one.
          validate: false,
          writes: writes.map((write) =>
            write.action === "delete"
              ? { $type: "com.atproto.repo.applyWrites#delete", collection: write.collection, rkey: write.rkey }
              : { $type: `com.atproto.repo.applyWrites#${write.action}`, collection: write.collection, rkey: write.rkey, value: write.value },
          ),
        },
        access,
      );
      const body = (await response.json()) as { results?: { uri?: string; cid?: string }[] };
      return (body.results ?? []).map((result) => ({ uri: result.uri ?? "", cid: result.cid ?? "" }));
    },
    list: async ({ host, repo, collection }) => {
      const found: { uri: string; cid: string; value: Json }[] = [];
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ repo, collection, limit: "100", ...(cursor ? { cursor } : {}) });
        const body = (await (await ask(`${trimmed(host)}/xrpc/com.atproto.repo.listRecords?${query}`, "list the records")).json()) as { records?: { uri: string; cid: string; value: Json }[]; cursor?: string };
        found.push(...(body.records ?? []));
        cursor = body.records?.length ? body.cursor : undefined;
      } while (cursor);
      return found;
    },
  };
};
