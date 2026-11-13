import type { Author, BaseNodeType, DgId, FoldedGraph, JsonObject, NodeRecord, PaperRecord, Pin, RelationTypeRecord } from "@dg/contract/records.ts";
import { identifierCurie, identifierUrl, parseIdentifier, type Identifier, type WorkAuthor } from "@dg/contract/scholarly.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";
import { iriOf } from "./jsonld.ts";
import { MIRA, addMiraLayer } from "./mira.ts";
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
const RUN_ENVIRONMENT = "https://w3id.org/ro/terms/workflow-run#environment";

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

/** One person's mark on a unit, as a crate tells it. */
export type CrateCheck = { by: Author; at: string; verdict: "checked" | "needsWork"; own: boolean; way: string; note?: string; current: boolean; cid?: string };

/** The ELN file format's own version, which a notebook reads to know what it is opening. */
export const ELN_SPEC = "https://purl.org/elnconsortium/eln-spec/1.2+20260923";
/**
 * The same version under the address the ELN Consortium's own checker looks for. Its specification and
 * eLabFTW's exports use the first address and its tests the second, so a file names both.
 */
export const ELN_SPEC_ALSO = "https://purl.archive.org/purl/elnconsortium/eln-spec/1.2+20260923";
const PREFIXES: Record<string, string> = { mira: "http://purl.org/mira-science/mira#", rdfs: "http://www.w3.org/2000/01/rdf-schema#" };

/**
 * One thing a lab notebook imports from an `.eln` file: an experiment, a protocol or a resource.
 * A notebook reads only what the crate's root lists, so these are the root's parts, each a folder
 * holding its own files.
 */
export type CrateEntry = {
  /** Its folder inside the crate, ending in `/`. */
  path: string;
  name: string;
  /** `experiment`, `protocol` or `resource`: the notebook's own word for what it becomes. */
  genre: "experiment" | "protocol" | "resource";
  /** Its body, as Markdown. */
  text: string;
  keywords: string[];
  created: string;
  modified: string;
  by: Author;
  /** Named values, such as a run's parameters. */
  values: Record<string, string>;
  /** Paths of the crate's files that belong to it. */
  files: string[];
  comments: { by: Author; at: string; text: string }[];
  /** The unit it is the notebook's view of. */
  unit?: DgId;
};

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
  /** Who has checked each unit. */
  checks?: Map<DgId, CrateCheck[]>;
  /** For an `.eln` file: what a notebook imports. With these, the root lists them and nothing else. */
  entries?: CrateEntry[];
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

/** Where a script's bytes are, and the page a person reads it on. GitHub serves the two from different addresses. */
const codeAddress = (repo: string, commit: string | undefined, path: string): { file: string; page: string } => {
  const base = repo.replace(/\/+$/, "").replace(/\.git$/, "");
  const where = path.split("/").map(encodeURIComponent).join("/");
  const page = `${base}/blob/${commit ?? "HEAD"}/${where}`;
  const github = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(base);
  return { file: github ? `https://raw.githubusercontent.com/${github[1]}/${commit ?? "HEAD"}/${where}` : page, page };
};
const MIME_OF_LANGUAGE: Record<string, string> = { python: "text/x-python", r: "text/x-r", julia: "text/x-julia", javascript: "text/javascript", typescript: "text/x-typescript", matlab: "text/x-matlab", shell: "application/x-sh" };

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
    if (known) return personId(author);
    // Whoever ran it may be named in words alone, such as a model. That is a name, not an address.
    const addressed = /^[a-z][a-z0-9+.-]*:/i.test(iri);
    // Someone already named in the crate keeps their name.
    if (addressed && entities.has(iri)) return iri;
    return add({ "@id": addressed ? iri : `#agent-${encodeURIComponent(iri)}`, "@type": "Person", name: iri.replace(/^https:\/\/orcid\.org\//, "ORCID ") });
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
  const hostedCode = (node: NodeRecord): string | undefined =>
    /^https?:\/\//.test(node.facts?.repo ?? "") && node.facts?.path ? codeAddress(node.facts.repo!, node.facts.commit, node.facts.path).file : undefined;
  const unitId = (id: DgId): string => {
    const paper = ownSourceOf.get(id);
    if (paper) return paper.doi ? `https://doi.org/${paper.doi}` : (paper.url ?? `#paper-${paper.id}`);
    const node = nodeAt(id);
    if (node && baseOf(graph, node) === "source" && node.facts?.doi) return `https://doi.org/${node.facts.doi}`;
    // A script in a repository is a file on the web: its address at the version that ran is its id.
    if (node && baseOf(graph, node) === "code" && hostedCode(node)) return hostedCode(node)!;
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

  // What each unit says at length: the newest text kept for it.
  const said = new Map<DgId, { at: string; body: string }>();
  for (const record of graph.documents.values()) {
    if (record.kind !== "snapshot" || !record.body.trim()) continue;
    const held = said.get(record.node);
    if (!held || record.at > held.at) said.set(record.node, { at: record.at, body: record.body });
  }

  const actions: string[] = [];
  const units: string[] = [];
  /** Which entity stands for which kind of unit, for the MIRA layer. */
  const bases = new Map<string, BaseNodeType>();
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
    bases.set(id, base);
    if (ownPaper) {
      paperId(ownPaper);
      continue;
    }
    const identifiers = identifiersOf(node).map((item) => ref(add(identifierEntity(item))));
    const common = {
      "@id": id,
      name: node.title,
      description: node.source?.description ?? (base === "run" ? said.get(node.id)?.body : undefined),
      text: base === "run" || base === "code" || base === "output" ? undefined : said.get(node.id)?.body,
      dateCreated: node.at,
      // A unit read from a paper is its extractor's reading of the authors' work, so both are named.
      // A unit that arrived from elsewhere is its first makers' work. Whoever brought it in contributed it.
      creator: facts.creators?.length ? refs(facts.creators.map((person) => personId({ id: person.name, name: person.name, ...(person.orcid ? { orcid: person.orcid } : {}) }))) : ref(authorOf(node.by)),
      contributor: facts.creators?.length ? ref(authorOf(node.by)) : undefined,
      isBasedOn: paper ? ref(paperId(paper)) : prov.sourceDocument ? ref(unitId(prov.sourceDocument)) : undefined,
      anchor: node.source?.anchor ?? facts.anchor?.exact,
      pagination: facts.anchor?.page,
      // The unit's own id first: it stays the same when the unit is retyped, which its address does not.
      identifier: [node.id, ...identifiers],
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
          // RO-Crate asks that a script be a file as well as source code.
          // A whole repository, with no one file named, is software a run used, not a script.
          "@type": hostedCode(node) ? ["File", "SoftwareSourceCode"] : "SoftwareApplication",
          codeRepository: hostedCode(node) ? facts.repo : undefined,
          // RO-Crate asks every piece of software for a version, and says so when none is known.
          version: facts.commit ?? (hostedCode(node) ? undefined : "unknown"),
          programmingLanguage: facts.language,
          license: facts.license,
          url: hostedCode(node) ? codeAddress(facts.repo!, facts.commit, facts.path!).page : facts.repo,
          encodingFormat: hostedCode(node) ? (MIME_OF_LANGUAGE[(facts.language ?? "").toLowerCase()] ?? "text/plain") : undefined,
          sdDatePublished: hostedCode(node) ? input.published.slice(0, 10) : undefined,
          description: hostedCode(node) ? `${facts.path} in ${facts.repo}, ${facts.commit ? `at commit ${facts.commit}` : "with no commit on record, so this points at whatever the repository holds now"}.` : common.description,
          contentIdentifier: facts.sourceCid,
        }) as Entity,
      );
      if (hostedCode(node)) outputFiles.push(id);
    } else if (base === "output") {
      const file = files.find((item) => item.unit === node.id);
      const web = !file && /^https?:\/\//.test(facts.uri ?? "");
      if (file || web) outputFiles.push(id);
      add(
        clean({
          ...common,
          // A data file is a file. `Dataset` on a file would say it is a folder.
          // With no bytes here or on the web it is something cited, not a data entity the crate holds.
          "@type":
            file || web
              ? ["File", OUTPUT_TYPE[facts.outputKind ?? "file"]!].filter((type, index, all) => all.indexOf(type) === index && type !== "MediaObject" && type !== "Dataset")
              : ["Dataset", "MediaObject"].includes(OUTPUT_TYPE[facts.outputKind ?? "file"]!)
                ? "CreativeWork"
                : OUTPUT_TYPE[facts.outputKind ?? "file"]!,
          // A more exact type is given by its address, which is how the ELN file format asks for it.
          additionalType: OUTPUT_TYPE[facts.outputKind ?? "file"] === "Dataset" ? ref("https://schema.org/Dataset") : undefined,
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
      add(
        clean({
          ...common,
          "@type": facts.doi ? "ScholarlyArticle" : "CreativeWork",
          creativeWorkStatus: facts.standing?.retracted ? "Retracted" : undefined,
          url: facts.uri,
          // The runs a paper reports. MIRA has the word for it and schema.org does not.
          "mira:describesActivity": refs((prov.describesActivity ?? []).filter((run) => chosen.has(run)).map(unitId)),
        }) as Entity,
      );
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

  // Sign-off: each mark is a review of the unit it was made on.
  let reviews = 0;
  for (const [unit, marks] of input.checks ?? []) {
    const about = entities.get(unitId(unit));
    if (!about || !chosen.has(unit)) continue;
    const made = marks.map((mark) => {
      reviews += 1;
      return add(
        clean({
          "@id": `#review-${reviews}`,
          "@type": "Review",
          name: mark.verdict === "needsWork" ? "Needs work" : mark.own ? "Signed by its author" : "Checked",
          itemReviewed: ref(unitId(unit)),
          author: ref(authorOf(mark.by)),
          dateCreated: mark.at,
          reviewAspect: mark.way,
          reviewBody: mark.note,
          // A mark holds for the version it was made on, and says so when the unit has moved on.
          description: mark.current ? undefined : "Made on an earlier version of this unit, which has changed since.",
          identifier: mark.cid,
        }) as Entity,
      );
    });
    about.review = refs(made);
  }

  // The same units in MIRA's words, in this one graph.
  addMiraLayer(entities as Map<string, JsonObject & { "@id": string }>, bases);

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

  // What a lab notebook imports: each entry is a folder the root lists, with its text, values, files and comments.
  const entryIds: string[] = [];
  let comments = 0;
  let values = 0;
  for (const entry of input.entries ?? []) {
    const id = `./${crateFileId(entry.path.replace(/\/+$/, ""))}/`;
    const said = entry.comments.map((comment) => {
      comments += 1;
      return add({ "@id": `#comment-${comments}`, "@type": "Comment", author: ref(authorOf(comment.by)), dateCreated: comment.at, text: comment.text });
    });
    const measured = Object.entries(entry.values).map(([name, value]) => {
      values += 1;
      return add({ "@id": `#value-${values}`, "@type": "PropertyValue", propertyID: name, name, value });
    });
    add(
      clean({
        "@id": id,
        "@type": "Dataset",
        name: entry.name,
        genre: entry.genre,
        author: ref(authorOf(entry.by)),
        dateCreated: entry.created,
        dateModified: entry.modified,
        encodingFormat: "text/markdown",
        text: entry.text,
        // The format asks for one comma-separated string.
        keywords: entry.keywords.map((word) => word.replace(/,/g, " ")).join(","),
        variableMeasured: refs(measured),
        hasPart: refs(entry.files.map(crateFileId)),
        comment: refs(said),
        identifier: entry.unit ?? entry.path.replace(/\/+$/, ""),
        mainEntity: entry.unit && chosen.has(entry.unit) ? ref(unitId(entry.unit)) : undefined,
      }) as Entity,
    );
    entryIds.push(id);
  }
  // Every file the crate holds or links belongs to some entry. What no entry claimed goes with the graph itself.
  if (entryIds.length) {
    const claimed = new Set((input.entries ?? []).flatMap((entry) => entry.files.map(crateFileId)));
    const loose = parts.filter((id) => !claimed.has(id));
    const home = entities.get(`./${crateFileId((input.entries!.find((entry) => entry.genre === "resource") ?? input.entries![0]!).path.replace(/\/+$/, ""))}/`)!;
    if (loose.length) home.hasPart = [...((home.hasPart as JsonObject[] | undefined) ?? []), ...refs(loose)];
  }

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
    conformsTo: [
      ...(entryIds.length ? [ELN_SPEC, ELN_SPEC_ALSO].map((address) => ref(add({ "@id": address, "@type": ["CreativeWork", "Profile"], name: "ELN file format", version: "1.2+20260923" }))) : []),
      ...(profile ? [ref(profile)] : []),
    ],
    // A notebook imports what the root lists. In an .eln file that is the entries, and their files hang from them.
    hasPart: entryIds.length ? refs(entryIds) : refs(parts),
    mentions: refs([...actions, ...units, ...(bases.size ? [MIRA.namespace] : [])]),
    about: refs(questions),
    citation: refs(citations),
    keywords: ["discourse graph", ...new Set([...chosen.values()].map((node) => baseOf(graph, node)).filter((base): base is BaseNodeType => base !== undefined))].join(", "),
  }) as Entity;
  const descriptor: Entity = { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", conformsTo: ref(CRATE_VERSIONS[version].conformsTo), about: ref("./") };

  const context: (string | JsonObject)[] = [CRATE_VERSIONS[version].context];
  // A run's environment is a Workflow Run Crate term, which the base RO-Crate context doesn't carry.
  const environment = [...entities.values()].some((entity) => "environment" in entity);
  if (environment) add({ "@id": RUN_ENVIRONMENT, "@type": "rdf:Property", name: "environment", description: "The settings a run was carried out under, such as its language and package versions.", "rdfs:label": "environment" });
  context.push({ ...Object.fromEntries(TERMS.filter(({ term }) => used.has(term)).map(({ term }) => [term, `${DG_NAMESPACE}${term}`])), ...(environment ? { environment: RUN_ENVIRONMENT } : {}), ...(bases.size ? { mira: MIRA.namespace } : {}) });
  // RO-Crate asks for a single value where there is only one, not a list of one.
  // A lab notebook's reader is stricter than a crate's: one identifier, as text, and parts and comments always as lists.
  const forNotebook = entryIds.length > 0;
  const listed = new Set(forNotebook ? ["@type", "hasPart", "comment"] : ["@type"]);
  if (forNotebook) {
    for (const entity of entities.values()) {
      if (typeof entity.additionalType === "string") delete entity.additionalType;
      if (entity.identifier === undefined || typeof entity.identifier === "string") continue;
      const held = [entity.identifier].flat() as (string | JsonObject)[];
      const words = held.map((item) => (typeof item === "string" ? item : String(entities.get(String(item["@id"]))?.value ?? "")));
      const links = held.flatMap((item) => (typeof item === "string" ? [] : [String(entities.get(String(item["@id"]))?.url ?? "")])).filter((link) => /^https?:/.test(link));
      entity.identifier = words.find(Boolean) ?? "";
      if (!entity.identifier) delete entity.identifier;
      const same = [...new Set([...([entity.sameAs ?? []].flat() as string[]), ...links])];
      if (same.length) entity.sameAs = same;
    }
  }
  const single = (entity: Entity): Entity =>
    Object.fromEntries(Object.entries(entity).map(([key, value]) => [key, Array.isArray(value) && value.length === 1 && !listed.has(key) ? value[0] : value])) as Entity;
  // A key written with a prefix, such as `mira:follows`, is spelled out too: RO-Crate 1.2 readers want every key in the context.
  const spelled = context[1] as Record<string, string>;
  for (const entity of [root, ...entities.values()]) {
    for (const key of Object.keys(entity)) {
      const [prefix, name] = key.split(":");
      if (name && !key.startsWith("@") && PREFIXES[prefix!]) spelled[key] = `${PREFIXES[prefix!]}${name}`;
    }
  }
  if (Object.keys(context[1] as JsonObject).length === 0) context.pop();
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

/**
 * `README.md`: the crate told as findings. For each piece of evidence, what was
 * observed, the figure and data it rests on, the run that produced them, the
 * protocol that run followed and the code it ran. Made from the metadata alone,
 * so it can't say anything the crate doesn't.
 */
export const crateReadme = (metadata: JsonObject): string => {
  const graph = (metadata["@graph"] as Entity[]) ?? [];
  const byId = new Map(graph.map((entity) => [entity["@id"], entity]));
  const root = byId.get("./");
  const list = (value: unknown): unknown[] => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);
  const ids = (value: unknown): string[] => list(value).flatMap((item) => (item && typeof item === "object" && "@id" in item ? [String((item as JsonObject)["@id"])] : []));
  const types = (entity: Entity | undefined): string[] => list(entity?.["@type"]).map(String);
  const nameOf = (id: string): string => String(byId.get(id)?.name ?? id);
  const isFile = (id: string): boolean => types(byId.get(id)).includes("File") && !/^https?:/.test(id);
  const linked = (id: string): string => (/^https?:\/\//.test(id) || isFile(id) ? `[${nameOf(id)}](${id})` : nameOf(id));
  const day = (value: unknown): string => (typeof value === "string" ? value.slice(0, 10) : "");
  const lines: string[] = [`# ${root?.name ?? "Research crate"}`, "", String(root?.description ?? ""), ""];

  const evidence = graph.filter((entity) => types(entity).includes("Evidence"));
  if (evidence.length) lines.push("## Findings", "");
  for (const item of evidence) {
    lines.push(`### ${item.name}`, "");
    if (typeof item.anchor === "string") lines.push(`> ${item.anchor}`, "");
    if (typeof item.text === "string") lines.push(item.text, "");
    const rests = ids(item.observationBase);
    // The pictures a reader can look at: the ones the finding rests on, then the ones its run made.
    const made = ids(item.isGroundedIn).flatMap((run) => ids(byId.get(run)?.result));
    const pictures = [...new Set([...rests, ...made])].filter((file) => isFile(file) && /^image\/(png|jpeg|svg\+xml)$/.test(String(byId.get(file)?.encodingFormat ?? "")));
    for (const id of pictures.slice(0, 2)) lines.push(`![${nameOf(id).replace(/[\[\]]/g, "")}](${id})`, "", ...(typeof byId.get(id)?.caption === "string" ? [`*${byId.get(id)!.caption}*`, ""] : []));
    for (const [kind, verb] of [["supports", "Supports"], ["opposes", "Opposes"], ["informs", "Informs"]] as const) for (const id of ids(item[kind])) lines.push(`- **${verb}:** ${nameOf(id)}`);
    for (const id of ids(item.isBasedOn)) lines.push(`- **Read from:** ${linked(id)}`);
    if (rests.length) {
      lines.push("- **Rests on:**");
      for (const id of rests) {
        const file = byId.get(id);
        const hash = typeof file?.sha256 === "string" ? `, SHA-256 \`${file.sha256.slice(0, 16)}…\`` : typeof file?.contentIdentifier === "string" ? `, content id \`${file.contentIdentifier}\`` : "";
        lines.push(`  - ${linked(id)}${isFile(id) ? "" : " (cited, not in this crate)"}${hash}`);
      }
    }
    for (const review of ids(item.review)) {
      const mark = byId.get(review);
      if (mark) lines.push(`- **${mark.name}:** ${ids(mark.author).map(nameOf).join(", ")}, ${day(mark.dateCreated)} (${String(mark.reviewAspect ?? "").toLowerCase()})${mark.reviewBody ? `. ${mark.reviewBody}` : ""}${mark.description ? ` ${mark.description}` : ""}`);
    }
    for (const run of ids(item.isGroundedIn)) {
      const action = byId.get(run);
      if (!action) continue;
      const when = [day(action.startTime), day(action.endTime)].filter(Boolean).join(" to ");
      lines.push(`- **Produced by:** ${action.name}${when ? ` (${when})` : ""}`);
      for (const id of ids(action.follows)) lines.push(`  - Followed ${linked(id)}${byId.get(id)?.version ? `, version ${byId.get(id)!.version}` : ""}`);
      for (const id of ids(action.instrument)) lines.push(`  - Ran ${linked(id)}${byId.get(id)?.version ? ` at \`${String(byId.get(id)!.version).slice(0, 12)}\`` : ""}`);
      const inputs = ids(action.object).filter((id) => !types(byId.get(id)).includes("PropertyValue"));
      for (const id of inputs) lines.push(`  - Used ${linked(id)}${isFile(id) ? "" : " (cited, not in this crate)"}`);
      const values = ids(action.object).map((id) => byId.get(id)).filter((value): value is Entity => Boolean(value) && types(value).includes("PropertyValue"));
      if (values.length) lines.push(`  - Parameters: ${values.map((value) => `${value.name} = ${value.value}`).join(", ")}`);
      if (typeof action.disambiguatingDescription === "string") lines.push(`  - ${action.disambiguatingDescription}`);
      if (typeof action.error === "string") lines.push(`  - Failed: ${action.error}`);
    }
    lines.push("");
  }

  const claims = graph.filter((entity) => types(entity).includes("Claim"));
  const questions = graph.filter((entity) => types(entity).includes("Question"));
  if (questions.length || claims.length) lines.push("## The argument", "");
  for (const question of questions) lines.push(`- **Question:** ${question.name}`);
  for (const claim of claims) {
    const backing = evidence.filter((item) => ids(item.supports).includes(claim["@id"])).length;
    const against = evidence.filter((item) => ids(item.opposes).includes(claim["@id"])).length;
    lines.push(`- **Claim:** ${claim.name}${backing || against ? ` (${backing} for, ${against} against, in this crate)` : ""}`);
  }
  if (questions.length || claims.length) lines.push("");

  const protocols = graph.filter((entity) => types(entity).includes("HowTo"));
  if (protocols.length) lines.push("## Methods", "");
  for (const protocol of protocols) {
    lines.push(`### ${protocol.name}${protocol.version ? ` (version ${protocol.version})` : ""}`, "");
    if (typeof protocol.text === "string") lines.push(protocol.text, "");
    ids(protocol.step).forEach((id, index) => lines.push(`${index + 1}. ${nameOf(id)}`));
    lines.push("");
  }

  const files = ids(root?.hasPart).filter(isFile);
  if (files.length) lines.push("## Files", "", "| File | What it is | Size | SHA-256 |", "|---|---|---|---|");
  for (const id of files) {
    const file = byId.get(id)!;
    lines.push(`| [${decodeURIComponent(id)}](${id}) | ${String(file.name ?? "").replace(/\|/g, "/")} | ${file.contentSize ?? ""} | ${typeof file.sha256 === "string" ? `\`${file.sha256.slice(0, 16)}…\`` : ""} |`);
  }
  if (files.length) lines.push("");

  lines.push("## Reuse", "");
  const license = ids(root?.license)[0];
  lines.push(license ? `Licensed under ${linked(license)}.` : String(root?.license ?? ""));
  const people = ids(root?.author).map(nameOf).join(", ");
  const cite = typeof root?.identifier === "string" ? root.identifier : "";
  if (people) lines.push("", `Cite as: ${people}. ${root?.name}. ${day(root?.datePublished).slice(0, 4)}.${cite ? ` ${cite}` : ""}`);
  lines.push("", "Every unit here is also described in the [MIRA schema](https://github.com/MIRA-science/schema), in `ro-crate-metadata.json`. Made with Discourse Graphs.", "");
  return lines.join("\n");
};
