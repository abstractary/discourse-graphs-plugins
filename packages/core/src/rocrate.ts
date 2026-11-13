import type { Author, BaseNodeType, DgId, FoldedGraph, JsonObject, NodeRecord, PaperRecord, Pin, RelationTypeRecord } from "@dg/contract/records.ts";
import { identifierCurie, identifierUrl, parseIdentifier, type Identifier, type WorkAuthor } from "@dg/contract/scholarly.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";
import { iriOf } from "./jsonld.ts";
import { baseOf, provenanceOf } from "./process.ts";

/**
 * A graph, or the part of one on a canvas, as an RO-Crate: one
 * `ro-crate-metadata.json` that describes the files beside it, the papers they
 * were read from, the people, and every run as a Process Run Crate action.
 * Pure: the caller hands over the files, and gets the metadata back.
 *
 * Units keep their Discourse Graphs meaning through a few extra terms, each
 * defined in the crate itself, so a reader that knows only schema.org still
 * sees questions, claims, articles, software and actions.
 */

export const CRATE_VERSIONS = {
  "1.3": { context: "https://w3id.org/ro/crate/1.3/context", conformsTo: "https://w3id.org/ro/crate/1.3" },
  /** The ELN file format pins this version. Nothing this export writes differs between the two. */
  "1.2": { context: "https://w3id.org/ro/crate/1.2/context", conformsTo: "https://w3id.org/ro/crate/1.2" },
} as const;
export type CrateVersion = keyof typeof CRATE_VERSIONS;

export const PROCESS_RUN_CRATE = { id: "https://w3id.org/ro/wfrun/process/0.6", name: "Process Run Crate", version: "0.6" };
export const DG_NAMESPACE = "https://discoursegraphs.com/ns/process#";

/** The terms schema.org lacks, with the sentence a reader of the crate is given for each. */
const TERMS: { term: string; kind: "rdfs:Class" | "rdf:Property"; name: string; description: string }[] = [
  { term: "Evidence", kind: "rdfs:Class", name: "Evidence", description: "An observation offered for or against a claim, with the passage or output it rests on." },
  { term: "Study", kind: "rdfs:Class", name: "Study", description: "A planned investigation of a question: its design, conditions and the protocols it uses." },
  { term: "supports", kind: "rdf:Property", name: "supports", description: "This unit is offered in support of the claim it points to." },
  { term: "opposes", kind: "rdf:Property", name: "opposes", description: "This unit is offered against the claim it points to." },
  { term: "addresses", kind: "rdf:Property", name: "addresses", description: "This claim is an answer to the question it points to." },
  { term: "informs", kind: "rdf:Property", name: "informs", description: "This unit bears on the question it points to without answering it." },
  { term: "follows", kind: "rdf:Property", name: "follows", description: "The protocol version a run followed." },
  { term: "observationBase", kind: "rdf:Property", name: "observation base", description: "The outputs a piece of evidence rests on." },
  { term: "isGroundedIn", kind: "rdf:Property", name: "is grounded in", description: "The run a piece of evidence rests on." },
  { term: "anchor", kind: "rdf:Property", name: "anchor", description: "The passage a unit was read from, word for word." },
  { term: "contentIdentifier", kind: "rdf:Property", name: "content identifier", description: "A hash of the content itself, as an IPFS-style CID, so two copies can be told to be the same." },
];

const ARGUMENTS = new Set(["supports", "opposes", "addresses", "informs"]);

/** One file in the crate's payload. The caller writes the bytes; the crate only describes them. */
export type CrateFile = {
  /** Its path inside the crate, with `/` between folders. */
  path: string;
  name: string;
  description?: string;
  mediaType: string;
  bytes: Uint8Array;
  /** A profile or format the file follows, as a URL. */
  conformsTo?: string;
  /** The unit this file is the content of: an output's bytes, a paper's PDF. */
  unit?: DgId;
  /** The paper record this file is the PDF of. */
  paper?: DgId;
};

export type CratePerson = { id: string; name: string; orcid?: string };

export type CrateInput = {
  graph: FoldedGraph;
  /** The units in the crate. Their papers, people and the arguments between them come along. */
  nodes: DgId[];
  name: string;
  description: string;
  /** An SPDX-style license URL. Without one the crate says plainly that none was chosen. */
  license?: string;
  author: CratePerson;
  publisher?: { name: string; ror?: string; id?: string };
  /** An ISO date. */
  published: string;
  /** The crate's own DOI or URL, once it has one. */
  identifier?: string;
  files: CrateFile[];
  version?: CrateVersion;
  /** Each protocol's CID as it stands now, so drift against a run's pin can be seen. */
  versions?: Map<DgId, string>;
  nameOf: (author: Author) => string;
  /** A person's ORCID iD, when the graph knows it. */
  orcidOf?: (author: Author) => string | undefined;
};

type Entity = JsonObject & { "@id": string; "@type": string | string[] };

const ref = (id: string): JsonObject => ({ "@id": id });
const refs = (ids: string[]): JsonObject[] => [...new Set(ids)].map(ref);

const clean = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== "" && !(Array.isArray(item) && item.length === 0))) as T;

/** A path as an RO-Crate `@id`: `/` between folders, everything else percent-encoded. */
export const crateFileId = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));

const LICENSES: Record<string, string> = {
  "https://creativecommons.org/licenses/by/4.0/": "Creative Commons Attribution 4.0 International",
  "https://creativecommons.org/publicdomain/zero/1.0/": "Creative Commons Zero 1.0 Universal",
  "https://creativecommons.org/licenses/by-sa/4.0/": "Creative Commons Attribution-ShareAlike 4.0 International",
  "https://creativecommons.org/licenses/by-nc/4.0/": "Creative Commons Attribution-NonCommercial 4.0 International",
  "https://creativecommons.org/licenses/by-nc-sa/4.0/": "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International",
};
export const LICENSE_CHOICES = Object.entries(LICENSES).map(([url, name]) => ({ url, name }));
/** A license as an entity with a name and a sentence, which is what a crate reader looks for. */
const licenseEntity = (url: string): Entity => {
  const plain = url.replace(/legalcode(\.[a-z-]+)?\/?$/, "");
  const name = LICENSES[plain] ?? LICENSES[`${plain}/`] ?? url;
  return { "@id": url, "@type": "CreativeWork", name, description: `The terms this may be reused under: ${name}.`, url };
};
const NO_LICENSE = "No license has been chosen for this crate. Ask its authors before reusing it.";

/** The formats the payload files follow, by the name a reader would know them by. */
const SPECS: Record<string, string> = {
  "https://www.w3.org/TR/prov-o/": "PROV-O: The PROV Ontology",
  "https://jsoncanvas.org/spec/1.0/": "JSON Canvas 1.0",
  "https://schema.datacite.org/meta/kernel-4.6/": "DataCite Metadata Schema 4.6",
};

const ACTION_STATUS: Record<string, string> = {
  completed: "http://schema.org/CompletedActionStatus",
  failed: "http://schema.org/FailedActionStatus",
  running: "http://schema.org/ActiveActionStatus",
  planned: "http://schema.org/PotentialActionStatus",
};

const OUTPUT_TYPE: Record<string, string> = { dataset: "Dataset", figure: "ImageObject", image: "ImageObject", table: "Dataset", text: "TextDigitalDocument", file: "MediaObject" };

const UNIT_TYPE: Record<BaseNodeType, string | string[]> = {
  question: "Question",
  claim: "Claim",
  evidence: ["CreativeWork", "Evidence"],
  source: "CreativeWork",
  protocol: "HowTo",
  study: ["CreativeWork", "Study"],
  run: "CreateAction",
  code: "SoftwareSourceCode",
  output: "MediaObject",
} as Record<BaseNodeType, string | string[]>;

const identifierEntity = (item: Identifier): Entity =>
  clean({
    "@id": `#id-${item.scheme}-${encodeURIComponent(item.value)}`,
    "@type": "PropertyValue",
    propertyID: item.scheme === "url" ? "url" : `https://registry.identifiers.org/registry/${item.scheme}`,
    name: item.scheme.toUpperCase(),
    value: identifierCurie(item),
    url: identifierUrl(item),
  }) as Entity;

const agentIri = (agent: string): string => (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(agent) ? `https://orcid.org/${agent}` : agent);

export const toRoCrate = async (input: CrateInput): Promise<JsonObject> => {
  const { graph, files, author, publisher, version = "1.3" } = input;
  const entities = new Map<string, Entity>();
  const add = (entity: Entity): string => {
    const known = entities.get(entity["@id"]);
    entities.set(entity["@id"], known ? ({ ...known, ...entity } as Entity) : entity);
    return entity["@id"];
  };

  const nodeAt = (id: DgId | undefined): NodeRecord | undefined => {
    const record = id ? graph.documents.get(id) : undefined;
    return record?.kind === "node" && !record.removed && !graph.withdrawn.has(record.id) ? record : undefined;
  };
  const chosen = new Map<DgId, NodeRecord>();
  for (const id of input.nodes) {
    const node = nodeAt(id);
    if (node) chosen.set(id, node);
  }
  const papers = new Map<DgId, PaperRecord>();
  for (const node of chosen.values()) {
    const paper = node.source ? graph.documents.get(node.source.paper) : undefined;
    if (paper?.kind === "paper") papers.set(paper.id, paper);
  }

  // People and organisations. An ORCID iD is the person's `@id` wherever one is known.
  const personId = (who: CratePerson): string =>
    add(clean({ "@id": who.orcid ? `https://orcid.org/${who.orcid}` : who.id.startsWith("did:") ? who.id : `#person-${encodeURIComponent(who.id)}`, "@type": "Person", name: who.name }) as Entity);
  const authorOf = (by: Author): string => {
    const orcid = by.id === author.id ? author.orcid : input.orcidOf?.(by);
    return personId({ id: by.id, name: input.nameOf(by), ...(orcid ? { orcid } : {}) });
  };
  const agentId = (agent: string): string => {
    const iri = agentIri(agent);
    const known = iri === author.id || agent === author.orcid;
    return known ? personId(author) : add({ "@id": iri, "@type": "Person", name: iri.replace(/^https:\/\/orcid\.org\//, "ORCID ") });
  };
  const me = personId(author);
  const publisherId = publisher
    ? add(clean({ "@id": publisher.ror ? `https://ror.org/${publisher.ror}` : (publisher.id ?? `#org-${encodeURIComponent(publisher.name)}`), "@type": "Organization", name: publisher.name, url: publisher.ror ? `https://ror.org/${publisher.ror}` : undefined }) as Entity)
    : undefined;
  // The author belongs to the lab that publishes the crate.
  if (publisherId) entities.set(me, { ...entities.get(me)!, affiliation: ref(publisherId) });

  // Papers: the works the units were read from, cited from the root.
  const fileOfPaper = new Map<DgId, string>();
  const fileOfUnit = new Map<DgId, string>();
  for (const file of files) {
    if (file.paper) fileOfPaper.set(file.paper, crateFileId(file.path));
    if (file.unit) fileOfUnit.set(file.unit, crateFileId(file.path));
  }
  const paperId = (paper: PaperRecord): string => {
    const ids = paperIdentifiers(paper);
    const listed: WorkAuthor[] = paper.people?.length ? paper.people : paper.authors.map((name) => ({ name }));
    const people = listed.map((person) => {
      const id = person.orcid ? `https://orcid.org/${person.orcid}` : `#author-${encodeURIComponent(person.name)}`;
      const affiliations = (person.affiliations ?? []).map((place) =>
        add(clean({ "@id": place.ror ? `https://ror.org/${place.ror}` : `#org-${encodeURIComponent(place.name)}`, "@type": "Organization", name: place.name, url: place.ror ? `https://ror.org/${place.ror}` : undefined }) as Entity),
      );
      return add(clean({ "@id": id, "@type": "Person", name: person.name, affiliation: refs(affiliations) }) as Entity);
    });
    return add(
      clean({
        "@id": paper.doi ? `https://doi.org/${paper.doi}` : (paper.url ?? `#paper-${paper.id}`),
        "@type": "ScholarlyArticle",
        name: paper.title,
        author: refs(people),
        datePublished: paper.published,
        isPartOf: paper.venue ? ref(add({ "@id": `#venue-${encodeURIComponent(paper.venue)}`, "@type": "Periodical", name: paper.venue })) : undefined,
        license: paper.license ? (/^https?:\/\//.test(paper.license) ? ref(add(licenseEntity(paper.license))) : paper.license) : undefined,
        identifier: ids.map((item) => ref(add(identifierEntity(item)))),
        url: paper.url,
        creativeWorkStatus: paper.standing?.retracted ? "Retracted" : undefined,
        isAccessibleForFree: paper.standing?.openAccess?.status && paper.standing.openAccess.status !== "closed" ? true : undefined,
        // The PDF, when the person chose to put it in the crate.
        encoding: fileOfPaper.has(paper.id) ? ref(fileOfPaper.get(paper.id)!) : undefined,
      }) as Entity,
    );
  };

  // Units. A source unit that stands for a paper is that paper's entity.
  const ownSourceOf = new Map<DgId, PaperRecord>();
  for (const node of chosen.values()) {
    const paper = node.source?.own ? papers.get(node.source.paper) : undefined;
    if (paper) ownSourceOf.set(node.id, paper);
  }
  const unitId = (id: DgId): string => {
    const paper = ownSourceOf.get(id);
    if (paper) return paper.doi ? `https://doi.org/${paper.doi}` : (paper.url ?? `#paper-${paper.id}`);
    const node = nodeAt(id);
    if (node && baseOf(graph, node) === "source" && node.facts?.doi) return `https://doi.org/${node.facts.doi}`;
    if (node && baseOf(graph, node) === "output" && fileOfUnit.has(id)) return fileOfUnit.get(id)!;
    if (node && baseOf(graph, node) === "output" && /^https?:\/\//.test(node.facts?.uri ?? "")) return node.facts!.uri!;
    return iriOf(graph, id);
  };
  /** A pin names a unit in the graph, or something outside it by RRID, DOI or URL. */
  const pinId = (pin: Pin): string => {
    if (chosen.has(pin.uri) || nodeAt(pin.uri)) return unitId(pin.uri);
    const outside = parseIdentifier(pin.uri);
    const id = (outside && identifierUrl(outside)) ?? pin.uri;
    add(clean({ "@id": id, "@type": "Thing", name: outside ? identifierCurie(outside) : pin.uri, contentIdentifier: pin.cid }) as Entity);
    return id;
  };

  const actions: string[] = [];
  const units: string[] = [];
  const outputFiles: string[] = [];
  let step = 0;
  for (const node of chosen.values()) {
    const base = baseOf(graph, node);
    if (!base) continue;
    const id = unitId(node.id);
    const prov = provenanceOf(graph, node.id);
    const facts = node.facts ?? {};
    const paper = node.source ? papers.get(node.source.paper) : undefined;
    const ownPaper = ownSourceOf.get(node.id);
    if (ownPaper) {
      paperId(ownPaper);
      continue;
    }
    const identifiers = identifiersOf(node).map((item) => ref(add(identifierEntity(item))));
    const common = {
      "@id": id,
      name: node.title,
      description: node.source?.description,
      dateCreated: node.at,
      // A unit read from a paper is its extractor's reading of the authors' work, so both are named.
      creator: ref(authorOf(node.by)),
      isBasedOn: paper ? ref(paperId(paper)) : prov.sourceDocument ? ref(unitId(prov.sourceDocument)) : undefined,
      anchor: node.source?.anchor ?? facts.anchor?.exact,
      pagination: facts.anchor?.page,
      identifier: identifiers,
      sameAs: facts.sameAs,
    };
    if (base === "run") {
      const parameters = Object.entries(facts.parameterValues ?? {}).map(([name, value]) =>
        add({ "@id": `#${encodeURIComponent(node.id)}-param-${encodeURIComponent(name)}`, "@type": "PropertyValue", name, value: typeof value === "string" ? value : JSON.stringify(value) }),
      );
      const results = [...chosen.values()].filter((other) => provenanceOf(graph, other.id).generatedBy === node.id).map((other) => unitId(other.id));
      const environment = Object.entries(facts.environment ?? {}).map(([name, value]) =>
        add({ "@id": `#${encodeURIComponent(node.id)}-env-${encodeURIComponent(name)}`, "@type": "PropertyValue", name, value: typeof value === "string" ? value : JSON.stringify(value) }),
      );
      add(
        clean({
          ...common,
          "@type": "CreateAction",
          instrument: refs((prov.instrument ?? []).map(pinId)),
          object: refs([...(prov.used ?? []).map(pinId), ...parameters]),
          result: refs(results),
          agent: refs((facts.agents?.length ? facts.agents.map(agentId) : [authorOf(node.by)])),
          startTime: facts.startedAt,
          endTime: facts.endedAt,
          actionStatus: facts.status ? ref(ACTION_STATUS[facts.status]!) : undefined,
          error: facts.status === "failed" && facts.deviations?.length ? facts.deviations.join(" ") : undefined,
          disambiguatingDescription: facts.status !== "failed" && facts.deviations?.length ? `Departed from its protocol: ${facts.deviations.join(" ")}` : undefined,
          follows: prov.follows ? ref(pinId(prov.follows)) : undefined,
          isPartOf: prov.partOf ? ref(unitId(prov.partOf)) : undefined,
          environment: refs(environment),
          subjectOf: facts.seeAlso,
        }) as Entity,
      );
      actions.push(id);
      continue;
    }
    if (base === "code") {
      add(
        clean({
          ...common,
          "@type": "SoftwareSourceCode",
          codeRepository: facts.repo,
          version: facts.commit,
          programmingLanguage: facts.language,
          license: facts.license,
          url: facts.repo && facts.path ? `${facts.repo.replace(/\/+$/, "")}/blob/${facts.commit ?? "HEAD"}/${facts.path}` : undefined,
          contentIdentifier: facts.sourceCid,
        }) as Entity,
      );
    } else if (base === "output") {
      const file = files.find((item) => item.unit === node.id);
      const web = !file && /^https?:\/\//.test(facts.uri ?? "");
      if (file || web) outputFiles.push(id);
      add(
        clean({
          ...common,
          "@type": file || web ? ["File", OUTPUT_TYPE[facts.outputKind ?? "file"]!].filter((type, index, all) => all.indexOf(type) === index && type !== "MediaObject") : OUTPUT_TYPE[facts.outputKind ?? "file"]!,
          encodingFormat: facts.mediaType,
          contentSize: facts.size !== undefined ? String(facts.size) : undefined,
          caption: facts.caption,
          contentIdentifier: facts.cid,
          isBasedOn: (prov.derivedFrom ?? []).length ? refs(prov.derivedFrom!.map(pinId)) : common.isBasedOn,
          contentUrl: !file && !web ? facts.uri : undefined,
        }) as Entity,
      );
    } else if (base === "protocol") {
      const steps = (facts.steps ?? []).map((name, index) => {
        step += 1;
        return add({ "@id": `#step-${step}`, "@type": "HowToStep", position: index + 1, name });
      });
      add(
        clean({
          ...common,
          "@type": "HowTo",
          version: facts.version,
          step: refs(steps),
          tool: facts.materials,
          contentIdentifier: input.versions?.get(node.id),
          workExample: refs((prov.implementedBy ?? []).map(unitId)),
        }) as Entity,
      );
    } else if (base === "study") {
      add(
        clean({
          ...common,
          "@type": UNIT_TYPE.study,
          about: prov.question ? ref(unitId(prov.question)) : undefined,
          abstract: facts.hypothesis,
          additionalType: facts.design,
          hasPart: refs((prov.protocols ?? []).map(unitId)),
          variableMeasured: (facts.variables ?? []).map(({ name, role, unit }) => `${name} (${role}${unit ? `, ${unit}` : ""})`),
          keywords: facts.conditions,
          sameAs: facts.preregistration ? [facts.preregistration, ...(facts.sameAs ?? [])] : facts.sameAs,
        }) as Entity,
      );
    } else if (base === "source") {
      add(clean({ ...common, "@type": facts.doi ? "ScholarlyArticle" : "CreativeWork", creativeWorkStatus: facts.standing?.retracted ? "Retracted" : undefined, url: facts.uri }) as Entity);
    } else {
      add(
        clean({
          ...common,
          "@type": UNIT_TYPE[base],
          observationBase: refs((prov.observationBase ?? []).map(pinId)),
          isGroundedIn: prov.isGroundedIn ? ref(unitId(prov.isGroundedIn)) : undefined,
        }) as Entity,
      );
    }
    units.push(id);
  }

  // Arguments between the units, active ones only. Who stated each stays in the record log.
  for (const { record, state } of graph.relations.values()) {
    if (state !== "active" || !chosen.has(record.source) || !chosen.has(record.target)) continue;
    const kind = (graph.documents.get(record.type) as RelationTypeRecord | undefined)?.base;
    if (!kind || !ARGUMENTS.has(kind)) continue;
    const from = entities.get(unitId(record.source));
    if (!from) continue;
    const held = (from[kind] as JsonObject[] | undefined) ?? [];
    const target = unitId(record.target);
    if (!held.some((item) => item["@id"] === target)) from[kind] = [...held, ref(target)];
  }

  // The payload.
  const parts: string[] = [];
  for (const file of files) {
    const id = crateFileId(file.path);
    const known = entities.get(id);
    add(
      clean({
        ...(known ?? {}),
        "@id": id,
        "@type": known ? known["@type"] : "File",
        name: known?.name ?? file.name,
        description: known?.description ?? file.description,
        encodingFormat: file.mediaType,
        contentSize: String(file.bytes.length),
        sha256: await sha256Hex(file.bytes),
        conformsTo: file.conformsTo ? ref(add({ "@id": file.conformsTo, "@type": "CreativeWork", name: SPECS[file.conformsTo] ?? file.conformsTo })) : undefined,
      }) as Entity,
    );
    parts.push(id);
  }
  for (const id of outputFiles) if (!parts.includes(id)) parts.push(id);

  const licenseId = input.license ? add(licenseEntity(input.license)) : undefined;
  const used = new Set<string>();
  for (const entity of entities.values()) {
    for (const { term } of TERMS) {
      if (term in entity || (Array.isArray(entity["@type"]) ? entity["@type"].includes(term) : entity["@type"] === term)) used.add(term);
    }
  }
  const termSet = DG_NAMESPACE.replace(/#$/, "");
  for (const { term, kind, name, description } of TERMS) {
    if (used.has(term)) add({ "@id": `${DG_NAMESPACE}${term}`, "@type": [kind, "DefinedTerm"], name, description, termCode: term, inDefinedTermSet: ref(termSet), "rdfs:label": name, "rdfs:comment": description });
  }
  if (used.size) {
    add({
      "@id": termSet,
      "@type": "DefinedTermSet",
      name: "Discourse Graphs process terms",
      description: "The few terms this crate uses that schema.org lacks: what a unit argues, and what a run followed.",
      hasDefinedTerm: TERMS.filter(({ term }) => used.has(term)).map(({ term }) => ref(`${DG_NAMESPACE}${term}`)),
    });
  }
  const profile = actions.length ? add({ "@id": PROCESS_RUN_CRATE.id, "@type": ["CreativeWork", "Profile"], name: PROCESS_RUN_CRATE.name, version: PROCESS_RUN_CRATE.version }) : undefined;
  const citations = [...papers.values()].map(paperId);
  const questions = [...chosen.values()].filter((node) => baseOf(graph, node) === "question").map((node) => unitId(node.id));

  const root = clean({
    "@id": "./",
    "@type": "Dataset",
    name: input.name,
    description: input.description,
    datePublished: input.published,
    license: licenseId ? ref(licenseId) : NO_LICENSE,
    author: [ref(me)],
    // With no lab, the person who made the crate is who published it.
    publisher: ref(publisherId ?? me),
    identifier: input.identifier,
    conformsTo: profile ? [ref(profile)] : undefined,
    hasPart: refs(parts),
    mentions: refs([...actions, ...units]),
    about: refs(questions),
    citation: refs(citations),
    keywords: ["discourse graph", ...new Set([...chosen.values()].map((node) => baseOf(graph, node)).filter((base): base is BaseNodeType => base !== undefined))].join(", "),
  }) as Entity;
  const descriptor: Entity = { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", conformsTo: ref(CRATE_VERSIONS[version].conformsTo), about: ref("./") };

  const context: (string | JsonObject)[] = [CRATE_VERSIONS[version].context];
  if (used.size) context.push(Object.fromEntries(TERMS.filter(({ term }) => used.has(term)).map(({ term }) => [term, `${DG_NAMESPACE}${term}`])));
  // RO-Crate asks for a single value where there is only one, not a list of one.
  const single = (entity: Entity): Entity =>
    Object.fromEntries(Object.entries(entity).map(([key, value]) => [key, Array.isArray(value) && value.length === 1 && key !== "@type" ? value[0] : value])) as Entity;
  return { "@context": context.length === 1 ? context[0]! : (context as never), "@graph": [descriptor, root, ...entities.values()].map(single) as never };
};

const escape = (text: unknown): string => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** `ro-crate-preview.html`: the crate in a page a person can read without any tool. */
export const cratePreview = (metadata: JsonObject): string => {
  const graph = (metadata["@graph"] as Entity[]) ?? [];
  const byId = new Map(graph.map((entity) => [entity["@id"], entity]));
  const root = byId.get("./");
  const typeOf = (entity: Entity): string => (Array.isArray(entity["@type"]) ? entity["@type"].join(", ") : entity["@type"]);
  const link = (id: string): string => {
    const name = byId.get(id)?.name;
    const text = escape(name ?? id);
    return /^https?:\/\//.test(id) ? `<a href="${escape(id)}">${text}</a>` : id.startsWith("#") || id === "./" ? text : `<a href="${escape(id)}">${text}</a>`;
  };
  const show = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(show).join("; ");
    if (value && typeof value === "object" && "@id" in value) return link(String((value as JsonObject)["@id"]));
    return escape(value);
  };
  const rows = (entity: Entity): string =>
    Object.entries(entity)
      .filter(([key]) => key !== "@id" && key !== "name")
      .map(([key, value]) => `<tr><th>${escape(key)}</th><td>${show(value)}</td></tr>`)
      .join("");
  const sections = graph
    .filter((entity) => entity["@id"] !== "./" && entity["@id"] !== "ro-crate-metadata.json")
    .map((entity) => `<section id="${escape(entity["@id"])}"><h2>${escape(entity.name ?? entity["@id"])}</h2><p class="type">${escape(typeOf(entity))}</p><table>${rows(entity)}</table></section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(root?.name ?? "RO-Crate")}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:54rem;margin:2rem auto;padding:0 1rem;color:#1c1c1c}h1{font-size:1.5rem}h2{font-size:1.05rem;margin:1.6rem 0 0}table{border-collapse:collapse;width:100%}th{text-align:left;vertical-align:top;width:11rem;font-weight:500;color:#5a5a5a;padding:2px 12px 2px 0}td{padding:2px 0;overflow-wrap:anywhere}.type{margin:0;color:#5a5a5a;font-size:.85rem}@media(prefers-color-scheme:dark){body{background:#161616;color:#e8e8e8}th,.type{color:#a0a0a0}a{color:#8ab4f8}}</style>
</head><body>
<h1>${escape(root?.name ?? "RO-Crate")}</h1>
<p>${escape(root?.description ?? "")}</p>
<table>${root ? rows(root) : ""}</table>
${sections}
<script type="application/ld+json">${JSON.stringify(metadata).replace(/</g, "\\u003c")}</script>
</body></html>
`;
};
