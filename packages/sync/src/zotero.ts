import type { Services } from "@dg/contract/services.ts";
import { mergeIdentifiers, parseIdentifier, type Identifier, type LibraryAnnotation, type LibraryItem, type LibraryStatus, type WorkAuthor } from "@dg/contract/scholarly.ts";

/**
 * Zotero, read through the local API the desktop app serves at
 * `http://localhost:23119/api/`. This is the only file that knows Zotero's
 * API, so a change in it is a change here and nowhere else.
 *
 * - Reads need no key. The person switches the API on in Zotero's Settings,
 *   under Advanced.
 * - Zotero silently drops a request that looks like it came from a web page,
 *   unless it carries `Zotero-Allowed-Request`. So every request carries it.
 * - Item JSON is the same shape the Zotero web API returns, so the readers
 *   below serve a web client too when one is added.
 */

export const ZOTERO_LOCAL = "http://localhost:23119/api";

type Json = Record<string, unknown>;
type Raw = { key: string; version?: number; library?: { type?: string; id?: number; name?: string }; data: Json };

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

/** Zotero keeps what has no field of its own as `Label: value` lines in Extra. */
const fromExtra = (extra: string | undefined, label: RegExp): string | undefined => {
  for (const line of (extra ?? "").split("\n")) {
    const found = /^([^:]+):\s*(.+)$/.exec(line.trim());
    if (found && label.test(found[1]!)) return found[2]!.trim();
  }
  return undefined;
};

const refOf = (raw: Raw, key = raw.key): string => `${raw.library?.type === "group" ? "groups" : "users"}/${raw.library?.id ?? 0}/items/${key}`;

/** The item's identifiers, DOI first: its own fields, then what people keep in Extra. */
export const identifiersOfItem = (raw: Raw): Identifier[] => {
  const data = raw.data;
  const extra = text(data.extra);
  const found: Identifier[] = [];
  const add = (scheme: Identifier["scheme"], value: string | undefined): void => {
    const read = value ? parseIdentifier(value, scheme) : null;
    if (read) found.push(read);
  };
  add("doi", text(data.DOI) ?? fromExtra(extra, /^doi$/i));
  add("pmid", text(data.PMID) ?? fromExtra(extra, /^pmid$/i));
  add("pmcid", text(data.PMCID) ?? fromExtra(extra, /^pmcid$/i));
  const arxiv = (text(data.archiveID) ?? fromExtra(extra, /^arxiv( id)?$/i))?.replace(/^arxiv:\s*/i, "");
  add("arxiv", arxiv ? `arXiv:${arxiv}` : undefined);
  for (const isbn of (text(data.ISBN) ?? "").split(/[\s,;]+/).filter(Boolean).slice(0, 1)) add("isbn", `ISBN ${isbn}`);
  add("citekey", text(data.citationKey) ?? fromExtra(extra, /^citation key$/i));
  if (raw.library?.id) found.push({ scheme: "zotero", value: refOf(raw) });
  // A link is kept only when nothing better names the work.
  const url = text(data.url);
  if (url && !found.some(({ scheme }) => scheme === "doi" || scheme === "pmid" || scheme === "arxiv")) add("url", url);
  return mergeIdentifiers(found);
};

const authorsOf = (data: Json): WorkAuthor[] => {
  const creators = Array.isArray(data.creators) ? (data.creators as Json[]) : [];
  // Authors where the item has any; otherwise whoever it lists, such as editors.
  const authors = creators.filter((creator) => creator.creatorType === "author");
  return (authors.length ? authors : creators).flatMap((creator): WorkAuthor[] => {
    const given = text(creator.firstName);
    const family = text(creator.lastName);
    const name = text(creator.name) ?? [given, family].filter(Boolean).join(" ");
    return name ? [{ name, ...(given ? { given } : {}), ...(family ? { family } : {}) }] : [];
  });
};

const selectLink = (raw: Raw, key = raw.key): string =>
  raw.library?.type === "group" ? `zotero://select/groups/${raw.library.id}/items/${key}` : `zotero://select/library/items/${key}`;
const openLink = (raw: Raw, attachment: string, page: number | undefined, annotation: string): string =>
  `zotero://open-pdf/${raw.library?.type === "group" ? `groups/${raw.library.id}` : "library"}/items/${attachment}?${page !== undefined ? `page=${page + 1}&` : ""}annotation=${annotation}`;

export const itemOf = (raw: Raw, children: Raw[] = []): LibraryItem => {
  const data = raw.data;
  const venue = text(data.publicationTitle) ?? text(data.proceedingsTitle) ?? text(data.bookTitle) ?? text(data.repository) ?? text(data.publisher);
  return {
    ref: refOf(raw),
    key: raw.key,
    library: { kind: raw.library?.type === "group" ? "group" : "user", id: raw.library?.id ?? 0, ...(raw.library?.name ? { name: raw.library.name } : {}) },
    type: text(data.itemType) ?? "document",
    title: text(data.title) ?? "Untitled",
    authors: authorsOf(data),
    ...(text(data.date) ? { published: text(data.date)! } : {}),
    ...(venue ? { venue } : {}),
    identifiers: identifiersOfItem(raw),
    tags: (Array.isArray(data.tags) ? (data.tags as Json[]) : []).flatMap((tag) => (text(tag.tag) ? [text(tag.tag)!] : [])),
    attachments: children
      .filter((child) => child.data.itemType === "attachment")
      .map((child) => ({
        key: child.key,
        title: text(child.data.title) ?? text(child.data.filename) ?? "Attachment",
        ...(text(child.data.contentType) ? { mediaType: text(child.data.contentType)! } : {}),
        ...(text(child.data.filename) ? { filename: text(child.data.filename)! } : {}),
      })),
    open: selectLink(raw),
  };
};

const TYPES = new Set(["highlight", "underline", "note", "text", "image", "ink"]);

export const annotationOf = (raw: Raw): LibraryAnnotation | null => {
  const data = raw.data;
  const type = text(data.annotationType);
  const attachment = text(data.parentItem);
  if (data.itemType !== "annotation" || !type || !TYPES.has(type) || !attachment) return null;
  let pageIndex: number | undefined;
  try {
    const position = JSON.parse(text(data.annotationPosition) ?? "{}") as { pageIndex?: unknown };
    if (Number.isInteger(position.pageIndex)) pageIndex = position.pageIndex as number;
  } catch {
    // A position this can't read still leaves the quoted words, which is what the reader finds a passage by.
  }
  return {
    key: raw.key,
    ref: refOf(raw),
    attachment,
    type: type as LibraryAnnotation["type"],
    ...(text(data.annotationText) ? { text: text(data.annotationText)! } : {}),
    ...(text(data.annotationComment) ? { comment: text(data.annotationComment)! } : {}),
    ...(text(data.annotationColor) ? { color: text(data.annotationColor)!.toLowerCase() } : {}),
    ...(text(data.annotationPageLabel) ? { pageLabel: text(data.annotationPageLabel)! } : {}),
    ...(pageIndex !== undefined ? { pageIndex } : {}),
    ...(text(data.annotationSortIndex) ? { order: text(data.annotationSortIndex)! } : {}),
    tags: (Array.isArray(data.tags) ? (data.tags as Json[]) : []).flatMap((tag) => (text(tag.tag) ? [text(tag.tag)!] : [])),
    ...(text(data.annotationAuthorName) ? { author: text(data.annotationAuthorName)! } : {}),
    open: openLink(raw, attachment, pageIndex, raw.key),
  };
};

const NOT_RUNNING = "Zotero isn't answering. Open Zotero on this computer and try again.";
const SWITCHED_OFF = 'Zotero is running but won\'t talk to other apps. In Zotero, open Settings, then Advanced, and tick "Allow other applications on this computer to communicate with Zotero".';

export const createZotero = ({ fetch: send, base = ZOTERO_LOCAL, timeoutMs = 8000 }: { fetch: typeof fetch; base?: string; timeoutMs?: number }): Services["zotero"] => {
  const get = async (path: string): Promise<Response> => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), timeoutMs);
    let response: Response;
    try {
      response = await send(`${base}${path}`, { headers: { "Zotero-Allowed-Request": "1", "Zotero-API-Version": "3", accept: "application/json" }, signal: stop.signal });
    } catch {
      throw new Error(NOT_RUNNING);
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 403) throw new Error(SWITCHED_OFF);
    if (response.status === 404) throw new Error("Zotero no longer has that item. It may have been merged or deleted.");
    if (!response.ok) throw new Error(`Zotero answered with an error (${response.status}). Update Zotero and try again.`);
    return response;
  };
  const list = async (path: string): Promise<Raw[]> => {
    const value = (await (await get(path)).json()) as unknown;
    return Array.isArray(value) ? (value as Raw[]).filter((raw) => raw && typeof raw.key === "string" && raw.data) : [];
  };
  /** `users/<id>/items/<key>` as the API path it is. The local API also answers to user 0. */
  const pathOf = (ref: string): string => {
    if (!/^(users|groups)\/\d+\/items\/[A-Z0-9]{8}$/.test(ref)) throw new Error("That isn't a Zotero item.");
    return `/${ref}`;
  };

  return {
    status: async (): Promise<LibraryStatus> => {
      try {
        const response = await get("/users/0/items?limit=1&format=keys");
        const serverId = response.headers.get("Zotero-Server-ID") ?? undefined;
        // Zotero 10 names itself with a server id, and is the first that can take writes.
        return { ok: true, app: "zotero", canWrite: Boolean(serverId), ...(serverId ? { serverId } : {}) };
      } catch (error) {
        return { ok: false, app: "zotero", problem: error instanceof Error ? error.message : NOT_RUNNING };
      }
    },
    search: async ({ text: asked, limit = 20 }) => {
      const found = await list(`/users/0/items/top?q=${encodeURIComponent(asked)}&qmode=titleCreatorYear&limit=${limit}&sort=dateModified&direction=desc`);
      return found.filter((raw) => raw.data.itemType !== "attachment" && raw.data.itemType !== "note").map((raw) => itemOf(raw));
    },
    item: async ({ ref }) => {
      const path = pathOf(ref);
      const raw = (await (await get(path)).json()) as Raw;
      return itemOf(raw, await list(`${path}/children`));
    },
    annotations: async ({ ref }) => {
      const path = pathOf(ref);
      const files = (await list(`${path}/children`)).filter((child) => child.data.itemType === "attachment");
      const marks: LibraryAnnotation[] = [];
      for (const file of files) {
        const children = await list(`${path.replace(/[A-Z0-9]{8}$/, file.key)}/children`);
        for (const child of children) {
          const mark = annotationOf(child);
          if (mark) marks.push(mark);
        }
      }
      return marks.sort((a, b) => (a.attachment === b.attachment ? (a.order ?? "").localeCompare(b.order ?? "") : a.attachment.localeCompare(b.attachment)));
    },
  };
};
