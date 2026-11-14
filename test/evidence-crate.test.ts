import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { JsonObject, NodeRecord } from "@dg/contract/records.ts";
import { readCrate } from "@dg/core/crate.ts";
import { isMiraDocument, miraEntities } from "@dg/core/mira.ts";
import { unzip } from "@dg/core/zip.ts";
import { toZenodo } from "@dg/core/zenodo.ts";
import { makeCore } from "./support.ts";

// The real EVD 1 bundle's two metadata files, from DiscourseGraphs/MATSUlab-issue-exchange-analysis (CC BY 4.0).
const BUNDLE = "test/fixtures/matsulab-evd1";
const CRATE = readFileSync(`${BUNDLE}/ro-crate-metadata.json`, "utf8");
const EVIDENCE = readFileSync(`${BUNDLE}/evidence.jsonld`, "utf8");

type Deposits = { opened: { server: string; token: string; metadata: Record<string, unknown> }[]; uploaded: { bucket: string; token: string; name: string; bytes: Uint8Array }[] };

const setup = async () => {
  const files = new Map<string, string>();
  const deposits: Deposits = { opened: [], uploaded: [] };
  const kept = new Map<string, string>();
  const secrets: SecretStore = { kind: "plain", get: async (id) => kept.get(id) ?? null, set: async (id, value) => void (value === null ? kept.delete(id) : kept.set(id, value)) };
  const { core, call, store, host, nodes } = await makeCore({
    wrap: (host) => ({ ...host, saveFile: async ({ name, dataBase64 }) => (files.set(name, dataBase64), { ok: true as const, value: { where: `saved/${name}` } }) }),
    services: {
      notifications: async () => [],
      deposit: {
        open: async (args: Deposits["opened"][number]) => {
          deposits.opened.push(args);
          return { id: "1", bucket: `${args.server}/api/files/bucket-1`, page: `${args.server}/deposit/1`, doi: "10.5072/zenodo.1" };
        },
        upload: async (args: Deposits["uploaded"][number]) => {
          deposits.uploaded.push(args);
          return { size: args.bytes.length };
        },
      },
    } as never,
    secrets,
  });
  const put = async (name: string, mime: string, body: string | Uint8Array): Promise<string> => {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const made = await host.writeAsset({ asset: { name, mime, dataUrl: `data:${mime};base64,${btoa(binary)}` } });
    assert.ok(made.ok);
    return made.value.ref;
  };
  return { core, call, store, put, nodes, saved: () => files, deposits, kept };
};

const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const metadataIn = async (archive: Uint8Array): Promise<{ files: { path: string; bytes: Uint8Array }[]; metadata: JsonObject }> => {
  const files = await unzip(archive);
  return { files, metadata: JSON.parse(new TextDecoder().decode(files.find(({ path }) => path === "ro-crate-metadata.json")!.bytes)) as JsonObject };
};
const typesOf = (entity: JsonObject): string[] => [entity["@type"]].flat().map(String);
const idOf = (value: unknown): string => String((value as JsonObject)["@id"]);

test("a MIRA graph is recognised and read under a crate's names", () => {
  const doc = JSON.parse(EVIDENCE) as JsonObject;
  assert.ok(isMiraDocument(doc));
  assert.ok(!isMiraDocument(JSON.parse(CRATE)));
  const byId = new Map(miraEntities(doc).map((entity) => [entity["@id"], entity]));
  assert.deepEqual(byId.get("#evidence")!["@type"], ["mira:Evidence"]);
  assert.deepEqual(byId.get("#study")!["@type"], ["mira:Study"]);
  assert.equal(byId.get("#study")!.startTime, "2026-01-25");
  assert.equal(byId.get("#observation")!.name, "29% of MATSUlab issues (n=445) were claimed as experiments.");
  // Packaging words say nothing about what kind of unit a thing is.
  assert.equal(byId.get("README.md")!["@type"], undefined);
});

test("a MATSUlab evidence bundle comes in as evidence, the study that grounds it, its protocol, code and files", async () => {
  const { call, put, nodes } = await setup();
  await put("evidence.jsonld", "application/ld+json", EVIDENCE);
  const ref = await put("ro-crate-metadata.json", "application/json", CRATE);
  const read = await call("crate.import", { ref });
  assert.equal(read.kind, "foreign");
  const view = await call("canvas.open", { id: read.canvas! });
  const count = (base: string): number => Object.values(view.nodes).filter((node) => node.base === base).length;
  assert.deepEqual(
    { evidence: count("evidence"), run: count("run"), protocol: count("protocol"), source: count("source"), code: count("code"), output: count("output"), claim: count("claim") },
    { evidence: 1, run: 1, protocol: 1, source: 1, code: 4, output: 10, claim: 0 },
  );
  const all = nodes();
  const titled = (title: string): NodeRecord => all.find((node) => node.title === title)!;
  // What was observed is the evidence's title. It never becomes a claim of its own.
  const evidence = titled("29% of MATSUlab issues (n=445) were claimed as experiments.");
  const run = titled("@analysis/quantify issue claiming from MATSUlab");
  const protocol = titled("Discourse graph conversion rate analysis");
  const source = titled("Narrative post describing the MATSUlab discourse graph analysis");
  const data = titled("Conversion Rate Data");
  const figure = titled("Figure 1: Issue Conversion Rate (static)");
  assert.ok(evidence && run && protocol && source && data && figure);
  assert.deepEqual(evidence.prov?.observationBase?.map(({ uri }) => uri).sort(), [data.id, titled("Issue Timeline Data").id].sort());
  assert.equal(evidence.prov?.isGroundedIn, run.id);
  // The person who made the finding stays its maker, with their ORCID iD. The importer only brought it in.
  assert.deepEqual(evidence.facts?.creators, [{ name: "Matt Akamatsu", orcid: "0000-0002-0286-5310" }]);
  assert.equal(evidence.prov?.sourceDocument, source.id);
  assert.equal(run.prov?.follows?.uri, protocol.id);
  assert.equal(run.prov?.instrument?.length, 4, "the four scripts ran");
  // The raw exports aren't in the bundle. They are still named, as inputs with no bytes behind them.
  const raw = titled("akamatsulab-whole-graph-2026-02-13-22-24-27.json (raw input, not included in this repository)");
  assert.equal(run.prov?.used?.length, 3);
  assert.ok(run.prov?.used?.some(({ uri }) => uri === raw.id));
  assert.equal(raw.facts?.cid, undefined);
  assert.equal(raw.facts?.uri, undefined);
  assert.equal(run.facts?.startedAt, "2026-01-25T00:00:00.000Z");
  assert.deepEqual(run.facts?.agents, ["0000-0002-0286-5310", "Claude (Anthropic)"]);
  assert.equal(figure.prov?.generatedBy, run.id);
  assert.equal(figure.facts?.outputKind, "figure");
  assert.match(figure.facts?.caption ?? "", /^Figure 1\./);
  assert.deepEqual(source.prov?.describesActivity, [run.id]);
  assert.equal(source.facts?.uri, "https://experiment.com/u/Hd2AYg");
  const script = titled("Metric calculation and data merging");
  assert.equal(script.facts?.repo, "https://github.com/DiscourseGraphs/MATSUlab-issue-exchange-analysis");
  assert.equal(script.facts?.path, "src/calculate_metrics.py");
  assert.equal(script.facts?.commit, undefined, "a branch name is not a version");
  assert.equal(script.facts?.language, "python");
  // The bundle's own notes and metadata files are packaging, not results.
  assert.ok(!all.some((node) => /Methods Excerpt|Evidence Bundle Metadata/.test(node.title)));
  const again = await call("crate.import", { ref });
  assert.equal(again.fresh, 0, "the same bundle twice makes nothing new");
  assert.equal(again.canvas, read.canvas, "and opens the canvas it already has");
});

test("the bundle goes back out as one graph a MIRA reader and a crate reader both understand", async () => {
  const { call, put, saved } = await setup();
  await put("evidence.jsonld", "application/ld+json", EVIDENCE);
  const read = await call("crate.import", { ref: await put("ro-crate-metadata.json", "application/json", CRATE) });
  const made = await call("crate.export", { canvas: read.canvas!, license: "https://creativecommons.org/licenses/by/4.0/" });
  const { files, metadata } = await metadataIn(bytesOf(saved().get(made.name)!));
  const { graph, byId, root } = readCrate(metadata);
  const context = metadata["@context"] as [string, Record<string, string>];
  assert.equal(context[1].mira, "http://purl.org/mira-science/mira#");
  assert.ok(byId.get("http://purl.org/mira-science/mira#")?.name, "the schema is named in the crate");

  const evidence = graph.find((entity) => typesOf(entity).includes("mira:Evidence"))!;
  assert.deepEqual(typesOf(evidence), ["CreativeWork", "Evidence", "mira:Evidence"]);
  assert.equal(idOf(evidence.creator), "https://orcid.org/0000-0002-0286-5310");
  assert.equal(byId.get("https://orcid.org/0000-0002-0286-5310")!.name, "Matt Akamatsu");
  assert.ok(evidence.contributor, "whoever brought it in is named as a contributor");
  const statement = byId.get(idOf(evidence["mira:observationStatement"]))!;
  assert.deepEqual(statement["@type"], ["CreativeWork", "mira:Claim"]);
  assert.equal(statement.name, evidence.name);
  const study = byId.get(idOf(evidence["mira:is_grounded_in"]))!;
  assert.deepEqual(typesOf(study), ["CreateAction", "mira:Study"]);
  assert.equal(idOf(study["mira:grounds"]), evidence["@id"]);
  assert.ok(typesOf(byId.get(idOf(study["mira:follows"]))!).includes("mira:Protocol"));
  assert.equal(([evidence["mira:observationBase"]].flat() as JsonObject[]).length, 2);
  const document = byId.get(idOf(evidence["mira:sourceDocument"]))!;
  assert.ok(typesOf(document).includes("mira:SourceDocument"));
  assert.equal(idOf(document["mira:describesActivity"]), study["@id"]);
  // Nothing is a list of one, and every reference lands on something in the crate.
  for (const entity of graph) for (const [key, value] of Object.entries(entity)) assert.ok(key === "@type" || !Array.isArray(value) || value.length !== 1, `${entity["@id"]} ${key}`);

  // The README tells the finding, and is described like every other file.
  const readme = new TextDecoder().decode(files.find(({ path }) => path === "README.md")!.bytes);
  assert.match(readme, /## Findings/);
  assert.match(readme, /### 29% of MATSUlab issues \(n=445\) were claimed as experiments\./);
  assert.match(readme, /\*\*Produced by:\*\* @analysis\/quantify issue claiming from MATSUlab \(2026-01-25 to 2026-02-14\)/);
  assert.match(readme, /Followed Discourse graph conversion rate analysis/);
  assert.match(readme, /Used MATSUlab discourse graph \(cited, not in this crate\)/);
  assert.match(readme, /Automated pipeline parsing JSON-LD and Roam JSON exports/, "the method is told in words");
  const described = byId.get("README.md")!;
  assert.equal(described.contentSize, String(new TextEncoder().encode(readme).length));
  assert.ok([root.hasPart].flat().some((part) => idOf(part) === "README.md"));
});

const SMALL = {
  "@context": "https://w3id.org/ro/crate/1.1/context",
  "@graph": [
    { "@id": "ro-crate-metadata.json", "@type": "CreativeWork", conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" }, about: { "@id": "./" } },
    { "@id": "./", "@type": "Dataset", name: "Counts", datePublished: "2026-03-01", hasPart: [{ "@id": "counts.csv" }] },
    { "@id": "counts.csv", "@type": "File", name: "The counts", encodingFormat: "text/csv" },
    { "@id": "#run", "@type": "CreateAction", name: "Count them", result: { "@id": "counts.csv" } },
    { "@id": "#finding", "@type": ["CreativeWork", "mira:Evidence"], name: "There were twelve", "mira:observationBase": { "@id": "counts.csv" }, "mira:is_grounded_in": { "@id": "#run" }, "mira:supports": { "@id": "#claim" } },
    { "@id": "#claim", "@type": "Claim", name: "Twelve is typical" },
  ],
};

test("files a crate names are hashed on the way in, packed on the way out, and left out once they change", async () => {
  const { call, put, nodes, saved, store, core } = await setup();
  const file = await put("counts.csv", "text/csv", "n\n12\n");
  const read = await call("crate.import", { ref: await put("ro-crate-metadata.json", "application/json", JSON.stringify(SMALL)) });
  assert.equal(read.hashed, 1);
  assert.equal(read.relations, 1, "the argument came with it");
  const output = nodes().find((node) => node.title === "The counts")!;
  const evidence = nodes().find((node) => node.title === "There were twelve")!;
  const claim = nodes().find((node) => node.title === "Twelve is typical")!;
  assert.match(output.facts?.cid ?? "", /^bafkrei/);
  assert.equal(output.facts?.size, 5);
  assert.equal(output.facts?.locator?.path, "counts.csv");
  // Evidence pins the bytes it rests on, not only the unit.
  assert.deepEqual(evidence.prov?.observationBase, [{ uri: output.id, cid: output.facts!.cid! }]);
  assert.ok([...core.graph().relations.values()].some(({ record, state }) => state === "active" && record.source === evidence.id && record.target === claim.id));

  const made = await call("crate.export", { canvas: read.canvas! });
  assert.equal(made.outputs, 1);
  assert.equal(made.changed, 0);
  const { files, metadata } = await metadataIn(bytesOf(saved().get(made.name)!));
  assert.equal(new TextDecoder().decode(files.find(({ path }) => path === "outputs/counts.csv")!.bytes), "n\n12\n");
  const { byId } = readCrate(metadata);
  const packed = byId.get("outputs/counts.csv")!;
  assert.ok(typesOf(packed).includes("File"));
  assert.equal(packed.contentIdentifier, output.facts!.cid);
  assert.match(String(packed.sha256), /^[0-9a-f]{64}$/);
  const finding = [...byId.values()].find((entity) => typesOf(entity).includes("mira:Evidence"))!;
  assert.equal(idOf(finding.observationBase), "outputs/counts.csv");
  assert.equal(idOf(finding["mira:supports"]), idOf(finding.supports));

  // The file is edited after the fact: the crate won't pass the new bytes off as the result on record.
  store.assets.set(file, { name: "counts.csv", mime: "text/csv", dataUrl: `data:text/csv;base64,${btoa("n\n13\n")}` });
  const again = await call("crate.export", { canvas: read.canvas! });
  assert.equal(again.outputs, 0);
  assert.equal(again.changed, 1);
  // Asked not to, it packs none.
  assert.equal((await call("crate.export", { canvas: read.canvas!, outputs: false })).changed, 0);
});

test("a crate goes to Zenodo as a draft that carries its reserved DOI, and is never published from here", async () => {
  const { call, put, deposits, saved, kept } = await setup();
  await put("counts.csv", "text/csv", "n\n12\n");
  const read = await call("crate.import", { ref: await put("ro-crate-metadata.json", "application/json", JSON.stringify(SMALL)) });
  await assert.rejects(call("crate.deposit", { canvas: read.canvas!, sandbox: true }), /Add a token for Zenodo's sandbox first/);
  assert.equal(deposits.opened.length, 0);

  const settings = await call("deposit.configure", { sandbox: true, token: "  secret-token-abcd  " });
  assert.deepEqual(settings.sandbox, { kept: true, hint: "abcd" });
  assert.deepEqual(settings.live, { kept: false });
  assert.ok(!JSON.stringify(settings).includes("secret-token"), "the token is never sent back");
  assert.equal(kept.get("discourse-graphs-zenodo-sandbox"), "secret-token-abcd");

  const made = await call("crate.deposit", { canvas: read.canvas!, sandbox: true, license: "https://creativecommons.org/licenses/by/4.0/" });
  assert.equal(made.page, "https://sandbox.zenodo.org/deposit/1");
  assert.equal(made.doi, "10.5072/zenodo.1");
  assert.equal(deposits.opened.length, 1);
  assert.equal(deposits.opened[0]!.server, "https://sandbox.zenodo.org");
  const form = deposits.opened[0]!.metadata;
  assert.equal(form.upload_type, "dataset");
  assert.equal(form.prereserve_doi, true);
  assert.equal(form.license, "cc-by-4.0");
  assert.equal(deposits.uploaded.length, 1);
  assert.equal(deposits.uploaded[0]!.bucket, "https://sandbox.zenodo.org/api/files/bucket-1");
  // What was sent is what was saved, and it names the DOI Zenodo reserved for it.
  assert.deepEqual([...deposits.uploaded[0]!.bytes], [...bytesOf(saved().get(made.name)!)]);
  const { files, metadata } = await metadataIn(deposits.uploaded[0]!.bytes);
  assert.equal(readCrate(metadata).root.identifier, "https://doi.org/10.5072/zenodo.1");
  const datacite = JSON.parse(new TextDecoder().decode(files.find(({ path }) => path === "datacite.json")!.bytes)) as { data: { attributes: JsonObject } };
  assert.equal(datacite.data.attributes.doi, "10.5072/zenodo.1");
  assert.match(new TextDecoder().decode(files.find(({ path }) => path === "README.md")!.bytes), /Cite as: .*https:\/\/doi\.org\/10\.5072\/zenodo\.1/);
  const after = await call("deposit.settings", {});
  assert.equal(after.drafts.length, 1);
  assert.equal(after.drafts[0]!.page, made.page);

  await call("deposit.configure", { sandbox: true, token: null });
  assert.deepEqual((await call("deposit.settings", {})).sandbox, { kept: false });
});

test("Zenodo's form gets names family first, a license by its id, and what the crate rests on", () => {
  const form = toZenodo({
    title: "A crate",
    description: "Units <and> files",
    creators: [{ name: "Ada B. Example", orcid: "0000-0002-1825-0097", affiliation: "Example Lab" }, { name: "Plato" }],
    publisher: "Example Lab",
    published: "2026-11-13T10:00:00.000Z",
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
    derivedFrom: [{ scheme: "doi", value: "10.1000/paper" }],
    references: [{ scheme: "pmid", value: "123" }],
    software: [{ scheme: "url", value: "https://github.com/example/code" }],
    subjects: ["Discourse graph"],
  });
  assert.deepEqual(form.creators, [{ name: "Example, Ada B.", orcid: "0000-0002-1825-0097", affiliation: "Example Lab" }, { name: "Plato" }]);
  assert.equal(form.license, "cc0-1.0");
  assert.equal(form.publication_date, "2026-11-13");
  assert.match(String(form.description), /Units &lt;and&gt; files/);
  assert.deepEqual(form.related_identifiers, [
    { identifier: "10.1000/paper", relation: "isDerivedFrom", resource_type: "publication-article" },
    { identifier: "pmid:123", relation: "references" },
    { identifier: "https://github.com/example/code", relation: "requires", resource_type: "software" },
  ]);
  // With no license chosen, none is claimed: Zenodo asks for one before it will publish.
  assert.equal("license" in toZenodo({ title: "x", description: "", creators: [], publisher: "", published: "2026-01-01", derivedFrom: [], references: [], software: [], subjects: [] }), false);
});
