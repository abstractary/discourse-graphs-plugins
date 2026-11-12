import {
  canonicalJson,
  uuidv7,
  validateRecord,
  type DgRecord,
  type HostRef,
  type Json,
} from "@dg/contract/records.ts";
import {
  CONTRACT_VERSION,
  fail,
  neverRejects,
  ok,
  type Appearance,
  type Asset,
  type Host,
  type HostEvent,
  type HostListener,
  type Skin,
  type TextSummary,
  type TextUnit,
} from "@dg/contract/host.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type RoamApi = any;

export const RECORDS_PAGE = "roam/js/discourse-graph/records";
/** On a node's page, so the unit id travels with the text. */
const UNIT_PROP = "dg-id";
const ASSETS_PAGE = "roam/js/discourse-graph/assets";
const LOCAL_ASSET = "dg-asset:";
/** A PDF someone added gets an embed here, so it's in the graph like any other. */
const PDFS_PAGE = "Discourse Graphs/PDFs";
const PDF_EMBED = /\{\{\s*(?:\[\[)?pdf(?:\]\])?\s*:\s*([^}\s]+)\s*\}\}/gi;
const fileNameOf = (url: string): string => {
  const path = decodeURIComponent(url.split("?")[0] ?? url);
  return path.split("/").pop()?.replace(/^\d+-/, "") || "Document.pdf";
};
const POLL_MS = 1000;
// A batch this size stays well under what a single block's props should hold.
const BATCH = 200;
const PROP = "dg";

type PulledBlock = {
  ":block/uid": string;
  ":block/string"?: string;
  ":block/order"?: number;
  ":node/title"?: string;
  ":edit/time"?: number;
  ":block/children"?: PulledBlock[];
  ":block/refs"?: { ":block/uid": string; ":node/title"?: string }[];
  ":block/props"?: Record<string, unknown>;
};

const byOrder = (blocks: PulledBlock[] = []): PulledBlock[] =>
  [...blocks].sort(
    (a, b) => (a[":block/order"] ?? 0) - (b[":block/order"] ?? 0),
  );

const toMarkdown = (blocks: PulledBlock[] = [], depth = 0): string =>
  byOrder(blocks)
    .map(
      (block) =>
        `${"  ".repeat(depth)}- ${block[":block/string"] ?? ""}\n${toMarkdown(block[":block/children"], depth + 1)}`,
    )
    .join("");

const collect = (block: PulledBlock, into: PulledBlock[] = []): PulledBlock[] => {
  into.push(block);
  for (const child of block[":block/children"] ?? []) collect(child, into);
  return into;
};

const TAG = /#\[\[([^\]]+)\]\]|(?:^|\s)#([^\s#[\]]+)/g;

const tagsIn = (text: string): string[] =>
  [...text.matchAll(TAG)].map((match) => match[1] ?? match[2]!);

const dataUrlToFile = async (asset: Asset): Promise<File> => {
  const blob = await (await fetch(asset.dataUrl)).blob();
  return new File([blob], asset.name, { type: asset.mime });
};

const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error as Error);
    reader.readAsDataURL(file);
  });

export type RoamHost = {
  host: Host;
  /** Stands in for the block the person last had their cursor in. */
  setCursor: (uid: string | null) => void;
  dispose: () => void;
};

const isBlank = (color: string): boolean =>
  !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";

/** Asks a real element what Roam's stylesheet says, so a custom theme carries over. */
const styled = <T,>(className: string, read: (style: CSSStyleDeclaration) => T): T => {
  const probe = document.createElement("span");
  probe.className = className;
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const value = read(getComputedStyle(probe));
  probe.remove();
  return value;
};

const lightnessOf = (color: string): number => {
  const [r = 255, g = 255, b = 255] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

/** Roam themes are plain CSS, so dark is judged from the page rather than a class. */
const lookNow = (): { appearance: Appearance; skin: Skin } => {
  const of = (selector: string): CSSStyleDeclaration | null => {
    const element = document.querySelector(selector);
    return element ? getComputedStyle(element) : null;
  };
  const body = getComputedStyle(document.body);
  const page =
    [".roam-body-main", ".roam-app"]
      .map((selector) => of(selector)?.backgroundColor ?? "")
      .find((color) => !isBlank(color)) ??
    (isBlank(body.backgroundColor) ? "rgb(255, 255, 255)" : body.backgroundColor);
  const side = of("#right-sidebar")?.backgroundColor ?? "";
  const accent = styled("bp3-button bp3-intent-primary", (style) => style.backgroundColor);
  const radius = styled("bp3-button", (style) => Number.parseFloat(style.borderRadius));
  const line = styled("bp3-divider", (style) => style.borderRightColor);
  return {
    appearance: lightnessOf(page) < 0.5 ? "dark" : "light",
    skin: {
      font: body.fontFamily,
      textFont: of(".rm-block-text")?.fontFamily ?? body.fontFamily,
      size: Number.parseFloat(body.fontSize) || 14,
      ink: of(".roam-body-main")?.color ?? body.color,
      muted: styled("bp3-text-muted", (style) => style.color),
      page,
      panel: isBlank(side) ? page : side,
      line: isBlank(line) ? "rgba(16, 22, 26, 0.15)" : line,
      accent: isBlank(accent) ? "#137cbd" : accent,
      radius: Number.isFinite(radius) ? radius : 3,
    },
  };
};

export const createRoamHost = async ({
  api,
  openSurface,
  closeDialog,
  storage = window.localStorage,
}: {
  api: RoamApi;
  openSurface: Host["openSurface"];
  closeDialog: Host["closeDialog"];
  storage?: Storage;
}): Promise<RoamHost> => {
  const graph: string = api.graph.name;
  const keyOf = (key: string): string => `dg-contract:${graph}:${key}`;

  const deviceId = ((): string => {
    const existing = storage.getItem(keyOf("device"));
    if (existing) return existing;
    const id = uuidv7();
    storage.setItem(keyOf("device"), id);
    return id;
  })();

  const q = (query: string, ...args: unknown[]): unknown[][] =>
    api.data.fast.q(query, ...args) as unknown[][];

  const pageUid = (title: string): string | null =>
    (q(
      "[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]",
      title,
    )[0]?.[0] as string | undefined) ?? null;

  const ensurePage = async (title: string): Promise<string> => {
    const existing = pageUid(title);
    if (existing) return existing;
    const uid: string = api.util.generateUID();
    await api.data.page.create({ page: { title, uid } });
    return uid;
  };

  const logs = (): PulledBlock[] => {
    const uid = pageUid(RECORDS_PAGE);
    if (!uid) return [];
    const page = api.data.pull(
      `[{:block/children [:block/uid :block/string :block/order {:block/children [:block/uid :block/order :block/props]}]}]`,
      [":block/uid", uid],
    ) as PulledBlock | null;
    return byOrder(page?.[":block/children"]).filter((block) =>
      (block[":block/string"] ?? "").startsWith("device "),
    );
  };

  const recordsIn = (block: PulledBlock): DgRecord[] => {
    const props = block[":block/props"] ?? {};
    const text = props[`:${PROP}`] ?? props[PROP];
    return typeof text === "string" ? (JSON.parse(text) as DgRecord[]) : [];
  };

  const ownLog = async (): Promise<string> => {
    const label = `device ${deviceId}`;
    const found = logs().find((block) => block[":block/string"] === label);
    if (found) return found[":block/uid"];
    const parent = await ensurePage(RECORDS_PAGE);
    const uid: string = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": parent, order: "last" },
      block: { string: label, uid },
    });
    return uid;
  };

  const appendBatch = async (log: string, records: DgRecord[]): Promise<void> => {
    const uid: string = api.util.generateUID();
    await api.data.block.create({
      location: { "parent-uid": log, order: "last" },
      block: { string: "", uid },
    });
    // Props, not the block string: Roam parses [[...]] in strings into real page
    // references, so a record's text would otherwise pollute the graph.
    await api.data.block.update({
      block: { uid, props: { [PROP]: JSON.stringify(records) } },
    });
  };

  const spaceId = async (): Promise<string> => {
    const uid = await ensurePage(RECORDS_PAGE);
    const page = api.data.pull("[:block/props]", [":block/uid", uid]) as {
      ":block/props"?: Record<string, unknown>;
    } | null;
    const props = page?.[":block/props"] ?? {};
    const existing = props[":dg-space"] ?? props["dg-space"];
    if (typeof existing === "string") return existing;
    const id = uuidv7();
    await api.data.page.update({
      page: { uid, props: { "dg-space": id } },
    });
    return id;
  };

  const isOwnPage = (title: string): boolean =>
    title.startsWith("roam/js/discourse-graph");

  const pages = (): TextSummary[] =>
    (
      q(
        "[:find ?u ?t ?e :where [?p :node/title ?t] [?p :block/uid ?u] [?p :edit/time ?e]]",
      ) as [string, string, number][]
    )
      .filter(([, title]) => !isOwnPage(title))
      .map(([ref, title, edited]) => ({
        ref,
        title,
        modifiedAt: new Date(edited).toISOString(),
        scope: "page" as const,
      }))
      .sort((a, b) => (a.title < b.title ? -1 : 1));

  const pullUnit = (ref: HostRef): PulledBlock | null =>
    api.data.pull(
      "[:block/uid :node/title :block/string :block/order :edit/time {:block/refs [:block/uid :node/title]} {:block/children ...}]",
      [":block/uid", ref],
    ) as PulledBlock | null;

  const summaryOf = (block: PulledBlock): TextSummary => ({
    ref: block[":block/uid"],
    title: block[":node/title"] ?? block[":block/string"] ?? "",
    modifiedAt: new Date(block[":edit/time"] ?? 0).toISOString(),
    scope: block[":node/title"] === undefined ? "part" : "page",
  });

  const notFound = (ref: string): ReturnType<typeof fail> =>
    fail("not-found", `No text for ${ref}. It may have been removed.`);

  const exists = (ref: HostRef): boolean => {
    const unit = pullUnit(ref);
    return Boolean(unit && unit[":block/uid"]);
  };

  const editing = (): { input: HTMLTextAreaElement; start: number; end: number; value: string } | null => {
    const input = document.activeElement as HTMLTextAreaElement | null;
    if (!input?.matches?.("textarea.rm-block-input")) return null;
    const { selectionStart: start, selectionEnd: end, value } = input;
    return start === end ? null : { input, start, end, value };
  };

  const listeners = new Set<HostListener>();
  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };

  let cursorBlock: string | null = null;
  let seenPages = new Map<string, { title: string; stamp: number }>();
  let seenRecords = -1;
  let seenFocus: string | null | undefined;
  let timer: number | undefined;

  const pageStamps = (): Map<string, { title: string; stamp: number }> => {
    const latest = new Map<string, number>(
      q(
        "[:find ?u (max ?e) :where [?b :block/page ?p] [?b :edit/time ?e] [?p :block/uid ?u]]",
      ) as [string, number][],
    );
    return new Map(
      pages().map(({ ref, title, modifiedAt }) => [
        ref,
        {
          title,
          stamp: Math.max(latest.get(ref) ?? 0, Date.parse(modifiedAt)),
        },
      ]),
    );
  };

  const recordCount = (): number =>
    logs().reduce(
      (total, log) => total + (log[":block/children"]?.length ?? 0),
      0,
    );

  const poll = async (): Promise<void> => {
    const current = pageStamps();
    for (const [ref, now] of current) {
      const before = seenPages.get(ref);
      if (!before) emit({ type: "text-changed", ref });
      else if (before.title !== now.title) {
        emit({ type: "text-renamed", ref, title: now.title });
      } else if (before.stamp !== now.stamp) {
        emit({ type: "text-changed", ref });
      }
    }
    for (const ref of seenPages.keys()) {
      if (!current.has(ref)) emit({ type: "text-removed", ref });
    }
    seenPages = current;

    const count = recordCount();
    if (seenRecords >= 0 && count !== seenRecords) {
      emit({ type: "records-changed" });
    }
    seenRecords = count;

    const focus = ((await api.ui.mainWindow.getOpenPageOrBlockUid()) ??
      null) as string | null;
    if (seenFocus !== undefined && focus !== seenFocus) {
      emit({ type: "focus-changed", ref: focus });
    }
    seenFocus = focus;

    const focused = api.ui.getFocusedBlock?.() as
      | { "block-uid"?: string }
      | null;
    if (focused?.["block-uid"]) cursorBlock = focused["block-uid"];
  };

  // Theme CSS arrives as style elements and body classes, not as a Roam event.
  let seenLook = "";
  const noticeLook = (): void => {
    const look = lookNow();
    const key = JSON.stringify(look);
    if (key === seenLook) return;
    seenLook = key;
    emit({ type: "appearance-changed", ...look });
  };
  const looks = new MutationObserver(noticeLook);

  const start = (): void => {
    if (timer !== undefined) return;
    seenPages = pageStamps();
    seenRecords = recordCount();
    seenLook = JSON.stringify(lookNow());
    looks.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    looks.observe(document.head, { childList: true });
    timer = window.setInterval(() => void poll(), POLL_MS);
  };

  const stop = (): void => {
    if (timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
    seenFocus = undefined;
    looks.disconnect();
  };

  let known: Set<string> | null = null;
  let knownCount = -1;
  const loadKnown = (): Set<string> => {
    const count = recordCount();
    if (known && count === knownCount) return known;
    const set = new Set<string>();
    for (const log of logs()) {
      for (const batch of log[":block/children"] ?? []) {
        for (const record of recordsIn(batch)) set.add(canonicalJson(record));
      }
    }
    known = set;
    knownCount = count;
    return set;
  };

  let writes: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writes.then(work, work);
    writes = next.catch(() => undefined);
    return next;
  };

  const host: Host = {
    describe: async () =>
      ok({
        contract: CONTRACT_VERSION,
        host: "roam",
        adapterVersion: "0.0.1",
        space: { id: await spaceId(), name: graph },
        person: {
          id: (api.user.uid() as string | null) ?? deviceId,
          name: "Graph member",
        },
        ...lookNow(),
        sharedSpace: api.graph.type !== "offline",
      }),

    listText: async ({ after, limit }) => {
      const all = pages();
      const start = after ? Number(after) : 0;
      const end = Math.min(start + limit, all.length);
      return ok({
        items: all.slice(start, end),
        next: String(end),
        done: end >= all.length,
      });
    },

    readText: async ({ ref }) => {
      const unit = pullUnit(ref);
      if (!unit?.[":block/uid"]) return notFound(ref);
      const tree = collect(unit);
      const value: TextUnit = {
        ...summaryOf(unit),
        body: toMarkdown(unit[":block/children"]),
        tags: tree.flatMap((block) => tagsIn(block[":block/string"] ?? "")),
        links: tree.flatMap((block) =>
          (block[":block/refs"] ?? []).map((target) => target[":block/uid"]),
        ),
      };
      return ok(value);
    },

    searchText: async ({ query, tag, limit }) => {
      let matches = pages();
      if (query !== undefined) {
        matches = matches.filter((page) => page.title.includes(query));
      }
      if (tag !== undefined) {
        const tagged = new Set(
          (
            q(
              "[:find ?u :in $ ?tag :where [?t :node/title ?tag] [?b :block/refs ?t] [?b :block/page ?p] [?p :block/uid ?u]]",
              tag,
            ) as [string][]
          ).map(([uid]) => uid),
        );
        matches = matches.filter((page) => tagged.has(page.ref));
      }
      return ok(matches.slice(0, limit));
    },

    listBacklinks: async ({ ref }) => {
      if (!exists(ref)) return notFound(ref);
      const uids = new Set(
        (
          q(
            "[:find ?u :in $ ?uid :where [?t :block/uid ?uid] [?b :block/refs ?t] [?b :block/page ?p] [?p :block/uid ?u]]",
            ref,
          ) as [string][]
        ).map(([uid]) => uid),
      );
      return ok(pages().filter((page) => uids.has(page.ref)));
    },

    createText: async ({ title, body = "", unit }) => {
      const existing = pageUid(title);
      if (existing) return fail("conflict", `"${title}" already exists.`, existing);
      const uid: string = api.util.generateUID();
      await api.data.page.create({ page: { title, uid } });
      if (unit) await api.data.block.update({ block: { uid, props: { [UNIT_PROP]: unit } } });
      if (body) {
        await api.data.block.fromMarkdown({
          location: { "parent-uid": uid, order: "last" },
          "markdown-string": body,
        });
      }
      return ok(summaryOf(pullUnit(uid)!));
    },

    removeText: async ({ ref }) => {
      if (!exists(ref)) return notFound(ref);
      await api.data.page.delete({ page: { uid: ref } });
      return ok(null);
    },

    // A graph has no place for a file a person only wants to read, so it goes to their downloads.
    saveFile: async ({ name, mediaType, dataBase64 }) => {
      const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return ok({ where: "your downloads" });
    },

    fileInFolder: async ({ ref, folder }) => {
      const unit = pullUnit(ref);
      const title = unit?.[":node/title"];
      if (!title) return notFound(ref);
      const page = `Folder/${folder}`;
      let uid = pageUid(page);
      if (!uid) {
        uid = api.util.generateUID() as string;
        await api.data.page.create({ page: { title: page, uid } });
      }
      await api.data.block.create({ location: { "parent-uid": uid, order: "last" }, block: { string: `[[${title}]]` } });
      return ok(null);
    },

    renameText: async ({ ref, title }) => {
      if (!exists(ref)) return notFound(ref);
      if (pageUid(title)) return fail("conflict", `"${title}" already exists.`);
      await api.data.page.update({ page: { uid: ref, title } });
      return ok(summaryOf(pullUnit(ref)!));
    },

    // Roam UIDs already survive renames and moves.
    pinText: async ({ ref, unit }) => {
      if (!exists(ref)) return notFound(ref);
      if (unit) await api.data.block.update({ block: { uid: ref, props: { [UNIT_PROP]: unit } } });
      return ok(summaryOf(pullUnit(ref)!));
    },

    listRecords: async ({ after, limit }) => {
      const cursor = (after ? JSON.parse(after) : {}) as Record<
        string,
        [number, number]
      >;
      const items: DgRecord[] = [];
      let done = true;
      for (const log of logs()) {
        const uid = log[":block/uid"];
        const batches = byOrder(log[":block/children"]);
        let [batch, offset] = cursor[uid] ?? [0, 0];
        while (batch < batches.length && items.length < limit) {
          const records = recordsIn(batches[batch]!);
          const take = records.slice(offset, offset + (limit - items.length));
          items.push(...take);
          offset += take.length;
          if (offset >= records.length) {
            batch += 1;
            offset = 0;
          }
        }
        cursor[uid] = [batch, offset];
        if (batch < batches.length) done = false;
      }
      return ok({ items, next: JSON.stringify(cursor), done });
    },

    putRecords: async ({ records }) =>
      inOrder(async () => {
        const problems = records.flatMap((record) => validateRecord(record));
        if (problems.length > 0) return fail("invalid", problems.join("; "));
        const seen = loadKnown();
        const fresh = records.filter((record) => !seen.has(canonicalJson(record)));
        if (fresh.length === 0) return ok({ stored: 0 });
        const log = await ownLog();
        for (let i = 0; i < fresh.length; i += BATCH) {
          await appendBatch(log, fresh.slice(i, i + BATCH));
        }
        for (const record of fresh) seen.add(canonicalJson(record));
        known = seen;
        knownCount = recordCount();
        return ok({ stored: fresh.length });
      }),

    readAsset: async ({ ref }) => {
      if (ref.startsWith(LOCAL_ASSET)) {
        const unit = api.data.pull("[:block/props]", [
          ":block/uid",
          ref.slice(LOCAL_ASSET.length),
        ]) as { ":block/props"?: Record<string, unknown> } | null;
        const stored = unit?.[":block/props"]?.[":dg-asset"];
        return typeof stored === "string"
          ? ok(JSON.parse(stored) as Asset)
          : fail("not-found", `No asset ${ref}.`);
      }
      try {
        const file = (await api.file.get({ url: ref })) as File;
        const asset: Asset = {
          name: file.name,
          mime: file.type,
          dataUrl: await fileToDataUrl(file),
        };
        return ok(asset);
      } catch (error) {
        return fail("not-found", `No asset ${ref}: ${String(error)}`);
      }
    },

    writeAsset: async ({ asset }) => {
      // Offline graphs store uploads at local-asset:// URLs that nothing in the
      // page can read back: file.get rejects them, and fetch and <img> both fail.
      if (api.graph.type === "offline") {
        const parent = await ensurePage(ASSETS_PAGE);
        const uid: string = api.util.generateUID();
        await api.data.block.create({
          location: { "parent-uid": parent, order: "last" },
          block: { string: "", uid },
        });
        await api.data.block.update({
          block: { uid, props: { "dg-asset": JSON.stringify(asset) } },
        });
        return ok({ ref: `${LOCAL_ASSET}${uid}` });
      }
      const ref = (await api.file.upload({
        file: await dataUrlToFile(asset),
        toast: { hide: true },
      })) as string;
      const url = ref.replace(/^!\[\]\(|\)$/g, "");
      if (asset.mime === "application/pdf") {
        const parent = await ensurePage(PDFS_PAGE);
        await api.data.block.create({ location: { "parent-uid": parent, order: "last" }, block: { string: `{{[[pdf]]: ${url}}}` } });
      }
      return ok({ ref: url });
    },

    // PDFs are embeds in blocks, or, in an offline graph, assets kept in block props.
    listFiles: async ({ extensions, limit }) => {
      const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));
      const found = new Map<string, { ref: string; name: string; mime: string; modifiedAt: string; at: number }>();
      if (wanted.has("pdf")) {
        const rows = q("[:find ?s ?t :where [?b :block/string ?s] [(clojure.string/includes? ?s \"pdf\")] [?b :edit/time ?t]]");
        for (const [text, time] of rows as [string, number][]) {
          for (const match of text.matchAll(PDF_EMBED)) {
            const url = match[1]!;
            if (!found.has(url)) found.set(url, { ref: url, name: fileNameOf(url), mime: "application/pdf", modifiedAt: new Date(time).toISOString(), at: time });
          }
        }
      }
      const kept = q("[:find ?u ?p ?t :where [?b :block/props ?p] [?b :block/uid ?u] [?b :edit/time ?t]]") as [string, Record<string, unknown>, number][];
      for (const [uid, props, time] of kept) {
        const stored = props?.[":dg-asset"] ?? props?.["dg-asset"];
        if (typeof stored !== "string") continue;
        const asset = JSON.parse(stored) as Asset;
        if (!wanted.has(asset.name.split(".").pop()?.toLowerCase() ?? "")) continue;
        found.set(`${LOCAL_ASSET}${uid}`, { ref: `${LOCAL_ASSET}${uid}`, name: asset.name, mime: asset.mime, modifiedAt: new Date(time).toISOString(), at: time });
      }
      return ok([...found.values()].sort((a, b) => b.at - a.at).slice(0, limit).map(({ at: _at, ...file }) => file));
    },

    getFocus: async () =>
      ok({
        ref: ((await api.ui.mainWindow.getOpenPageOrBlockUid()) ?? null) as
          | string
          | null,
      }),

    reveal: async ({ ref, placement }) => {
      const unit = pullUnit(ref);
      if (!unit?.[":block/uid"]) return notFound(ref);
      // An open custom view covers the main window, so openPage would change the
      // page behind it and leave the person looking at the panel.
      const view = (await api.ui.mainWindow.getOpenView()) as {
        type?: string;
      } | null;
      // The same goes for a canvas on its own page, which a person is still working in.
      if (placement === "side" || view?.type === "custom" || document.getElementById("dg-canvas-page")) {
        await api.ui.rightSidebar.open();
        await api.ui.rightSidebar.addWindow({
          window: { type: "outline", "block-uid": ref },
        });
      } else if (unit[":node/title"] !== undefined) {
        await api.ui.mainWindow.openPage({ page: { uid: ref } });
      } else {
        await api.ui.mainWindow.openBlock({ block: { uid: ref } });
      }
      return ok(null);
    },

    readSelection: async () => {
      const found = editing();
      return ok(found ? { text: found.value.slice(found.start, found.end) } : null);
    },

    // The block is being edited, so its textarea holds the truth. Writing there
    // keeps it, where an API update would be lost when the block loses focus.
    replaceSelection: async ({ ref }) => {
      const found = editing();
      if (!found) return fail("no-target", "Nothing is selected.");
      const unit = pullUnit(ref);
      if (!unit) return notFound(ref);
      const link = `[[${summaryOf(unit).title}]]`;
      const next = found.value.slice(0, found.start) + link + found.value.slice(found.end);
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(found.input, next);
      found.input.dispatchEvent(new Event("input", { bubbles: true }));
      found.input.setSelectionRange(found.start + link.length, found.start + link.length);
      return ok(null);
    },

    insertLink: async ({ ref, label }) => {
      const target = pullUnit(ref);
      if (!target?.[":block/uid"]) return notFound(ref);
      const block = cursorBlock ? pullUnit(cursorBlock) : null;
      if (!block?.[":block/uid"]) return fail("no-target", "No cursor to insert at.");
      const title = target[":node/title"];
      const link = title
        ? `[[${title}]]`
        : `((${ref}))`;
      const text = `${block[":block/string"] ?? ""} ${label ? `[${label}](${link})` : link}`.trim();
      await api.data.block.update({ block: { uid: cursorBlock, string: text } });
      return ok(null);
    },

    openSurface,
    closeDialog,

    getLocal: async ({ key }) => {
      const value = storage.getItem(keyOf(`local:${key}`));
      return ok(value === null ? null : (JSON.parse(value) as Json));
    },
    setLocal: async ({ key, value }) => {
      storage.setItem(keyOf(`local:${key}`), JSON.stringify(value));
      return ok(null);
    },

    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };

  return {
    host: neverRejects(host),
    setCursor: (uid) => {
      cursorBlock = uid;
    },
    dispose: () => {
      stop();
      listeners.clear();
    },
  };
};

/** Writes as another device would, for tests and for adapters that import. */
export const writeForeignRecord = async ({
  api,
  record,
}: {
  api: RoamApi;
  record: DgRecord;
}): Promise<void> => {
  const pageId = api.data.fast.q(
    "[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]",
    RECORDS_PAGE,
  )[0][0] as string;
  const label = "device another-device";
  const page = api.data.pull(
    "[{:block/children [:block/uid :block/string]}]",
    [":block/uid", pageId],
  ) as PulledBlock;
  let log = page[":block/children"]?.find(
    (block) => block[":block/string"] === label,
  )?.[":block/uid"];
  if (!log) {
    log = api.util.generateUID() as string;
    await api.data.block.create({
      location: { "parent-uid": pageId, order: "last" },
      block: { string: label, uid: log },
    });
  }
  const uid: string = api.util.generateUID();
  await api.data.block.create({
    location: { "parent-uid": log, order: "last" },
    block: { string: "", uid },
  });
  await api.data.block.update({
    block: { uid, props: { [PROP]: JSON.stringify([record]) } },
  });
};
