import {
  assertRelation,
  buildCanvas,
  createCanvasItem,
  createNode,
  createSnapshot,
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
  type RelationTypeRecord,
  type RunStatus,
  type UnitFacts,
} from "@dg/contract/records.ts";
import { sameDoi, mergeIdentifiers, parseIdentifier, type Identifier } from "@dg/contract/scholarly.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { CrateDeposited, CrateExported, CrateImported, DepositSettings } from "@dg/contract/surface.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";
import type { Context, Handlers, Stamp } from "./context.ts";
import { toDataCite, type DataCiteInput } from "./datacite.ts";
import { iriOf, toProcessJsonLd } from "./jsonld.ts";
import { isMiraDocument, mergeEntities, miraEntities, miraType, miraValue } from "./mira.ts";
import { baseOf, cidOfBytes, ensureProcessTypes, protocolCids, provenanceOf } from "./process.ts";
import { CRATE_VERSIONS, LICENSE_CHOICES, cratePreview, crateReadme, toRoCrate, type CrateFile } from "./rocrate.ts";
import { ZENODO, toZenodo } from "./zenodo.ts";
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
const typesOf = (entity: JsonObject): string[] => listOf(entity["@type"]).map((type) => miraType(String(type)));
const stringOf = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined);
const timeOf = (value: unknown): string | undefined => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
};

/** In order: an entity with several types is the first of these it carries. A MIRA study is a run, the activity that grounds evidence. */
const BASE_OF_TYPE: [string, BaseNodeType][] = [
  ["CreateAction", "run"],
  ["mira:Study", "run"],
  ["ComputationalWorkflow", "code"],
  ["SoftwareSourceCode", "code"],
  ["SoftwareApplication", "code"],
  ["HowTo", "protocol"],
  ["LabProtocol", "protocol"],
  ["mira:Protocol", "protocol"],
  ["mira:Evidence", "evidence"],
  ["Evidence", "evidence"],
  ["ScholarlyArticle", "source"],
  ["mira:SourceDocument", "source"],
  ["Question", "question"],
  ["mira:Question", "question"],
  ["Claim", "claim"],
  ["mira:Claim", "claim"],
  ["Study", "study"],
];
const ARGUMENTS = ["supports", "opposes", "addresses", "informs"] as const;
const FILE_TYPES = new Set(["File", "MediaObject", "ImageObject", "Dataset", "TextDigitalDocument", "WebPage"]);
const STATUS: Record<string, RunStatus> = { CompletedActionStatus: "completed", FailedActionStatus: "failed", ActiveActionStatus: "running", PotentialActionStatus: "planned" };
const KIND_OF_MIME = (mime: string | undefined, types: string[]): UnitFacts["outputKind"] =>
  types.includes("ImageObject") || mime?.startsWith("image/") ? "figure" : types.includes("Dataset") || mime === "application/json" ? "dataset" : mime === "text/csv" || mime === "text/tab-separated-values" ? "table" : mime?.startsWith("text/") ? "text" : "file";
const LANGUAGE_OF_MIME: Record<string, string> = { "text/x-python": "python", "text/x-r": "r", "application/javascript": "javascript", "text/x-julia": "julia" };

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

/** What is known of a file the crate names, when its bytes could be read. */
export type CrateBytes = { cid: string; size: number; /** Where the file sits in the base, when it does. */ path?: string };
export type CratePlan = { records: DgRecord[]; units: NodeRecord[]; fresh: number; name: string; skipped: number; relations: number };

/**
 * Turns another tool's crate into units. A run keeps what it used, what ran
 * and what came out. Evidence keeps the outputs it rests on, the run that
 * grounds it and the document it was read from, whether the crate says so in
 * our words or in MIRA's. Importing the same crate twice makes nothing new.
 *
 * `extra` holds JSON-LD files that sit beside the metadata, such as a MATSUlab
 * bundle's `evidence.jsonld`. Those written in MIRA's context are read as part
 * of the same graph.
 */
export const planCrateImport = ({
  metadata,
  extra = [],
  files,
  graph,
  types,
  relationTypes = {},
  stamp,
  limit = 300,
}: {
  metadata: unknown;
  extra?: unknown[];
  files?: Map<string, CrateBytes>;
  graph: FoldedGraph;
  types: Partial<Record<BaseNodeType, NodeTypeRecord>>;
  relationTypes?: Partial<Record<string, RelationTypeRecord>>;
  stamp: Stamp;
  limit?: number;
}): CratePlan => {
  const read = readCrate(isMiraDocument(metadata) ? { "@graph": miraEntities(metadata) } : metadata);
  const entities = mergeEntities(read.graph, extra.filter(isMiraDocument).map(miraEntities));
  const byId = new Map(entities.map((entity) => [entity["@id"], entity]));
  const root = byId.get(read.root["@id"])!;
  const name = stringOf(root.name) ?? "RO-Crate";
  // What tells this crate from another, so its relative ids don't collide with theirs.
  const rootKey = /^https?:\/\//.test(root["@id"]) ? root["@id"] : (idsOf(root.identifier)[0] ?? stringOf(root.identifier) ?? `urn:ro-crate:${slugOf(name)}:${stringOf(root.datePublished) ?? ""}`);
  const keyOf = (id: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(id) ? id : `${rootKey}#${id.replace(/^#/, "")}`);
  const existing = [...graph.documents.values()].filter((record): record is NodeRecord => record.kind === "node" && !record.removed);
  const agent = `RO-Crate import: ${name}`;

  const cited = new Set(idsOf(root.citation));
  const parts = new Set(idsOf(root.hasPart));
  // MIRA keeps what was observed as a statement of its own. It becomes the evidence's title, never a unit.
  const statements = new Set(entities.flatMap((entity) => idsOf(miraValue(entity, "observationStatement"))));
  const typed = (entity: Entity): BaseNodeType | undefined => (statements.has(entity["@id"]) ? undefined : BASE_OF_TYPE.find(([type]) => typesOf(entity).includes(type))?.[1]);
  const arguing = entities.some((entity) => typed(entity) === "evidence");
  // The files something rests on, or a run made.
  const rested = new Set(entities.flatMap((entity) => [...idsOf(miraValue(entity, "observationBase")), ...idsOf(entity.result), ...idsOf(entity.image), ...(idsOf(entity.wasGeneratedBy).length ? [entity["@id"]] : [])]));
  // What a run took in. A named input that is no file here, such as raw data held back, is still cited as a dataset.
  const takenIn = new Set(entities.filter((entity) => typed(entity) === "run").flatMap((run) => idsOf(run.object)));
  const baseFor = (entity: Entity): BaseNodeType | undefined => {
    if (statements.has(entity["@id"])) return undefined;
    const named = typed(entity);
    if (named) return named;
    if (cited.has(entity["@id"])) return "source";
    if (takenIn.has(entity["@id"]) && stringOf(entity.name) && !typesOf(entity).some((type) => type === "PropertyValue" || type === "Person" || type === "Organization")) return "output";
    const kinds = typesOf(entity);
    const isFile = kinds.some((type) => FILE_TYPES.has(type)) && entity["@id"] !== "./";
    const listed = parts.has(entity["@id"]) || /^https?:\/\//.test(entity["@id"]);
    // In a crate that argues, the notes and metadata files that nothing rests on are packaging, not results.
    const packaging = arguing && !rested.has(entity["@id"]) && (/\.(md|jsonld|txt)$/i.test(entity["@id"]) || /markdown|ld\+json/.test(stringOf(entity.encodingFormat) ?? ""));
    if (isFile && !packaging && (listed || rested.has(entity["@id"]))) return "output";
    return undefined;
  };
  const candidates = entities.filter((entity) => entity !== root && !/ro-crate-(metadata\.json(ld)?|preview\.html)$/.test(entity["@id"]) && baseFor(entity) && types[baseFor(entity)!]);
  // Runs and what they name come first, so a very large crate keeps its provenance before its loose files.
  const named = new Set(candidates.filter((entity) => baseFor(entity) === "run").flatMap((run) => [...idsOf(run.instrument), ...idsOf(run.object), ...idsOf(run.result)]));
  const rank = (entity: Entity): number => (baseFor(entity) === "run" || baseFor(entity) === "evidence" ? 0 : named.has(entity["@id"]) || rested.has(entity["@id"]) ? 1 : baseFor(entity) === "output" ? 3 : 2);
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
    // Whoever first made it, by name and ORCID iD, so bringing it in doesn't make it the importer's.
    const creators = [...idsOf(entity.creator), ...idsOf(entity.author)].flatMap((id) => {
      const orcid = parseIdentifier(id, "orcid");
      const name = stringOf(byId.get(id)?.name) ?? (orcid?.scheme === "orcid" ? undefined : /^[a-z][a-z0-9+.-]*:|^#/i.test(id) ? undefined : id);
      return name || orcid?.scheme === "orcid" ? [{ name: name ?? `ORCID ${orcid!.value}`, ...(orcid?.scheme === "orcid" ? { orcid: orcid.value } : {}) }] : [];
    });
    const first = base === "source" || base === "code" ? [] : creators.filter((person, index) => creators.findIndex((other) => other.name === person.name && other.orcid === person.orcid) === index);
    const common: UnitFacts = { provenance: { method: "imported", agent }, sameAs: [keyOf(entity["@id"])], ...(rest.length ? { identifiers: rest } : {}), ...(first.length ? { creators: first } : {}) };
    if (base === "source") return { ...common, ...(doi ? { doi } : {}), ...(absolute && !doi ? { uri: absolute } : {}) };
    if (base === "code") {
      const license = idsOf(entity.license)[0] ?? stringOf(entity.license);
      const language = stringOf(entity.programmingLanguage) ?? stringOf(byId.get(idsOf(entity.programmingLanguage)[0] ?? "")?.name) ?? LANGUAGE_OF_MIME[stringOf(entity.encodingFormat) ?? ""];
      // A file on GitHub says its repository, version and path in its own address. A branch name is not a version.
      const hosted = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/.exec(absolute ?? "");
      const repo = stringOf(entity.codeRepository) ?? hosted?.[1] ?? (typesOf(entity).includes("SoftwareApplication") && /^https?:\/\//.test(stringOf(entity.url) ?? "") ? stringOf(entity.url) : undefined);
      const commit = (stringOf(entity.version) === "unknown" ? undefined : stringOf(entity.version)) ?? stringOf(entity.softwareVersion) ?? (hosted && /^[0-9a-f]{40}$/.test(hosted[2]!) ? hosted[2] : undefined);
      return {
        ...common,
        ...(repo ? { repo } : {}),
        ...(commit ? { commit } : {}),
        ...(language ? { language } : {}),
        ...(license ? { license } : {}),
        ...(hosted ? { path: hosted[3]! } : absolute ? {} : { path: entity["@id"] }),
      };
    }
    if (base === "output") {
      const mime = stringOf(entity.encodingFormat) ?? listOf(entity.encodingFormat).map(stringOf).find(Boolean);
      const known = files?.get(entity["@id"]);
      const size = known?.size ?? Number(stringOf(entity.contentSize));
      const caption = stringOf(entity.caption) ?? stringOf(entity.description);
      return {
        ...common,
        // An input that was only named has no address to give.
        ...(absolute || !entity["@id"].startsWith("#") ? { uri: absolute ?? `${rootKey.replace(/\/?$/, "/")}${entity["@id"]}` } : {}),
        ...(mime ? { mediaType: mime } : {}),
        ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
        ...(known ? { cid: known.cid } : {}),
        ...(known?.path ? { locator: { path: known.path } } : {}),
        // An input that was only named, with no file type, is data that was held back.
        outputKind: typesOf(entity).some((type) => FILE_TYPES.has(type)) ? KIND_OF_MIME(mime, typesOf(entity)) : "dataset",
        ...(caption ? { caption } : {}),
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

  const titleOf = (entity: Entity, base: BaseNodeType): string => {
    const statement = base === "evidence" ? stringOf(byId.get(idsOf(miraValue(entity, "observationStatement"))[0] ?? "")?.name) : undefined;
    return statement ?? stringOf(entity.name) ?? stringOf(entity.headline) ?? (base === "run" ? `Run ${entity["@id"].replace(/^#/, "")}` : decodeURIComponent(entity["@id"].split("/").pop() ?? entity["@id"]));
  };

  const unitFor = (entity: Entity): NodeRecord => {
    const base = baseFor(entity)!;
    const key = keyOf(entity["@id"]);
    const known = made.get(entity["@id"]);
    if (known) return known;
    const built = facts(entity, base);
    const same =
      existing.find((node) => baseOf(graph, node) === base && node.facts?.sameAs?.includes(key)) ??
      (base === "source" && built.doi ? existing.find((node) => baseOf(graph, node) === "source" && sameDoi(node.facts?.doi, built.doi)) : undefined);
    const node = same ?? createNode({ ...stamp, title: titleOf(entity, base), type: types[base]!.id, facts: built });
    made.set(entity["@id"], node);
    if (!same) fresh += 1;
    return node;
  };
  for (const entity of taken) unitFor(entity);

  // Provenance, once every unit has its id. A unit already in the graph keeps the links it has.
  const pin = (id: string): Pin => ({ uri: made.get(id)?.id ?? keyOf(id), ...(files?.get(id) ? { cid: files.get(id)!.cid } : {}) });
  const madeAs = (id: string | undefined, base: BaseNodeType): DgId | undefined => {
    const entity = id ? byId.get(id) : undefined;
    return entity && made.has(id!) && baseFor(entity) === base ? made.get(id!)!.id : undefined;
  };
  const withLinks = [...made.entries()].map(([id, node]): NodeRecord => {
    const entity = byId.get(id)!;
    const base = baseFor(entity);
    if (existing.includes(node)) return node;
    let prov: ProvenanceLinks = {};
    if (base === "run") {
      const inputs = idsOf(entity.object).filter((other) => !typesOf(byId.get(other) ?? {}).includes("PropertyValue"));
      // Schema.org names the code a run ran as its instrument. PROV and MIRA list it among what was used.
      const isCode = (other: string): boolean => Boolean(byId.get(other) && baseFor(byId.get(other)!) === "code");
      const instrument = [...new Set([...idsOf(entity.instrument), ...inputs.filter(isCode)])].map(pin);
      const used = inputs.filter((other) => !isCode(other)).map(pin);
      const follows = idsOf(miraValue(entity, "follows"))[0];
      prov = { ...(instrument.length ? { instrument } : {}), ...(used.length ? { used } : {}), ...(follows ? { follows: pin(follows) } : {}) };
    }
    if (base === "output") {
      const run = taken.find((other) => baseFor(other) === "run" && idsOf(other.result).includes(id));
      const by = run ? made.get(run["@id"])!.id : madeAs(idsOf(entity.wasGeneratedBy)[0], "run");
      if (by) prov = { generatedBy: by };
    }
    if (base === "evidence") {
      const rests = idsOf(miraValue(entity, "observationBase")).map(pin);
      const grounding = madeAs(idsOf(miraValue(entity, "isGroundedIn"))[0], "run") ?? taken.flatMap((other) => (baseFor(other) === "run" && idsOf(miraValue(other, "grounds")).includes(id) ? [made.get(other["@id"])!.id] : []))[0];
      const document = idsOf(miraValue(entity, "sourceDocument")).map((other) => madeAs(other, "source")).find(Boolean) ?? idsOf(entity.isBasedOn).map((other) => madeAs(other, "source")).find(Boolean);
      prov = { ...(rests.length ? { observationBase: rests } : {}), ...(grounding ? { isGroundedIn: grounding } : {}), ...(document ? { sourceDocument: document } : {}) };
    }
    if (base === "source") {
      const reports = idsOf(miraValue(entity, "describesActivity")).flatMap((other) => (madeAs(other, "run") ? [madeAs(other, "run")!] : []));
      if (reports.length) prov = { describesActivity: reports };
    }
    return Object.keys(prov).length ? { ...node, prov } : node;
  });
  for (const node of withLinks) if (!existing.includes(node)) records.push(node);

  // What a crate says at length about a finding or a method becomes that unit's own text.
  for (const [id, node] of made) {
    const entity = byId.get(id)!;
    const base = baseFor(entity);
    const said = stringOf(entity.description);
    if (said && !existing.includes(node) && base !== "output" && base !== "code" && base !== "source") records.push(createSnapshot({ ...stamp, node: node.id, body: said }));
  }

  // Arguments between the units, in our words or MIRA's.
  let relations = 0;
  for (const [id, node] of made) {
    for (const kind of ARGUMENTS) {
      const type = relationTypes[kind];
      if (!type) continue;
      for (const target of idsOf(miraValue(byId.get(id)!, kind))) {
        const other = made.get(target);
        if (!other || other.id === node.id) continue;
        const held = [...graph.relations.values()].some(({ record, state }) => state === "active" && record.type === type.id && record.source === node.id && record.target === other.id);
        if (held) continue;
        records.push(assertRelation({ ...stamp, type: type.id, source: node.id, target: other.id }));
        relations += 1;
      }
    }
  }
  return { records, units: withLinks, fresh, name, skipped: ordered.length - taken.length, relations };
};

// The feature

const DRAFTS_KEY = "deposit-drafts";
const tokenId = (sandbox: boolean): string => `discourse-graphs-zenodo-${sandbox ? "sandbox" : "live"}`;
const HINTS_KEY = "deposit-token-hints";
type DraftNote = DepositSettings["drafts"][number];
type ExportParams = { canvas?: DgId; nodes?: DgId[]; name?: string; description?: string; license?: string; pdfs?: boolean; outputs?: boolean; format?: "zip" | "eln" };

const dirOf = (path: string): string => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const extensionOf = (path: string): string => (nameOf(path).includes(".") ? nameOf(path).split(".").pop()!.toLowerCase() : "");
const joined = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join("/");

export const crateFeature = (context: Context, { secrets }: { secrets?: SecretStore } = {}) => {
  const baseIn = (node: NodeRecord | undefined) => baseOf(context.graph(), node);
  const unitsOnCanvas = (canvas: DgId): DgId[] =>
    liveCanvasItems({ graph: context.graph(), canvas }).flatMap(({ item }) => {
      const node = (item as { dg?: { node?: DgId } }).dg?.node;
      return node ? [node] : [];
    });

  /** A file in the base by where it sits, or nothing. Hosts list files by extension, so that is how it is found. */
  const fileAt = async (path: string): Promise<Uint8Array | undefined> => {
    const extension = extensionOf(path);
    if (!extension) return undefined;
    const listing = await context.host.listFiles({ extensions: [extension], limit: 5000 });
    const file = listing.ok ? listing.value.find((entry) => entry.name === nameOf(path) && (entry.folder ?? "") === dirOf(path)) : undefined;
    const asset = file ? await context.host.readAsset({ ref: file.ref }) : undefined;
    return asset?.ok ? fromBase64(asset.value.dataUrl.split(",")[1] ?? "") : undefined;
  };

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

  /** Everything a crate says about itself, gathered once, so the archive and a repository's form can't disagree. */
  const gather = async ({ canvas, nodes: asked, name: givenName, description: givenDescription, license }: ExportParams) => {
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
    const sources = records.filter((node) => baseIn(node) === "source" && !node.source?.own);
    const code = records.filter((node) => baseIn(node) === "code");
    const described: DataCiteInput = {
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
    };
    return { graph, canvas, canvasRecord, start, nodes, records, papers, name, description, published, me, people, orcidOf, lab, described, license };
  };

  /** The archive itself. `doi` is the crate's own, once a repository has reserved one. */
  const pack = async (gathered: Awaited<ReturnType<typeof gather>>, { pdfs = false, outputs = true, format = "zip" }: ExportParams, doi?: string) => {
    const { graph, canvas, canvasRecord, start, nodes, records, papers, name, description, published, me, people, orcidOf, lab, described, license } = gathered;
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
    files.push({
      path: "datacite.json",
      name: "DataCite metadata",
      description: "This crate described in DataCite's schema, for a repository that will give it a DOI.",
      mediaType: "application/json",
      bytes: text(JSON.stringify(toDataCite({ ...described, ...(doi ? { doi } : {}) }), null, 2)),
      conformsTo: "https://schema.datacite.org/meta/kernel-4.6/",
    });

    // An output's own file, when the base holds it and it still hashes to what the record says.
    let outputCount = 0;
    let changed = 0;
    if (outputs) {
      const taken = new Set<string>();
      for (const node of records) {
        const path = node.facts?.locator?.path;
        if (baseIn(node) !== "output" || !path || node.facts?.locator?.cellIndex !== undefined) continue;
        const bytes = await fileAt(path);
        if (!bytes) continue;
        if (node.facts?.cid && (await cidOfBytes(bytes)) !== node.facts.cid) {
          changed += 1;
          continue;
        }
        let inside = `outputs/${nameOf(path)}`;
        for (let n = 2; taken.has(inside); n += 1) inside = `outputs/${n}-${nameOf(path)}`;
        taken.add(inside);
        files.push({ path: inside, name: node.title, ...(node.facts?.caption ? { description: node.facts.caption } : {}), mediaType: node.facts?.mediaType ?? "application/octet-stream", bytes, unit: node.id });
        outputCount += 1;
      }
    }
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
    const describe = (list: CrateFile[]) =>
      toRoCrate({
        graph,
        nodes,
        name,
        description,
        ...(license ? { license } : {}),
        author: { id: me.id, name: me.name, ...(orcidOf(me.id) ? { orcid: orcidOf(me.id)! } : {}) },
        ...(lab ? { publisher: { name: lab.name, id: lab.did } } : {}),
        published,
        ...(doi ? { identifier: `https://doi.org/${doi}` } : {}),
        files: list,
        version,
        versions,
        nameOf: (author) => people.find((person) => person.did === author.id)?.name ?? author.name,
        orcidOf: (author) => orcidOf(author.id),
      });
    // The README is written from the metadata, then described in it like any other file.
    files.push({
      path: "README.md",
      name: "Read me first",
      description: "The crate told as findings: what was observed, what each finding rests on, and how it was produced.",
      mediaType: "text/markdown",
      bytes: text(crateReadme(await describe(files))),
    });
    const metadata = await describe(files);
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
    const summary = { name: fileName, units: nodes.length, added: nodes.length - new Set(start).size, files: files.length + 2, pdfs: pdfCount, papers: papers.length, version: CRATE_VERSIONS[version].conformsTo, outputs: outputCount, changed };
    return { archive, fileName, mediaType: format === "eln" ? "application/vnd.eln+zip" : "application/zip", summary };
  };

  const hints = async (): Promise<Record<string, string>> => {
    const kept = await context.getLocal(HINTS_KEY);
    return kept && typeof kept === "object" ? (kept as Record<string, string>) : {};
  };
  const drafts = async (): Promise<DraftNote[]> => {
    const kept = await context.getLocal(DRAFTS_KEY);
    return Array.isArray(kept) ? (kept as DraftNote[]) : [];
  };
  const depositSettings = async (): Promise<DepositSettings> => {
    const kept = await hints();
    const one = async (sandbox: boolean) => {
      const has = Boolean(await secrets?.get(tokenId(sandbox)));
      return { kept: has, ...(has && kept[tokenId(sandbox)] ? { hint: kept[tokenId(sandbox)]! } : {}) };
    };
    return { live: await one(false), sandbox: await one(true), canKeep: Boolean(secrets), reachable: Boolean(context.services), drafts: (await drafts()).slice(0, 10) };
  };

  const handlers: Pick<Handlers, "crate.export" | "crate.import" | "crate.licenses" | "crate.deposit" | "deposit.settings" | "deposit.configure"> = {
    "crate.licenses": async () => LICENSE_CHOICES,
    "crate.export": async (params): Promise<CrateExported> => {
      const { archive, fileName, mediaType, summary } = await pack(await gather(params), params);
      const saved = await context.host.saveFile({ name: fileName, mediaType, dataBase64: toBase64(archive) });
      if (!saved.ok) throw new Error(saved.error.message);
      return { where: saved.value.where, ...summary };
    },

    "deposit.settings": depositSettings,
    "deposit.configure": async ({ sandbox = false, token }) => {
      if (!secrets) throw new Error("This base has nowhere to keep a token.");
      const value = token?.trim() || null;
      await secrets.set(tokenId(sandbox), value);
      const kept = await hints();
      if (value) kept[tokenId(sandbox)] = value.slice(-4);
      else delete kept[tokenId(sandbox)];
      await context.setLocal(HINTS_KEY, kept);
      return depositSettings();
    },
    "crate.deposit": async ({ sandbox = false, ...params }): Promise<CrateDeposited> => {
      const place = sandbox ? ZENODO.sandbox : ZENODO.live;
      if (!context.services) throw new Error(`${place.name} can't be reached from here.`);
      const token = await secrets?.get(tokenId(sandbox));
      if (!token) throw new Error(`Add a token for ${place.name} first.`);
      const gathered = await gather(params);
      // The draft comes first, because it reserves the DOI the crate then names as its own.
      const draft = await context.services.deposit.open({ server: place.server, token, metadata: toZenodo(gathered.described) });
      const { archive, fileName, mediaType, summary } = await pack(gathered, { ...params, format: "zip" }, draft.doi);
      // A copy stays in the base whatever happens next, so a failed upload loses nothing.
      const saved = await context.host.saveFile({ name: fileName, mediaType, dataBase64: toBase64(archive) });
      if (!saved.ok) throw new Error(saved.error.message);
      await context.setLocal(DRAFTS_KEY, [{ name: gathered.name, page: draft.page, ...(draft.doi ? { doi: draft.doi } : {}), at: gathered.published, sandbox }, ...(await drafts())].slice(0, 50));
      await context.services.deposit.upload({ bucket: draft.bucket, token, name: fileName, bytes: archive });
      return { where: saved.value.where, ...summary, page: draft.page, ...(draft.doi ? { doi: draft.doi } : {}), sandbox };
    },

    "crate.import": async ({ ref }): Promise<CrateImported> => {
      const asset = await context.host.readAsset({ ref });
      if (!asset.ok) throw new Error(asset.error.message);
      const bytes = fromBase64(asset.value.dataUrl.split(",")[1] ?? "");
      const isJson = /\.json(ld)?$/i.test(asset.value.name);
      let entries: { path: string; bytes: Uint8Array }[] = [];
      if (!isJson) {
        try {
          entries = await unzip(bytes, (path) => /(^|\/)(ro-crate-metadata\.json|dg-records\.jsonl)$/.test(path) || /\.jsonld$/i.test(path));
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
      const parsed = (raw: Uint8Array): unknown[] => {
        try {
          return [JSON.parse(decoder.decode(raw))];
        } catch {
          return [];
        }
      };
      const isMira = isMiraDocument(metadata);
      const { root, graph: described } = readCrate(isMira ? { "@graph": miraEntities(metadata) } : metadata);
      const name = typeof root.name === "string" && root.name ? root.name : asset.value.name;
      const folder = isJson ? "" : metadataFile.path.replace(/ro-crate-metadata\.json$/, "");
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

      // JSON-LD beside the metadata, such as a bundle's `evidence.jsonld`, and the bytes of the files it names.
      let extra: unknown[] = [];
      const files = new Map<string, CrateBytes>();
      const hash = async (id: string, raw: Uint8Array, path?: string): Promise<void> => void files.set(id, { cid: await cidOfBytes(raw), size: raw.length, ...(path ? { path } : {}) });
      if (!isJson) {
        extra = entries.filter(({ path }) => /\.jsonld$/i.test(path) && dirOf(path) === dirOf(metadataFile.path) && !path.endsWith("discourse-graph.jsonld")).flatMap((entry) => parsed(entry.bytes));
      } else {
        const beside = await context.host.listFiles({ extensions: ["json", "jsonld"], limit: 5000 });
        const me = beside.ok ? beside.value.find((entry) => entry.ref === ref) : undefined;
        if (beside.ok && me && !isMira) {
          for (const entry of beside.value.filter((other) => /\.jsonld$/i.test(other.name) && (other.folder ?? "") === (me.folder ?? "") && other.ref !== ref)) {
            const read = await context.host.readAsset({ ref: entry.ref });
            if (read.ok) extra.push(...parsed(fromBase64(read.value.dataUrl.split(",")[1] ?? "")));
          }
        }
        // A crate that is a folder in the base: its files are right there, so they are hashed and found again on export.
        const named = [...described, ...extra.filter(isMiraDocument).flatMap(miraEntities)].map((entity) => entity["@id"]).filter((id) => !/^[a-z][a-z0-9+.-]*:/i.test(id) && !id.startsWith("#") && id !== "./" && extensionOf(id) && !/ro-crate-(metadata\.json(ld)?|preview\.html)$/.test(id));
        for (const id of new Set(named)) {
          const path = joined(me?.folder, decodeURIComponent(id));
          const raw = me ? await fileAt(path) : undefined;
          if (raw) await hash(id, raw, path);
        }
      }
      if (!isJson) {
        const wanted = new Set([...described, ...extra.filter(isMiraDocument).flatMap(miraEntities)].map((entity) => `${folder}${decodeURIComponent(entity["@id"])}`));
        for (const entry of await unzip(bytes, (path) => wanted.has(path) && !/ro-crate-metadata\.json$/.test(path))) await hash(encodeURI(entry.path.slice(folder.length)), entry.bytes);
      }

      const stamp = context.stamp();
      const { types: process, created } = ensureProcessTypes({ nodeTypes: context.nodeTypes(), stamp, ...(context.titleFormat ? { titleFormat: context.titleFormat } : {}) });
      const discourse = Object.fromEntries(
        (["question", "claim", "evidence", "source"] as const).flatMap((base) => {
          const type = context.nodeTypes().find((item) => item.base === base);
          return type ? [[base, type] as const] : [];
        }),
      );
      const relationTypes = Object.fromEntries([...context.relationTypes()].reverse().map((type) => [type.base, type]));
      const plan = planCrateImport({ metadata, extra, files, graph, types: { ...discourse, ...process }, relationTypes, stamp });
      if (plan.units.length === 0) throw new Error("This crate describes nothing this can turn into units: no articles, code, runs, evidence or files.");
      const title = `Crate: ${plan.name}`.slice(0, 80);
      // Read again with nothing new in it, the crate opens the canvas it already has. A second copy would only be clutter.
      const before = plan.fresh === 0 ? context.documents("canvas").find((canvas) => !canvas.removed && canvas.title === title) : undefined;
      if (before) return { name: plan.name, kind: "foreign", units: plan.units.length, fresh: 0, canvas: before.id, skipped: plan.skipped, relations: plan.relations, hashed: files.size };
      const made = await context.makeCanvas(title, { needsLayout: true });
      const cards = plan.units.map((node, index) =>
        createCanvasItem({
          ...stamp,
          canvas: made.id,
          item: { type: "text" as const, text: node.title, x: (index % 4) * 300, y: Math.floor(index / 4) * 180, width: 240, height: 96, dg: { node: node.id } },
          z: index + 1,
        }),
      );
      await context.put([...created, ...plan.records, ...cards]);
      return { name: plan.name, kind: "foreign", units: plan.units.length, fresh: plan.fresh, canvas: made.id, skipped: plan.skipped, relations: plan.relations, hashed: files.size };
    },
  };
  return { handlers };
};
