import type { Services } from "@dg/contract/services.ts";

/**
 * Zenodo's deposit API. This is the only file that knows it.
 *
 * - A draft is opened with its metadata, which reserves a DOI without registering it.
 * - Files go to the draft's bucket.
 * - Nothing here publishes. A token with only `deposit:write` is enough, and
 *   that scope can't publish either.
 */

type Json = Record<string, unknown>;

const failure = async (response: Response, doing: string): Promise<Error> => {
  let said = "";
  try {
    const body = (await response.json()) as { message?: string; errors?: { field?: string; message?: string; messages?: string[] }[] };
    said = [body.message, ...(body.errors ?? []).map((error) => `${error.field ?? ""} ${error.message ?? (error.messages ?? []).join(" ")}`.trim())].filter(Boolean).join(". ");
  } catch {
    // Not JSON: the status says enough.
  }
  if (response.status === 401) return new Error("Zenodo didn't accept the token. Make a new one and save it again.");
  if (response.status === 403) return new Error("The token can't make deposits. It needs the deposit:write scope.");
  return new Error(`Zenodo couldn't ${doing} (${response.status}).${said ? ` It said: ${said}` : ""}`);
};

export const createZenodo = ({ fetch: send }: { fetch: typeof fetch }): Services["deposit"] => ({
  open: async ({ server, token, metadata }) => {
    let response: Response;
    try {
      response = await send(`${server.replace(/\/+$/, "")}/api/deposit/depositions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ metadata }),
      });
    } catch {
      throw new Error("Zenodo couldn't be reached. Check the connection and try again.");
    }
    if (!response.ok) throw await failure(response, "start a draft");
    const body = (await response.json()) as { id?: number | string; links?: Json; metadata?: { prereserve_doi?: { doi?: string } } };
    const bucket = typeof body.links?.bucket === "string" ? body.links.bucket : undefined;
    const page = typeof body.links?.html === "string" ? body.links.html : undefined;
    if (body.id === undefined || !bucket || !page) throw new Error("Zenodo started a draft but didn't say where its files go.");
    const doi = body.metadata?.prereserve_doi?.doi;
    return { id: String(body.id), bucket, page, ...(doi ? { doi } : {}) };
  },

  upload: async ({ bucket, token, name, bytes }) => {
    let response: Response;
    try {
      response = await send(`${bucket.replace(/\/+$/, "")}/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${token}` },
        body: bytes as BodyInit,
      });
    } catch {
      throw new Error("The draft was started, but the file didn't reach Zenodo. Open the draft and add the saved crate by hand.");
    }
    if (!response.ok) throw await failure(response, "take the file");
    const body = (await response.json().catch(() => ({}))) as { checksum?: string; size?: number };
    return { ...(body.checksum ? { checksum: body.checksum } : {}), ...(typeof body.size === "number" ? { size: body.size } : {}) };
  },
});
