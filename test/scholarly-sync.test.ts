import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServices } from "@dg/sync/client.ts";
import { createScholarly, parseLinkHeader } from "@dg/sync/scholarly.ts";
import type { Notification, NotificationSummary } from "@dg/contract/scholarly.ts";

/** Trimmed copies of what the public services really answered, with no abstracts or full text. */
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/scholarly/${name}`, import.meta.url), "utf8");

const CARROLL = "10.1063/5.0038163";
const GAUTHIER = "10.1038/s41467-021-25801-2";
const ARXIV = "10.48550/arxiv.2010.14967";
const RETRACTED = "10.1177/1758835919874651";
const ZENODO = "10.5281/zenodo.21752615";
const ZENODO_PAGE = "https://zenodo.org/records/21752615";

type Route = string | (() => Response | Promise<Response>) | { status: number } | { fixture: string; headers?: Record<string, string> };
type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

const json = (body: string, status = 200): Response => new Response(body, { status, headers: { "content-type": "application/json" } });
const at = (response: Response, url: string): Response => Object.defineProperty(response, "url", { value: url });

/** A stand-in for the network: answers by exact address, and 404s anything it wasn't told about. */
const network = (routes: Record<string, Route>) => {
  const calls: Call[] = [];
  const send = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, ...(typeof init.body === "string" ? { body: init.body } : {}) });
    const route = routes[`${method} ${url}`] ?? routes[url];
    if (route === undefined) return new Response("", { status: 404 });
    if (typeof route === "function") return route();
    if (typeof route === "string") return json(route);
    if ("status" in route) return new Response("", { status: route.status });
    return new Response(fixture(route.fixture), { headers: route.headers ?? { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { send, calls, asked: (part: string) => calls.filter(({ url }) => url.includes(part)) };
};

const agency = (doi: string, name: string): Record<string, Route> => ({ [`https://doi.org/doiRA/${doi}`]: JSON.stringify([{ DOI: doi, RA: name }]) });
const esummary = (pmid: string): string => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
const idconv = (doi: string): string => `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=${encodeURIComponent(doi)}&format=json`;

const carroll = (): Record<string, Route> => ({
  ...agency(CARROLL, "Crossref"),
  [`https://api.crossref.org/works/${CARROLL}`]: { fixture: "crossref-carroll.json" },
  [`https://api.openalex.org/works/doi:${CARROLL}`]: { fixture: "openalex-carroll.json" },
  [esummary("33380041")]: { fixture: "pubmed-carroll.json" },
  // The publisher's page refuses programs, as it does in life.
  [`https://doi.org/${CARROLL}`]: { status: 403 },
});

const service = (name: string, services: { name: string; ok: boolean; problem?: string }[]) => services.find((entry) => entry.name === name);

test("a Crossref DOI is read from Crossref, OpenAlex and PubMed, and never from DataCite", async () => {
  const { send, asked } = network(carroll());
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: CARROLL }] });

  assert.equal(work.agency, "crossref");
  assert.equal(asked("api.crossref.org").length, 1);
  assert.equal(asked("api.datacite.org").length, 0);
  assert.equal(work.title, "Do reservoir computers work best at the edge of chaos?");
  assert.equal(work.venue, "Chaos: An Interdisciplinary Journal of Nonlinear Science");
  assert.equal(work.published, "2020-12-01");
  assert.equal(work.volume, "30");
  assert.equal(work.issue, "12");
  assert.equal(work.pages, "121109");
  assert.equal(work.type, "ScholarlyArticle");
  assert.equal(work.retracted, undefined);
  assert.deepEqual(work.openAccess, { status: "green", url: "https://arxiv.org/pdf/2012.01409" });
  assert.ok(work.references?.includes("10.1016/0167-2789(90)90064-v"));
  assert.ok(work.subjects?.includes("Neural Networks and Reservoir Computing"));
  // OpenAlex knew the PMID, so PubMed was asked directly and the converter never was.
  assert.equal(asked("idconv").length, 0);
  assert.deepEqual(work.identifiers, [
    { scheme: "doi", value: CARROLL },
    { scheme: "pmid", value: "33380041" },
    { scheme: "openalex", value: "W3107601746" },
  ]);
  assert.ok(!Number.isNaN(Date.parse(work.checkedAt)));
  assert.equal(new Date(work.checkedAt).toISOString(), work.checkedAt);
});

test("each field says which service it came from, and the registry wins what the publisher deposited", async () => {
  const { send } = network(carroll());
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: CARROLL }] });

  for (const field of ["title", "authors", "venue", "published", "volume", "issue", "pages", "type", "references", "agency"] as const) {
    assert.equal(work.from[field], "crossref", field);
  }
  for (const field of ["openAccess", "citedBy", "subjects"] as const) assert.equal(work.from[field], "openalex", field);
  // OpenAlex counts citations its own way, and its number is the one kept.
  const openalexCount = (JSON.parse(fixture("openalex-carroll.json")) as { cited_by_count: number }).cited_by_count;
  const crossrefCount = (JSON.parse(fixture("crossref-carroll.json")) as { message: { "is-referenced-by-count": number } }).message["is-referenced-by-count"];
  assert.notEqual(openalexCount, crossrefCount);
  assert.equal(work.citedBy, openalexCount);
  // The author is Crossref's, once, with the ROR that only OpenAlex had.
  assert.deepEqual(work.authors, [
    {
      name: "T. L. Carroll",
      given: "T. L.",
      family: "Carroll",
      orcid: "0000-0002-2371-2049",
      affiliations: [{ name: "U.S. Naval Research Lab , Washington, DC 20375, USA", ror: "04d23a975" }],
    },
  ]);
});

test("OpenAlex fills authors' ORCID and affiliation gaps without adding or reordering anyone", async () => {
  const { send, asked } = network({
    ...agency(GAUTHIER, "Crossref"),
    [`https://api.crossref.org/works/${GAUTHIER}`]: { fixture: "crossref-gauthier.json" },
    [`https://api.openalex.org/works/doi:${GAUTHIER}`]: { fixture: "openalex-gauthier.json" },
    [esummary("34548491")]: { fixture: "pubmed-gauthier.json" },
  });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: GAUTHIER }] });

  assert.deepEqual(work.authors?.map(({ name }) => name), ["Daniel J. Gauthier", "Erik Bollt", "Aaron Griffith", "Wendson A. S. Barbosa"]);
  assert.equal(work.authors?.[0]?.orcid, "0000-0002-4473-217X");
  assert.deepEqual(work.authors?.[1]?.affiliations, [{ name: "Clarkson University", ror: "03rwgpn18" }]);
  assert.equal(work.license, "https://creativecommons.org/licenses/by/4.0");
  assert.equal(work.pages, "5564");
  // OpenAlex writes the PMCID as a link ending in bare digits.
  assert.deepEqual(
    work.identifiers.filter(({ scheme }) => scheme !== "doi"),
    [
      { scheme: "pmid", value: "34548491" },
      { scheme: "pmcid", value: "PMC8455577" },
      { scheme: "openalex", value: "W3170977978" },
    ],
  );
  // The landing page had nothing to say, and that is told rather than thrown.
  assert.equal(service("signposting", work.services)?.ok, false);
  assert.equal(asked("api.datacite.org").length, 0);
});

test("an arXiv identifier implies its DataCite DOI, and DataCite holds the record", async () => {
  const { send, asked } = network({
    ...agency(ARXIV, "DataCite"),
    [`https://api.datacite.org/dois/${ARXIV}`]: { fixture: "datacite-arxiv.json" },
    [`https://api.openalex.org/works/doi:${ARXIV}`]: { fixture: "openalex-arxiv.json" },
    [idconv(ARXIV)]: JSON.stringify({ status: "ok", records: [{ doi: ARXIV, status: "error", errmsg: "Identifier not found in PMC" }] }),
  });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "arxiv", value: "2010.14967v2" }] });

  assert.equal(work.agency, "datacite");
  assert.equal(asked("api.crossref.org").length, 0);
  assert.equal(work.from.title, "datacite");
  assert.equal(work.title, "Construction of quasimodes for non-selfadjoint operators via propagation of Hagedorn wave-packets");
  // DataCite's author, once, with the ORCID and affiliation only OpenAlex had.
  assert.deepEqual(work.authors, [
    { name: "Víctor Arnaiz", given: "Víctor", family: "Arnaiz", orcid: "0000-0002-3390-0596", affiliations: [{ name: "Université Paris-Saclay", ror: "03xjwb503" }] },
  ]);
  assert.equal(work.venue, "arXiv");
  assert.equal(work.published, "2020-10-28");
  assert.equal(work.type, "ScholarlyArticle");
  assert.equal(work.license, "http://arxiv.org/licenses/nonexclusive-distrib/1.0/");
  // OpenAlex answered with the journal version: its DOI is noted as another version, not taken as this work's.
  assert.deepEqual(work.identifiers, [
    { scheme: "doi", value: ARXIV },
    { scheme: "arxiv", value: "2010.14967v2" },
    { scheme: "openalex", value: "W3097863073" },
  ]);
  assert.deepEqual(work.updates, [{ type: "version", doi: "10.4171/jst/418", label: "Another version" }]);
  assert.deepEqual(service("pubmed", work.services), { name: "pubmed", ok: false, problem: "PubMed doesn't list this work." });
});

test("a Zenodo DOI brings its landing page's signposts along", async () => {
  const { send } = network({
    ...agency(ZENODO, "DataCite"),
    [`https://api.datacite.org/dois/${ZENODO}`]: { fixture: "datacite-zenodo.json" },
    [`HEAD https://doi.org/${ZENODO}`]: () => at(new Response(null, { headers: { link: fixture("zenodo-link-header.txt").trim() } }), ZENODO_PAGE),
    "https://zenodo.org/api/records/21752615": { fixture: "zenodo-linkset.json", headers: { "content-type": "application/linkset+json" } },
  });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: ZENODO }] });

  assert.equal(work.agency, "datacite");
  assert.equal(work.type, "ScholarlyArticle");
  assert.equal(work.license, "https://creativecommons.org/licenses/by/4.0/legalcode");
  assert.deepEqual(work.updates, [{ type: "version", doi: "10.5281/zenodo.21752614", label: "Version of" }]);
  assert.equal(work.from.signposts, "signposting");
  assert.equal(work.signposts?.anchor, ZENODO_PAGE);
  assert.equal(work.signposts?.citeAs, `https://doi.org/${ZENODO}`);
  assert.deepEqual(work.signposts?.types, ["https://schema.org/ScholarlyArticle", "https://schema.org/AboutPage"]);
  assert.equal(service("openalex", work.services)?.problem, "OpenAlex has no record of this work.");
});

const retractedRoutes = (): Record<string, Route> => ({
  ...agency(RETRACTED, "Crossref"),
  [`https://api.crossref.org/works/${RETRACTED}`]: { fixture: "crossref-retracted.json" },
  [`https://api.openalex.org/works/doi:${RETRACTED}`]: { fixture: "openalex-retracted.json" },
  [idconv(RETRACTED)]: { fixture: "idconv-retracted.json" },
  [esummary("31579114")]: { fixture: "pubmed-retracted.json" },
});

test("a retraction is reported when every service says so, with the notice listed once", async () => {
  const { send } = network(retractedRoutes());
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: RETRACTED }] });

  assert.equal(work.retracted, true);
  assert.equal(work.from.retracted, "crossref");
  // Crossref lists the notice twice (publisher and Retraction Watch) and PubMed once more: one line is kept.
  assert.deepEqual(work.updates, [{ type: "retraction", doi: "10.1177/17588359211061903", date: "2021-12-15", label: "Retraction" }]);
});

for (const only of ["crossref", "openalex", "pubmed"] as const) {
  test(`a retraction is reported when only ${only} knows of it`, async () => {
    const routes = retractedRoutes();
    const strip = (name: string, change: (body: Record<string, unknown>) => void): void => {
      const body = JSON.parse(fixture(name)) as Record<string, unknown>;
      change(body);
      const address = Object.keys(routes).find((url) => (routes[url] as { fixture?: string }).fixture === name)!;
      routes[address] = JSON.stringify(body);
    };
    if (only !== "crossref") strip("crossref-retracted.json", (body) => delete (body.message as Record<string, unknown>)["updated-by"]);
    if (only !== "openalex") strip("openalex-retracted.json", (body) => Object.assign(body, { is_retracted: false }));
    if (only !== "pubmed") {
      strip("pubmed-retracted.json", (body) => {
        const summary = (body.result as Record<string, { pubtype: string[]; references: unknown[] }>)["31579114"]!;
        summary.pubtype = ["Journal Article"];
        summary.references = [];
      });
    }
    const work = await createScholarly({ fetch: network(routes).send }).lookupWork({ identifiers: [{ scheme: "doi", value: RETRACTED }] });
    assert.equal(work.retracted, true);
    assert.equal(work.from.retracted, only);
    assert.ok(work.services.filter(({ name }) => name !== "signposting").every(({ ok }) => ok));
  });
}

test("PubMed's converter finds the PMID and PMCID when OpenAlex is down", async () => {
  const routes = retractedRoutes();
  routes[`https://api.openalex.org/works/doi:${RETRACTED}`] = { status: 500 };
  const { send, asked } = network(routes);
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: RETRACTED }] });

  assert.equal(asked("idconv").length, 1);
  assert.deepEqual(service("openalex", work.services), { name: "openalex", ok: false, problem: "OpenAlex answered 500." });
  assert.equal(service("crossref", work.services)?.ok, true);
  assert.equal(service("pubmed", work.services)?.ok, true);
  assert.deepEqual(
    work.identifiers.map(({ scheme, value }) => `${scheme}:${value}`),
    [`doi:${RETRACTED}`, "pmid:31579114", "pmcid:PMC6759708"],
  );
  // Crossref's title, with the publisher's markup and line breaks taken out.
  assert.equal(
    work.title,
    "RETRACTED: Downregulation of long noncoding RNA LINC01419 inhibits cell migration, invasion, and tumor growth and promotes autophagy via inactivation of the PI3K/Akt1/mTOR pathway in gastric cancer",
  );
  assert.equal(work.openAccess, undefined);
  assert.equal(work.from.citedBy, "crossref");
});

test("one service failing, by error, by refusal or by silence, never fails the lookup", async () => {
  const routes = carroll();
  routes[`https://api.crossref.org/works/${CARROLL}`] = () => {
    throw new TypeError("fetch failed");
  };
  routes[esummary("33380041")] = () => new Promise<Response>(() => {});
  const { send } = network(routes);
  const work = await createScholarly({ fetch: send, timeoutMs: 40 }).lookupWork({ identifiers: [{ scheme: "doi", value: CARROLL }] });

  assert.deepEqual(work.services, [
    { name: "crossref", ok: false, problem: "Couldn't reach Crossref." },
    { name: "openalex", ok: true },
    { name: "pubmed", ok: false, problem: "PubMed took too long to answer." },
    { name: "signposting", ok: false, problem: "The landing page refused to be read by a program." },
  ]);
  // With the registry gone, OpenAlex's copy stands in, and says it is OpenAlex's.
  assert.equal(work.title, "Do reservoir computers work best at the edge of chaos?");
  assert.equal(work.from.title, "openalex");
  assert.equal(work.agency, "crossref");
  assert.equal(work.from.agency, undefined);
});

test("a service that is slow is cut off, and told to stop", async () => {
  let stopped = false;
  const send = (async (url: string, init: RequestInit = {}) => {
    if (!url.includes("openalex")) return new Response("", { status: 404 });
    return new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => {
        stopped = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
  const work = await createScholarly({ fetch: send, timeoutMs: 30 }).lookupWork({ identifiers: [{ scheme: "openalex", value: "W3107601746" }] });
  assert.deepEqual(work.services, [{ name: "openalex", ok: false, problem: "OpenAlex took too long to answer." }]);
  assert.equal(stopped, true);
});

test("when doi.org can't say who registered a DOI, both registries are asked and the one that answers is it", async () => {
  const { send, asked } = network({ [`https://api.datacite.org/dois/${ARXIV}`]: { fixture: "datacite-arxiv.json" } });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [{ scheme: "doi", value: ARXIV }] });
  assert.equal(asked("api.crossref.org").length, 1);
  assert.equal(work.agency, "datacite");
  assert.equal(work.from.agency, "datacite");
  assert.equal(service("crossref", work.services)?.problem, "Crossref has no record of this work.");
});

test("nothing about the person is sent: no email, no agent name, only identifiers", async () => {
  const { send, calls } = network({ ...carroll(), ...retractedRoutes() });
  const scholarly = createScholarly({ fetch: send });
  await scholarly.lookupWork({ identifiers: [{ scheme: "doi", value: CARROLL }] });
  await scholarly.lookupWork({ identifiers: [{ scheme: "doi", value: RETRACTED }] });
  assert.ok(calls.length >= 9);
  for (const { url, headers } of calls) {
    assert.doesNotMatch(url, /mailto|email|tool=|@/i, url);
    assert.deepEqual(Object.keys(headers).filter((name) => name.toLowerCase() !== "accept"), [], url);
  }
});

test("a title alone is looked up in Crossref and taken when the titles match closely", async () => {
  const title = "do reservoir computers work best at the Edge of Chaos";
  const { send, asked } = network({
    [`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=3`]: { fixture: "crossref-search.json" },
    [`https://api.openalex.org/works/doi:${CARROLL}`]: { fixture: "openalex-carroll.json" },
    [esummary("33380041")]: { fixture: "pubmed-carroll.json" },
  });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [], title });

  assert.equal(work.title, "Do reservoir computers work best at the edge of chaos?");
  assert.equal(work.from.title, "crossref");
  assert.equal(work.agency, "crossref");
  assert.equal(work.identifiers[0]?.value, CARROLL);
  assert.equal(work.citedBy, (JSON.parse(fixture("openalex-carroll.json")) as { cited_by_count: number }).cited_by_count);
  // The search hit is the record: Crossref is asked once, and doi.org not at all.
  assert.equal(asked("api.crossref.org").length, 1);
  assert.equal(asked("doiRA").length, 0);
});

test("a title that only resembles what Crossref found is refused", async () => {
  const title = "Do reservoir computers work at all?";
  const { send, calls } = network({
    [`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=3`]: { fixture: "crossref-search.json" },
  });
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [], title });

  assert.deepEqual(work.identifiers, []);
  assert.deepEqual(work.from, {});
  assert.equal(work.title, undefined);
  assert.deepEqual(work.services, [{ name: "crossref", ok: false, problem: "Crossref has no work with a title that matches closely." }]);
  assert.equal(calls.length, 1);
});

test("with nothing to go on, nothing is asked", async () => {
  const { send, calls } = network({});
  const work = await createScholarly({ fetch: send }).lookupWork({ identifiers: [] });
  assert.deepEqual({ identifiers: work.identifiers, from: work.from, services: work.services }, { identifiers: [], from: {}, services: [] });
  assert.equal(calls.length, 0);
});

test("a Link header is read with quoted commas, several relations in one rel, and bare parameters", () => {
  const header = [
    '<https://example.org/a>; rel="cite-as describedby"; type="application/ld+json"; title="One, two; and <three>"',
    "<https://example.org/b>;rel=item;type=application/pdf",
    '</c>; REL="License" ; title="say \\"hi\\", twice"',
    "garbage",
    '<https://example.org/d>; rel="item"; anchor="https://elsewhere.example/"',
  ].join(", ");
  assert.deepEqual(parseLinkHeader(header), [
    { href: "https://example.org/a", rel: ["cite-as", "describedby"], type: "application/ld+json" },
    { href: "https://example.org/b", rel: ["item"], type: "application/pdf" },
    { href: "/c", rel: ["license"] },
    { href: "https://example.org/d", rel: ["item"], anchor: "https://elsewhere.example/" },
  ]);
  assert.deepEqual(parseLinkHeader(""), []);
});

test("signposts are read from Link headers, falling back to GET when HEAD is refused", async () => {
  const page = "https://repo.example/works/7";
  const { send, calls } = network({
    [`HEAD ${page}`]: { status: 405 },
    [`GET ${page}`]: () =>
      new Response("<html>not read</html>", {
        headers: {
          link: [
            '<https://doi.org/10.1234/seven>; rel="cite-as"',
            '<meta.jsonld>; rel="describedby"; type="application/ld+json"; profile="https://schema.org/"',
            '<https://repo.example/files/7.pdf>; rel="item"; type="application/pdf"',
            '<https://creativecommons.org/licenses/by/4.0/>; rel="license"',
            '<https://schema.org/ScholarlyArticle>; rel="type", <https://schema.org/AboutPage>; rel="type"',
            '<https://orcid.org/0000-0002-2371-2049>; rel="author"',
            '<https://repo.example/collections/2>; rel="collection"',
            '<https://repo.example/inbox/>; rel="http://www.w3.org/ns/ldp#inbox"',
            '<https://other.example/x.pdf>; rel="item"; anchor="https://other.example/x"',
          ].join(", "),
        },
      }),
  });
  assert.deepEqual(await createScholarly({ fetch: send }).signposts(page), {
    anchor: page,
    citeAs: "https://doi.org/10.1234/seven",
    describedBy: [{ href: "https://repo.example/works/meta.jsonld", type: "application/ld+json", profile: "https://schema.org/" }],
    items: [{ href: "https://repo.example/files/7.pdf", type: "application/pdf" }],
    license: "https://creativecommons.org/licenses/by/4.0/",
    types: ["https://schema.org/ScholarlyArticle", "https://schema.org/AboutPage"],
    authors: ["https://orcid.org/0000-0002-2371-2049"],
    collection: "https://repo.example/collections/2",
    inbox: "https://repo.example/inbox/",
  });
  assert.deepEqual(calls.map(({ method }) => method), ["HEAD", "GET"]);
});

test("a linkset's links for the same page are folded in, and other pages' links are left out", async () => {
  const page = "https://repo.example/works/7";
  const { send, calls } = network({
    [`HEAD ${page}`]: () =>
      new Response(null, {
        headers: { link: '<https://doi.org/10.1234/seven>; rel="cite-as", </works/7/linkset>; rel="linkset"; type="application/linkset+json"' },
      }),
    "https://repo.example/works/7/linkset": JSON.stringify({
      linkset: [
        {
          anchor: page,
          "cite-as": [{ href: "https://doi.org/10.1234/other" }],
          item: [{ href: "https://repo.example/files/7.pdf", type: "application/pdf" }, { href: "https://repo.example/files/7.csv", type: "text/csv" }],
          author: [{ href: "https://orcid.org/0000-0002-2371-2049" }],
          "http://www.w3.org/ns/ldp#inbox": [{ href: "https://repo.example/inbox/" }],
        },
        { anchor: "https://repo.example/files/7.pdf", collection: [{ href: page }] },
      ],
    }),
  });
  const found = await createScholarly({ fetch: send }).signposts(page);
  assert.deepEqual(found, {
    anchor: page,
    // What the page's own headers said comes first.
    citeAs: "https://doi.org/10.1234/seven",
    items: [
      { href: "https://repo.example/files/7.pdf", type: "application/pdf" },
      { href: "https://repo.example/files/7.csv", type: "text/csv" },
    ],
    authors: ["https://orcid.org/0000-0002-2371-2049"],
    linkset: "https://repo.example/works/7/linkset",
    inbox: "https://repo.example/inbox/",
  });
  assert.equal(calls.at(-1)?.headers.accept, "application/linkset+json");
});

test("Zenodo's real headers and linkset read as one set of signposts, with nothing doubled", async () => {
  const { send } = network({
    [`HEAD https://doi.org/${ZENODO}`]: () => at(new Response(null, { headers: { link: fixture("zenodo-link-header.txt").trim() } }), ZENODO_PAGE),
    "https://zenodo.org/api/records/21752615": { fixture: "zenodo-linkset.json", headers: { "content-type": "application/linkset+json" } },
  });
  const found = await createScholarly({ fetch: send }).signposts(`https://doi.org/${ZENODO}`);
  assert.equal(found.anchor, ZENODO_PAGE);
  assert.equal(found.citeAs, `https://doi.org/${ZENODO}`);
  assert.equal(found.license, "https://creativecommons.org/licenses/by/4.0/legalcode");
  assert.equal(found.linkset, "https://zenodo.org/api/records/21752615");
  assert.deepEqual(found.items, [{ href: "https://zenodo.org/records/21752615/files/IJSRAIML25122", type: "application/octet-stream" }]);
  assert.equal(found.describedBy?.length, 15);
  assert.ok(found.describedBy?.some(({ type, profile }) => type === "application/ld+json" && profile === "https://datapackage.org/profiles/2.0/datapackage.json"));
  // The file's own `collection` link belongs to the file, not to this page.
  assert.equal(found.collection, undefined);
});

test("a page that can't be read is a plain error from signposts", async () => {
  const { send } = network({});
  await assert.rejects(createScholarly({ fetch: send }).signposts("https://gone.example/x"), /The landing page wasn't found\./);
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(createScholarly({ fetch: down }).signposts("https://gone.example/x"), /Couldn't reach the landing page\./);
});

const notification: Notification = {
  "@context": ["https://www.w3.org/ns/activitystreams", "https://coar-notify.net"],
  id: "urn:uuid:94ecae35-dcfd-4182-8550-22c7164fe23f",
  type: ["Announce", "coar-notify:ReviewAction"],
  origin: { id: "https://dg.example", inbox: "https://dg.example/inbox/", type: "Service" },
  target: { id: "https://repo.example", inbox: "https://repo.example/inbox/", type: "Service" },
  object: { id: "https://dg.example/reviews/1", type: ["Page", "sorg:Review"] },
  context: { id: `https://doi.org/${CARROLL}` },
};

test("a notification is posted as JSON-LD, and the inbox's Location comes back", async () => {
  const { send, calls } = network({
    "POST https://repo.example/inbox/": () => new Response(null, { status: 201, headers: { location: "/inbox/urn:uuid:1" } }),
  });
  const sent = await createScholarly({ fetch: send }).sendNotification({ inbox: "https://repo.example/inbox/", notification });
  assert.deepEqual(sent, { status: 201, location: "https://repo.example/inbox/urn:uuid:1" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.headers, { "content-type": "application/ld+json" });
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ""), notification);

  const quiet = network({ "POST https://repo.example/inbox/": () => new Response(null, { status: 202 }) });
  assert.deepEqual(await createScholarly({ fetch: quiet.send }).sendNotification({ inbox: "https://repo.example/inbox/", notification }), { status: 202 });
});

test("an inbox that refuses a notification is a plain error", async () => {
  const { send } = network({ "POST https://repo.example/inbox/": { status: 403 } });
  await assert.rejects(createScholarly({ fetch: send }).sendNotification({ inbox: "https://repo.example/inbox/", notification }), /didn't take the notification\. It answered 403\./);
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(createScholarly({ fetch: down }).sendNotification({ inbox: "https://repo.example/inbox/", notification }), /Couldn't reach the inbox at https:\/\/repo\.example\/inbox\//);
});

test("a server's notifications are listed, narrowed to one work when asked, through createServices", async () => {
  const summary: NotificationSummary = {
    id: notification.id,
    types: ["Announce", "coar-notify:ReviewAction"],
    about: ["https://dg.example/reviews/1"],
    context: `https://doi.org/${CARROLL}`,
    from: "https://dg.example",
    receivedAt: "2026-11-12T10:00:00.000Z",
    notification,
  };
  const about = `https://doi.org/${CARROLL}`;
  const { send, calls } = network({
    "http://lab/v1/notify/inbox": JSON.stringify({ notifications: [summary, summary] }),
    [`http://lab/v1/notify/inbox?about=${encodeURIComponent(about)}`]: JSON.stringify({ notifications: [summary] }),
    "http://bad/v1/notify/inbox": () => json(JSON.stringify({ error: { message: "Not allowed" } }), 403),
  });
  const services = createServices({ fetch: send, store: { get: async () => null, set: async () => {} } });
  assert.equal((await services.notifications({ server: "http://lab/" })).length, 2);
  assert.deepEqual(await services.notifications({ server: "http://lab", about }), [summary]);
  assert.deepEqual(calls.map(({ url }) => url), ["http://lab/v1/notify/inbox", "http://lab/v1/notify/inbox?about=https%3A%2F%2Fdoi.org%2F10.1063%2F5.0038163"]);
  await assert.rejects(services.notifications({ server: "http://bad" }), /Not allowed/);
  assert.equal(typeof services.lookupWork, "function");
  assert.equal(typeof services.signposts, "function");
  assert.equal(typeof services.sendNotification, "function");
});
