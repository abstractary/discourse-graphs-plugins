import { inLibraryOf, paperIdentifiers } from "./card.ts";
import { isLibraryRef, mergeIdentifiers } from "@dg/contract/scholarly.ts";
import { cidOfBytes } from "./process.ts";
import { normalDoi } from "@dg/contract/scholarly.ts";
import {
  assertRelation,
  createCanvas,
  createCanvasItem,
  createNode,
  createNodeType,
  createPaper,
  createRelationType,
  revise,
  type BaseNodeType,
  type BaseRelationType,
  type DgId,
  type DgRecord,
  type NodeTypeRecord,
  type PaperRecord,
  type RelationRecord,
  type RelationTypeRecord,
} from "@dg/contract/records.ts";
import type { ExtractedEdge, ExtractedNode, ExtractionGraph } from "@dg/contract/services.ts";
import type { PaperSummary, SavedExtraction } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";

type TypeSpec = { label: string; abbreviation: string; base: BaseNodeType; lexicon?: string; color?: string };

/** The MIRA classes, as this graph writes them. Colors match MIRA's own palette. */
const NODE_TYPES: Record<string, TypeSpec> = {
  Question: { label: "Question", abbreviation: "QUE", base: "question" },
  Claim: { label: "Claim", abbreviation: "CLM", base: "claim" },
  Evidence: { label: "Evidence", abbreviation: "EVD", base: "evidence" },
  Source: { label: "Source", abbreviation: "SRC", base: "source" },
  SourceDocument: { label: "Source", abbreviation: "SRC", base: "source" },
  // An extracted MIRA Study is an activity the paper reports, so it is a Run here.
  Study: { label: "Run", abbreviation: "RUN", base: "run", lexicon: "science.mira.study" },
  Protocol: { label: "Protocol", abbreviation: "PRO", base: "protocol", lexicon: "science.mira.protocol" },
  Request: { label: "Request", abbreviation: "REQ", base: "question", lexicon: "science.mira.request" },
};

const RELATIONS: Record<string, { label: string; complement: string; base: BaseRelationType }> = {
  supports: { label: "Supports", complement: "Supported by", base: "supports" },
  opposes: { label: "Opposes", complement: "Opposed by", base: "opposes" },
  addresses: { label: "Addresses", complement: "Addressed by", base: "addresses" },
  informs: { label: "Informs", complement: "Informed by", base: "informs" },
  derivedFrom: { label: "Derived from", complement: "Has derivation", base: "derivedFrom" },
  grounds: { label: "Grounds", complement: "Grounded by", base: "grounds" },
  follows: { label: "Follows", complement: "Followed by", base: "follows" },
  describesActivity: { label: "Describes", complement: "Described by", base: "describesActivity" },
  request_target: { label: "Asks about", complement: "Asked about by", base: "requestTarget" },
  request_for: { label: "Asks about", complement: "Asked about by", base: "requestTarget" },
};

const heightOf = (title: string): number => Math.max(64, 34 + 18 * Math.ceil(title.length / 34));

const spec = (type: string): TypeSpec => NODE_TYPES[type] ?? { label: type, abbreviation: type.slice(0, 3).toUpperCase(), base: "claim" };

const stemOf = (name: string): string => name.replace(/\.[^.]+$/, "");
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const textOfDataUrl = (dataUrl: string): string => new TextDecoder().decode(fromBase64(dataUrl.split(",")[1] ?? ""));
const bareDoi = (text: string | undefined): string | undefined => normalDoi(text);

const surname = (name: string): string => name.trim().split(/\s+/).pop() ?? name;
/** A paper in a few words, the way it's cited in conversation: "Carroll 2020", "Dambre et al. 2012". */
export const paperLabel = (paper: { title: string; authors: string[]; filename: string; doi?: string }, sourceText = ""): string => {
  const [first, second, ...rest] = paper.authors;
  const who = !first ? "" : rest.length ? `${surname(first)} et al.` : second ? `${surname(first)} & ${surname(second)}` : surname(first);
  const arxiv = /arxiv\.(\d{2})\d{2}\./i.exec(paper.doi ?? "")?.[1];
  const year = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/.exec(paper.filename)?.[1] ?? (arxiv ? `20${arxiv}` : undefined) ?? [...sourceText.matchAll(/\b((?:19|20)\d{2})\b/g)].pop()?.[1];
  if (!who) return paper.title.length > 28 ? `${paper.title.slice(0, 27).trimEnd()}…` : paper.title;
  return year ? `${who} ${year}` : who;
};

/** The names a saved extraction of `paper.pdf` goes by, best first. */
const SAVED_SUFFIXES = [".graph.json", ".mira.jsonld", ".jsonld", ".json"];
export const savedNamesFor = (filename: string): string[] => SAVED_SUFFIXES.map((suffix) => `${stemOf(filename)}${suffix}`.toLowerCase());
/** The paper a saved extraction's own name points at: `paper.graph.json` is about `paper`. */
const savedStem = (name: string): string => {
  const lower = name.toLowerCase();
  const suffix = SAVED_SUFFIXES.find((item) => lower.endsWith(item));
  return suffix ? name.slice(0, name.length - suffix.length) : stemOf(name);
};

type LdNode = Record<string, unknown> & { "@id"?: string; "@type"?: string | string[] };
const typesOf = (node: LdNode): string[] => (Array.isArray(node["@type"]) ? node["@type"] : node["@type"] ? [node["@type"]] : []);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** MIRA's own JSON-LD, as MIRA extraction exports it: units, relation instances, and each one's passage as an Item. */
const fromMiraJsonLd = (document: { "@graph"?: unknown }, name: string): ExtractionGraph => {
  const all = (Array.isArray(document["@graph"]) ? document["@graph"] : []) as LdNode[];
  const byId = new Map(all.flatMap((node) => (node["@id"] ? [[node["@id"], node] as const] : [])));
  const passage = (node: LdNode): string | undefined => text(byId.get(String(node.description ?? ""))?.content);
  const schemas = new Set(all.filter((node) => typesOf(node).includes("NodeSchema")).map((node) => node["@id"]));
  const nodes: ExtractedNode[] = [];
  const edges: ExtractedEdge[] = [];
  for (const node of all) {
    const types = typesOf(node);
    const id = node["@id"];
    if (!id) continue;
    if (types.includes("RelationInstance")) {
      const relation = types.find((type) => type !== "RelationInstance" && !type.includes(":"));
      const [subject, object] = [text(node.source), text(node.destination)];
      const anchor = passage(node);
      if (relation && subject && object) edges.push({ relation, subject, object, ...(anchor ? { anchor } : {}) });
      continue;
    }
    if (!types.some((type) => schemas.has(type))) continue;
    const type = types.find((item) => !schemas.has(item)) ?? "Claim";
    const content = text(node.content) ?? text(node.title) ?? "";
    const [first, ...rest] = content.split(/\n\n/);
    const anchor = passage(node);
    const doi = /^https?:\/\/(dx\.)?doi\.org\//i.test(id) ? bareDoi(id) : undefined;
    nodes.push({
      id,
      type,
      text: first || content,
      ...(rest.length ? { description: rest.join("\n\n") } : {}),
      ...(anchor ? { anchor } : {}),
      ...(doi ? { doi } : {}),
    });
  }
  const authors = all
    .filter((node) => typesOf(node).includes("UserAccount") && /author/i.test(node["@id"] ?? ""))
    .flatMap((node) => (text(node.accountName) ? [{ name: String(node.accountName) }] : []));
  const sources = nodes.filter((node) => node.type === "SourceDocument");
  const own = sources.find((node) => edges.some((edge) => edge.relation === "describesActivity" && edge.subject === node.id)) ?? sources[0];
  return { source: `${savedStem(name)}.pdf`, paper: { ...(own?.doi ? { doi: own.doi } : {}), authors }, nodes, edges };
};

/** A saved extraction file, read into the one shape the importer takes. Says plainly when the file is something else. */
export const parseExtraction = (name: string, content: string): ExtractionGraph => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${name} isn't valid JSON.`);
  }
  const data = parsed as Partial<ExtractionGraph> & { "@graph"?: unknown };
  if (Array.isArray(data?.["@graph"])) {
    const graph = fromMiraJsonLd(data, name);
    if (!graph.nodes.length) throw new Error(`${name} holds no MIRA units.`);
    return graph;
  }
  if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) throw new Error(`${name} isn't a saved extraction. It needs nodes and edges.`);
  const nodes = data.nodes.filter((node) => node && typeof node.id === "string" && typeof node.type === "string" && typeof node.text === "string" && node.text.trim());
  if (!nodes.length) throw new Error(`${name} holds no units.`);
  const edges = data.edges.filter((edge) => edge && typeof edge.relation === "string" && typeof edge.subject === "string" && typeof edge.object === "string");
  return { ...data, nodes, edges } as ExtractionGraph;
};

const describeSaved = (name: string, graph: ExtractionGraph): SavedExtraction => ({
  name,
  ...(graph.paper?.title ? { title: graph.paper.title } : {}),
  ...(graph.models?.[0] ? { model: graph.models[0] } : {}),
  units: graph.nodes.length,
  relations: graph.edges.length,
});

export type PaperMeta = { filename: string; model: string; server: string; schema: string; /** The hash of the PDF that was read, when the file was in hand. */ fileCid?: string | undefined };

/** Turns one extraction into records. Units get no note or page until they're exported. */
export const planPaper = (context: Context, graph: ExtractionGraph, meta: PaperMeta): { records: DgRecord[]; paper: PaperRecord } => {
  const stamp = context.stamp();
  const fresh: DgRecord[] = [];

  // A type is the same type only when its meaning matches too: a "Protocol" someone made as a kind of source isn't MIRA's.
  const keyOf = (label: string, base: string | undefined): string => `${label.toLowerCase()}|${base ?? ""}`;
  const known = new Map<string, NodeTypeRecord>(context.nodeTypes().map((type) => [keyOf(type.label, type.base), type]));
  const typeFor = (name: string): NodeTypeRecord => {
    const wanted = spec(name);
    const found = known.get(keyOf(wanted.label, wanted.base));
    if (found) return found;
    const made = createNodeType({
      ...stamp,
      fields: {
        label: wanted.label,
        base: wanted.base,
        abbreviation: wanted.abbreviation,
        titleFormat: context.titleFormat?.(wanted.abbreviation) ?? `${wanted.abbreviation} - {content}`,
        ...(wanted.lexicon ? { lexicon: wanted.lexicon } : {}),
        ...(wanted.color ? { color: wanted.color } : {}),
      },
    });
    known.set(keyOf(wanted.label, wanted.base), made);
    fresh.push(made);
    return made;
  };

  const relationsKnown = new Map<string, RelationTypeRecord>(context.relationTypes().flatMap((type) => (type.base ? [[type.base, type] as const] : [])));
  const relationFor = (name: string): RelationTypeRecord => {
    const wanted = RELATIONS[name] ?? { label: name, complement: `${name} (reversed)`, base: "informs" as BaseRelationType };
    const found = relationsKnown.get(wanted.base);
    if (found) return found;
    const made = createRelationType({ ...stamp, fields: { ...wanted, rules: [] } });
    relationsKnown.set(wanted.base, made);
    fresh.push(made);
    return made;
  };

  // The paper's own source unit, among any it cites: the one that reports the work, or carries its DOI.
  const sources = graph.nodes.filter((node) => spec(node.type).base === "source");
  const ownSource =
    sources.find((node) => graph.edges.some((edge) => edge.relation === "describesActivity" && edge.subject === node.id)) ??
    sources.find((node) => bareDoi(node.doi) && bareDoi(node.doi) === bareDoi(graph.paper?.doi)) ??
    (sources.length === 1 ? sources[0] : undefined);
  // Only the DOI the extraction states for the paper itself counts: it decides what may be kept on a server.
  const doi = bareDoi(graph.paper?.doi);
  const url = graph.paper?.url ?? ownSource?.url;
  const title = graph.paper?.title ?? stemOf(meta.filename);
  const canvas = createCanvas({ ...stamp, title, fields: { needsLayout: true } });
  const paper = createPaper({
    ...stamp,
    fields: {
      title,
      canvas: canvas.id,
      filename: meta.filename,
      ...(meta.fileCid ? { fileCid: meta.fileCid } : {}),
      authors: (graph.paper?.authors ?? []).map(({ name }) => name),
      model: meta.model,
      schema: meta.schema,
      server: meta.server,
      ...(doi ? { doi } : {}),
      ...(url ? { url } : {}),
      ...(graph.paper?.license ? { license: graph.paper.license } : {}),
    },
  });
  canvas.paper = paper.id;
  fresh.push(canvas, paper);

  const nodeIds = new Map<string, DgId>();
  const cards = new Map<string, DgId>();
  graph.nodes.forEach((extracted, index) => {
    const node = createNode({
      ...stamp,
      title: extracted.text,
      type: typeFor(extracted.type).id,
      source: {
        paper: paper.id,
        ...(extracted.anchor ? { anchor: extracted.anchor } : {}),
        ...(extracted.description ? { description: extracted.description } : {}),
        ...(extracted === ownSource ? { own: true as const } : {}),
      },
      // A source keeps its identifier, so the same paper cited from two canvases can be recognised.
      ...(spec(extracted.type).base === "source" && (bareDoi(extracted.doi) ?? (extracted === ownSource ? doi : undefined))
        ? { facts: { doi: (bareDoi(extracted.doi) ?? doi)! } }
        : {}),
    });
    nodeIds.set(extracted.id, node.id);
    const item = {
      type: "text" as const,
      text: extracted.text,
      x: (index % 4) * 300,
      y: Math.floor(index / 4) * 200,
      width: 240,
      height: heightOf(extracted.text),
      dg: { node: node.id },
    };
    const card = createCanvasItem({ ...stamp, canvas: canvas.id, item, z: index + 1 });
    cards.set(extracted.id, card.id);
    fresh.push(node, card);
  });

  graph.edges.forEach((edge, index) => {
    const [source, target] = [nodeIds.get(edge.subject), nodeIds.get(edge.object)];
    const [from, to] = [cards.get(edge.subject), cards.get(edge.object)];
    if (!source || !target || !from || !to) return;
    const relation = assertRelation({ ...stamp, type: relationFor(edge.relation).id, source, target });
    const item = { fromNode: from, toNode: to, dg: { relation: relation.id } };
    fresh.push(relation, createCanvasItem({ ...stamp, canvas: canvas.id, item, z: graph.nodes.length + index + 1 }));
  });
  return { records: fresh, paper };
};

export const paperFeature = (
  context: Context,
  demoGraphs: { filename: string; graph: ExtractionGraph }[],
): Pick<Handlers, "paper.extract" | "paper.saved" | "paper.importGraph" | "paper.loadDemo" | "paper.list" | "paper.share"> & {
  summary: (paper: PaperRecord) => PaperSummary;
  graphOf: (paper: PaperRecord) => ExtractionGraph;
} => {
  const papers = (): PaperRecord[] => context.documents("paper");

  const unitsOf = (paper: PaperRecord) =>
    context.documents("node").filter((node) => !node.removed && node.source?.paper === paper.id);

  const relationsOf = (paper: PaperRecord): RelationRecord[] => {
    const ids = new Set(unitsOf(paper).map(({ id }) => id));
    return [...context.graph().relations.values()].flatMap(({ record, state }) =>
      state !== "withdrawn" && state !== "rejected" && ids.has(record.source) && ids.has(record.target) ? [record] : [],
    );
  };

  const summary = (paper: PaperRecord): PaperSummary => ({
    id: paper.id,
    title: paper.title,
    canvas: paper.canvas,
    filename: paper.filename,
    authors: paper.authors,
    model: paper.model,
    server: paper.server,
    schema: paper.schema,
    units: unitsOf(paper).length,
    relations: relationsOf(paper).length,
    at: paper.at,
    credit: context.creditFor(paper),
    stored: paper.stored === true,
    ...(inLibraryOf(paperIdentifiers(paper), paper.by, context.me().id) ? { library: inLibraryOf(paperIdentifiers(paper), paper.by, context.me().id)! } : {}),
    ...(paper.doi ? { doi: paper.doi } : {}),
    ...(paper.labPaper ? { labPaper: paper.labPaper } : {}),
  });

  /** The extraction, rebuilt from records, so a lab receives what the person reviewed. */
  const graphOf = (paper: PaperRecord): ExtractionGraph => ({
    source: paper.filename,
    models: [paper.model],
    paper: { title: paper.title, ...(paper.doi ? { doi: paper.doi } : {}), authors: paper.authors.map((name) => ({ name })) },
    nodes: unitsOf(paper).map((node) => ({
      id: node.id,
      type: context.typeOf(node.type)?.label ?? "Claim",
      text: node.title,
      ...(node.source?.anchor ? { anchor: node.source.anchor } : {}),
      ...(node.source?.description ? { description: node.source.description } : {}),
    })),
    edges: relationsOf(paper).map((record) => ({
      relation: context.relationTypeOf(record.type)?.base ?? "informs",
      subject: record.source,
      object: record.target,
    })),
  });

  const importGraph = async (graph: ExtractionGraph, meta: PaperMeta): Promise<PaperRecord> => {
    const { records, paper } = planPaper(context, graph, meta);
    await context.put(records);
    return paper;
  };

  /** The saved extraction beside a paper's file: same name, in its folder first, then anywhere in the base. */
  const savedBeside = async (name: string, ref?: string): Promise<{ name: string; graph: ExtractionGraph } | null> => {
    const listed = await context.host.listFiles({ extensions: ["json", "jsonld"], limit: 5000 });
    if (!listed.ok) return null;
    const wanted = savedNamesFor(name);
    const folder = ref?.includes("/") ? ref.slice(0, ref.lastIndexOf("/")) : undefined;
    const found = listed.value
      .filter((file) => wanted.includes(file.name.toLowerCase()))
      .sort(
        (a, b) =>
          Number(b.folder === folder) - Number(a.folder === folder) ||
          wanted.indexOf(a.name.toLowerCase()) - wanted.indexOf(b.name.toLowerCase()),
      );
    for (const file of found) {
      const read = await context.host.readAsset({ ref: file.ref });
      if (!read.ok) continue;
      try {
        return { name: file.name, graph: parseExtraction(file.name, textOfDataUrl(read.value.dataUrl)) };
      } catch {
        // A JSON file of the same name that isn't an extraction.
      }
    }
    return null;
  };

  /** A picked PDF is kept where the reader looks, so its units can be opened at their passage. */
  /** The PDF's own hash. A saved extraction read with no PDF beside it has none. */
  const hashOf = async (file: { name: string; dataBase64: string }): Promise<string | undefined> =>
    /\.pdf$/i.test(file.name) && file.dataBase64 ? cidOfBytes(fromBase64(file.dataBase64)).catch(() => undefined) : undefined;

  const keepFile = async (file: { name: string; mediaType: string; dataBase64: string }): Promise<void> => {
    if (!/\.pdf$/i.test(file.name) || !file.dataBase64) return;
    const listed = await context.host.listFiles({ extensions: ["pdf"], limit: 5000 });
    if (listed.ok && listed.value.some((entry) => entry.name === file.name)) return;
    await context.host.writeAsset({ asset: { name: file.name, mime: "application/pdf", dataUrl: `data:application/pdf;base64,${file.dataBase64}` } });
  };

  /** Only a paper with a DOI ever reaches Discourse Graphs, and only its graph. */
  const keepGraph = async (paper: PaperRecord, graph: ExtractionGraph): Promise<PaperRecord> => {
    if (!paper.doi || !context.services) return paper;
    try {
      // The graph as this base holds it, so what the server serves carries the units' own ids.
      await context.services.storeGraph({ doi: paper.doi, graph: graphOf(paper), schema: paper.schema, model: paper.model });
    } catch {
      return paper;
    }
    const stored = revise({ record: paper, changes: { stored: true }, by: context.me() });
    await context.put([stored]);
    return stored;
  };

  const shareToLab = async (paper: PaperRecord, file?: { dataBase64: string; mediaType: string }): Promise<PaperRecord> => {
    const link = await context.services?.link();
    const lab = context.myLab();
    if (!link?.token || !lab) throw new Error("Join a lab first.");
    const me = { did: context.me().id, name: context.me().name };
    await context.services!.uploadPaper(link, {
      paper: {
        id: paper.id,
        title: paper.title,
        filename: paper.filename,
        model: paper.model,
        schema: paper.schema,
        server: paper.server,
        canvas: paper.canvas,
        uploadedBy: me,
        extractedBy: { did: paper.by.id, name: paper.by.name },
        ...(paper.doi ? { doi: paper.doi } : {}),
      },
      graph: graphOf(paper),
      ...(file ? { fileBase64: file.dataBase64, mediaType: file.mediaType } : {}),
    });
    const canvas = context.canvasOf(paper.canvas);
    const shared = revise({ record: paper, changes: { labPaper: paper.id, uploadedBy: context.me() }, by: context.me() });
    await context.put([shared, ...(canvas ? [revise({ record: canvas, changes: { shared: lab.did }, by: context.me() })] : [])]);
    return shared;
  };

  return {
    summary,
    graphOf,
    "paper.list": async () => papers().map(summary).sort((a, b) => b.at.localeCompare(a.at)),
    "paper.importGraph": async ({ graph, filename, model, server, schema }) =>
      summary(await importGraph(graph, {
        filename,
        model: model ?? graph.models?.[0] ?? "Unknown",
        server: server ?? "Imported file",
        schema: schema ?? "mira",
      })),
    "paper.loadDemo": async () => {
      const made: PaperSummary[] = [];
      for (const { filename, graph } of demoGraphs) {
        if (papers().some((paper) => paper.filename === filename)) continue;
        made.push(summary(await importGraph(graph, {
          filename,
          model: graph.models?.[0] ?? "Unknown",
          server: "MIRA extraction (saved output)",
          schema: "mira",
        })));
      }
      return made;
    },
    "paper.saved": async ({ name, ref, text: content }) => {
      if (content !== undefined) return describeSaved(name, parseExtraction(name, content));
      const found = await savedBeside(name, ref);
      return found ? describeSaved(found.name, found.graph) : null;
    },
    "paper.extract": async ({ file: picked, ref, saved, server, model, schema, share }) => {
      const status = (message: string): void => context.send({ event: "job-status", message });
      let file = picked;
      if (!file && ref) {
        const asset = await context.readFile(ref);
        if (!asset.ok) throw new Error(asset.error.message);
        file = { name: asset.value.name, mediaType: asset.value.mime, dataBase64: asset.value.dataUrl.split(",")[1] ?? "" };
      }
      if (!file) throw new Error("Choose a paper first.");
      const name = file.name;
      let paper: PaperRecord;
      let graph: ExtractionGraph;

      if (saved) {
        const found = saved === true ? await savedBeside(name, ref) : { name: saved.name, graph: parseExtraction(saved.name, saved.text) };
        if (!found) throw new Error(`No saved extraction sits beside ${name}.`);
        graph = found.graph;
        const from = `Saved extraction (${found.name})`;
        const madeBy = graph.models?.[0] ?? "Unknown";
        // The same saved file read twice is the same paper, so the second time opens the first.
        const already = papers().find((entry) => entry.filename === name && entry.server === from && entry.model === madeBy && context.canvasOf(entry.canvas) && !context.canvasOf(entry.canvas)!.removed);
        if (already) return summary(already);
        status("Making the paper's canvas");
        if (picked) await keepFile(picked);
        paper = await importGraph(graph, { filename: name, model: madeBy, server: from, schema: schema ?? "mira", fileCid: await hashOf(file) });
      } else {
        if (!context.services) throw new Error("No services are set up here.");
        if (!server || !model || !schema) throw new Error("Choose a server, a model and a schema first.");
        const servers = await context.services.servers();
        const serverName = servers.find(({ url }) => url === server)?.name ?? server;
        graph = await context.services.extract({
          url: server,
          filename: name,
          mediaType: file.mediaType,
          dataBase64: file.dataBase64,
          model,
          schema,
          onStatus: status,
        });
        status("Making the paper's canvas");
        if (picked) await keepFile(picked);
        paper = await importGraph(graph, { filename: name, model: graph.models?.[0] ?? model, server: serverName, schema, fileCid: await hashOf(file) });
        paper = await keepGraph(paper, graph);
      }
      // Read from the reference library's own file: the paper is that reference, so it carries its identifiers.
      if (ref && isLibraryRef(ref) && context.services?.zotero) {
        const item = await context.services.zotero.file({ ref }).then((held) => held.item, () => undefined);
        const doi = item?.identifiers.find(({ scheme }) => scheme === "doi")?.value;
        const rest = item?.identifiers.filter(({ scheme }) => scheme !== "doi") ?? [];
        if (item && (rest.length || (doi && !paper.doi))) {
          paper = revise({ record: paper, changes: { identifiers: mergeIdentifiers(paper.identifiers, rest), ...(doi && !paper.doi ? { doi } : {}) }, by: context.me() });
          await context.put([paper]);
        }
      }
      if (share) {
        status("Adding it to the lab's repository");
        paper = await shareToLab(paper, share.includeFile ? file : undefined);
      }
      return summary(paper);
    },
    "paper.share": async ({ id }) => {
      const paper = context.documents("paper").find((item) => item.id === id);
      if (!paper) throw new Error("No such paper.");
      return summary(await shareToLab(paper));
    },
  };
};
