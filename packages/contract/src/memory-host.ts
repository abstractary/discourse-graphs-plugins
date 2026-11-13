import {
  canonicalJson,
  uuidv7,
  validateRecord,
  type DgRecord,
  type HostRef,
  type Json,
} from "./records.ts";
import {
  CONTRACT_VERSION,
  fail,
  ok,
  type Asset,
  type Host,
  type HostEvent,
  type HostInfo,
  type HostListener,
  type Page,
  type TextSummary,
  type TextUnit,
} from "./host.ts";
import type { ConformanceDriver, ConformanceSetup } from "./conformance.ts";

type StoredText = Omit<TextUnit, "ref"> & { properties?: Record<string, HostRef[] | string> };

/** The durable part. Sharing one store between hosts simulates a reload. */
export type MemoryStore = {
  spaceId: string;
  texts: Map<HostRef, StoredText>;
  records: DgRecord[];
  local: Map<string, Json>;
  assets: Map<string, Asset>;
  /** Files that live outside the base, by path: what a reference library keeps. */
  outside: Map<string, Asset>;
  focus: HostRef | null;
  cursor: HostRef | null;
  selection: { ref: HostRef; text: string } | null;
  folders: Map<HostRef, string>;
  files: Map<string, string>;
};

export const createMemoryStore = (): MemoryStore => ({
  selection: null,
  folders: new Map(),
  files: new Map(),
  spaceId: uuidv7(),
  texts: new Map(),
  records: [],
  local: new Map(),
  assets: new Map(),
  outside: new Map(),
  focus: null,
  cursor: null,
});

const summarize = (ref: HostRef, text: StoredText): TextSummary => ({
  ref,
  title: text.title,
  modifiedAt: text.modifiedAt,
  scope: text.scope,
});

const pageOf = <T>(
  items: T[],
  after: string | undefined,
  limit: number,
): Page<T> => {
  const start = after === undefined ? 0 : Number(after);
  const end = Math.min(start + limit, items.length);
  return {
    items: items.slice(start, end),
    next: String(end),
    done: end >= items.length,
  };
};

/** The reference implementation. It shows the contract can be met, nothing more. */
export const createMemoryHost = ({
  store,
  host = "memory",
  textForEveryUnit = false,
}: {
  store: MemoryStore;
  host?: string;
  textForEveryUnit?: boolean;
}): { host: Host; emit: (event: HostEvent) => void } => {
  const listeners = new Set<HostListener>();
  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };
  const now = (): string => new Date().toISOString();
  const readRef = (ref: HostRef): StoredText | undefined => store.texts.get(ref);
  const notFound = (ref: HostRef): ReturnType<typeof fail> =>
    fail("not-found", `No text for ${ref}. It may have been removed.`);

  const api: Host = {
    describe: async () => {
      const info: HostInfo = {
        contract: CONTRACT_VERSION,
        host,
        adapterVersion: "0.0.0",
        ...(textForEveryUnit ? { textForEveryUnit } : {}),
        space: { id: store.spaceId, name: "Memory" },
        person: { id: "person-1", name: "Test Person" },
        appearance: "light",
        skin: {
          font: "system-ui, sans-serif",
          textFont: "Georgia, serif",
          size: 13,
          ink: "#222",
          muted: "#666",
          page: "#fff",
          panel: "#f5f5f5",
          line: "#ddd",
          accent: "#36c",
          radius: 4,
        },
        sharedSpace: false,
      };
      return ok(info);
    },
    listText: async ({ after, limit }) =>
      ok(
        pageOf(
          [...store.texts].map(([ref, text]) => summarize(ref, text)),
          after,
          limit,
        ),
      ),
    readText: async ({ ref }) => {
      const text = readRef(ref);
      return text ? ok({ ref, ...text }) : notFound(ref);
    },
    searchText: async ({ query, tag, limit }) =>
      ok(
        [...store.texts]
          .filter(
            ([, text]) =>
              (query === undefined || text.title.includes(query)) &&
              (tag === undefined || text.tags.includes(tag)),
          )
          .slice(0, limit)
          .map(([ref, text]) => summarize(ref, text)),
      ),
    listBacklinks: async ({ ref }) =>
      ok(
        [...store.texts]
          .filter(([, text]) => text.links.includes(ref))
          .map(([from, text]) => summarize(from, text)),
      ),
    createText: async ({ title, body = "" }) => {
      const existing = [...store.texts].find(([, text]) => text.title === title);
      if (existing) {
        return fail("conflict", `"${title}" already exists.`, existing[0]);
      }
      const ref = uuidv7();
      const text: StoredText = {
        title,
        body,
        tags: [],
        links: [],
        modifiedAt: now(),
        scope: "page",
      };
      store.texts.set(ref, text);
      emit({ type: "text-changed", ref });
      return ok(summarize(ref, text));
    },
    removeText: async ({ ref }) => {
      if (!readRef(ref)) return notFound(ref);
      store.texts.delete(ref);
      emit({ type: "text-removed", ref });
      return ok(null);
    },
    saveFile: async ({ name, dataBase64 }) => {
      store.files.set(name, dataBase64);
      return ok({ where: name });
    },

    fileInFolder: async ({ ref, folder }) => {
      if (!readRef(ref)) return notFound(ref);
      store.folders.set(ref, folder);
      return ok(null);
    },
    renameText: async ({ ref, title }) => {
      const text = readRef(ref);
      if (!text) return notFound(ref);
      text.title = title;
      text.modifiedAt = now();
      emit({ type: "text-renamed", ref, title });
      return ok(summarize(ref, text));
    },
    pinText: async ({ ref }) => {
      const text = readRef(ref);
      return text ? ok(summarize(ref, text)) : notFound(ref);
    },
    listRecords: async ({ after, limit }) =>
      ok(pageOf(store.records, after, limit)),
    putRecords: async ({ records }) => {
      const problems = records.flatMap((record) => validateRecord(record));
      if (problems.length > 0) return fail("invalid", problems.join("; "));
      const known = new Set(store.records.map(canonicalJson));
      const fresh = records.filter((record) => !known.has(canonicalJson(record)));
      store.records.push(...fresh);
      if (fresh.length > 0) emit({ type: "records-changed" });
      return ok({ stored: fresh.length });
    },
    readAsset: async ({ ref }) => {
      const asset = store.assets.get(ref);
      return asset ? ok(asset) : fail("not-found", `No asset ${ref}.`);
    },
    writeAsset: async ({ asset }) => {
      const ref = uuidv7();
      store.assets.set(ref, asset);
      return ok({ ref });
    },
    listFiles: async ({ extensions, limit }) => {
      const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));
      const files = [...store.assets.entries()]
        .filter(([, asset]) => wanted.has(asset.name.split(".").pop()?.toLowerCase() ?? ""))
        .reverse()
        .slice(0, limit)
        .map(([ref, asset]) => ({ ref, name: asset.name, mime: asset.mime, size: Math.floor(((asset.dataUrl.split(",")[1] ?? "").length * 3) / 4) }));
      return ok(files);
    },
    getFocus: async () => ok({ ref: store.focus }),
    reveal: async ({ ref }) => {
      if (!readRef(ref)) return notFound(ref);
      store.focus = ref;
      emit({ type: "focus-changed", ref });
      return ok(null);
    },
    insertLink: async ({ ref, label }) => {
      const target = readRef(ref);
      if (!target) return notFound(ref);
      const page = store.cursor ? readRef(store.cursor) : undefined;
      if (!page) return fail("no-target", "No cursor to insert at.");
      page.body += ` [[${label ?? target.title}]]`;
      page.links.push(ref);
      return ok(null);
    },
    readLocalFile: async ({ path }) => {
      const asset = store.outside.get(path);
      return asset ? ok(asset) : fail("not-found", `Nothing at ${path}.`);
    },
    listTagged: async ({ tags, limit }) => {
      const found: { ref: HostRef; title: string; line: number; text: string; tag: string }[] = [];
      for (const [ref, text] of store.texts) {
        text.body.split("\n").forEach((held, line) => {
          const tag = tags.find((item) => new RegExp(`#${item}(?![\\w/-])`, "i").test(held));
          const words = tag ? held.replace(new RegExp(`#${tag}(?![\\w/-])`, "i"), "").replace(/^\s*[-*+]\s+/, "").replace(/\s+/g, " ").trim() : "";
          if (tag && words && found.length < limit) found.push({ ref, title: text.title, line, text: words, tag });
        });
      }
      return ok(found);
    },
    replaceTagged: async ({ ref, line, tag, target }) => {
      const text = readRef(ref);
      const to = readRef(target);
      if (!text || !to) return notFound(text ? target : ref);
      const lines = text.body.split("\n");
      if (!new RegExp(`#${tag}(?![\\w/-])`, "i").test(lines[line] ?? "")) return fail("conflict", "That line has changed since it was listed. Look again.");
      lines[line] = `${/^\s*[-*+]\s+/.exec(lines[line]!)?.[0] ?? ""}[[${to.title}]]`;
      text.body = lines.join("\n");
      return ok(null);
    },
    setLinks: async ({ ref, links, managed, facts = {}, managedFacts = [] }) => {
      const text = readRef(ref);
      if (!text) return notFound(ref);
      const before = JSON.stringify(text.properties ?? {});
      const next: Record<string, HostRef[] | string> = { ...(text.properties ?? {}) };
      for (const key of [...managed, ...managedFacts]) delete next[key];
      for (const [key, value] of Object.entries(facts)) next[key] = value;
      for (const [key, refs] of Object.entries(links)) {
        const live = refs.filter((other) => other !== ref && store.texts.has(other));
        if (live.length) next[key] = live;
      }
      if (JSON.stringify(next) === before) return ok({ written: false });
      text.properties = next;
      return ok({ written: true });
    },
    readSelection: async () => ok(store.selection ? { text: store.selection.text } : null),
    replaceSelection: async ({ ref }) => {
      const { selection } = store;
      const target = store.texts.get(ref);
      const page = selection ? store.texts.get(selection.ref) : undefined;
      if (!selection || !target || !page) return fail("no-target", "Nothing is selected.");
      page.body = page.body.replace(selection.text, `[[${target.title}]]`);
      store.selection = null;
      return ok(null);
    },
    openSurface: async () => ok(null),
    closeDialog: async () => ok(null),
    openLink: async () => ok(null),
    getLocal: async ({ key }) => ok(store.local.get(key) ?? null),
    setLocal: async ({ key, value }) => {
      store.local.set(key, value);
      return ok(null);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { host: api, emit };
};

export const createMemorySetup = (
  store: MemoryStore = createMemoryStore(),
): ConformanceSetup => {
  const { host, emit } = createMemoryHost({ store });
  const edit = (ref: HostRef, change: (text: StoredText) => void): void => {
    const text = store.texts.get(ref);
    if (!text) return;
    change(text);
    text.modifiedAt = new Date().toISOString();
  };
  const driver: ConformanceDriver = {
    reload: async () => createMemoryHost({ store }).host,
    selectOutside: async ({ ref, text }) => {
      store.selection = text ? { ref, text } : null;
    },
    editOutside: async ({ ref, body }) => {
      edit(ref, (text) => {
        text.body = body;
      });
      emit({ type: "text-changed", ref });
    },
    renameOutside: async ({ ref, title }) => {
      edit(ref, (text) => {
        text.title = title;
      });
      emit({ type: "text-renamed", ref, title });
    },
    removeOutside: async ({ ref }) => {
      store.texts.delete(ref);
      emit({ type: "text-removed", ref });
    },
    linkOutside: async ({ from, to }) => {
      edit(from, (text) => {
        text.links.push(to);
      });
      emit({ type: "text-changed", ref: from });
    },
    tagOutside: async ({ ref, tag }) => {
      edit(ref, (text) => {
        text.tags.push(tag);
      });
      emit({ type: "text-changed", ref });
    },
    focusOutside: async ({ ref }) => {
      store.focus = ref;
      emit({ type: "focus-changed", ref });
    },
    placeCursor: async ({ ref }) => {
      store.cursor = ref;
    },
    readAtCursor: async () =>
      store.cursor ? (store.texts.get(store.cursor)?.body ?? "") : "",
    isVisible: async ({ ref }) => store.focus === ref,
    closePanels: async () => {},
    writeRecordOutside: async ({ record }) => {
      store.records.push(record);
      emit({ type: "records-changed" });
    },
    settle: async () => {},
  };
  return { host, driver };
};
