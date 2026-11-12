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
import type { ExtractionGraph } from "@dg/contract/services.ts";
import type { PaperSummary } from "@dg/contract/surface.ts";
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
  Study: { label: "Run", abbreviation: "RUN", base: "run", lexicon: "science.mira.study", color: "#d98ab0" },
  Protocol: { label: "Protocol", abbreviation: "PRO", base: "protocol", lexicon: "science.mira.protocol", color: "#8fbf6f" },
  Request: { label: "Request", abbreviation: "REQ", base: "question", lexicon: "science.mira.request", color: "#b18cf2" },
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

export type PaperMeta = { filename: string; model: string; server: string; schema: string };

/** Turns one extraction into records. Units get no note or page until they're exported. */
export const planPaper = (context: Context, graph: ExtractionGraph, meta: PaperMeta): { records: DgRecord[]; paper: PaperRecord } => {
  const stamp = context.stamp();
  const fresh: DgRecord[] = [];

  const known = new Map<string, NodeTypeRecord>(context.nodeTypes().map((type) => [type.label.toLowerCase(), type]));
  const typeFor = (name: string): NodeTypeRecord => {
    const wanted = spec(name);
    const found = known.get(wanted.label.toLowerCase());
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
    known.set(wanted.label.toLowerCase(), made);
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

  const title = graph.paper?.title ?? meta.filename.replace(/\.[^.]+$/, "");
  const canvas = createCanvas({ ...stamp, title, fields: { needsLayout: true } });
  const paper = createPaper({
    ...stamp,
    fields: {
      title,
      canvas: canvas.id,
      filename: meta.filename,
      authors: (graph.paper?.authors ?? []).map(({ name }) => name),
      model: meta.model,
      schema: meta.schema,
      server: meta.server,
      ...(graph.paper?.doi ? { doi: graph.paper.doi } : {}),
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
      },
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
): Pick<Handlers, "paper.extract" | "paper.importGraph" | "paper.loadDemo" | "paper.list" | "paper.share"> & {
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

  /** Only a paper with a DOI ever reaches Discourse Graphs, and only its graph. */
  const keepGraph = async (paper: PaperRecord, graph: ExtractionGraph): Promise<PaperRecord> => {
    if (!paper.doi || !context.services) return paper;
    try {
      await context.services.storeGraph({ doi: paper.doi, graph, schema: paper.schema, model: paper.model });
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
    "paper.extract": async ({ file, server, model, schema, share }) => {
      if (!context.services) throw new Error("No services are set up here.");
      const servers = await context.services.servers();
      const name = servers.find(({ url }) => url === server)?.name ?? server;
      const status = (message: string): void => context.send({ event: "job-status", message });
      const graph = await context.services.extract({
        url: server,
        filename: file.name,
        mediaType: file.mediaType,
        dataBase64: file.dataBase64,
        model,
        schema,
        onStatus: status,
      });
      status("Making the paper's canvas");
      let paper = await importGraph(graph, { filename: file.name, model: graph.models?.[0] ?? model, server: name, schema });
      paper = await keepGraph(paper, graph);
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
