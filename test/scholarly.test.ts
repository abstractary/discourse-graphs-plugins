import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore, type Core } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore, type MemoryStore } from "@dg/contract/memory-host.ts";
import type { ExtractionGraph, LabLink, Services } from "@dg/contract/services.ts";
import type { DgRecord, JsonObject, NodeRecord, PaperRecord } from "@dg/contract/records.ts";
import { CARD_FIELD_IDS, identifierCurie, identifierUrl, mergeIdentifiers, parseIdentifier, type Notification, type WorkMetadata } from "@dg/contract/scholarly.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { planCrateImport, readCrate, slugOf } from "@dg/core/crate.ts";
import { toDataCite } from "@dg/core/datacite.ts";
import { buildNotification, RELATIONSHIPS } from "@dg/core/notify.ts";
import { PROCESS_RUN_CRATE } from "@dg/core/rocrate.ts";
import { crc32, unzip, zip } from "@dg/core/zip.ts";

const demo = JSON.parse(readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8")) as ExtractionGraph;
const DOI = demo.paper?.doi ?? "10.1016/j.semarthrit.2018.02.012";

const WORK: WorkMetadata = {
  identifiers: [
    { scheme: "doi", value: DOI.toLowerCase() },
    { scheme: "pmid", value: "29571540" },
    { scheme: "openalex", value: "W2790000000" },
  ],
  title: "A registry title",
  authors: [{ name: "Ada Example", given: "Ada", family: "Example", orcid: "0000-0002-1825-0097", affiliations: [{ name: "Example University", ror: "03yrm5c26" }] }],
  published: "2018-10",
  venue: "Seminars in Arthritis and Rheumatism",
  license: "https://creativecommons.org/licenses/by/4.0/",
  openAccess: { status: "green", url: "https://example.org/oa.pdf" },
  retracted: true,
  updates: [{ type: "retraction", doi: "10.1000/retraction" }],
  citedBy: 12,
  agency: "crossref",
  signposts: { inbox: "https://repository.example.org/inbox" },
  from: { title: "crossref", openAccess: "openalex" },
  services: [
    { name: "crossref", ok: true },
    { name: "openalex", ok: true },
    { name: "pubmed", ok: false, problem: "PubMed doesn't list this work." },
  ],
  checkedAt: "2026-11-12T10:00:00.000Z",
};

type Sent = { looked: { identifiers: unknown[]; title?: string }[]; notified: { inbox: string; notification: Notification }[] };

const services = (link: LabLink | null, sent: Sent): Services =>
  ({
    servers: async () => [],
    extract: async () => demo,
    storeGraph: async () => {},
    link: async () => link,
    pushRecords: async () => {},
    pullRecords: async () => ({ records: [], done: true }),
    lookupWork: async (args: Sent["looked"][number]) => {
      sent.looked.push(args);
      return WORK;
    },
    sendNotification: async (args: Sent["notified"][number]) => {
      sent.notified.push(args);
      return { status: 201, location: "https://repository.example.org/inbox/1" };
    },
    notifications: async () => [],
  }) as unknown as Services;

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async (link: LabLink | null = null, store: MemoryStore = createMemoryStore()): Promise<{ core: Core; call: Call; store: MemoryStore; sent: Sent; saved: () => Map<string, string> }> => {
  const { host } = createMemoryHost({ store });
  const sent: Sent = { looked: [], notified: [] };
  const files = new Map<string, string>();
  const keeping = { ...host, saveFile: async ({ name, dataBase64 }: { name: string; dataBase64: string }) => (files.set(name, dataBase64), { ok: true as const, value: { where: `saved/${name}` } }) };
  const core = await createCore({ host: keeping, services: services(link, sent), demoGraphs: [{ filename: "demo.pdf", graph: demo }] });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = {
    send: (message) => {
      if ("id" in message) pending.get(message.id)?.(message);
    },
    onMessage: (handler) => {
      listener = handler;
      return () => {};
    },
  };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      next += 1;
      const id = `r${next}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  return { core, call, store, sent, saved: () => files };
};

const extracted = async (call: Call) => {
  const paper = await call("paper.extract", { file: { name: "lupus.pdf", mediaType: "application/pdf", dataBase64: "AAAA" }, server: "http://local", model: "demo-replay", schema: "mira" } as never);
  const view = await call("canvas.open", { id: paper.canvas });
  return { paper, view, units: Object.values(view.nodes) };
};

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

test("identifiers read in every form people paste them", () => {
  assert.deepEqual(parseIdentifier("https://doi.org/10.1063/5.0038163"), { scheme: "doi", value: "10.1063/5.0038163" });
  assert.deepEqual(parseIdentifier("doi:10.1038/S41467-021-25801-2"), { scheme: "doi", value: "10.1038/s41467-021-25801-2" });
  assert.deepEqual(parseIdentifier("https://arxiv.org/abs/2010.14967v2"), { scheme: "arxiv", value: "2010.14967v2" });
  assert.deepEqual(parseIdentifier("10.48550/arXiv.2010.14967"), { scheme: "arxiv", value: "2010.14967" });
  assert.deepEqual(parseIdentifier("https://pubmed.ncbi.nlm.nih.gov/31579114/"), { scheme: "pmid", value: "31579114" });
  assert.deepEqual(parseIdentifier("PMC6759708"), { scheme: "pmcid", value: "PMC6759708" });
  assert.deepEqual(parseIdentifier("https://orcid.org/0000-0002-1825-0097"), { scheme: "orcid", value: "0000-0002-1825-0097" });
  assert.deepEqual(parseIdentifier("https://ror.org/03yrm5c26"), { scheme: "ror", value: "03yrm5c26" });
  assert.deepEqual(parseIdentifier("RRID:AB_2313773"), { scheme: "rrid", value: "AB_2313773" });
  assert.deepEqual(parseIdentifier("https://openalex.org/W2741809807"), { scheme: "openalex", value: "W2741809807" });
  assert.deepEqual(parseIdentifier("https://example.org/data.csv"), { scheme: "url", value: "https://example.org/data.csv" });
  // Bare digits are only a PMID when the scheme is named.
  assert.equal(parseIdentifier("31579114"), null);
  assert.deepEqual(parseIdentifier("31579114", "pmid"), { scheme: "pmid", value: "31579114" });
  assert.equal(parseIdentifier("not an identifier"), null);
  assert.equal(identifierUrl({ scheme: "doi", value: "10.1/x" }), "https://doi.org/10.1/x");
  assert.equal(identifierCurie({ scheme: "rrid", value: "AB_1" }), "RRID:AB_1");
  assert.deepEqual(
    mergeIdentifiers([{ scheme: "pmid", value: "1" }], [{ scheme: "doi", value: "10.1/X" }, { scheme: "doi", value: "10.1/x" }]).map(identifierCurie),
    ["doi:10.1/X", "pmid:1"],
  );
});

test("a card's facts say what it was read from, how, by whom, where and when", async () => {
  const { call } = await setup();
  const { units, paper } = await extracted(call);
  const claim = units.find((unit) => unit.base === "claim")!;
  assert.equal(claim.card.source?.how, "auto");
  assert.ok(claim.card.source?.by, "the model that read it is named");
  assert.equal(claim.card.source?.paper, paper.id);
  assert.ok(claim.card.source!.name.length > 0 && claim.card.source!.name.length <= 40, claim.card.source!.name);
  assert.equal(claim.card.authors.role, "paper");
  assert.ok(claim.card.authors.names.length > 0);
  assert.equal(claim.card.origin.kind, "here");
  assert.ok(claim.card.origin.name.length > 0);
  assert.ok(!Number.isNaN(new Date(claim.card.created).getTime()));
  assert.ok(claim.card.identifiers.some(({ scheme, value }) => scheme === "doi" && value === DOI.toLowerCase()), JSON.stringify(claim.card.identifiers));

  // A unit a person writes was read from nothing, and is credited to them.
  const made = await call("node.create", { title: "My own claim" } as never);
  assert.equal(made.card.source, undefined);
  assert.equal(made.card.authors.role, "maker");
  assert.deepEqual(made.card.identifiers, []);
});

test("the card fields a person shows are kept, in card order, and unknown ones are dropped", async () => {
  const { call } = await setup();
  assert.deepEqual((await call("prefs.get", {})).cardFields, ["source"]);
  const next = await call("prefs.set", { cardFields: ["identifiers", "source", "bogus" as never, "created"] });
  assert.deepEqual(next.cardFields, ["source", "created", "identifiers"]);
  assert.deepEqual((await call("prefs.set", { cardFields: [] })).cardFields, []);
  assert.deepEqual((await call("prefs.set", { cardFields: CARD_FIELD_IDS })).cardFields, CARD_FIELD_IDS);
});

test("a person can add and take away a unit's identifiers", async () => {
  const { call } = await setup();
  const made = await call("node.create", { title: "An antibody we used" } as never);
  const added = await call("unit.identify", { node: made.id, add: ["RRID:AB_2313773", "https://doi.org/10.5281/zenodo.123"] });
  assert.deepEqual(added.card.identifiers.map(identifierCurie), ["doi:10.5281/zenodo.123", "RRID:AB_2313773"]);
  const fewer = await call("unit.identify", { node: made.id, remove: [{ scheme: "doi", value: "10.5281/zenodo.123" }] });
  assert.deepEqual(fewer.card.identifiers.map(identifierCurie), ["RRID:AB_2313773"]);
  await assert.rejects(call("unit.identify", { node: made.id, add: ["just some words"] }), /isn't an identifier/);
});

test("looking a paper up keeps what the registries say, and sends only identifiers and the title", async () => {
  const { call, sent, core } = await setup();
  const { units, paper } = await extracted(call);
  const claim = units.find((unit) => unit.base === "claim")!;
  const before = await call("node.view", { id: claim.id });
  assert.equal(before.provenance.work?.target, "paper");
  assert.equal(before.provenance.work?.standing, undefined);

  const found = await call("work.lookup", { unit: claim.id });
  assert.equal(found.saved, true);
  assert.deepEqual(Object.keys(sent.looked[0]!).sort(), ["identifiers", "title"]);

  const record = core.graph().documents.get(paper.id) as PaperRecord;
  assert.equal(record.standing?.retracted, true);
  assert.equal(record.standing?.inbox, "https://repository.example.org/inbox");
  assert.deepEqual(record.standing?.services, ["crossref", "openalex"]);
  assert.equal(record.venue, "Seminars in Arthritis and Rheumatism");
  assert.equal(record.people?.[0]?.orcid, "0000-0002-1825-0097");
  // The paper's own title is never overwritten by a registry's.
  assert.notEqual(record.title, "A registry title");
  assert.deepEqual(record.identifiers?.map(({ scheme }) => scheme), ["pmid", "openalex"]);

  const after = await call("node.view", { id: claim.id });
  assert.equal(after.node.card.retracted, true);
  assert.ok(after.node.card.identifiers.some(({ scheme }) => scheme === "pmid"));
  assert.equal(after.provenance.work?.standing?.citedBy, 12);
});

test("an announcement is drafted for reading, and only sent when asked", async () => {
  const link: LabLink = { server: "http://lab.test/", id: "lab-1", name: "Lab", token: "t" };
  const { call, sent } = await setup(link);
  const { units } = await extracted(call);
  const claim = units.find((unit) => unit.base === "claim")!;

  const early = await call("notify.draft", { unit: claim.id });
  assert.equal(early.ready, false);
  assert.match((early as { why: string }).why, /Look the paper up first/);

  await call("work.lookup", { unit: claim.id });
  const draft = await call("notify.draft", { unit: claim.id });
  assert.ok(draft.ready);
  assert.equal(sent.notified.length, 0, "drafting sends nothing");
  const { notification, inbox } = draft as Extract<typeof draft, { ready: true }>;
  assert.equal(inbox, "https://repository.example.org/inbox");
  assert.deepEqual(notification.type, ["Announce", "coar-notify:RelationshipAction"]);
  assert.deepEqual(notification["@context"], ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"]);
  assert.match(notification.id, /^urn:uuid:/);
  assert.deepEqual(notification.origin, { id: "http://lab.test", inbox: "http://lab.test/v1/notify/inbox", type: "Service" });
  assert.deepEqual(notification.target, { id: "https://repository.example.org", inbox, type: "Service" });
  const object = notification.object as JsonObject;
  assert.equal(object.type, "Relationship");
  assert.equal(object["as:relationship"], RELATIONSHIPS.readFrom);
  assert.equal(object["as:object"], `https://doi.org/${DOI.toLowerCase()}`);
  assert.equal((notification.context as JsonObject)["ietf:cite-as"], `https://doi.org/${DOI.toLowerCase()}`);

  const done = await call("notify.send", { unit: claim.id, id: notification.id });
  assert.equal(done.status, 201);
  assert.equal(sent.notified.length, 1);
  assert.equal(sent.notified[0]!.inbox, inbox);
  assert.equal(sent.notified[0]!.notification.id, notification.id, "what was read is what is sent");
});

test("a notification follows each COAR Notify pattern", () => {
  const base = { actor: { id: "did:plc:me", name: "Me" }, origin: { id: "https://a.org", inbox: "https://a.org/inbox" }, target: { id: "https://b.org", inbox: "https://b.org/inbox" }, about: { id: "https://b.org/paper/1", citeAs: "https://doi.org/10.1/x" }, object: { id: "https://a.org/review/9", citeAs: "https://doi.org/10.2/review" } };
  const review = buildNotification({ ...base, pattern: "announce-review" });
  assert.deepEqual(review.type, ["Announce", "coar-notify:ReviewAction"]);
  assert.equal((review.object as JsonObject).id, "https://a.org/review/9");
  assert.equal((review.context as JsonObject).id, "https://b.org/paper/1");
  const request = buildNotification({ ...base, pattern: "request-endorsement" });
  assert.deepEqual(request.type, ["Offer", "coar-notify:EndorsementAction"]);
  // A request is about the work itself, so the work is the object.
  assert.equal((request.object as JsonObject).id, "https://b.org/paper/1");
  assert.equal(request.context, undefined);
});

test("a zip written here reads back, and the checksum matches the standard one", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const entries = [
    { path: "ro-crate-metadata.json", bytes: new TextEncoder().encode('{"a":1}') },
    { path: "papers/Ünïcode name.pdf", bytes: new Uint8Array([0, 1, 2, 255]) },
  ];
  const read = await unzip(zip(entries));
  assert.deepEqual(read.map(({ path }) => path), entries.map(({ path }) => path));
  assert.deepEqual([...read[1]!.bytes], [0, 1, 2, 255]);
  await assert.rejects(unzip(new Uint8Array([1, 2, 3])), /isn't a ZIP/);
});

test("a canvas exports as an RO-Crate that says everything a crate reader expects", async () => {
  const { call, saved } = await setup();
  const { paper, units } = await extracted(call);
  await call("work.lookup", { unit: units[0]!.id });
  const made = await call("crate.export", { canvas: paper.canvas, license: "https://creativecommons.org/licenses/by/4.0/" });
  assert.equal(made.version, "https://w3id.org/ro/crate/1.3");
  assert.match(made.name, /\.crate\.zip$/);
  const files = await unzip(bytesOf(saved().get(made.name)!));
  const paths = files.map(({ path }) => path);
  for (const expected of ["ro-crate-metadata.json", "ro-crate-preview.html", "discourse-graph.jsonld", "dg-records.jsonl", "datacite.json"]) assert.ok(paths.includes(expected), `${expected} in ${paths.join(", ")}`);
  assert.ok(paths.some((path) => path.endsWith(".canvas")));

  const metadata = JSON.parse(new TextDecoder().decode(files.find(({ path }) => path === "ro-crate-metadata.json")!.bytes)) as JsonObject;
  const { root, byId, graph } = readCrate(metadata);
  const context = metadata["@context"] as unknown[];
  assert.equal(context[0], "https://w3id.org/ro/crate/1.3/context");
  assert.deepEqual(byId.get("ro-crate-metadata.json")!.conformsTo, { "@id": "https://w3id.org/ro/crate/1.3" });
  assert.equal(root["@type"], "Dataset");
  for (const key of ["name", "description", "datePublished", "license", "author", "hasPart", "mentions", "citation"]) assert.ok(root[key] !== undefined, `root has ${key}`);
  assert.ok(!Number.isNaN(new Date(root.datePublished as string).getTime()));
  assert.equal((byId.get("https://creativecommons.org/licenses/by/4.0/") as JsonObject).name, "Creative Commons Attribution 4.0 International");

  // Every reference resolves inside the crate, and every payload file is described with its size and hash.
  const ids = new Set(graph.map((entity) => entity["@id"]));
  const dangling: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const id = (value as JsonObject)["@id"];
      if (typeof id === "string" && Object.keys(value).length === 1 && !ids.has(id) && !/^http:\/\/schema\.org\//.test(id) && !/^https:\/\/w3id\.org\/ro\/crate\//.test(id)) dangling.push(id);
    }
  };
  for (const entity of graph) for (const [key, value] of Object.entries(entity)) if (key !== "@id") walk(value);
  assert.deepEqual(dangling, []);
  for (const file of files.filter(({ path }) => !path.startsWith("ro-crate-"))) {
    const entity = byId.get(file.path.split("/").map(encodeURIComponent).join("/"))!;
    assert.ok(entity, `${file.path} is described`);
    assert.equal(entity.contentSize, String(file.bytes.length));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes as BufferSource))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    assert.equal(entity.sha256, digest);
    assert.ok([root.hasPart].flat().some((part) => (part as JsonObject)["@id"] === entity["@id"]));
  }

  // The paper is a cited article with its identifiers, its authors with ORCID iDs, and its retraction.
  const article = byId.get(`https://doi.org/${DOI.toLowerCase()}`)!;
  assert.equal(article["@type"], "ScholarlyArticle");
  assert.ok([root.citation].flat().some((item) => (item as JsonObject)["@id"] === article["@id"]));
  assert.equal(article.creativeWorkStatus, "Retracted");
  assert.ok(byId.has("https://orcid.org/0000-0002-1825-0097"));
  assert.ok(byId.has("https://ror.org/03yrm5c26"));
  const pmid = ([article.identifier].flat() as JsonObject[]).map((item) => byId.get(item["@id"] as string)!).find((item) => item.value === "pmid:29571540");
  assert.equal(pmid?.["@type"], "PropertyValue");

  // Claims and questions are schema.org's own; what schema.org lacks is defined in the crate.
  const claim = graph.find((entity) => entity["@type"] === "Claim")!;
  assert.ok(claim && (claim.isBasedOn as JsonObject)["@id"] === article["@id"]);
  const extra = context[1] as Record<string, string>;
  for (const [term, iri] of Object.entries(extra)) assert.equal((byId.get(iri) as JsonObject | undefined)?.name !== undefined, true, `${term} is defined`);
  // The run profile is named as a profile, and nothing is a list of one.
  for (const entity of graph) for (const [key, value] of Object.entries(entity)) assert.ok(key === "@type" || !Array.isArray(value) || value.length !== 1, `${entity["@id"]} ${key}`);
  assert.ok(root.publisher, "someone published it");
  const argued = graph.filter((entity) => "supports" in entity || "opposes" in entity || "addresses" in entity || "informs" in entity);
  assert.ok(argued.length > 0, "arguments are carried");

  const datacite = JSON.parse(new TextDecoder().decode(files.find(({ path }) => path === "datacite.json")!.bytes)) as { data: { attributes: JsonObject } };
  assert.deepEqual((datacite.data.attributes.relatedIdentifiers as JsonObject[])[0], { relatedIdentifier: DOI.toLowerCase(), relatedIdentifierType: "DOI", relationType: "IsDerivedFrom", resourceTypeGeneral: "JournalArticle" });
  assert.match(new TextDecoder().decode(files.find(({ path }) => path === "ro-crate-preview.html")!.bytes), /<h1>/);
});

test("a crate made here comes back whole in another space, and twice makes nothing new", async () => {
  const first = await setup();
  const { paper, view } = await extracted(first.call);
  const made = await first.call("crate.export", { canvas: paper.canvas, format: "eln" });
  assert.match(made.name, /\.eln$/);
  const archive = first.saved().get(made.name)!;
  const inside = await unzip(bytesOf(archive));
  const folder = `${slugOf(made.name.replace(/\.eln$/, ""))}/`;
  assert.ok(inside.every(({ path }) => path.startsWith(folder)), "an .eln holds one folder");
  const metadata = JSON.parse(new TextDecoder().decode(inside.find(({ path }) => path.endsWith("ro-crate-metadata.json"))!.bytes)) as JsonObject;
  assert.equal((metadata["@context"] as unknown[])[0], "https://w3id.org/ro/crate/1.2/context");
  assert.ok(readCrate(metadata).byId.get("ro-crate-metadata.json")!.sdPublisher);

  const store = createMemoryStore();
  const second = await setup(null, store);
  const { host } = createMemoryHost({ store });
  const kept = await host.writeAsset({ asset: { name: made.name, mime: "application/zip", dataUrl: `data:application/zip;base64,${archive}` } });
  assert.ok(kept.ok);
  const read = await second.call("crate.import", { ref: kept.value.ref });
  assert.equal(read.kind, "own");
  assert.equal(read.units, Object.keys(view.nodes).length);
  assert.equal(read.fresh, read.units);
  const back = await second.call("canvas.open", { id: read.canvas! });
  assert.deepEqual(Object.values(back.nodes).map(({ title }) => title).sort(), Object.values(view.nodes).map(({ title }) => title).sort());
  assert.equal(back.items.filter(({ item }) => "fromNode" in item).length, view.items.filter(({ item }) => "fromNode" in item).length);
  assert.equal((await second.call("crate.import", { ref: kept.value.ref })).fresh, 0);
});

const FOREIGN = {
  "@context": "https://w3id.org/ro/crate/1.1/context",
  "@graph": [
    { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" }, about: { "@id": "./" } },
    {
      "@id": "./",
      "@type": "Dataset",
      name: "Variant calling run",
      datePublished: "2024-05-01",
      conformsTo: { "@id": "https://w3id.org/ro/wfrun/process/0.5" },
      hasPart: [{ "@id": "calls.vcf" }, { "@id": "reads.fastq" }, { "@id": "notes.txt" }],
      mentions: [{ "@id": "#run-1" }],
      citation: [{ "@id": "https://doi.org/10.1000/method" }],
    },
    { "@id": "https://doi.org/10.1000/method", "@type": "ScholarlyArticle", name: "The method paper" },
    { "@id": "https://github.com/example/caller", "@type": "SoftwareApplication", name: "caller", version: "2.1.0", codeRepository: "https://github.com/example/caller" },
    {
      "@id": "#run-1",
      "@type": "CreateAction",
      name: "Call variants",
      instrument: { "@id": "https://github.com/example/caller" },
      object: [{ "@id": "reads.fastq" }, { "@id": "#depth" }],
      result: { "@id": "calls.vcf" },
      agent: { "@id": "https://orcid.org/0000-0002-1825-0097" },
      startTime: "2024-04-30T10:00:00+02:00",
      endTime: "2024-04-30T11:00:00+02:00",
      actionStatus: { "@id": "http://schema.org/CompletedActionStatus" },
    },
    { "@id": "#depth", "@type": "PropertyValue", name: "min_depth", value: "10" },
    { "@id": "https://orcid.org/0000-0002-1825-0097", "@type": "Person", name: "Ada Example" },
    { "@id": "calls.vcf", "@type": "File", name: "Variant calls", encodingFormat: "text/x-vcf", contentSize: "2048" },
    { "@id": "reads.fastq", "@type": "File", name: "Reads", contentSize: "999" },
    { "@id": "notes.txt", "@type": "File", name: "Notes", encodingFormat: "text/plain" },
  ],
};

test("another tool's run crate becomes a run with its code, inputs and outputs", async () => {
  const { call, core, store } = await setup();
  const { host } = createMemoryHost({ store });
  const json = btoa(JSON.stringify(FOREIGN));
  const kept = await host.writeAsset({ asset: { name: "ro-crate-metadata.json", mime: "application/json", dataUrl: `data:application/json;base64,${json}` } });
  assert.ok(kept.ok);
  const read = await call("crate.import", { ref: kept.value.ref });
  assert.equal(read.kind, "foreign");
  assert.equal(read.units, 6);
  assert.equal(read.fresh, 6);
  const view = await call("canvas.open", { id: read.canvas! });
  const byTitle = new Map(Object.values(view.nodes).map((node) => [node.title, node]));
  assert.deepEqual([...byTitle.values()].map(({ base }) => base).sort(), ["code", "output", "output", "output", "run", "source"]);
  const nodes = [...core.graph().documents.values()].filter((record): record is NodeRecord => record.kind === "node");
  const run = nodes.find((node) => node.title === "Call variants")!;
  const code = nodes.find((node) => node.title === "caller")!;
  const calls = nodes.find((node) => node.title === "Variant calls")!;
  const reads = nodes.find((node) => node.title === "Reads")!;
  assert.equal(run.facts?.status, "completed");
  assert.equal(run.facts?.startedAt, "2024-04-30T08:00:00.000Z");
  assert.deepEqual(run.facts?.agents, ["0000-0002-1825-0097"]);
  assert.deepEqual(run.facts?.parameterValues, { min_depth: "10" });
  assert.deepEqual(run.prov?.instrument, [{ uri: code.id }]);
  assert.deepEqual(run.prov?.used, [{ uri: reads.id }]);
  assert.equal(calls.prov?.generatedBy, run.id);
  assert.equal(calls.facts?.mediaType, "text/x-vcf");
  assert.equal(calls.facts?.size, 2048);
  assert.equal(code.facts?.commit, "2.1.0");
  assert.equal(nodes.find((node) => node.title === "The method paper")?.facts?.doi, "10.1000/method");
  assert.equal(run.facts?.provenance?.method, "imported");
  // The card says it arrived in a file.
  assert.equal(byTitle.get("Call variants")!.card.origin.kind, "here");

  const method = await call("process.run", { id: run.id } as never).catch(() => null);
  assert.ok(method === null || typeof method === "object");
  assert.equal((await call("crate.import", { ref: kept.value.ref })).fresh, 0, "the same crate twice makes nothing new");
});

test("a crate plan refuses what isn't a crate", () => {
  assert.throws(() => readCrate({ nodes: [] }), /isn't an RO-Crate/);
  assert.throws(() => planCrateImport({ metadata: { "@graph": [] }, graph: { documents: new Map(), relations: new Map(), withdrawn: new Set() } as never, types: {}, stamp: { space: "s", by: { id: "a", name: "A" } } }), /no root dataset/);
});

test("DataCite metadata names the creators and what the crate rests on", () => {
  const { data } = toDataCite({
    title: "T",
    description: "D",
    creators: [{ name: "Ada Example", orcid: "0000-0002-1825-0097", affiliation: "Lab" }],
    publisher: "Lab",
    published: "2026-11-12T00:00:00.000Z",
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
    derivedFrom: [{ scheme: "doi", value: "10.1/a" }],
    references: [{ scheme: "arxiv", value: "2010.14967" }, { scheme: "rrid", value: "AB_1" }],
    software: [{ scheme: "url", value: "https://github.com/x/y" }],
    subjects: ["Discourse graph"],
  }) as { data: { attributes: Record<string, unknown> } };
  const attributes = data.attributes;
  assert.equal(attributes.publicationYear, 2026);
  assert.deepEqual((attributes.relatedIdentifiers as JsonObject[]).map((item) => `${item.relationType} ${item.relatedIdentifierType}`), ["IsDerivedFrom DOI", "References arXiv", "Requires URL"]);
  assert.equal(((attributes.creators as JsonObject[])[0]!.nameIdentifiers as JsonObject[])[0]!.nameIdentifierScheme, "ORCID");
  assert.equal(PROCESS_RUN_CRATE.id, "https://w3id.org/ro/wfrun/process/0.6");
});
