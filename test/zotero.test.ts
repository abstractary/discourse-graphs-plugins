import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NodeRecord } from "@dg/contract/records.ts";
import { identifierCurie, identifierUrl, parseIdentifier } from "@dg/contract/scholarly.ts";
import { suggestType } from "@dg/core/library.ts";
import { createZotero } from "@dg/sync/zotero.ts";
import { makeCore } from "./support.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(`test/fixtures/zotero/${name}.json`, "utf8"));
const ITEMS = fixture("items") as { key: string }[];

type Seen = { url: string; headers: Record<string, string> }[];

/** Stands in for the Zotero app: answers the local API's paths from the fixtures, and notes what it was asked. */
const zoteroApp = (seen: Seen, mode: "on" | "off" | "closed" = "on"): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (mode === "closed") throw new TypeError("fetch failed");
    if (mode === "off") return new Response("Local API is not enabled", { status: 403 });
    const path = new URL(url).pathname.replace(/^\/api/, "");
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "Zotero-Server-ID": "srv-1" } });
    if (path === "/users/0/items") return json([]);
    if (path === "/users/0/items/top") return json(ITEMS);
    if (path === "/users/123456/items/ABCD2345") return json(ITEMS[0]);
    if (path === "/users/123456/items/ABCD2345/children") return json(fixture("children"));
    if (path === "/users/123456/items/PDFA0001/children") return json(fixture("annotations"));
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

const setup = async (mode: "on" | "off" | "closed" = "on") => {
  const seen: Seen = [];
  const { core, call, host } = await makeCore({ services: { zotero: createZotero({ fetch: zoteroApp(seen, mode) }) }, demoGraphs: [] });
  return { core, call, seen, host };
};

const REF = "users/123456/items/ABCD2345";

test("a Zotero item reads as an identifier, and opens in Zotero", () => {
  assert.deepEqual(parseIdentifier("zotero://select/users/123456/items/ABCD2345"), { scheme: "zotero", value: REF });
  assert.deepEqual(parseIdentifier("https://www.zotero.org/groups/77/items/ABCD2345"), { scheme: "zotero", value: "groups/77/items/ABCD2345" });
  assert.equal(identifierUrl({ scheme: "zotero", value: REF }), "zotero://select/library/items/ABCD2345");
  assert.equal(identifierUrl({ scheme: "zotero", value: "groups/77/items/ABCD2345" }), "zotero://select/groups/77/items/ABCD2345");
  // A citation key is only words, so it is read only when the scheme is named.
  assert.equal(parseIdentifier("carroll2020edge")?.scheme, undefined);
  assert.equal(identifierCurie(parseIdentifier("@carroll2020edge", "citekey")!), "@carroll2020edge");
});

test("every request says it is allowed, and Zotero's refusals are told in words a person can act on", async () => {
  const on = await setup();
  assert.deepEqual(await on.call("zotero.status", {}), { ok: true, app: "zotero", canWrite: true, serverId: "srv-1" });
  assert.ok(on.seen.every(({ url, headers }) => url.startsWith("http://localhost:23119/api/") && headers["Zotero-Allowed-Request"] === "1"));
  const off = await (await setup("off")).call("zotero.status", {});
  assert.equal(off.ok, false);
  assert.match(off.problem!, /Settings, then Advanced/);
  const closed = await (await setup("closed")).call("zotero.status", {});
  assert.match(closed.problem!, /Open Zotero on this computer/);
});

test("a search lists references, not their notes, with what names each one", async () => {
  const { call } = await setup();
  const hits = await call("zotero.search", { text: "reservoir" });
  assert.equal(hits.length, 1);
  const { item, label, held } = hits[0]!;
  assert.equal(label, "Carroll 2020");
  assert.equal(held, undefined);
  assert.deepEqual(item.authors.map(({ name }) => name), ["Thomas L. Carroll"], "authors, not editors");
  assert.equal(item.venue, "Chaos");
  assert.deepEqual(item.identifiers.map(identifierCurie), ["doi:10.1063/5.0038163", "pmid:33380041", "arxiv:2012.01409", "@carroll2020edge", `zotero:${REF}`]);
  assert.equal(item.open, "zotero://select/library/items/ABCD2345");
});

test("an item shows its highlights in reading order, each with the type it would most likely be", async () => {
  const { call } = await setup();
  const view = await call("zotero.item", { ref: REF });
  assert.deepEqual(view.item.attachments.map(({ key, mediaType }) => [key, mediaType]), [["PDFA0001", "application/pdf"]]);
  assert.deepEqual(view.annotations.map(({ key }) => key), ["ANNO0001", "ANNO0003", "ANNO0002", "ANNO0004"]);
  const byKey = new Map(view.annotations.map((mark) => [mark.key, mark]));
  const label = (id: string | undefined) => view.types.find((type) => type.id === id)?.label;
  assert.equal(label(byKey.get("ANNO0001")!.suggested), "Evidence", "a quote is evidence unless it says otherwise");
  assert.equal(label(byKey.get("ANNO0002")!.suggested), "Claim", "a dg/claim tag is honoured");
  assert.equal(label(byKey.get("ANNO0004")!.suggested), "Question", "a plain type name as a tag is honoured too");
  assert.equal(byKey.get("ANNO0003")!.usable, false, "a picture has no words to bring");
  assert.equal(byKey.get("ANNO0002")!.pageIndex, 5);
  assert.equal(byKey.get("ANNO0004")!.pageIndex, undefined, "a position that can't be read is left out, not guessed");
  assert.equal(byKey.get("ANNO0002")!.open, "zotero://open-pdf/library/items/PDFA0001?page=6&annotation=ANNO0002");
  assert.equal(byKey.get("ANNO0002")!.color, "#ff6666");
});

test("bringing in makes one source and the chosen highlights, and doing it again makes nothing", async () => {
  const { call, core } = await setup();
  const made = await call("zotero.import", { ref: REF, annotations: [{ key: "ANNO0001" }, { key: "ANNO0002" }] });
  assert.equal(made.made, 2);
  assert.equal(made.wasHere, false);
  const nodes = () => [...core.graph().documents.values()].filter((record): record is NodeRecord => record.kind === "node");
  const source = nodes().find((node) => node.id === made.source.id)!;
  assert.equal(source.facts?.doi, "10.1063/5.0038163");
  assert.deepEqual(source.facts?.authors, ["Thomas L. Carroll"]);
  assert.equal(source.facts?.provenance?.method, "imported");
  assert.ok(source.facts?.identifiers?.some(({ scheme, value }) => scheme === "zotero" && value === REF));

  const claim = nodes().find((node) => node.facts?.identifiers?.some(({ value }) => value.endsWith("ANNO0002")))!;
  assert.equal(claim.title, "the reservoir computer with the largest entropy did not give the lowest testing error", "line breaks from the PDF are closed up");
  assert.deepEqual(claim.facts?.anchor, { source: source.id, exact: "the reservoir computer with the largest entropy\n did not give the lowest testing error", page: "6", comment: "This cuts against the edge-of-chaos story" });
  assert.equal(claim.prov?.sourceDocument, source.id);
  assert.equal(claim.facts?.provenance?.method, "authored", "a person marked it");

  // The card says where it was read and that a person read it; the panel can open the passage in Zotero.
  const view = await call("node.view", { id: claim.id });
  assert.equal(view.node.card.source?.name, "Carroll 2020");
  assert.equal(view.node.card.source?.how, "manual");
  assert.deepEqual(view.node.card.authors, { names: ["Thomas L. Carroll"], role: "paper" });
  assert.ok(view.node.card.identifiers.some(({ scheme }) => scheme === "doi"));
  assert.deepEqual(view.provenance.library, { app: "zotero", open: "zotero://open-pdf/library/items/PDFA0001?page=6&annotation=ANNO0002", what: "passage", exact: claim.facts!.anchor!.exact, comment: "This cuts against the edge-of-chaos story" });
  assert.equal((await call("node.view", { id: source.id })).provenance.library?.what, "item");

  const again = await call("zotero.import", { ref: REF, annotations: [{ key: "ANNO0001" }, { key: "ANNO0002" }, { key: "ANNO0004" }] });
  assert.deepEqual([again.made, again.already, again.wasHere], [1, 2, true]);
  assert.equal(nodes().filter((node) => node.title === source.title).length, 1, "one source, however often it is brought in");
  const item = await call("zotero.item", { ref: REF });
  assert.equal(item.held, source.id);
  assert.equal(item.annotations.filter((mark) => mark.held).length, 3);
});

test("a source already in the graph by its DOI is the one a Zotero item joins", async () => {
  const { call, core } = await setup();
  const types = await call("grammar.get", {});
  const sourceType = types.nodeTypes.find((type) => type.base === "source");
  const mine = await call("node.create", { title: "Carroll's edge of chaos paper", ...(sourceType ? { type: sourceType.id } : {}) } as never);
  await call("unit.identify", { node: mine.id, add: ["10.1063/5.0038163"] });
  if (!sourceType) return;
  const made = await call("zotero.import", { ref: REF });
  assert.equal(made.source.id, mine.id);
  assert.equal(made.wasHere, true);
  const node = core.graph().documents.get(mine.id) as NodeRecord;
  assert.equal(node.title, "Carroll's edge of chaos paper", "its title stays as its author wrote it");
  assert.ok(node.facts?.identifiers?.some(({ scheme }) => scheme === "zotero"), "it learns where it sits in the library");
  assert.ok(node.facts?.identifiers?.some(({ scheme }) => scheme === "pmid"));
});

test("a mark's tags decide its type before its kind does", () => {
  const types = [
    { id: "t-c", label: "Claim", abbreviation: "CLM", base: "claim" },
    { id: "t-e", label: "Evidence", abbreviation: "EVD", base: "evidence" },
    { id: "t-h", label: "Hypothesis", abbreviation: "HYP", base: "claim" },
  ] as never[];
  const mark = { key: "k", ref: "r", attachment: "a", type: "highlight" as const, text: "words", tags: [] as string[], open: "" };
  assert.equal(suggestType(mark, types)?.id, "t-e");
  assert.equal(suggestType({ ...mark, tags: ["#dg/Hypothesis"] }, types)?.id, "t-h");
  assert.equal(suggestType({ ...mark, tags: ["CLM"] }, types)?.id, "t-c");
  assert.equal(suggestType({ ...mark, text: undefined as never, comment: "a thought" } as never, types)?.id, "t-c");
});
