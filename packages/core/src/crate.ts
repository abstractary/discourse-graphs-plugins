import {
  buildCanvas,
  createCanvasItem,
  createNode,
  liveCanvasItems,
  staysLocal,
  validateRecord,
  type BaseNodeType,
  type DgId,
  type DgRecord,
  type FoldedGraph,
  type JsonObject,
  type NodeRecord,
  type NodeTypeRecord,
  type PaperRecord,
  type Pin,
  type ProvenanceLinks,
  type RunStatus,
  type UnitFacts,
} from "@dg/contract/records.ts";
import { mergeIdentifiers, parseIdentifier, type Identifier } from "@dg/contract/scholarly.ts";
import type { CrateExported, CrateImported } from "@dg/contract/surface.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";
import type { Context, Handlers, Stamp } from "./context.ts";
import { toDataCite } from "./datacite.ts";
import { iriOf, toProcessJsonLd } from "./jsonld.ts";
import { baseOf, ensureProcessTypes, protocolCids, provenanceOf } from "./process.ts";
import { CRATE_VERSIONS, LICENSE_CHOICES, cratePreview, toRoCrate, type CrateFile } from "./rocrate.ts";
import { unzip, zip } from "./zip.ts";

/**
 * Research crates in and out. Going out, a canvas or a set of units becomes
 * one archive a repository, a lab notebook or a colleague's tools can read.
 * Coming in, a crate this app made is restored exactly; anyone else's becomes
 * sources, code, runs and outputs with their provenance kept.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const text = (value: string): Uint8Array => encoder.encode(value);

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};
const fromBase64 = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export const slugOf = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60) || "discourse-graph";

/** The units asked for, plus everything their provenance names, so the crate explains itself. */
export const withProvenance = (graph: FoldedGraph, ids: DgId[]): DgId[] => {
  const live = (id: string): boolean => {
    const record = graph.documents.get(id);
    return record?.kind === "node" && !record.removed && !graph.withdrawn.has(id);
  };
  const kept = new Set<DgId>();
  let reach = ids.filter(live);
  while (reach.length) {
    const next: DgId[] = [];
    for (const id of reach) {
      if (kept.has(id)) continue;
      kept.add(id);
      const prov = provenanceOf(graph, id);
      const pins = (list: Pin[] | undefined): string[] => (list ?? []).map(({ uri }) => uri);
      const named = [
        prov.question,
        prov.partOf,
        prov.generatedBy,
        prov.isGroundedIn,
        prov.sourceDocument,
        prov.follows?.uri,
        ...(prov.protocols ?? []),
        ...(prov.implementedBy ?? []),
        ...(prov.describesActivity ?? []),
        ...pins(prov.instrument),
        ...pins(prov.used),
        ...pins(prov.derivedFrom),
        ...pins(prov.observationBase),
      ];
      for (const other of named) if (other && live(other) && !kept.has(other)) next.push(other);
    }
    reach = next;
  }
  return [...kept];
};

/** Every record a crate needs to be opened again as it was: units, their types, the arguments between them, papers and the canvas. */
export const recordsFor = (graph: FoldedGraph, nodes: DgId[], canvas?: DgId): DgRecord[] => {
  const chosen = new Set(nodes);
  const kept = new Map<DgId, DgRecord>();
  const keep = (id: DgId | undefined): void => {
    const record = id ? graph.documents.get(id) : undefined;
    if (record && !staysLocal(record)) kept.set(record.id, record);
  };
  for (const id of nodes) {
    const node = graph.documents.get(id);
    if (node?.kind !== "node") continue;
    keep(id);
    keep(node.type);
    keep(node.source?.paper);
  }
  for (const { record, state } of graph.relations.values()) {
    if (state !== "active" || !chosen.has(record.source) || !chosen.has(record.target)) continue;
    kept.set(record.id, record);
    keep(record.type);
  }
  if (canvas) {
    keep(canvas);
    for (const item of liveCanvasItems({ graph, canvas })) kept.set(item.id, item);
  }
  return [...kept.values()];
};

// Reading a crate someone else made

type Entity = JsonObject & { "@id": string };

const listOf = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
const idsOf = (value: unknown): string[] => listOf(value).flatMap((item) => (item && typeof item === "object" && "@id" in item ? [String((item as JsonObject)["@id"])] : typeof item === "string" ? [item] : []));
const typesOf = (entity: JsonObject): string[] => listOf(entity["@type"]).map(String);
const stringOf = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined);
const timeOf = (value: unknown): string | undefined => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
};

const BASE_OF_TYPE: [string, BaseNodeType][] = [
  ["CreateAction", "run"],
  ["ComputationalWorkflow", "code"],
  ["SoftwareSourceCode", "code"],
  ["SoftwareApplication", "code"],
  ["HowTo", "protocol"],
  ["LabProtocol", "protocol"],
  ["ScholarlyArticle", "source"],
  ["Question", "question"],
  ["Claim", "claim"],
];
const FILE_TYPES = new Set(["File", "MediaObject", "ImageObject", "Dataset", "TextDigitalDocument"]);
const STATUS: Record<string, RunStatus> = { CompletedActionStatus: "completed", FailedActionStatus: "failed", ActiveActionStatus: "running", PotentialActionStatus: "planned" };
const KIND_OF_MIME = (mime: string | undefined, types: string[]): UnitFacts["outputKind"] =>
  types.includes("Dataset") ? "dataset" : types.includes("ImageObject") || mime?.startsWith("image/") ? "figure" : mime === "text/csv" || mime === "text/tab-separated-values" ? "table" : mime?.startsWith("text/") ? "text" : "file";

/** A crate's metadata, checked to be one. Accepts RO-Crate 1.0 to 1.3. */
export const readCrate = (metadata: unknown): { graph: Entity[]; root: Entity; byId: Map<string, Entity> } => {
  const graph = (metadata as JsonObject | null)?.["@graph"];
  if (!Array.isArray(graph)) throw new Error("This isn't an RO-Crate: its metadata has no @graph.");
  const entities = graph.filter((item): item is Entity => Boolean(item) && typeof item === "object" && typeof (item as JsonObject)["@id"] === "string");
  const byId = new Map(entities.map((entity) => [entity["@id"], entity]));
  const descriptor = entities.find((entity) => entity["@id"].endsWith("ro-crate-metadata.json") || entity["@id"].endsWith("ro-crate-metadata.jsonld"));
  const root = byId.get(idsOf(descriptor?.about)[0] ?? "./");
  if (!root) throw new Error("This isn't an RO-Crate: it has no root dataset.");
  return { graph: entities, root, byId };
};

export type CratePlan = { records: DgRecord[]; units: NodeRecord[]; fresh: number; name: string; skipped: number };

/**
 * Turns another tool's crate into units. A run keeps what it used, what ran
 * and what came out. Importing the same crate twice makes nothing new.
 */
export const planCrateImport = ({
  metadata,
  graph,
  types,
  stamp,
  limit = 300,
}: {
  metadata: unknown;
  graph: FoldedGraph;
  types: Partial<Record<BaseNodeType, NodeTypeRecord>>;
  stamp: Stamp;
  limit?: number;
}): CratePlan => {
  const { graph: entities, root, byId } = readCrate(metadata);
  const name = stringOf(root.name) ?? "RO-Crate";
  // What tells this crate from another, so its relative ids don't collide with theirs.
  const rootKey = /^https?:\/\//.test(root["@id"]) ? root["@id"] : (idsOf(root.identifier)[0] ?? stringOf(root.identifier) ?? `urn:ro-crate:${slugOf(name)}:${stringOf(root.datePublished) ?? ""}`);
  const keyOf = (id: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(id) ? id : `${rootKey}#${id.replace(/^#/, "")}`);
  const existing = [...graph.documents.values()].filter((record): record is NodeRecord => record.kind === "node" && !record.removed);
  const agent = `RO-Crate import: ${name}`;

  const cited = new Set(idsOf(root.citation));
  const parts = new Set(idsOf(root.hasPart));
  const baseFor = (entity: Entity): BaseNodeType | undefined => {
    const kinds = typesOf(entity);
    const named = BASE_OF_TYPE.find(([type]) => kinds.includes(type))?.[1];
    if (named) return named;
    if (cited.has(entity["@id"])) return "source";
    if (kinds.some((type) => FILE_TYPES.has(type)) && (parts.has(entity["@id"]) || /^https?:\/\//.test(entity["@id"])) && entity["@id"] !== "./") return "output";
    return undefined;
  };
  const candidates = entities.filter((entity) => entity !== root && !/ro-crate-(metadata\.json(ld)?|preview\.html)$/.test(entity["@id"]) && baseFor(entity) && types[baseFor(entity)!]);
  // Runs and what they name come first, so a very large crate keeps its provenance before its loose files.
  const named = new Set(candidates.filter((entity) => baseFor(entity) === "run").flatMap((run) => [...idsOf(run.instrument), ...idsOf(run.object), ...idsOf(run.result)]));
  const rank = (entity: Entity): number => (baseFor(entity) === "run" ? 0 : named.has(entity["@id"]) ? 1 : baseFor(entity) === "output" ? 3 : 2);
  const ordered = [...candidates].sort((a, b) => rank(a) - rank(b));
  const taken = ordered.slice(0, limit);

  const identifiersIn = (entity: Entity): Identifier[] =>
    mergeIdentifiers(
      [entity["@id"], ...idsOf(entity.identifier).map((id) => stringOf(byId.get(id)?.value) ?? id), ...listOf(entity.identifier).filter((item): item is string => typeof item === "string"), ...idsOf(entity.sameAs)]
        .flatMap((value) => {
          const found = parseIdentifier(value);
          return found && found.scheme !== "url" ? [found] : [];
        }),
    );

  const made = new Map<string, NodeRecord>();
  const records: DgRecord[] = [];
  let fresh = 0;
  const facts = (entity: Entity, base: BaseNodeType): UnitFacts => {
    const ids = identifiersIn(entity);
    const doi = ids.find(({ scheme }) => scheme === "doi")?.value;
    const rest = ids.filter(({ scheme }) => scheme !== "doi");
    const absolute = /^https?:\/\//.test(entity["@id"]) ? entity["@id"] : undefined;
    const common: UnitFacts = { provenance: { method: "imported", agent }, sameAs: [keyOf(entity["@id"])], ...(rest.length ? { identifiers: rest } : {}) };
    if (base === "source") return { ...common, ...(doi ? { doi } : {}), ...(absolute && !doi ? { uri: absolute } : {}) };
    if (base === "code") {
      const license = idsOf(entity.license)[0] ?? stringOf(entity.license);
      return {
        ...common,
        ...(stringOf(entity.codeRepository) ? { repo: stringOf(entity.codeRepository)! } : {}),
        ...(stringOf(entity.version) ? { commit: stringOf(entity.version)! } : {}),
        ...(stringOf(entity.programmingLanguage) ?? stringOf(byId.get(idsOf(entity.programmingLanguage)[0] ?? "")?.name) ? { language: (stringOf(entity.programmingLanguage) ?? stringOf(byId.get(idsOf(entity.programmingLanguage)[0] ?? "")?.name))! } : {}),
        ...(license ? { license } : {}),
        ...(absolute ? {} : { path: entity["@id"] }),
      };
    }
    if (base === "output") {
      const mime = stringOf(entity.encodingFormat) ?? listOf(entity.encodingFormat).map(stringOf).find(Boolean);
      const size = Number(stringOf(entity.contentSize));
      return {
        ...common,
        uri: absolute ?? `${rootKey.replace(/\/?$/, "/")}${entity["@id"]}`,
        ...(mime ? { mediaType: mime } : {}),
        ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
        outputKind: KIND_OF_MIME(mime, typesOf(entity)),
        ...(stringOf(entity.description) ? { caption: stringOf(entity.description)! } : {}),
      };
    }
    if (base === "run") {
      const status = STATUS[(idsOf(entity.actionStatus)[0] ?? "").replace(/^https?:\/\/schema\.org\//, "")];
      const agents = idsOf(entity.agent).map((id) => parseIdentifier(id, "orcid")?.value ?? stringOf(byId.get(id)?.name) ?? id);
      const parameterValues = Object.fromEntries(
        idsOf(entity.object).flatMap((id) => {
          const value = byId.get(id);
          return value && typesOf(value).includes("PropertyValue") && stringOf(value.name) ? [[stringOf(value.name)!, (value.value ?? "") as never] as const] : [];
        }),
      );
      return {
        ...common,
        ...(status ? { status } : {}),
        ...(timeOf(entity.startTime) ? { startedAt: timeOf(entity.startTime)! } : {}),
        ...(timeOf(entity.endTime) ? { endedAt: timeOf(entity.endTime)! } : {}),
        ...(agents.length ? { agents } : {}),
        ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
        ...(stringOf(entity.error) ? { deviations: [stringOf(entity.error)!] } : {}),
        fingerprint: keyOf(entity["@id"]),
      };
    }
    if (base === "protocol") {
      const steps = idsOf(entity.step).flatMap((id) => (stringOf(byId.get(id)?.name) ?? stringOf(byId.get(id)?.text) ? [(stringOf(byId.get(id)?.name) ?? stringOf(byId.get(id)?.text))!] : []));
      return { ...common, ...(stringOf(entity.version) ? { version: stringOf(entity.version)! } : {}), ...(steps.length ? { steps } : {}) };
    }
    return common;
  };

  const unitFor = (entity: Entity): NodeRecord => {
    const base = baseFor(entity)!;
    const key = keyOf(entity["@id"]);
    const known = made.get(entity["@id"]);
    if (known) return known;
    const built = facts(entity, base);
    const same =
      existing.find((node) => baseOf(graph, node) === base && node.facts?.sameAs?.includes(key)) ??
      (base === "source" && built.doi ? existing.find((node) => baseOf(graph, node) === "source" && node.facts?.doi === built.doi) : undefined);
    const node =
      same ??
      createNode({
        ...stamp,
        title: stringOf(entity.name) ?? stringOf(entity.headline) ?? (base === "run" ? `Run ${entity["@id"].replace(/^#/, "")}` : decodeURIComponent(entity["@id"].split("/").pop() ?? entity["@id"])),
        type: types[base]!.id,
        facts: built,
      });
    made.set(entity["@id"], node);
    if (!same) fresh += 1;
    return node;
  };
  for (const entity of taken) unitFor(entity);

  // Provenance, once every unit has its id. A unit already in the graph keeps the links it has.
  const pin = (id: string): Pin => ({ uri: made.get(id)?.id ?? keyOf(id) });
  const withLinks = [...made.entries()].map(([id, node]): NodeRecord => {
    const entity = byId.get(id)!;
    const base = baseFor(entity);
    if (existing.includes(node)) return node;
    let prov: ProvenanceLinks = {};
    if (base === "run") {
      const instrument = idsOf(entity.instrument).map(pin);
      const used = idsOf(entity.object).filter((other) => !typesOf(byId.get(other) ?? {}).includes("PropertyValue")).map(pin);
      prov = { ...(instrument.length ? { instrument } : {}), ...(used.length ? { used } : {}) };
    }
    if (base === "output") {
      const run = taken.find((other) => baseFor(other) === "run" && idsOf(other.result).includes(id));
      if (run) prov = { generatedBy: made.get(run["@id"])!.id };
    }
    return Object.keys(prov).length ? { ...node, prov } : node;
  });
  for (const node of withLinks) if (!existing.includes(node)) records.push(node);
  return { records, units: withLinks, fresh, name, skipped: ordered.length - taken.length };
};

// The feature

export const crateFeature = (context: Context) => {
  const baseIn = (node: NodeRecord | undefined) => baseOf(context.graph(), node);
  const unitsOnCanvas = (canvas: DgId): DgId[] =>
    liveCanvasItems({ graph: context.graph(), canvas }).flatMap(({ item }) => {
      const node = (item as { dg?: { node?: DgId } }).dg?.node;
      return node ? [node] : [];
    });

  const pdfOf = async (paper: PaperRecord): Promise<CrateFile | undefined> => {
    const listing = await context.host.listFiles({ extensions: ["pdf"], limit: 500 });
    const file = listing.ok ? listing.value.find((entry) => entry.name === paper.filename) : undefined;
    const asset = file ? await context.host.readAsset({ ref: file.ref }) : undefined;
    if (!file || !asset?.ok) return undefined;
    return {
      path: `papers/${file.name}`,
      name: paper.title,
      description: "The paper the units were read from.",
      mediaType: "application/pdf",
      bytes: fromBase64(asset.value.dataUrl.split(",")[1] ?? ""),
      paper: paper.id,
    };
  };

  const handlers: Pick<Handlers, "crate.export" | "crate.import" | "crate.licenses"> = {
    "crate.licenses": async () => LICENSE_CHOICES,
    "crate.export": async ({ canvas, nodes: asked, name: givenName, description: givenDescription, license, pdfs = false, format = "zip" }): Promise<CrateExported> => {
      const graph = context.graph();
      const canvasRecord = canvas ? context.canvasOf(canvas) : undefined;
      const start = asked?.length ? asked : canvas ? unitsOnCanvas(canvas) : [];
      if (start.length === 0) throw new Error("There are no units to put in a crate. Add some to the canvas first.");
      const nodes = withProvenance(graph, start);
      const records = nodes.flatMap((id) => (context.nodeOf(id) ? [context.nodeOf(id)!] : []));
      const papers = [...new Set(records.flatMap((node) => (node.source ? [node.source.paper] : [])))].flatMap((id) => {
        const paper = graph.documents.get(id);
        return paper?.kind === "paper" ? [paper] : [];
      });
      const name = givenName?.trim() || canvasRecord?.title || "Discourse graph";
      const counts = new Map<string, number>();
      for (const node of records) counts.set(context.typeOf(node.type)?.label ?? "Untyped", (counts.get(context.typeOf(node.type)?.label ?? "Untyped") ?? 0) + 1);
      const description =
        givenDescription?.trim() ||
        `A discourse graph of ${records.length} ${records.length === 1 ? "unit" : "units"} (${[...counts].map(([label, count]) => `${count} ${label}`).join(", ")})${papers.length ? `, read from ${papers.map(({ title }) => `"${title}"`).join(", ")}` : ""}. Made with Discourse Graphs.`;
      const published = new Date().toISOString();
      const me = context.me();
      const people = context.documents("person");
      const orcidOf = (did: string): string | undefined => people.find((person) => person.did === did)?.orcid;
      const lab = context.myLab();
      const versions = await protocolCids(graph);

      const chosen = new Set(nodes.map((id) => iriOf(graph, id)));
      const jsonld = toProcessJsonLd(graph, "https://discoursegraphs.com/ns/process/context.jsonld", versions);
      const files: CrateFile[] = [
        {
          path: "discourse-graph.jsonld",
          name: "The discourse graph, as PROV-O JSON-LD",
          description: "Every unit and its provenance links, with the arguments between them. Read with the Discourse Graphs process context.",
          mediaType: "application/ld+json",
          bytes: text(JSON.stringify({ ...jsonld, "@graph": (jsonld["@graph"] as JsonObject[]).filter((item) => chosen.has(String(item.id))) }, null, 2)),
          conformsTo: "https://www.w3.org/TR/prov-o/",
        },
        {
          path: "dg-records.jsonl",
          name: "Discourse Graphs records",
          description: "The same graph as the records Discourse Graphs keeps, one per line. Importing the crate reads these, so nothing is lost on the way back.",
          mediaType: "application/jsonl",
          bytes: text(recordsFor(graph, nodes, canvas).map((record) => JSON.stringify(record)).join("\n")),
        },
      ];
      if (canvas && canvasRecord) {
        const doc = buildCanvas({ graph, canvas });
        files.push({
          path: `${slugOf(canvasRecord.title)}.canvas`,
          name: `${canvasRecord.title}, as a JSON Canvas`,
          description: "Where each unit sits on the canvas. Opens in Obsidian and any other JSON Canvas tool.",
          mediaType: "application/json",
          bytes: text(JSON.stringify(doc, null, 2)),
          conformsTo: "https://jsoncanvas.org/spec/1.0/",
        });
      }
      const sources = records.filter((node) => baseIn(node) === "source" && !node.source?.own);
      const code = records.filter((node) => baseIn(node) === "code");
      files.push({
        path: "datacite.json",
        name: "DataCite metadata",
        description: "This crate described in DataCite's schema, for a repository that will give it a DOI.",
        mediaType: "application/json",
        bytes: text(
          JSON.stringify(
            toDataCite({
              title: name,
              description,
              creators: [{ name: me.name, ...(orcidOf(me.id) ? { orcid: orcidOf(me.id)! } : {}), ...(lab ? { affiliation: lab.name } : {}) }],
              publisher: lab?.name ?? me.name,
              published,
              ...(license ? { license, licenseName: LICENSE_CHOICES.find(({ url }) => url === license)?.name ?? license } : {}),
              derivedFrom: papers.flatMap((paper) => paperIdentifiers(paper).slice(0, 1)),
              references: sources.flatMap((node) => identifiersOf(node).slice(0, 1)),
              software: code.flatMap((node): Identifier[] => (node.facts?.swhid ? [{ scheme: "swhid", value: node.facts.swhid }] : node.facts?.repo ? [{ scheme: "url", value: node.facts.repo }] : [])),
              subjects: ["Discourse graph", ...new Set(papers.flatMap(({ venue }) => (venue ? [venue] : [])))],
            }),
            null,
            2,
          ),
        ),
        conformsTo: "https://schema.datacite.org/meta/kernel-4.6/",
      });
      let pdfCount = 0;
      if (pdfs) {
        for (const paper of papers) {
          const pdf = await pdfOf(paper);
          if (pdf) {
            files.push(pdf);
            pdfCount += 1;
          }
        }
      }

      const version = format === "eln" ? "1.2" : "1.3";
      const metadata = await toRoCrate({
        graph,
        nodes,
        name,
        description,
        ...(license ? { license } : {}),
        author: { id: me.id, name: me.name, ...(orcidOf(me.id) ? { orcid: orcidOf(me.id)! } : {}) },
        ...(lab ? { publisher: { name: lab.name, id: lab.did } } : {}),
        published,
        files,
        version,
        versions,
        nameOf: (author) => people.find((person) => person.did === author.id)?.name ?? author.name,
        orcidOf: (author) => orcidOf(author.id),
      });
      if (format === "eln") {
        // The ELN format asks who made the archive.
        const descriptor = (metadata["@graph"] as JsonObject[]).find((entity) => entity["@id"] === "ro-crate-metadata.json")!;
        descriptor.sdPublisher = { "@id": "https://discoursegraphs.com" };
        (metadata["@graph"] as JsonObject[]).push({ "@id": "https://discoursegraphs.com", "@type": "Organization", name: "Discourse Graphs", url: "https://discoursegraphs.com" });
      }
      const slug = slugOf(name);
      const folder = format === "eln" ? `${slug}/` : "";
      const archive = zip([
        { path: `${folder}ro-crate-metadata.json`, bytes: text(JSON.stringify(metadata, null, 2)) },
        { path: `${folder}ro-crate-preview.html`, bytes: text(cratePreview(metadata)) },
        ...files.map(({ path, bytes }) => ({ path: `${folder}${path}`, bytes })),
      ]);
      const fileName = format === "eln" ? `${slug}.eln` : `${slug}.crate.zip`;
      const saved = await context.host.saveFile({ name: fileName, mediaType: format === "eln" ? "application/vnd.eln+zip" : "application/zip", dataBase64: toBase64(archive) });
      if (!saved.ok) throw new Error(saved.error.message);
      return { where: saved.value.where, name: fileName, units: nodes.length, added: nodes.length - new Set(start).size, files: files.length + 2, pdfs: pdfCount, papers: papers.length, version: CRATE_VERSIONS[version].conformsTo };
    },

    "crate.import": async ({ ref }): Promise<CrateImported> => {
      const asset = await context.host.readAsset({ ref });
      if (!asset.ok) throw new Error(asset.error.message);
      const bytes = fromBase64(asset.value.dataUrl.split(",")[1] ?? "");
      const isJson = /\.json(ld)?$/i.test(asset.value.name);
      let entries: { path: string; bytes: Uint8Array }[] = [];
      if (!isJson) {
        try {
          entries = await unzip(bytes, (path) => /(^|\/)(ro-crate-metadata\.json|dg-records\.jsonl)$/.test(path));
        } catch (error) {
          throw new Error(`${asset.value.name} can't be read as a crate. ${error instanceof Error ? error.message : ""}`.trim());
        }
      }
      // The metadata sits at the top of a crate, or one folder down in an .eln file.
      const depth = (path: string): number => path.split("/").length;
      const metadataFile = isJson ? { path: asset.value.name, bytes } : entries.filter(({ path }) => path.endsWith("ro-crate-metadata.json")).sort((a, b) => depth(a.path) - depth(b.path))[0];
      if (!metadataFile) throw new Error(`${asset.value.name} has no ro-crate-metadata.json, so it isn't an RO-Crate.`);
      let metadata: unknown;
      try {
        metadata = JSON.parse(decoder.decode(metadataFile.bytes));
      } catch {
        throw new Error("This crate's metadata doesn't read as JSON.");
      }
      const { root } = readCrate(metadata);
      const name = typeof root.name === "string" && root.name ? root.name : asset.value.name;
      const folder = metadataFile.path.replace(/ro-crate-metadata\.json$/, "");
      const own = entries.find(({ path }) => path === `${folder}dg-records.jsonl`);
      const graph = context.graph();

      if (own) {
        // A crate this app made: its records come back as they were, under their own authors.
        const lines = decoder.decode(own.bytes).split("\n").filter((line) => line.trim());
        const records: DgRecord[] = [];
        for (const line of lines) {
          let record: unknown;
          try {
            record = JSON.parse(line);
          } catch {
            throw new Error("This crate's records are damaged: a line doesn't read as JSON.");
          }
          const problems = validateRecord(record);
          if (problems.length) throw new Error(`This crate holds a record this version can't read: ${problems[0]}.`);
          if (!staysLocal(record as DgRecord)) records.push(record as DgRecord);
        }
        const held = (record: DgRecord): boolean => {
          const current = graph.documents.get(record.id);
          if (current && "rev" in current && "rev" in record) return current.rev >= record.rev;
          return Boolean(current) || graph.relations.has(record.id);
        };
        const fresh = records.filter((record) => !held(record));
        if (fresh.length) await context.put(fresh);
        const units = records.filter((record) => record.kind === "node");
        const canvas = records.find((record) => record.kind === "canvas");
        return { name, kind: "own", units: units.length, fresh: fresh.filter((record) => record.kind === "node").length, ...(canvas ? { canvas: canvas.id } : {}), skipped: 0 };
      }

      const stamp = context.stamp();
      const { types: process, created } = ensureProcessTypes({ nodeTypes: context.nodeTypes(), stamp, ...(context.titleFormat ? { titleFormat: context.titleFormat } : {}) });
      const discourse = Object.fromEntries(
        (["question", "claim", "evidence", "source"] as const).flatMap((base) => {
          const type = context.nodeTypes().find((item) => item.base === base);
          return type ? [[base, type] as const] : [];
        }),
      );
      const plan = planCrateImport({ metadata, graph, types: { ...discourse, ...process }, stamp });
      if (plan.units.length === 0) throw new Error("This crate describes nothing this can turn into units: no articles, code, runs or files.");
      const made = await context.makeCanvas(`Crate: ${plan.name}`.slice(0, 80), { needsLayout: true });
      const cards = plan.units.map((node, index) =>
        createCanvasItem({
          ...stamp,
          canvas: made.id,
          item: { type: "text" as const, text: node.title, x: (index % 4) * 300, y: Math.floor(index / 4) * 180, width: 240, height: 96, dg: { node: node.id } },
          z: index + 1,
        }),
      );
      await context.put([...created, ...plan.records, ...cards]);
      return { name: plan.name, kind: "foreign", units: plan.units.length, fresh: plan.fresh, canvas: made.id, skipped: plan.skipped };
    },
  };
  return { handlers };
};
