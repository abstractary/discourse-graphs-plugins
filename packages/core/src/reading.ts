import { isLibraryRef, isSharedLibraryRef, mergeIdentifiers, sameDoi, sameIdentifier, type Identifier, type LibraryAnnotation, type LibraryFile, type PaperShelf } from "@dg/contract/scholarly.ts";
import { citeAs, identifiersOf, selectLinkOf } from "./card.ts";
import { suggestType } from "./library.ts";
import { keyOfPaper, sameWork } from "./work.ts";
import {
  createCanvasItem,
  createNode,
  createNodeType,
  liveCanvasItems,
  revise,
  type CanvasItem,
  type CanvasRecord,
  type DgId,
  type DgRecord,
  type NodeRecord,
  type NodeTypeRecord,
  type PaperRecord,
} from "@dg/contract/records.ts";
import type { FileSummary } from "@dg/contract/host.ts";
import type { HolonLevel, PdfDocument, PdfMark, Provenance, UnitsAvailable, UnitsSegment, PdfLibraryMark } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { cidOfBytes } from "./process.ts";
import { mustBeOfPaper, readingOf, refusal } from "./locks.ts";
import { paperOfWork, standsFor } from "./work.ts";

/**
 * Reading PDFs into the graph, and the units waiting to go on a canvas.
 *
 * A highlight becomes a unit that keeps its words, page and file, the way an
 * extracted unit keeps its passage. The words are a W3C text quote: the reader
 * finds them again by their text, so a re-rendered or re-flowed page still
 * lights the right passage. The file is a source unit, made the first time
 * anything is read from it, pinned by its content hash so a renamed file is
 * still the same source.
 */

const CARD_WIDTH = 240;
const COLUMN_GAP = 96;
const ROW_GAP = 24;
const LIST_TTL_MS = 4000;
const HOLON_LEVELS = new Set(["question", "claim", "evidence", "output"]);

const cardHeight = (title: string): number => 40 + 19 * Math.ceil(title.length / 30);
const stemOf = (name: string): string => name.replace(/\.[^.]+$/, "");
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
/** Collapses what a PDF's line breaks and spacing add, so a quote matches however it was selected. */
export const normalizeQuote = (text: string): string => text.normalize("NFKC").replace(/-\s*\n\s*/g, "").replace(/\s+/g, " ").trim();

type Value<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
const value = <T>(result: Value<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

export const readingFeature = (context: Context) => {
  let listed: { at: number; files: FileSummary[] } | null = null;
  const cids = new Map<string, string>();
  let pendingReveal: { ref: string; unit: DgId } | null = null;

  /**
   * The reference library's PDFs, by ref, when the person has made it their PDF library. With it on, the
   * library is where papers are: its files are listed first and read where it keeps them.
   */
  const inLibrary = new Map<string, LibraryFile>();
  let libraryProblem = "";
  const IDENTITY: Identifier["scheme"][] = ["doi", "pmid", "pmcid", "arxiv", "isbn"];
  const libraryOn = async (): Promise<boolean> => Boolean((await context.prefs()).zoteroLibrary && context.services?.zotero);
  const libraryFiles = async (): Promise<FileSummary[]> => {
    if (!(await libraryOn())) {
      inLibrary.clear();
      libraryProblem = "";
      return [];
    }
    try {
      const found = await context.services!.zotero.files();
      inLibrary.clear();
      for (const file of found) inLibrary.set(file.ref, file);
      libraryProblem = "";
      return found.map((file) => ({ ref: file.ref, name: file.filename, mime: "application/pdf", folder: "Zotero", ...(file.size !== undefined ? { size: file.size } : {}), ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}) }));
    } catch (error) {
      // Zotero closed, or its setting off. What was listed last stays, and the list says why it may be stale.
      libraryProblem = error instanceof Error ? error.message : String(error);
      return [...inLibrary.values()].map((file) => ({ ref: file.ref, name: file.filename, mime: "application/pdf", folder: "Zotero" }));
    }
  };

  const files = async (fresh = false): Promise<FileSummary[]> => {
    if (!fresh && listed && Date.now() - listed.at < LIST_TTL_MS) return listed.files;
    const [library, result] = await Promise.all([libraryFiles(), context.host.listFiles({ extensions: ["pdf"], limit: 500 })]);
    listed = { at: Date.now(), files: [...library, ...(result.ok ? result.value : [])] };
    return listed.files;
  };

  const live = (node: NodeRecord) => !node.removed;
  const nodes = (): NodeRecord[] => context.documents("node").filter(live);
  const papers = (): PaperRecord[] => context.documents("paper");
  const baseOf = (node: NodeRecord) => context.typeOf(node.type)?.base;

  /** The paper a file is: by its bytes when both are known, otherwise by its name. The newest reading wins. */
  const paperOf = (file: FileSummary): PaperRecord | undefined => {
    const cid = cids.get(file.ref);
    const all = [...papers()].sort((a, b) => b.at.localeCompare(a.at));
    // A library's file is first of all the work its reference names: the same DOI is the same paper, whatever the file is called.
    const item = inLibrary.get(file.ref)?.item;
    const named = item ? all.find((paper) => sameWork(keyOfPaper(paper), { identifiers: item.identifiers }) === "identifier") : undefined;
    return named ?? (cid ? all.find((paper) => paper.fileCid === cid) : undefined) ?? all.find((paper) => paper.filename === file.name);
  };
  /** The unit that stands for this file: the paper's own source, or one made from a highlight. */
  const sourceOf = (file: FileSummary, cid?: string): NodeRecord | undefined => {
    const paper = paperOf(file);
    if (paper) {
      // The paper's own source unit: made by its extraction, or stated by DOI or title.
      const sources = nodes().filter((node) => baseOf(node) === "source");
      const own =
        sources.find((node) => node.source?.paper === paper.id && node.source.own) ??
        sources.find((node) => node.source?.paper === paper.id && sameDoi(node.facts?.doi, paper.doi)) ??
        sources.find((node) => node.source?.paper === paper.id) ??
        sources.find((node) => !node.source && standsFor(node, paper));
      if (own) return own;
    }
    // The source a library item already has: the same work by identifier, or this person's own unit for that item.
    const item = inLibrary.get(file.ref)?.item;
    if (item) {
      const me = context.me().id;
      const sources = nodes().filter((node) => baseOf(node) === "source");
      const shares = (schemes: Identifier["scheme"][], mineOnly: boolean) => (node: NodeRecord) =>
        identifiersOf(node).some((held) => schemes.includes(held.scheme) && (!mineOnly || node.by.id === me || isSharedLibraryRef(held.value)) && item.identifiers.some((other) => sameIdentifier(held, other)));
      const known = sources.find(shares(IDENTITY, false)) ?? sources.find(shares(["zotero"], true));
      if (known) return known;
    }
    return nodes().find((node) => baseOf(node) === "source" && (node.facts?.uri === file.ref || (cid !== undefined && node.facts?.cid === cid)));
  };

  /** The library's own highlights on a file that aren't units here yet. */
  const libraryMarksOf = async (file: FileSummary): Promise<PdfLibraryMark[]> => {
    const held = inLibrary.get(file.ref);
    if (!held || !context.services?.zotero) return [];
    let marks: LibraryAnnotation[];
    try {
      marks = await context.services.zotero.annotations({ ref: held.item.ref });
    } catch {
      return [];
    }
    const me = context.me().id;
    const attachment = file.ref.split("/").pop();
    const types = context.nodeTypes().filter((type) => type.base === "question" || type.base === "claim" || type.base === "evidence");
    const brought = new Set(nodes().filter((node) => node.by.id === me).flatMap((node) => (node.facts?.identifiers ?? []).filter(({ scheme }) => scheme === "zotero").map(({ value }) => value)));
    return marks
      .filter((mark) => mark.attachment === attachment && mark.text && !brought.has(mark.ref))
      .map((mark) => ({ key: mark.key, exact: mark.text!, ...(mark.pageIndex !== undefined ? { page: mark.pageIndex + 1 } : {}), ...(mark.comment ? { comment: mark.comment } : {}), ...(mark.color ? { color: mark.color } : {}), ...(suggestType(mark, types) ? { suggested: suggestType(mark, types)!.id } : {}), open: mark.open }));
  };

  const marksOf = (file: FileSummary, source: NodeRecord | undefined): PdfMark[] => {
    const paper = paperOf(file);
    return nodes().flatMap((node): PdfMark[] => {
      if (node.id === source?.id) return [];
      const anchor = node.facts?.anchor;
      if (source && anchor?.exact && (anchor.source === source.id || node.prov?.sourceDocument === source.id)) {
        const page = Number(anchor.page);
        return [{ unit: context.summarize(node), exact: anchor.exact, ...(Number.isFinite(page) && page > 0 ? { page } : {}) }];
      }
      if (paper && node.source?.paper === paper.id && node.source.anchor) return [{ unit: context.summarize(node), exact: node.source.anchor }];
      return [];
    });
  };

  /** Whose shelf a file is on. Only said in a lab, where the difference decides who can open it. */
  const shelfOfFile = (file: FileSummary, held: LibraryFile | undefined, paper: PaperRecord | undefined): PaperShelf | undefined => {
    const lab = context.myLab();
    if (!lab) return undefined;
    const group = lab.settings?.zoteroGroup;
    if (held?.item.library.kind === "group") {
      return group && String(held.item.library.id) === group.id ? { kind: "lab", name: group.name } : { kind: "group", name: held.item.library.name ?? "A Zotero group" };
    }
    if (held) return { kind: "yours", name: "Your Zotero library" };
    if (paper?.labPaper) return { kind: "lab", name: `${lab.name}'s papers` };
    return isLibraryRef(file.ref) ? undefined : { kind: "yours", name: "Your vault" };
  };

  const documentOf = (file: FileSummary): PdfDocument => {
    const paper = paperOf(file);
    const source = sourceOf(file, cids.get(file.ref));
    const held = inLibrary.get(file.ref);
    return {
      ref: file.ref,
      name: file.name,
      title: paper?.title ?? source?.title ?? held?.item.title ?? stemOf(file.name),
      ...(shelfOfFile(file, held, paper) ? { shelf: shelfOfFile(file, held, paper)! } : {}),
      ...(held ? { library: { app: "zotero" as const, open: selectLinkOf(held.item.ref), what: "item" as const, label: citeAs(held.item.authors.map(({ name }) => name), held.item.published, held.item.title), item: held.item.ref } } : {}),
      ...(file.folder ? { folder: file.folder } : {}),
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.modifiedAt ? { modifiedAt: file.modifiedAt } : {}),
      ...(paper ? { paper: { id: paper.id, title: paper.title, canvas: paper.canvas } } : {}),
      ...(source ? { source: source.id } : {}),
      units: marksOf(file, source).length,
    };
  };

  const fileOf = async (ref: string): Promise<FileSummary> => {
    const found = (await files()).find((file) => file.ref === ref) ?? (await files(true)).find((file) => file.ref === ref);
    if (found) return found;
    // A library's file opened while the library isn't the PDF library: it is still read from the library.
    if (isLibraryRef(ref) && context.services?.zotero) {
      const file = await context.services.zotero.file({ ref });
      inLibrary.set(file.ref, file);
      return { ref: file.ref, name: file.filename, mime: "application/pdf", folder: "Zotero", ...(file.size !== undefined ? { size: file.size } : {}) };
    }
    // A ref a base can read but doesn't list, such as a link from elsewhere.
    const asset = value(await context.readFile(ref));
    return { ref, name: asset.name, mime: asset.mime };
  };

  const cidOf = async (ref: string): Promise<string> => {
    const known = cids.get(ref);
    if (known) return known;
    const asset = value(await context.readFile(ref));
    const cid = await cidOfBytes(fromBase64(asset.dataUrl.split(",")[1] ?? ""));
    cids.set(ref, cid);
    return cid;
  };

  const sourceType = (fresh: DgRecord[]): NodeTypeRecord => {
    const found = context.nodeTypes().find((type) => type.base === "source");
    if (found) return found;
    const made = createNodeType({
      ...context.stamp(),
      fields: { label: "Source", base: "source", abbreviation: "SRC", titleFormat: context.titleFormat?.("SRC") ?? "SRC - {content}" },
    });
    fresh.push(made);
    return made;
  };

  /** Where a new card from this file goes: under the last one from it, or in a column right of everything. */
  const spotFor = (canvas: DgId, source: DgId, height: number): { x: number; y: number } => {
    const items = liveCanvasItems({ graph: context.graph(), canvas }).flatMap((record) => {
      const item = record.item as CanvasItem & { x?: number; y?: number; width?: number; height?: number };
      return typeof item.x === "number" && typeof item.y === "number" ? [{ item, record }] : [];
    });
    const fromHere = items.filter(({ item }) => {
      const unit = (item as { dg?: { node?: DgId } }).dg?.node;
      const node = unit ? context.nodeOf(unit) : undefined;
      return node?.prov?.sourceDocument === source;
    });
    if (fromHere.length) {
      const last = fromHere.reduce((low, entry) => (entry.item.y! + (entry.item.height ?? 0) > low.item.y! + (low.item.height ?? 0) ? entry : low));
      return { x: last.item.x!, y: last.item.y! + (last.item.height ?? height) + ROW_GAP };
    }
    if (!items.length) return { x: 0, y: 0 };
    const right = Math.max(...items.map(({ item }) => item.x! + (item.width ?? CARD_WIDTH)));
    const top = Math.min(...items.map(({ item }) => item.y!));
    return { x: Math.round(right + COLUMN_GAP), y: Math.round(top) };
  };

  const nextZ = (canvas: DgId): number => Math.max(0, ...liveCanvasItems({ graph: context.graph(), canvas }).map((item) => item.z)) + 1;

  const cardsOn = (canvas: DgId): Map<DgId, DgId> => {
    const cards = new Map<DgId, DgId>();
    for (const record of liveCanvasItems({ graph: context.graph(), canvas })) {
      const unit = (record.item as { dg?: { node?: DgId } }).dg?.node;
      if (unit && !cards.has(unit)) cards.set(unit, record.id);
    }
    return cards;
  };

  const holonLevelOf = (canvas: CanvasRecord): HolonLevel | undefined => {
    if (!canvas.holon) return undefined;
    const node = context.nodeOf(canvas.holon);
    if (!node) return context.documents("lab").some((lab) => lab.did === canvas.holon) ? "lab" : undefined;
    const base = baseOf(node);
    return base && HOLON_LEVELS.has(base) ? (base as HolonLevel) : undefined;
  };

  /** Relations that stand or wait for a decision, as a canvas draws them. Withdrawn and declined ones stay off. */
  const activeRelations = () =>
    [...context.graph().relations.values()].filter(({ state }) => state === "active" || state === "pending").map(({ record }) => record);

  const handlers: Pick<
    Handlers,
    "pdf.list" | "pdf.library" | "pdf.open" | "pdf.add" | "pdf.cut" | "pdf.uncut" | "pdf.show" | "pdf.follow" | "canvas.pdf" | "units.available" | "canvas.placeUnits" | "units.put"
  > = {
    "pdf.list": async () => {
      const all = (await files(true)).map(documentOf);
      // With the library as the PDF library, a paper it holds is listed once, as the library's. A copy of
      // the same paper in the base is the same work, so it isn't listed beside it.
      const theirs = all.filter((doc) => doc.library);
      const works = new Set(theirs.flatMap((doc) => [doc.paper?.id, doc.source].filter(Boolean) as string[]));
      const here = all.filter((doc) => !doc.library && !(doc.paper && works.has(doc.paper.id)) && !(doc.source && works.has(doc.source)));
      // Papers first: they're what people came to read. Each group stays newest first.
      const ordered = (docs: PdfDocument[]): PdfDocument[] => [...docs.filter((doc) => doc.paper), ...docs.filter((doc) => !doc.paper)];
      // The lab's shelf comes first: it is what everyone in the lab can open.
      const labFirst = (docs: PdfDocument[]): PdfDocument[] => [...docs.filter((doc) => doc.shelf?.kind === "lab"), ...docs.filter((doc) => doc.shelf?.kind !== "lab")];
      return [...labFirst(ordered(theirs)), ...ordered(here)];
    },
    "pdf.library": async () => {
      const on = await libraryOn();
      const prefs = await context.prefs();
      if (!context.services?.zotero) return { on: false, wanted: prefs.zoteroLibrary, reachable: false, files: 0, problem: "This base can't reach Zotero." };
      if (!on) return { on: false, wanted: false, reachable: true, files: 0 };
      await files(true);
      return { on: true, wanted: true, reachable: !libraryProblem, files: inLibrary.size, ...(libraryProblem ? { problem: libraryProblem } : {}), ...(context.host.readLocalFile ? {} : { problem: "Zotero's files can only be opened in the desktop app." }) };
    },

    "pdf.open": async ({ ref, data = true }) => {
      const file = await fileOf(ref);
      let dataBase64 = "";
      if (data || !cids.has(ref)) {
        const asset = value(await context.readFile(ref));
        const bytes = asset.dataUrl.split(",")[1] ?? "";
        if (!cids.has(ref)) cids.set(ref, await cidOfBytes(fromBase64(bytes)));
        if (data) dataBase64 = bytes;
      }
      const source = sourceOf(file, cids.get(ref));
      // A file renamed or moved since: its source follows it.
      // A library's address is one computer's, so it is never written into a record as where the file is.
      if (source && baseOf(source) === "source" && !source.source && source.facts?.uri !== ref && !isLibraryRef(ref)) {
        await context.put([revise({ record: source, changes: { facts: { ...source.facts, uri: ref } }, by: context.me() })]);
      }
      const reveal = data && pendingReveal?.ref === ref ? pendingReveal.unit : undefined;
      if (reveal) pendingReveal = null;
      const theirs = data ? await libraryMarksOf(file) : [];
      return { document: { ...documentOf(file), ...(theirs.length ? { libraryMarks: theirs.length } : {}) }, dataBase64, marks: marksOf(file, source), ...(theirs.length ? { libraryMarks: theirs } : {}), ...(reveal ? { reveal } : {}) };
    },

    "pdf.add": async ({ name, dataBase64 }) => {
      const clean = name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf`;
      const bytes = fromBase64(dataBase64);
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("That file isn't a PDF.");
      const { ref } = value(await context.host.writeAsset({ asset: { name: clean, mime: "application/pdf", dataUrl: `data:application/pdf;base64,${dataBase64}` } }));
      cids.set(ref, await cidOfBytes(bytes));
      const file = (await files(true)).find((entry) => entry.ref === ref) ?? { ref, name: clean, mime: "application/pdf", size: bytes.length };
      return documentOf(file);
    },

    "pdf.cut": async ({ ref, exact, page, title, type, canvas, newCanvas, documentTitle }) => {
      const quote = normalizeQuote(exact);
      const name = title.trim() || quote;
      if (!quote) throw new Error("Highlight some words first.");
      const file = await fileOf(ref);
      const cid = await cidOf(ref);
      const fresh: DgRecord[] = [];
      const stamp = context.stamp();
      let source = sourceOf(file, cid);
      if (!source) {
        // A file from the library is the reference it belongs to: its title, authors and identifiers come with it.
        const item = inLibrary.get(ref)?.item;
        const doi = item?.identifiers.find(({ scheme }) => scheme === "doi")?.value;
        const rest = item?.identifiers.filter(({ scheme }) => scheme !== "doi") ?? [];
        source = createNode({
          ...stamp,
          title: item?.title ?? (documentTitle?.trim() || stemOf(file.name)),
          type: sourceType(fresh).id,
          facts: {
            ...(item ? {} : { uri: ref }),
            mediaType: "application/pdf",
            cid,
            ...(file.size !== undefined ? { size: file.size } : {}),
            ...(doi ? { doi } : {}),
            ...(rest.length ? { identifiers: mergeIdentifiers(rest) } : {}),
            ...(item?.authors.length ? { authors: item.authors.map(({ name }) => name) } : {}),
            ...(item?.published ? { published: item.published } : {}),
            ...(item?.venue ? { venue: item.venue } : {}),
            ...(item ? { provenance: { method: "imported" as const, agent: "Zotero" } } : {}),
          },
        });
        fresh.push(source);
      }
      const node = createNode({
        ...stamp,
        title: name,
        ...(type ? { type } : {}),
        prov: { sourceDocument: source.id },
        facts: { anchor: { source: source.id, exact: quote, page: String(page) } },
      });
      fresh.push(node);
      let target = canvas;
      if (newCanvas?.trim()) target = (await context.makeCanvas(newCanvas.trim())).id;
      if (target && !context.canvasOf(target)) throw new Error("That canvas is gone.");
      // A PDF canvas takes a highlight only from its own paper's file.
      const reading = target ? readingOf(context.graph(), target) : undefined;
      if (reading && paperOf(file)?.id !== reading.id) throw refusal(reading);
      await context.put(fresh);
      if (target) {
        const height = cardHeight(name);
        const spot = spotFor(target, source.id, height);
        await context.put([createCanvasItem({ ...context.stamp(), canvas: target, z: nextZ(target), item: { type: "text", text: name, ...spot, width: CARD_WIDTH, height, dg: { node: node.id } } })]);
        context.send({ event: "units-placed", canvas: target, units: [node.id] });
      }
      return { node: context.summarize(context.nodeOf(node.id)!), canvas: target ?? null };
    },

    "pdf.uncut": async ({ node: id }) => {
      const node = context.nodeOf(id);
      if (!node) return null;
      const by = context.me();
      const cards = context.documents("canvas-item").filter((item) => !item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === id);
      await context.put([revise({ record: node, changes: { removed: true }, by }), ...cards.map((card) => revise({ record: card, changes: { removed: true }, by }))]);
      return null;
    },

    "canvas.pdf": async ({ id }) => (await canvasPdf(id)) ?? null,

    "pdf.show": async ({ ref, unit }) => {
      if (ref && unit) pendingReveal = { ref, unit };
      value(await context.host.openSurface({ route: { surface: "pdf", ...(ref ? { id: ref } : {}) }, placement: "main" }));
      if (ref && unit) context.send({ event: "pdf-reveal", ref, unit });
      return null;
    },

    "pdf.follow": async ({ unit }) => {
      context.send({ event: "pdf-follow", unit });
      return null;
    },

    "units.available": async ({ canvas }) => {
      const here = cardsOn(canvas);
      const canvases = context
        .documents("canvas")
        .filter((record) => !record.removed && record.id !== canvas)
        .sort((a, b) => b.editedAt.localeCompare(a.editedAt));
      const placedOn = new Map<DgId, Set<DgId>>();
      for (const other of canvases) {
        for (const unit of cardsOn(other.id).keys()) {
          const set = placedOn.get(unit) ?? new Set();
          set.add(other.id);
          placedOn.set(unit, set);
        }
      }
      const folders = context.documents("folder").filter((folder) => !folder.removed).sort((a, b) => a.title.localeCompare(b.title));
      const filed = new Map<DgId, Set<DgId>>();
      for (const item of context.documents("folder-item")) {
        if (item.removed) continue;
        const set = filed.get(item.folder) ?? new Set();
        set.add(item.node);
        filed.set(item.folder, set);
      }
      const inSomeFolder = new Set([...filed.values()].flatMap((set) => [...set]));

      const relations = activeRelations();
      const links = new Map<DgId, number>();
      for (const relation of relations) {
        if (here.has(relation.source) && !here.has(relation.target)) links.set(relation.target, (links.get(relation.target) ?? 0) + 1);
        if (here.has(relation.target) && !here.has(relation.source)) links.set(relation.source, (links.get(relation.source) ?? 0) + 1);
      }

      const available = nodes().filter((node) => !here.has(node.id));
      const units: UnitsAvailable["units"] = {};
      for (const node of available) units[node.id] = { ...context.summarize(node), links: links.get(node.id) ?? 0 };
      // Most connected to this canvas first: those are the ones the argument is missing.
      const ordered = (ids: Iterable<DgId>): DgId[] =>
        [...ids].filter((id) => units[id]).sort((a, b) => units[b]!.links - units[a]!.links || units[a]!.title.localeCompare(units[b]!.title));

      const segments: UnitsSegment[] = [];
      for (const other of canvases) {
        const held = ordered(cardsOn(other.id).keys());
        const level = holonLevelOf(other);
        if (held.length) segments.push({ kind: "canvas", id: other.id, title: other.title, ...(level ? { holon: level } : {}), units: held });
      }
      for (const folder of folders) {
        const held = ordered(filed.get(folder.id) ?? []);
        if (held.length) segments.push({ kind: "folder", id: folder.id, title: folder.title, units: held });
      }
      const loose = ordered(available.filter((node) => !placedOn.has(node.id) && !inSomeFolder.has(node.id)).map((node) => node.id));
      if (loose.length) segments.push({ kind: "loose", id: "loose", title: "On no canvas or folder", units: loose });

      return {
        units,
        segments,
        relations: relations
          .filter((relation) => units[relation.source] && units[relation.target])
          .map((relation) => {
            const kind = context.relationTypeOf(relation.type)?.base;
            return { source: relation.source, target: relation.target, label: context.relationTypeOf(relation.type)?.label ?? "Related", ...(kind ? { kind } : {}) };
          }),
      } satisfies UnitsAvailable;
    },

    "canvas.placeUnits": async ({ canvas, places }) => {
      if (!context.canvasOf(canvas)) throw new Error("That canvas is gone.");
      mustBeOfPaper(context.graph(), canvas, places.map((place) => place.node));
      const cards = cardsOn(canvas);
      const stamp = context.stamp();
      const fresh: DgRecord[] = [];
      const ids: DgId[] = [];
      let z = nextZ(canvas);
      const placed = new Set<DgId>();
      for (const place of places) {
        const node = context.nodeOf(place.node);
        if (!node || node.removed || cards.has(node.id)) continue;
        const record = createCanvasItem({
          ...stamp,
          canvas,
          z: z++,
          item: { type: "text", text: node.title, x: Math.round(place.x), y: Math.round(place.y), width: Math.round(place.width), height: Math.round(place.height), dg: { node: node.id } },
        });
        cards.set(node.id, record.id);
        placed.add(node.id);
        fresh.push(record);
        ids.push(record.id);
      }
      // Their relations come with them, to each other and to what's already here.
      const drawn = new Set(
        liveCanvasItems({ graph: context.graph(), canvas }).flatMap((record) => (record.item as { dg?: { relation?: DgId } }).dg?.relation ?? []),
      );
      for (const relation of activeRelations()) {
        if (!placed.has(relation.source) && !placed.has(relation.target)) continue;
        if (drawn.has(relation.id)) continue;
        const fromNode = cards.get(relation.source);
        const toNode = cards.get(relation.target);
        if (!fromNode || !toNode) continue;
        const label = context.relationTypeOf(relation.type)?.label;
        const record = createCanvasItem({
          ...stamp,
          canvas,
          z: z++,
          item: { fromNode, toNode, toEnd: "arrow", ...(label ? { label } : {}), dg: { relation: relation.id } } as never,
        });
        drawn.add(relation.id);
        fresh.push(record);
        ids.push(record.id);
      }
      if (fresh.length) await context.put(fresh);
      if (placed.size) context.send({ event: "units-placed", canvas, units: [...placed] });
      return { ids };
    },

    // A column beside what's there. An open canvas then brings them to where the person is looking.
    "units.put": async ({ canvas, nodes: ids }) => {
      if (!context.canvasOf(canvas)) throw new Error("That canvas is gone.");
      mustBeOfPaper(context.graph(), canvas, ids);
      const cards = cardsOn(canvas);
      const wanted = [...new Set(ids)].filter((id) => context.nodeOf(id) && !context.nodeOf(id)!.removed);
      const already = wanted.filter((id) => cards.has(id));
      const fresh = wanted.filter((id) => !cards.has(id));
      if (fresh.length) {
        const start = spotFor(canvas, "", 0);
        let y = start.y;
        const places = fresh.map((id) => {
          const height = cardHeight(context.nodeOf(id)!.title);
          const place = { node: id, x: start.x, y, width: CARD_WIDTH, height };
          y += height + ROW_GAP;
          return place;
        });
        await handlers["canvas.placeUnits"]({ canvas, places });
      }
      if (already.length) context.send({ event: "highlight", units: already });
      return { placed: fresh, already };
    },
  };

  /** The file a unit was read from, for the context panel's provenance. */
  const pdfOf = async (node: NodeRecord): Promise<Provenance["pdf"] | undefined> => {
    const anchor = node.facts?.anchor;
    // An anchor's source may be a unit or a DOI; the stated source document is always a unit.
    const source = (anchor?.source ? context.nodeOf(anchor.source) : undefined) ?? (node.prov?.sourceDocument ? context.nodeOf(node.prov.sourceDocument) : undefined);
    const page = Number(anchor?.page);
    const at = { ...(Number.isFinite(page) && page > 0 ? { page } : {}), ...(anchor?.exact ? { exact: anchor.exact } : {}) };
    const listing = await files();
    if (source?.facts?.uri) {
      const file = listing.find((entry) => entry.ref === source.facts!.uri);
      return { ref: source.facts.uri, name: file?.name ?? source.title, ...at };
    }
    // A paper's file, found by its name, for its extracted units and for highlights on it.
    const paperId = source?.source?.paper ?? node.source?.paper;
    const paper = paperId
      ? papers().find((entry) => entry.id === paperId)
      : source
        ? paperOfWork(papers(), source)
        : undefined;
    const file = paper ? listing.find((entry) => entry.name === paper.filename) : undefined;
    return file ? { ref: file.ref, name: file.name, ...at } : undefined;
  };

  /** The PDF most of a canvas's cards were read from: its own paper's for a PDF canvas. */
  async function canvasPdf(canvas: DgId): Promise<{ ref: string; name: string } | undefined> {
    const record = context.canvasOf(canvas);
    const counts = new Map<DgId, number>();
    if (record?.paper) counts.set(record.paper, Number.MAX_SAFE_INTEGER);
    const highlighted = new Map<string, number>();
    for (const unit of cardsOn(canvas).keys()) {
      const node = context.nodeOf(unit);
      if (node?.source?.paper) counts.set(node.source.paper, (counts.get(node.source.paper) ?? 0) + 1);
      const source = node?.prov?.sourceDocument ? context.nodeOf(node.prov.sourceDocument) : undefined;
      if (source?.facts?.uri) highlighted.set(source.facts.uri, (highlighted.get(source.facts.uri) ?? 0) + 1);
    }
    const listing = await files();
    const byPaper = [...counts].sort((a, b) => b[1] - a[1]).flatMap(([id, count]) => {
      const paper = papers().find((entry) => entry.id === id);
      const file = paper ? listing.find((entry) => entry.name === paper.filename) : undefined;
      return file ? [{ ref: file.ref, name: file.name, count }] : [];
    });
    const byHighlight = [...highlighted].sort((a, b) => b[1] - a[1]).flatMap(([ref, count]) => {
      const file = listing.find((entry) => entry.ref === ref);
      return file ? [{ ref, name: file.name, count }] : [];
    });
    const best = [...byPaper, ...byHighlight].sort((a, b) => b.count - a.count)[0];
    return best ? { ref: best.ref, name: best.name } : undefined;
  }

  return { handlers, pdfOf, canvasPdf };
};
