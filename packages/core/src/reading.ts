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
import type { HolonLevel, PdfDocument, PdfMark, Provenance, UnitsAvailable, UnitsSegment } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { cidOfBytes } from "./process.ts";

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

  const files = async (fresh = false): Promise<FileSummary[]> => {
    if (!fresh && listed && Date.now() - listed.at < LIST_TTL_MS) return listed.files;
    const result = await context.host.listFiles({ extensions: ["pdf"], limit: 500 });
    listed = { at: Date.now(), files: result.ok ? result.value : [] };
    return listed.files;
  };

  const live = (node: NodeRecord) => !node.removed;
  const nodes = (): NodeRecord[] => context.documents("node").filter(live);
  const papers = (): PaperRecord[] => context.documents("paper");
  const baseOf = (node: NodeRecord) => context.typeOf(node.type)?.base;

  const paperOf = (file: FileSummary): PaperRecord | undefined => papers().find((paper) => paper.filename === file.name);
  /** The unit that stands for this file: the paper's own source, or one made from a highlight. */
  const sourceOf = (file: FileSummary, cid?: string): NodeRecord | undefined => {
    const paper = paperOf(file);
    if (paper) {
      // The paper's own source unit: made by its extraction, or stated by DOI or title.
      const sources = nodes().filter((node) => baseOf(node) === "source");
      const own =
        sources.find((node) => node.source?.paper === paper.id) ??
        (paper.doi ? sources.find((node) => node.facts?.doi === paper.doi) : undefined) ??
        sources.find((node) => node.title === paper.title);
      if (own) return own;
    }
    return nodes().find((node) => baseOf(node) === "source" && (node.facts?.uri === file.ref || (cid !== undefined && node.facts?.cid === cid)));
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

  const documentOf = (file: FileSummary): PdfDocument => {
    const paper = paperOf(file);
    const source = sourceOf(file, cids.get(file.ref));
    return {
      ref: file.ref,
      name: file.name,
      title: paper?.title ?? source?.title ?? stemOf(file.name),
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
    // A ref a base can read but doesn't list, such as a link from elsewhere.
    const asset = value(await context.host.readAsset({ ref }));
    return { ref, name: asset.name, mime: asset.mime };
  };

  const cidOf = async (ref: string): Promise<string> => {
    const known = cids.get(ref);
    if (known) return known;
    const asset = value(await context.host.readAsset({ ref }));
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
    "pdf.list" | "pdf.open" | "pdf.add" | "pdf.cut" | "pdf.uncut" | "pdf.show" | "units.available" | "canvas.placeUnits"
  > = {
    "pdf.list": async () => {
      const all = (await files(true)).map(documentOf);
      // Papers first: they're what people came to read. Each group stays newest first.
      return [...all.filter((doc) => doc.paper), ...all.filter((doc) => !doc.paper)];
    },

    "pdf.open": async ({ ref, data = true }) => {
      const file = await fileOf(ref);
      let dataBase64 = "";
      if (data || !cids.has(ref)) {
        const asset = value(await context.host.readAsset({ ref }));
        const bytes = asset.dataUrl.split(",")[1] ?? "";
        if (!cids.has(ref)) cids.set(ref, await cidOfBytes(fromBase64(bytes)));
        if (data) dataBase64 = bytes;
      }
      const source = sourceOf(file, cids.get(ref));
      // A file renamed or moved since: its source follows it.
      if (source && baseOf(source) === "source" && !source.source && source.facts?.uri !== ref) {
        await context.put([revise({ record: source, changes: { facts: { ...source.facts, uri: ref } }, by: context.me() })]);
      }
      const reveal = data && pendingReveal?.ref === ref ? pendingReveal.unit : undefined;
      if (reveal) pendingReveal = null;
      return { document: documentOf(file), dataBase64, marks: marksOf(file, source), ...(reveal ? { reveal } : {}) };
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
        source = createNode({
          ...stamp,
          title: documentTitle?.trim() || stemOf(file.name),
          type: sourceType(fresh).id,
          facts: { uri: ref, mediaType: "application/pdf", cid, ...(file.size !== undefined ? { size: file.size } : {}) },
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

    "pdf.show": async ({ ref, unit }) => {
      if (unit) pendingReveal = { ref, unit };
      value(await context.host.openSurface({ route: { surface: "pdf", id: ref }, placement: "main" }));
      if (unit) context.send({ event: "pdf-reveal", ref, unit });
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
        ? papers().find((entry) => (entry.doi && entry.doi === source.facts?.doi) || entry.title === source.title)
        : undefined;
    const file = paper ? listing.find((entry) => entry.name === paper.filename) : undefined;
    return file ? { ref: file.ref, name: file.name, ...at } : undefined;
  };

  return { handlers, pdfOf };
};
