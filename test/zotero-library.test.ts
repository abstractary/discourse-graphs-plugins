import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { createNode, type Author, type NodeRecord } from "@dg/contract/records.ts";
import { isLibraryRef, isSharedLibraryRef } from "@dg/contract/scholarly.ts";
import type { Services } from "@dg/contract/services.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { inLibraryOf } from "@dg/core/card.ts";
import { createZotero } from "@dg/sync/zotero.ts";

/**
 * Zotero as it really answers on its own computer, as read from Zotero 10.0.9 on 13 November 2026: the
 * personal library is user 0, and a PDF's whereabouts is a `file:` link on its attachment. The older
 * fixtures give the library a numbered id, which a local library never has.
 */
type Raw = { key: string; library?: unknown; links?: unknown; data: Record<string, unknown> };
const fixture = (name: string): Raw[] => JSON.parse(readFileSync(`test/fixtures/zotero/${name}.json`, "utf8")) as Raw[];
const LOCAL = { type: "user", id: 0, name: "My Library" };
const ITEM: Raw = { ...fixture("items")[0]!, library: LOCAL };
const PATH = "/Users/reader/Zotero/storage/PDFA0001/Carroll 2020.pdf";
const PDF: Raw = {
  ...fixture("children")[0]!,
  library: LOCAL,
  links: { enclosure: { href: `file://${encodeURI(PATH)}`, type: "application/pdf", length: 14 } },
};
PDF.data = { ...PDF.data, md5: "948593208d570a07c561ff73a02435cd", dateModified: "2026-11-13T21:33:27Z" };
const MARKS = fixture("annotations").map((raw) => ({ ...raw, library: LOCAL }));
const ITEM_REF = "users/0/items/ABCD2345";
const FILE_REF = "zotero:users/0/items/PDFA0001";
const BYTES = "%PDF-1.7 carroll";

const zoteroApp = (state: { open: boolean }): typeof fetch =>
  (async (input: string | URL | Request) => {
    if (!state.open) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, "");
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "Zotero-Server-ID": "srv-1", "X-Zotero-Version": "10.0.9" } });
    if (path === "/users/0/groups") return json([]);
    if (path === "/users/0/items" && url.searchParams.get("itemType") === "attachment") return json(url.searchParams.get("start") === "0" ? [PDF] : []);
    if (path === "/users/0/items" && url.searchParams.get("itemKey")) return json([ITEM]);
    if (path === "/users/0/items") return json([]);
    if (path === "/users/0/items/PDFA0001") return json(PDF);
    if (path === "/users/0/items/ABCD2345") return json(ITEM);
    if (path === "/users/0/items/ABCD2345/children") return json([PDF]);
    if (path === "/users/0/items/PDFA0001/children") return json(MARKS);
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const setup = async () => {
  const state = { open: true };
  const store = createMemoryStore();
  store.outside.set(PATH, { name: "Carroll 2020.pdf", mime: "application/pdf", dataUrl: `data:application/pdf;base64,${btoa(BYTES)}` });
  const { host, emit } = createMemoryHost({ store });
  const opened: string[] = [];
  const base = { ...host, openSurface: async (args: { route: { surface: string } }) => (opened.push(args.route.surface), { ok: true as const, value: null }) };
  const services = { servers: async () => [], link: async () => null, pushRecords: async () => {}, pullRecords: async () => ({ records: [], done: true }), zotero: createZotero({ fetch: zoteroApp(state) }) } as unknown as Services;
  const core = await createCore({ host: base as never, services, demoGraphs: [] });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });
  const nodes = (): NodeRecord[] => [...core.graph().documents.values()].filter((record): record is NodeRecord => record.kind === "node" && !record.removed);
  return { core, call, store, host, emit, state, opened, nodes };
};

test("a personal library read on its own computer is user 0, and still a library", async () => {
  const zotero = createZotero({ fetch: zoteroApp({ open: true }) });
  assert.deepEqual(await zotero.status(), { ok: true, app: "zotero", canWrite: true, serverId: "srv-1", version: "10.0.9" });
  const files = await zotero.files();
  assert.equal(files.length, 1);
  const [file] = files;
  assert.equal(file!.ref, FILE_REF);
  assert.ok(isLibraryRef(file!.ref) && !isLibraryRef("Paper files/x.pdf"));
  assert.equal(file!.path, PATH, "where the file is, with its spaces read back");
  assert.equal(file!.filename, "Carroll 2020.pdf");
  assert.equal(file!.size, 14);
  assert.equal(file!.item.ref, ITEM_REF);
  // The fault the older fixtures hid: with an id of 0 the item's place in the library was never recorded.
  assert.ok(file!.item.identifiers.some((id) => id.scheme === "zotero" && id.value === ITEM_REF));
  assert.ok(file!.item.identifiers.some((id) => id.scheme === "doi" && id.value === "10.1063/5.0038163"));
  assert.equal((await zotero.file({ ref: FILE_REF })).path, PATH);
  await assert.rejects(zotero.file({ ref: `zotero:${ITEM_REF}` }), /isn't a PDF/);
});

test("with Zotero as the PDF library, its PDFs are the list and are read where Zotero keeps them", async () => {
  const { call, store, core } = await setup();
  // A copy of some other paper in the vault, and nothing from Zotero yet.
  const kept = await call("pdf.add", { name: "Notes on tides.pdf", dataBase64: btoa("%PDF-1.7 tides") });
  assert.deepEqual((await call("pdf.list", {})).map((doc) => doc.name), ["Notes on tides.pdf"]);
  assert.deepEqual(await call("pdf.library", {}), { on: false, wanted: false, reachable: true, files: 0 });

  await call("prefs.set", { zoteroLibrary: true });
  assert.deepEqual(await call("pdf.library", {}), { on: true, wanted: true, reachable: true, files: 1 });
  const listed = await call("pdf.list", {});
  assert.deepEqual(listed.map((doc) => [doc.name, Boolean(doc.library)]), [["Carroll 2020.pdf", true], ["Notes on tides.pdf", false]], "Zotero's first, then what is only in the vault");
  const theirs = listed[0]!;
  assert.equal(theirs.ref, FILE_REF);
  assert.equal(theirs.title, "Do reservoir computers work best at the edge of chaos?", "named for its reference, not its file");
  assert.deepEqual(theirs.library, { app: "zotero", open: "zotero://select/library/items/ABCD2345", what: "item", label: "Carroll 2020", item: ITEM_REF });

  const opened = await call("pdf.open", { ref: FILE_REF });
  assert.equal(atob(opened.dataBase64), BYTES, "the bytes are Zotero's own file");
  assert.equal(store.assets.size, 1, "and nothing was copied into the base");
  assert.equal(opened.libraryMarks?.length, 2, "the highlights made in Zotero are offered, not yet units");
  assert.equal(opened.document.libraryMarks, 2);
  assert.ok(opened.libraryMarks!.every((mark) => mark.exact && mark.open.startsWith("zotero://open-pdf/library/items/PDFA0001")));

  // A highlight made here, on Zotero's file: its source is the reference, with its identifiers, and no local address.
  const cut = await call("pdf.cut", { ref: FILE_REF, exact: "the smallest testing error", page: 3, title: "The smallest testing error is at the edge", canvas: null });
  const unit = core.graph().documents.get(cut.node.id) as NodeRecord;
  const source = core.graph().documents.get(unit.prov!.sourceDocument!) as NodeRecord;
  assert.equal(source.title, "Do reservoir computers work best at the edge of chaos?");
  assert.equal(source.facts?.doi, "10.1063/5.0038163");
  assert.ok(source.facts?.identifiers?.some((id) => id.scheme === "zotero" && id.value === ITEM_REF));
  assert.equal(source.facts?.uri, undefined, "one computer's file address is never written into a record");
  assert.match(source.facts?.cid ?? "", /^bafkrei/, "the bytes it was read from are pinned");
  assert.deepEqual(cut.node.card.library, { app: "zotero", open: "zotero://select/library/items/ABCD2345", what: "item" });
  assert.equal(cut.node.card.source?.name, "Carroll 2020");
  const again = (await call("pdf.list", {}))[0]!;
  assert.equal(again.source, source.id);
  assert.equal(again.units, 1);
  assert.equal(kept.name, "Notes on tides.pdf");
});

test("a copy in the vault of a paper Zotero holds is the same work, listed once", async () => {
  const { call, core } = await setup();
  // Read first from a vault copy, by a highlight, and told its DOI.
  const copy = await call("pdf.add", { name: "carroll-edge-of-chaos.pdf", dataBase64: btoa("%PDF-1.7 a different scan") });
  const cut = await call("pdf.cut", { ref: copy.ref, exact: "the largest entropy", page: 2, title: "The largest entropy did not give the lowest error", canvas: null });
  const sourceId = (core.graph().documents.get(cut.node.id) as NodeRecord).prov!.sourceDocument!;
  await call("unit.identify", { node: sourceId, add: ["10.1063/5.0038163"] });
  assert.equal((core.graph().documents.get(sourceId) as NodeRecord).facts?.doi, "10.1063/5.0038163");

  await call("prefs.set", { zoteroLibrary: true });
  const listed = await call("pdf.list", {});
  assert.deepEqual(listed.map((doc) => doc.name), ["Carroll 2020.pdf"], "the vault copy isn't listed beside Zotero's");
  assert.equal(listed[0]!.source, sourceId, "and what was read from the copy is found on Zotero's file");
  assert.equal(listed[0]!.units, 1);
  // Switched off again, the vault's own files are the list, as before.
  await call("prefs.set", { zoteroLibrary: false });
  assert.deepEqual((await call("pdf.list", {})).map((doc) => doc.name), ["carroll-edge-of-chaos.pdf"]);
});

test("when Zotero is closed the list says so, and what the vault holds is still there", async () => {
  const { call, state } = await setup();
  await call("pdf.add", { name: "Notes on tides.pdf", dataBase64: btoa("%PDF-1.7 tides") });
  await call("prefs.set", { zoteroLibrary: true });
  assert.equal((await call("pdf.list", {})).length, 2);
  state.open = false;
  const status = await call("pdf.library", {});
  assert.equal(status.wanted, true);
  assert.equal(status.reachable, false);
  assert.match(status.problem ?? "", /Zotero isn't answering/);
  assert.ok((await call("pdf.list", {})).some((doc) => doc.name === "Notes on tides.pdf"));
  await assert.rejects(call("pdf.open", { ref: FILE_REF }), /Zotero isn't answering/);
});

test("a personal library's address marks and opens only for the person whose unit carries it", async () => {
  const me: Author = { id: "did:plc:me", name: "Me" };
  const mate: Author = { id: "did:plc:mate", name: "Mate" };
  const personal = [{ scheme: "zotero" as const, value: ITEM_REF }];
  const group = [{ scheme: "zotero" as const, value: "groups/77/items/ABCD2345" }];
  assert.ok(!isSharedLibraryRef(ITEM_REF) && isSharedLibraryRef("groups/77/items/ABCD2345"));
  assert.deepEqual(inLibraryOf(personal, me, me.id), { app: "zotero", open: "zotero://select/library/items/ABCD2345", what: "item" });
  assert.equal(inLibraryOf(personal, mate, me.id), undefined, "user 0 on a teammate's computer is their library, not mine");
  assert.deepEqual(inLibraryOf(group, mate, me.id), { app: "zotero", open: "zotero://select/groups/77/items/ABCD2345", what: "item" }, "a group library is the same for every member");
  assert.equal(inLibraryOf([{ scheme: "doi", value: "10.1/x" }], me, me.id), undefined);
  assert.equal(inLibraryOf(personal, me, me.id, "zotero://open-pdf/library/items/PDFA0001?annotation=A")?.what, "passage");

  // In the graph: a teammate's source with the same personal address isn't taken for mine.
  const { call, host, emit, core, nodes } = await setup();
  const { nodeTypes } = await call("grammar.get", {});
  const theirs = createNode({ space: "lab", by: mate, title: "Some other paper in their library", type: nodeTypes.find((type) => type.base === "source")!.id, facts: { identifiers: personal } });
  await host.putRecords({ records: [theirs] });
  emit({ type: "records-changed" });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await call("node.view", { id: theirs.id })).node.card.library, undefined);
  const brought = await call("zotero.import", { ref: ITEM_REF });
  assert.notEqual(brought.source.id, theirs.id, "my item makes my own source");
  assert.equal(brought.wasHere, false);
  assert.equal(nodes().filter((node) => node.title.startsWith("Do reservoir computers")).length, 1);
  assert.ok((core.graph().documents.get(brought.source.id) as NodeRecord).facts?.identifiers?.some((id) => id.value === ITEM_REF));
});

test("the dialog can be opened at one reference, to bring in what was highlighted since", async () => {
  const { call, opened } = await setup();
  assert.deepEqual(await call("zotero.pending", {}), {});
  await call("zotero.show", { item: ITEM_REF });
  assert.deepEqual(opened, ["zotero"]);
  assert.deepEqual(await call("zotero.pending", {}), { item: ITEM_REF });
  assert.deepEqual(await call("zotero.pending", {}), {}, "asked for once");
  // Bringing one highlight in leaves the other still offered on the file.
  await call("prefs.set", { zoteroLibrary: true });
  await call("pdf.list", {});
  const view = await call("zotero.item", { ref: ITEM_REF });
  const first = view.annotations.find((mark) => mark.usable)!;
  await call("zotero.import", { ref: ITEM_REF, annotations: [{ key: first.key }] });
  const reopened = await call("pdf.open", { ref: FILE_REF });
  assert.equal(reopened.libraryMarks?.length, 1);
  assert.equal(reopened.marks.length, 1, "the one brought in is now a unit, lit in the reader");
});

test("a whole paper read from Zotero's file is that reference: its identifiers, its mark, no copy", async () => {
  const { call, store, core } = await setup();
  await call("prefs.set", { zoteroLibrary: true });
  await call("pdf.list", {});
  // A saved extraction stands in for a model, as it does when one sits beside a PDF.
  const saved = readFileSync("demo/papers/lupus-nephritis-prediction.graph.json", "utf8");
  const paper = await call("paper.extract", { ref: FILE_REF, saved: { name: "Carroll 2020.graph.json", text: saved }, schema: "mira" } as never);
  assert.equal(paper.filename, "Carroll 2020.pdf");
  assert.deepEqual(paper.library, { app: "zotero", open: "zotero://select/library/items/ABCD2345", what: "item" });
  const record = [...core.graph().documents.values()].find((item) => item.kind === "paper" && item.id === paper.id) as { identifiers?: { scheme: string; value: string }[]; fileCid?: string };
  assert.ok(record.identifiers?.some((id) => id.scheme === "zotero" && id.value === ITEM_REF));
  assert.match(record.fileCid ?? "", /^bafkrei/, "pinned to the bytes of Zotero's file");
  assert.equal(store.assets.size, 0, "nothing was copied into the base");
  const units = Object.values((await call("canvas.open", { id: paper.canvas })).nodes);
  assert.ok(units.length > 5);
  assert.ok(units.every((unit) => unit.paper?.library?.app === "zotero"), "every unit read from it carries the mark");
  // The file's row now leads to the paper's canvas.
  const row = (await call("pdf.list", {})).find((doc) => doc.ref === FILE_REF)!;
  assert.equal(row.paper?.id, paper.id);
});
