import { cursorAfter, logLines, parseLogLine, resumeAt, type LogCursor } from "@dg/contract/log.ts";
import {
  MarkdownView,
  TFile,
  getAllTags,
  normalizePath,
  type App,
  type EventRef,
  type Plugin,
  type WorkspaceLeaf,
} from "obsidian";
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
  type Page,
  type Skin,
  type TextSummary,
} from "@dg/contract/host.ts";

export const ROOT = "discourse-graph";
export const RECORDS = `${ROOT}/records`;
const ASSETS = `${ROOT}/assets`;
const UNIT_FOLDERS = "Discourse Units";
const PAPER_FILES = "Paper files";
const TABLES = "Discourse tables";
const PICTURES = "Discourse pictures";
const ID_KEY = "dg-id";
// A raw rename on disk arrives as a delete then a create, so a delete waits this
// long to see whether the same id comes back at a new path.
const RENAME_WINDOW_MS = 1200;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  pdf: "application/pdf",
};

const splitName = (name: string): [string, string] => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, "pdf"];
};

const sanitize = (title: string): string =>
  title.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim();

// Most file systems stop at 255 bytes, and a sentence of evidence can run past that.
const MAX_NAME_BYTES = 200;

/** The whole title stays on the unit. This only decides what the file is called. */
const fileName = (title: string, unit?: string): string => {
  const whole = sanitize(title);
  const encoder = new TextEncoder();
  if (encoder.encode(whole).length <= MAX_NAME_BYTES) return whole;
  let short = whole.slice(0, MAX_NAME_BYTES);
  while (encoder.encode(short).length > MAX_NAME_BYTES) short = short.slice(0, -1);
  const atWord = short.slice(0, short.lastIndexOf(" ")).trim() || short;
  // Two long claims can open the same way, so the end of the id keeps them apart.
  return unit ? `${atWord}... ${unit.slice(-6)}` : `${atWord}...`;
};

const stripFrontmatter = (text: string): string =>
  text.replace(/^---\n[\s\S]*?\n---\n?/, "");

/** Today's plugin already gives each node an id, so importing never edits a note. */
const LEGACY_ID_KEY = "nodeInstanceId";

const idFromText = (text: string): string | null => {
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  for (const key of [ID_KEY, LEGACY_ID_KEY]) {
    const found = frontmatter.match(new RegExp(`^${key}:\\s*(\\S+)`, "m"))?.[1];
    if (found) return found;
  }
  return null;
};

type LocalData = {
  deviceId?: string;
  personId?: string;
  local?: Record<string, Json>;
};

export type ObsidianHost = {
  host: Host;
  /** Synchronous, for the editor's draw path. */
  refOfFile: (file: TFile) => HostRef;
  forgetCursor: () => void;
  useCursor: (view: MarkdownView) => void;
  cursorView: () => MarkdownView | null;
  dispose: () => void;
};

export const SURFACE_VIEW = "dg-contract-panel";

const appearanceNow = (): Appearance =>
  document.body.classList.contains("theme-dark") ? "dark" : "light";

/** Read from the theme's own variables, so a custom theme carries into frames. */
const skinNow = (): Skin => {
  const style = getComputedStyle(document.body);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  // "??" marks font slots the person hasn't set.
  const fonts = (name: string): string => read(name).replace(/"\?\?",\s*/g, "");
  const px = (name: string, fallback: number): number =>
    Number.parseFloat(read(name)) || fallback;
  return {
    font: fonts("--font-interface"),
    textFont: fonts("--font-text"),
    size: px("--font-ui-small", 13),
    ink: read("--text-normal"),
    muted: read("--text-muted"),
    page: read("--background-primary"),
    panel: read("--background-secondary"),
    line: read("--background-modifier-border"),
    accent: read("--interactive-accent"),
    radius: px("--radius-s", 4),
  };
};

const DEVICE_KEY = "discourse-graphs-device";

export const createObsidianHost = async ({
  app,
  plugin,
  openSurface,
  closeDialog,
}: {
  app: App;
  plugin: Plugin;
  openSurface: Host["openSurface"];
  closeDialog: Host["closeDialog"];
}): Promise<ObsidianHost> => {
  const { vault, metadataCache, workspace, fileManager } = app;
  const listeners = new Set<HostListener>();
  const emit = (event: HostEvent): void => {
    for (const listener of listeners) listener(event);
  };

  const idToPath = new Map<string, string>();
  const pathToId = new Map<string, string>();
  const remember = (id: string, path: string): void => {
    idToPath.set(id, path);
    pathToId.set(path, id);
  };

  const isText = (file: unknown): file is TFile =>
    file instanceof TFile &&
    file.extension === "md" &&
    !file.path.startsWith(`${ROOT}/`);

  const cachedId = (file: TFile): string | undefined => {
    const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
    return (frontmatter?.[ID_KEY] ?? frontmatter?.[LEGACY_ID_KEY]) as string | undefined;
  };

  /** A synced copy ("Note 2.md") carries the same id, and the first file keeps it. */
  const ownedElsewhere = (id: string, file: TFile): boolean => {
    const owner = idToPath.get(id);
    return Boolean(owner && owner !== file.path && vault.getFileByPath(owner));
  };

  const idOf = async (file: TFile): Promise<string | null> => {
    const known = pathToId.get(file.path);
    if (known) return known;
    const id = cachedId(file) ?? idFromText(await vault.cachedRead(file));
    if (!id || ownedElsewhere(id, file)) return null;
    remember(id, file.path);
    return id;
  };

  const refOf = async (file: TFile): Promise<HostRef> => {
    const id = await idOf(file);
    return id ? `id:${id}` : `path:${file.path}`;
  };

  const refOfFile = (file: TFile): HostRef => {
    const id = pathToId.get(file.path) ?? cachedId(file);
    return id && !ownedElsewhere(id, file) ? `id:${id}` : `path:${file.path}`;
  };

  const textFiles = (): TFile[] =>
    vault
      .getMarkdownFiles()
      .filter(isText)
      .sort((a, b) => (a.path < b.path ? -1 : 1));

  const resolve = async (ref: HostRef): Promise<TFile | null> => {
    if (ref.startsWith("path:")) return vault.getFileByPath(ref.slice(5));
    const id = ref.slice(3);
    const known = idToPath.get(id);
    const file = known ? vault.getFileByPath(known) : null;
    if (file) {
      const current = idFromText(await vault.read(file));
      if (current === id) return file;
    }
    for (const candidate of textFiles()) {
      const text = await vault.cachedRead(candidate);
      if (idFromText(text) === id) {
        remember(id, candidate.path);
        return candidate;
      }
    }
    return null;
  };

  const summary = async (file: TFile): Promise<TextSummary> => ({
    ref: await refOf(file),
    title: file.basename,
    modifiedAt: new Date(file.stat.mtime).toISOString(),
    scope: "page",
  });

  const notFound = (ref: string): ReturnType<typeof fail> =>
    fail("not-found", `No text for ${ref}. It may have been removed.`);

  let data: LocalData = ((await plugin.loadData()) as LocalData | null) ?? {};
  const saveData = async (): Promise<void> => plugin.saveData(data);
  // A device's id is kept on the device. The plugin's own data file travels with the vault, and two
  // devices that shared an id would write to one log, which a sync tool then has to merge.
  let deviceId = (app.loadLocalStorage(DEVICE_KEY) as string | null) ?? null;
  if (!deviceId) {
    // The first device to start after this change keeps the id the vault had. Any other makes its own.
    deviceId = data.deviceId ?? uuidv7();
    app.saveLocalStorage(DEVICE_KEY, deviceId);
    if (data.deviceId) {
      delete data.deviceId;
      await saveData();
    }
  }
  if (!data.personId) {
    data.personId = uuidv7();
    await saveData();
  }
  const deviceLog = `${RECORDS}/${deviceId}.jsonl`;

  const ensureFolder = async (path: string): Promise<void> => {
    if (!(await vault.adapter.exists(path))) await vault.createFolder(path);
  };

  const spaceId = async (): Promise<string> => {
    const path = `${ROOT}/space.json`;
    if (await vault.adapter.exists(path)) {
      return (JSON.parse(await vault.adapter.read(path)) as { id: string }).id;
    }
    await ensureFolder(ROOT);
    const id = uuidv7();
    await vault.adapter.write(path, JSON.stringify({ id }));
    return id;
  };

  const recordFiles = async (): Promise<string[]> => {
    if (!(await vault.adapter.exists(RECORDS))) return [];
    const { files } = await vault.adapter.list(RECORDS);
    return files.filter((file) => file.endsWith(".jsonl")).sort();
  };

  // Whole lines only. What a sync tool left half written, joined or marked is skipped when read as a record.
  const readLines = async (path: string): Promise<string[]> => logLines(await vault.adapter.read(path));

  let known: Set<string> | null = null;
  const loadKnown = async (): Promise<Set<string>> => {
    if (known) return known;
    const set = new Set<string>();
    for (const path of await recordFiles()) {
      for (const line of await readLines(path)) {
        const record = parseLogLine(line);
        if (record) set.add(canonicalJson(record));
      }
    }
    known = set;
    return set;
  };

  let writes: Promise<unknown> = Promise.resolve();
  const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writes.then(work, work);
    writes = next.catch(() => undefined);
    return next;
  };

  let lastView: MarkdownView | null = null;
  let beside: WorkspaceLeaf | null = null;

  /**
   * Text opens beside a panel and never replaces it, the same as Roam's sidebar.
   * Further cards reuse that pane, so a reading session doesn't pile up splits.
   */
  const besideSurface = (): WorkspaceLeaf => {
    const recent = workspace.getMostRecentLeaf();
    const fromSurface = recent?.view.getViewType() === SURFACE_VIEW;
    if (!fromSurface) return workspace.getLeaf(false);
    if (beside && workspace.getLeafById((beside as WorkspaceLeaf & { id: string }).id)) return beside;
    beside = workspace.getLeaf("split", "vertical");
    return beside;
  };
  const removals = new Map<string, number>();

  const noticeArrival = async (file: TFile): Promise<void> => {
    const text = await vault.cachedRead(file);
    const id = idFromText(text);
    if (!id) return;
    const pending = removals.get(id);
    const moved = idToPath.get(id) !== file.path;
    remember(id, file.path);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      removals.delete(id);
      emit({ type: "text-renamed", ref: `id:${id}`, title: file.basename });
    } else if (moved) {
      emit({ type: "text-renamed", ref: `id:${id}`, title: file.basename });
    }
  };

  const refs: EventRef[] = [
    vault.on("create", (file) => {
      if (file.path.startsWith(`${RECORDS}/`)) {
        known = null;
        emit({ type: "records-changed" });
      } else if (isText(file)) void noticeArrival(file);
    }),
    vault.on("modify", (file) => {
      if (file.path.startsWith(`${RECORDS}/`)) {
        known = null;
        emit({ type: "records-changed" });
      } else if (isText(file)) {
        void refOf(file).then((ref) => emit({ type: "text-changed", ref }));
      }
    }),
    vault.on("delete", (file) => {
      const id = pathToId.get(file.path);
      pathToId.delete(file.path);
      if (!id) {
        if (file instanceof TFile && file.extension === "md") {
          emit({ type: "text-removed", ref: `path:${file.path}` });
        }
        return;
      }
      // A rename on disk reports the new path first, so by now the note has
      // already arrived somewhere else and this is only its old path going away.
      if (idToPath.get(id) !== file.path) return;
      removals.set(
        id,
        window.setTimeout(() => {
          removals.delete(id);
          idToPath.delete(id);
          emit({ type: "text-removed", ref: `id:${id}` });
        }, RENAME_WINDOW_MS),
      );
    }),
    vault.on("rename", (file, oldPath) => {
      const id = pathToId.get(oldPath);
      pathToId.delete(oldPath);
      if (!isText(file)) return;
      if (id) remember(id, file.path);
      // Moving a note isn't renaming it, and a file's name can be shorter than the unit's title.
      if (oldPath.split("/").pop() === file.name) return;
      void refOf(file).then((ref) =>
        emit({ type: "text-renamed", ref, title: file.basename }),
      );
    }),
    workspace.on("file-open", (file) => {
      if (!file) {
        emit({ type: "focus-changed", ref: null });
        return;
      }
      void refOf(file).then((ref) => emit({ type: "focus-changed", ref }));
    }),
    workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view instanceof MarkdownView) lastView = leaf.view;
    }),
    workspace.on("css-change", () => {
      emit({
        type: "appearance-changed",
        appearance: appearanceNow(),
        skin: skinNow(),
      });
    }),
  ];

  const pageOfCursor = (after?: string): Record<string, LogCursor | number> =>
    after ? (JSON.parse(after) as Record<string, LogCursor | number>) : {};


  const host: Host = {
    describe: async () =>
      ok({
        contract: CONTRACT_VERSION,
        host: "obsidian",
        adapterVersion: "0.0.1",
        space: { id: await spaceId(), name: vault.getName() },
        person: { id: data.personId!, name: "Vault owner" },
        appearance: appearanceNow(),
        skin: skinNow(),
        sharedSpace: false,
        textForEveryUnit: true,
      }),

    listText: async ({ after, limit }) => {
      const files = textFiles();
      const start = after ? Number(after) : 0;
      const end = Math.min(start + limit, files.length);
      const items = await Promise.all(files.slice(start, end).map(summary));
      const page: Page<TextSummary> = {
        items,
        next: String(end),
        done: end >= files.length,
      };
      return ok(page);
    },

    readText: async ({ ref }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      const cache = metadataCache.getFileCache(file);
      const links = await Promise.all(
        (cache?.links ?? []).flatMap((link) => {
          const target = metadataCache.getFirstLinkpathDest(link.link, file.path);
          return target ? [refOf(target)] : [];
        }),
      );
      return ok({
        ...(await summary(file)),
        body: stripFrontmatter(await vault.read(file)),
        tags: (cache ? (getAllTags(cache) ?? []) : []).map((tag) => tag.slice(1)),
        links,
      });
    },

    searchText: async ({ query, tag, limit }) => {
      const matches = textFiles().filter((file) => {
        const titled = query === undefined || file.basename.includes(query);
        if (!titled) return false;
        if (tag === undefined) return true;
        const cache = metadataCache.getFileCache(file);
        return (cache ? (getAllTags(cache) ?? []) : []).includes(`#${tag}`);
      });
      return ok(await Promise.all(matches.slice(0, limit).map(summary)));
    },

    listBacklinks: async ({ ref }) => {
      const target = await resolve(ref);
      if (!target) return notFound(ref);
      const sources = Object.entries(metadataCache.resolvedLinks)
        .filter(([, links]) => links[target.path] !== undefined)
        .flatMap(([path]) => {
          const file = vault.getFileByPath(path);
          return file && isText(file) ? [file] : [];
        });
      return ok(await Promise.all(sources.map(summary)));
    },

    createText: async ({ title, body = "", unit }) => {
      const stored = fileName(title, unit);
      const path = normalizePath(`${stored}.md`);
      const existing = vault.getFileByPath(path);
      if (existing) {
        return fail("conflict", `"${stored}" already exists.`, await refOf(existing));
      }
      const id = unit ?? uuidv7();
      const file = await vault.create(path, `---\n${ID_KEY}: ${id}\n---\n${body}`);
      remember(id, file.path);
      return ok(await summary(file));
    },

    removeText: async ({ ref }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      await fileManager.trashFile(file);
      return ok(null);
    },

    saveFile: async ({ name, dataBase64 }) => {
      if (!vault.getFolderByPath(PAPER_FILES)) await vault.createFolder(PAPER_FILES);
      const path = normalizePath(`${PAPER_FILES}/${sanitize(name)}`);
      const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
      const held = vault.getFileByPath(path);
      if (held) await vault.modifyBinary(held, bytes.buffer);
      else await vault.createBinary(path, bytes.buffer);
      return ok({ where: path });
    },

    readLocalFile: async ({ path }) => {
      // Only a PDF, and only where a reference library says its file is. Read in place, never copied into the vault.
      if (!/\.pdf$/i.test(path)) return fail("unavailable", "Only PDFs are read from outside the vault.");
      const fs = (window as unknown as { require?: (name: string) => { promises: { readFile: (path: string) => Promise<Uint8Array> } } }).require?.("fs");
      if (!fs) return fail("unavailable", "Files outside the vault can only be read in Obsidian's desktop app.");
      const name = path.split(/[\\/]/).pop() ?? "Document.pdf";
      try {
        const bytes = new Uint8Array(await fs.promises.readFile(path));
        let binary = "";
        for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
        return ok({ name, mime: "application/pdf", dataUrl: `data:application/pdf;base64,${btoa(binary)}` });
      } catch {
        return fail("not-found", `${name} isn't where Zotero says it is. Open it in Zotero once so it downloads.`);
      }
    },

    listTagged: async ({ tags, limit }) => {
      const wanted = new Set(tags.map((tag) => `#${tag}`.toLowerCase()));
      const found: { ref: HostRef; title: string; line: number; text: string; tag: string }[] = [];
      for (const file of textFiles()) {
        const marks = (metadataCache.getFileCache(file)?.tags ?? []).filter((mark) => wanted.has(mark.tag.toLowerCase()));
        if (marks.length === 0) continue;
        const lines = (await vault.cachedRead(file)).split("\n");
        const ref = await refOf(file);
        for (const mark of marks) {
          const line = mark.position.start.line;
          // The line's own words: no tag, no list mark, no checkbox.
          const text = (lines[line] ?? "").replace(new RegExp(`${mark.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`, "i"), "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "").replace(/\s+/g, " ").trim();
          if (text) found.push({ ref, title: file.basename, line, text, tag: mark.tag.slice(1) });
          if (found.length >= limit) return ok(found);
        }
      }
      return ok(found);
    },

    replaceTagged: async ({ ref, line, tag, target }) => {
      const file = await resolve(ref);
      const to = await resolve(target);
      if (!file || !to) return notFound(file ? target : ref);
      const pattern = new RegExp(`#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`, "i");
      let done = false;
      await vault.process(file, (data) => {
        const lines = data.split("\n");
        const held = lines[line];
        // The note may have been edited since it was listed. A line without the tag is left alone.
        if (held === undefined || !pattern.test(held)) return data;
        const lead = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/.exec(held)?.[0] ?? /^\s*/.exec(held)![0];
        lines[line] = `${lead}[[${metadataCache.fileToLinktext(to, file.path, true)}]]`;
        done = true;
        return lines.join("\n");
      });
      return done ? ok(null) : fail("conflict", "That line has changed since it was listed. Look again.");
    },

    openTable: async ({ name, property, value, columns }) => {
      // An Obsidian base: a table over every note whose property says it is this type.
      if (!vault.getFolderByPath(TABLES)) await vault.createFolder(TABLES);
      const path = normalizePath(`${TABLES}/${sanitize(name)}.base`);
      const quoted = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const yaml = [
        "filters:",
        "  and:",
        `    - 'note[${quoted(property)}] == ${quoted(value).replace(/'/g, "''")}'`,
        "properties:",
        "  file.name:",
        "    displayName: Unit",
        ...columns.flatMap((column) => [`  note.${column.property}:`, `    displayName: ${quoted(column.label)}`]),
        "views:",
        "  - type: table",
        `    name: ${quoted(name)}`,
        "    order:",
        "      - file.name",
        ...columns.map((column) => `      - note.${column.property}`),
        "",
      ].join("\n");
      const held = vault.getFileByPath(path);
      // One a person has since arranged is theirs. It is opened as it is.
      const file = held ?? (await vault.create(path, yaml));
      await workspace.getLeaf(false).openFile(file);
      return ok({ where: path });
    },

    fileInFolder: async ({ ref, folder }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      const path = normalizePath(`${UNIT_FOLDERS}/${sanitize(folder)}`);
      if (file.parent?.path === path) return ok(null);
      for (const part of [UNIT_FOLDERS, path]) {
        if (!vault.getFolderByPath(part)) await vault.createFolder(part);
      }
      await fileManager.renameFile(file, normalizePath(`${path}/${file.name}`));
      return ok(null);
    },

    renameText: async ({ ref, title }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      const parent = file.parent?.path;
      const folder = parent && parent !== "/" ? `${parent}/` : "";
      const path = normalizePath(`${folder}${fileName(title)}.md`);
      if (vault.getFileByPath(path)) {
        return fail("conflict", `"${title}" already exists.`);
      }
      await fileManager.renameFile(file, path);
      return ok(await summary(file));
    },

    setLinks: async ({ ref, links, managed, facts = {}, managedFacts = [] }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      const wanted: Record<string, string[]> = {};
      for (const [key, refs] of Object.entries(links)) {
        const texts = new Set<string>();
        for (const other of refs) {
          const target = await resolve(other);
          // The shortest text Obsidian resolves to this file, so two notes of one name in different folders stay apart.
          if (target && target.path !== file.path) texts.add(`[[${metadataCache.fileToLinktext(target, file.path, true)}]]`);
        }
        if (texts.size > 0) wanted[key] = [...texts].sort();
      }
      const ours = (held: unknown): held is string[] | undefined | null =>
        held === undefined || held === null || (Array.isArray(held) && held.every((item) => typeof item === "string" && /^\[\[.*\]\]$/.test(item)));
      const differs = (held: Record<string, unknown>): string[] =>
        managed.filter((key) => {
          const now = held[key];
          // A property of the same name that a person filled with something else is theirs, and stays.
          if (!ours(now)) return false;
          return JSON.stringify(now ?? []) !== JSON.stringify(wanted[key] ?? []);
        });
      // Facts are plain text under names only this plugin uses, so they are simply kept in step.
      const stale = (held: Record<string, unknown>): string[] => managedFacts.filter((key) => (held[key] ?? undefined) !== (facts[key] ?? undefined));
      const cached = metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (cached && differs(cached).length === 0 && stale(cached).length === 0) return ok({ written: false });
      let written = false;
      await fileManager.processFrontMatter(file, (frontmatter) => {
        const held = frontmatter as Record<string, unknown>;
        for (const key of differs(held)) {
          written = true;
          if (wanted[key]) held[key] = wanted[key];
          else delete held[key];
        }
        for (const key of stale(held)) {
          written = true;
          if (facts[key] !== undefined) held[key] = facts[key];
          else delete held[key];
        }
      });
      return ok({ written });
    },

    pinText: async ({ ref, unit }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      let id = await idOf(file);
      if (!id) {
        id = unit ?? uuidv7();
        const fresh = id;
        await fileManager.processFrontMatter(file, (frontmatter) => {
          (frontmatter as Record<string, string>)[ID_KEY] = fresh;
        });
        remember(id, file.path);
      }
      return ok(await summary(file));
    },

    listRecords: async ({ after, limit }) => {
      const cursor = pageOfCursor(after);
      const items: DgRecord[] = [];
      let done = true;
      for (const path of await recordFiles()) {
        const lines = await readLines(path);
        // A log that was replaced or joined with a copy since is read again from its top.
        let line = resumeAt(lines, cursor[path]);
        while (line < lines.length && items.length < limit) {
          const record = parseLogLine(lines[line]!);
          if (record) items.push(record);
          line += 1;
        }
        cursor[path] = cursorAfter(lines, line);
        if (line < lines.length) done = false;
      }
      return ok({ items, next: JSON.stringify(cursor), done });
    },

    putRecords: async ({ records }) =>
      inOrder(async () => {
        const problems = records.flatMap((record) => validateRecord(record));
        if (problems.length > 0) return fail("invalid", problems.join("; "));
        const seen = await loadKnown();
        const fresh = records.filter((record) => !seen.has(canonicalJson(record)));
        if (fresh.length === 0) return ok({ stored: 0 });
        await ensureFolder(ROOT);
        await ensureFolder(RECORDS);
        const text = fresh.map((record) => `${JSON.stringify(record)}\n`).join("");
        const file = vault.getFileByPath(deviceLog);
        if (file) await vault.append(file, text);
        else await vault.create(deviceLog, text);
        for (const record of fresh) seen.add(canonicalJson(record));
        known = seen;
        return ok({ stored: fresh.length });
      }),

    readAsset: async ({ ref }) => {
      const file = vault.getFileByPath(ref);
      if (!file) return fail("not-found", `No asset ${ref}.`);
      const bytes = new Uint8Array(await vault.readBinary(file));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const mime = MIME[file.extension] ?? "application/octet-stream";
      const asset: Asset = {
        name: file.name,
        mime,
        dataUrl: `data:${mime};base64,${btoa(binary)}`,
      };
      return ok(asset);
    },

    writeAsset: async ({ asset }) => {
      const encoded = asset.dataUrl.split(",")[1] ?? "";
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      // A document a person added sits with the papers, where they'd look for it.
      if (asset.mime === "application/pdf") {
        await ensureFolder(PAPER_FILES);
        const [stem, extension] = splitName(sanitize(asset.name) || "Document.pdf");
        let path = normalizePath(`${PAPER_FILES}/${stem}.${extension}`);
        for (let n = 2; vault.getFileByPath(path); n += 1) path = normalizePath(`${PAPER_FILES}/${stem} ${n}.${extension}`);
        await vault.createBinary(path, bytes.buffer);
        return ok({ ref: path });
      }
      // A picture a person added is theirs to find again, under the name they gave it.
      if (asset.mime.startsWith("image/")) {
        await ensureFolder(PICTURES);
        const [stem, extension] = splitName(sanitize(asset.name) || "Picture.png");
        let path = normalizePath(`${PICTURES}/${stem}.${extension}`);
        for (let n = 2; vault.getFileByPath(path); n += 1) path = normalizePath(`${PICTURES}/${stem} ${n}.${extension}`);
        await vault.createBinary(path, bytes.buffer);
        return ok({ ref: path });
      }
      await ensureFolder(ROOT);
      await ensureFolder(ASSETS);
      const path = `${ASSETS}/${uuidv7()}-${sanitize(asset.name)}`;
      await vault.createBinary(path, bytes.buffer);
      return ok({ ref: path });
    },

    listFiles: async ({ extensions, limit }) => {
      const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));
      const files = vault
        .getFiles()
        .filter((file) => wanted.has(file.extension.toLowerCase()))
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, limit)
        .map((file) => ({
          ref: file.path,
          name: file.name,
          mime: MIME[file.extension.toLowerCase()] ?? "application/octet-stream",
          ...(file.parent && file.parent.path !== "/" ? { folder: file.parent.path } : {}),
          size: file.stat.size,
          modifiedAt: new Date(file.stat.mtime).toISOString(),
        }));
      return ok(files);
    },

    getFocus: async () => {
      const file = workspace.getActiveFile();
      return ok({ ref: file ? await refOf(file) : null });
    },

    reveal: async ({ ref, placement }) => {
      const file = await resolve(ref);
      if (!file) return notFound(ref);
      const leaf = placement === "side" ? workspace.getRightLeaf(false) : besideSurface();
      if (!leaf) return fail("unavailable", "No pane to open in.");
      await leaf.openFile(file, { active: true });
      return ok(null);
    },

    insertLink: async ({ ref, label }) => {
      const target = await resolve(ref);
      if (!target) return notFound(ref);
      if (!lastView?.file) return fail("no-target", "No cursor to insert at.");
      const editor = lastView.editor;
      const text = label ? `[[${target.basename}|${label}]]` : `[[${target.basename}]]`;
      editor.replaceRange(text, editor.getCursor());
      await lastView.save();
      return ok(null);
    },

    readSelection: async () => {
      const view = workspace.getActiveViewOfType(MarkdownView) ?? lastView;
      const text = view?.editor.getSelection() ?? "";
      return ok(text ? { text } : null);
    },

    replaceSelection: async ({ ref }) => {
      const target = await resolve(ref);
      if (!target) return notFound(ref);
      const view = workspace.getActiveViewOfType(MarkdownView) ?? lastView;
      if (!view?.editor.somethingSelected()) return fail("no-target", "Nothing is selected.");
      view.editor.replaceSelection(`[[${target.basename}]]`);
      await view.save();
      return ok(null);
    },

    openSurface,
    closeDialog,
    openLink: async ({ url }) => {
      window.open(url, "_blank", "noopener");
      return ok(null);
    },

    getLocal: async ({ key }) => ok(data.local?.[key] ?? null),
    setLocal: async ({ key, value }) =>
      inOrder(async () => {
        data = { ...data, local: { ...data.local, [key]: value } };
        await saveData();
        return ok(null);
      }),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    host: neverRejects(host),
    refOfFile,
    forgetCursor: () => {
      lastView = null;
    },
    useCursor: (view) => {
      lastView = view;
    },
    cursorView: () => lastView,
    dispose: () => {
      for (const ref of refs) vault.offref(ref);
      for (const timer of removals.values()) window.clearTimeout(timer);
      listeners.clear();
    },
  };
};
