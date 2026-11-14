import { tid } from "./ids.ts";
import {
  canonicalJson,
  createCanvas,
  createNode,
  foldRecords,
  isJsonSafe,
  revise,
  type Author,
  type DgRecord,
  type HostRef,
  type NodeRecord,
} from "./records.ts";
import {
  CONTRACT_VERSION,
  type Host,
  type HostEvent,
  type Result,
  type TextSummary,
} from "./host.ts";

/**
 * What a person or another device does to the base, outside the contract.
 * A real adapter implements this against the live host.
 */
export type ConformanceDriver = {
  /** A new Host over the same stored data, as after restarting the app. */
  reload: () => Promise<Host>;
  editOutside: (args: { ref: HostRef; body: string }) => Promise<void>;
  renameOutside: (args: { ref: HostRef; title: string }) => Promise<void>;
  removeOutside: (args: { ref: HostRef }) => Promise<void>;
  linkOutside: (args: { from: HostRef; to: HostRef }) => Promise<void>;
  tagOutside: (args: { ref: HostRef; tag: string }) => Promise<void>;
  focusOutside: (args: { ref: HostRef | null }) => Promise<void>;
  placeCursor: (args: { ref: HostRef | null }) => Promise<void>;
  readAtCursor: () => Promise<string>;
  /** Selects some text on a page, or clears the selection when `text` is null. */
  selectOutside: (args: { ref: HostRef; text: string | null }) => Promise<void>;
  /** True when a person could actually see this text right now. */
  isVisible: (args: { ref: HostRef }) => Promise<boolean>;
  closePanels: () => Promise<void>;
  writeRecordOutside: (args: { record: DgRecord }) => Promise<void>;
  /** Resolves once the host has delivered pending events. */
  settle: () => Promise<void>;
};

export type ConformanceSetup = { host: Host; driver: ConformanceDriver };

type Context = ConformanceSetup & {
  unique: (label: string) => string;
  /** Tags can't hold spaces in either base. */
  uniqueTag: () => string;
  person: Author;
  spaceId: string;
};

export type Check = { id: string; run: (context: Context) => Promise<void> };

export type CheckResult = { id: string; pass: boolean; detail?: string };

class CheckFailed extends Error {}

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new CheckFailed(message);
};

const must = <T>(result: Result<T>, label: string): T => {
  if (!result.ok) {
    throw new CheckFailed(`${label}: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
};

const expectError = <T>(
  result: Result<T>,
  code: string,
  label: string,
): void => {
  expect(!result.ok, `${label}: expected ${code}, got success`);
  if (!result.ok) {
    expect(
      result.error.code === code,
      `${label}: expected ${code}, got ${result.error.code}`,
    );
  }
};

const makeText = async (
  { host, unique }: Context,
  label: string,
  body = "fixture body",
): Promise<TextSummary> =>
  must(await host.createText({ title: unique(label), body }), "createText");

const makeNode = ({ spaceId, person, unique }: Context, label: string): NodeRecord =>
  createNode({ space: spaceId, by: person, title: unique(label) });

const readToEnd = async (
  host: Host,
): Promise<{ records: DgRecord[]; cursor: string }> => {
  const records: DgRecord[] = [];
  let after: string | undefined;
  for (;;) {
    const page = must(
      await host.listRecords({ limit: 3, ...(after ? { after } : {}) }),
      "listRecords",
    );
    records.push(...page.items);
    after = page.next;
    if (page.done) return { records, cursor: page.next };
  }
};

const allRecords = async (host: Host): Promise<DgRecord[]> =>
  (await readToEnd(host)).records;

const collectEvents = (host: Host): { events: HostEvent[]; stop: () => void } => {
  const events: HostEvent[] = [];
  const stop = host.subscribe((event) => events.push(event));
  return { events, stop };
};

export const CHECKS: Check[] = [
  {
    id: "describe.shape",
    run: async ({ host }) => {
      const info = must(await host.describe(), "describe");
      expect(info.contract === CONTRACT_VERSION, "wrong contract version");
      expect(info.host.length > 0, "host is empty");
      expect(info.space.id.length > 0, "space id is empty");
      expect(info.person.id.length > 0, "person id is empty");
      expect(isJsonSafe(info), "describe result isn't plain JSON");
    },
  },
  {
    id: "describe.skin",
    run: async ({ host }) => {
      const { skin } = must(await host.describe(), "describe");
      for (const key of ["font", "textFont", "ink", "muted", "page", "panel", "line", "accent"] as const) {
        expect(skin[key].length > 0, `skin.${key} is empty`);
      }
      expect(skin.size >= 10 && skin.size <= 24, "skin.size isn't a px size");
      expect(skin.radius >= 0 && skin.radius <= 24, "skin.radius isn't a px size");
    },
  },
  {
    id: "describe.space-is-stable",
    run: async ({ host, driver }) => {
      const before = must(await host.describe(), "describe");
      const after = must(await (await driver.reload()).describe(), "describe");
      expect(before.space.id === after.space.id, "space id changed on reload");
    },
  },
  {
    id: "text.create-and-read",
    run: async (context) => {
      const created = await makeText(context, "create", "first line");
      const unit = must(
        await context.host.readText({ ref: created.ref }),
        "readText",
      );
      expect(unit.title === created.title, "title differs from createText");
      expect(unit.body.includes("first line"), "body lost its text");
      expect(isJsonSafe(unit), "readText result isn't plain JSON");
    },
  },
  {
    id: "text.stored-title-is-returned",
    run: async (context) => {
      const title = `${context.unique("awkward")} a/b: c?`;
      const created = must(
        await context.host.createText({ title }),
        "createText",
      );
      const unit = must(
        await context.host.readText({ ref: created.ref }),
        "readText",
      );
      expect(unit.title === created.title, "stored title wasn't returned");
    },
  },
  {
    id: "text.takes-a-very-long-title",
    run: async (context) => {
      // Evidence extracted from a paper is often a whole sentence or two.
      const made = await context.host.createText({
        title: context.unique(`${"A long sentence of evidence. ".repeat(20)}`),
        body: "fixture body",
      });
      const unit = must(made, "createText");
      expect(Boolean(unit.ref), "no ref for a long title");
      must(await context.host.readText({ ref: unit.ref }), "readText");
      must(await context.host.removeText({ ref: unit.ref }), "removeText");
    },
  },
  {
    id: "text.duplicate-title-is-conflict",
    run: async (context) => {
      const created = await makeText(context, "duplicate");
      const again = await context.host.createText({ title: created.title });
      expectError(again, "conflict", "second createText");
      if (!again.ok) {
        expect(again.error.ref === created.ref, "conflict must name the ref");
      }
    },
  },
  {
    id: "text.remove",
    run: async (context) => {
      const created = await makeText(context, "removed");
      const removed = await context.host.removeText({ ref: created.ref });
      expect(removed.ok, "removeText should succeed");
      await context.driver.settle();
      const gone = await context.host.readText({ ref: created.ref });
      expectError(gone, "not-found", "reading removed text");
    },
  },
  {
    id: "text.ref-survives-rename",
    run: async (context) => {
      const created = await makeText(context, "rename");
      const title = context.unique("renamed");
      must(
        await context.host.renameText({ ref: created.ref, title }),
        "renameText",
      );
      const unit = must(
        await context.host.readText({ ref: created.ref }),
        "readText after rename",
      );
      expect(unit.title === title, "new title not visible");
    },
  },
  {
    id: "text.ref-survives-outside-rename",
    run: async (context) => {
      const created = await makeText(context, "outside");
      const title = context.unique("moved");
      await context.driver.renameOutside({ ref: created.ref, title });
      await context.driver.settle();
      const unit = must(
        await context.host.readText({ ref: created.ref }),
        "readText after outside rename",
      );
      expect(unit.title === title, "new title not visible");
    },
  },
  {
    id: "text.pin-makes-listed-ref-stable",
    run: async (context) => {
      const created = await makeText(context, "pin");
      const listed = must(
        await context.host.searchText({ query: created.title, limit: 1 }),
        "searchText",
      )[0];
      expect(listed !== undefined, "new text not searchable");
      const pinned = must(
        await context.host.pinText({ ref: listed!.ref }),
        "pinText",
      );
      const title = context.unique("pinned-moved");
      await context.driver.renameOutside({ ref: pinned.ref, title });
      await context.driver.settle();
      const reloaded = await context.driver.reload();
      must(await reloaded.readText({ ref: pinned.ref }), "pinned ref after reload");
    },
  },
  {
    id: "text.missing-is-not-found",
    run: async (context) => {
      const created = await makeText(context, "remove");
      await context.driver.removeOutside({ ref: created.ref });
      await context.driver.settle();
      expectError(
        await context.host.readText({ ref: created.ref }),
        "not-found",
        "readText of removed text",
      );
    },
  },
  {
    id: "text.list-pages-through-everything",
    run: async (context) => {
      const made = await Promise.all(
        ["a", "b", "c", "d", "e"].map((label) => makeText(context, label)),
      );
      const seen: string[] = [];
      let after: string | undefined;
      for (;;) {
        const page = must(
          await context.host.listText({ limit: 2, ...(after ? { after } : {}) }),
          "listText",
        );
        expect(page.items.length <= 2, "page exceeded limit");
        seen.push(...page.items.map((item) => item.ref));
        after = page.next;
        if (page.done) break;
      }
      expect(new Set(seen).size === seen.length, "a unit appeared twice");
      for (const unit of made) {
        expect(seen.includes(unit.ref), `listText missed ${unit.title}`);
      }
    },
  },
  {
    id: "text.search-by-title-and-tag",
    run: async (context) => {
      const created = await makeText(context, "searchable");
      const byTitle = must(
        await context.host.searchText({ query: created.title, limit: 5 }),
        "searchText",
      );
      expect(byTitle.some((item) => item.ref === created.ref), "title not found");
      const tag = context.uniqueTag();
      await context.driver.tagOutside({ ref: created.ref, tag });
      await context.driver.settle();
      const byTag = must(
        await context.host.searchText({ tag, limit: 5 }),
        "searchText by tag",
      );
      expect(byTag.some((item) => item.ref === created.ref), "tag not found");
    },
  },
  {
    id: "text.backlinks",
    run: async (context) => {
      const target = await makeText(context, "target");
      const source = await makeText(context, "source");
      await context.driver.linkOutside({ from: source.ref, to: target.ref });
      await context.driver.settle();
      const links = must(
        await context.host.listBacklinks({ ref: target.ref }),
        "listBacklinks",
      );
      expect(links.some((item) => item.ref === source.ref), "backlink missing");
    },
  },
  {
    id: "records.idempotent",
    run: async (context) => {
      const record = makeNode(context, "idempotent");
      must(await context.host.putRecords({ records: [record] }), "first put");
      const second = must(
        await context.host.putRecords({ records: [record] }),
        "second put",
      );
      expect(second.stored === 0, "identical record was stored twice");
      const copies = (await allRecords(context.host)).filter(
        (item) => item.id === record.id,
      );
      expect(copies.length === 1, `found ${copies.length} copies`);
    },
  },
  {
    id: "records.unknown-fields-survive",
    run: async (context) => {
      const record = {
        ...makeNode(context, "future"),
        ext: { lab: { keep: true } },
        addedByALaterVersion: ["kept"],
      } as DgRecord;
      must(await context.host.putRecords({ records: [record] }), "put");
      const stored = (await allRecords(context.host)).find(
        (item) => item.id === record.id,
      );
      expect(
        canonicalJson(stored) === canonicalJson(record),
        "record changed in storage",
      );
    },
  },
  {
    id: "records.stale-write-loses",
    run: async (context) => {
      const first = makeNode(context, "versioned");
      const second = revise({
        record: first,
        changes: { title: context.unique("newer") },
        by: context.person,
      });
      for (const record of [first, second, first]) {
        must(await context.host.putRecords({ records: [record] }), "put");
      }
      const graph = foldRecords({
        records: await allRecords(context.host),
        localSpace: context.spaceId,
      });
      const winner = graph.documents.get(first.id) as NodeRecord | undefined;
      expect(winner?.rev === 2, "older version beat the newer one");
    },
  },
  {
    id: "records.concurrent-writes-all-survive",
    run: async (context) => {
      const records = ["one", "two", "three", "four"].map((label) =>
        makeNode(context, label),
      );
      await Promise.all(
        records.map(async (record) =>
          must(await context.host.putRecords({ records: [record] }), "put"),
        ),
      );
      const ids = new Set((await allRecords(context.host)).map((item) => item.id));
      expect(records.every((record) => ids.has(record.id)), "a write was lost");
    },
  },
  {
    id: "records.invalid-batch-stores-nothing",
    run: async (context) => {
      const good = makeNode(context, "good");
      const bad = { ...makeNode(context, "bad"), rev: 0 } as DgRecord;
      expectError(
        await context.host.putRecords({ records: [good, bad] }),
        "invalid",
        "putRecords",
      );
      const ids = (await allRecords(context.host)).map((item) => item.id);
      expect(!ids.includes(good.id), "partial batch was stored");
    },
  },
  {
    id: "records.cursor-sees-later-writes",
    run: async (context) => {
      must(
        await context.host.putRecords({ records: [makeNode(context, "old")] }),
        "put",
      );
      const { cursor } = await readToEnd(context.host);
      const later = makeNode(context, "later");
      must(await context.host.putRecords({ records: [later] }), "put later");
      const page = must(
        await context.host.listRecords({ limit: 100, after: cursor }),
        "list from cursor",
      );
      expect(
        page.items.some((item) => item.id === later.id),
        "the saved cursor missed a later write",
      );
    },
  },
  {
    id: "records.survive-reload",
    run: async (context) => {
      const record = createCanvas({
        space: context.spaceId,
        by: context.person,
        title: context.unique("canvas"),
      });
      must(await context.host.putRecords({ records: [record] }), "put");
      const reloaded = await context.driver.reload();
      const ids = (await allRecords(reloaded)).map((item) => item.id);
      expect(ids.includes(record.id), "record lost on reload");
    },
  },
  {
    id: "local.stays-out-of-records",
    run: async (context) => {
      const key = context.unique("key");
      must(
        await context.host.setLocal({ key, value: { cached: [1, 2] } }),
        "setLocal",
      );
      const reloaded = await context.driver.reload();
      const value = must(await reloaded.getLocal({ key }), "getLocal");
      expect(
        canonicalJson(value) === canonicalJson({ cached: [1, 2] }),
        "local value changed",
      );
      const records = canonicalJson(await allRecords(context.host));
      expect(!records.includes(key), "local state leaked into records");
    },
  },
  {
    id: "assets.round-trip",
    run: async (context) => {
      const asset = {
        name: `${context.unique("figure")}.png`,
        mime: "image/png",
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      };
      const { ref } = must(
        await context.host.writeAsset({ asset }),
        "writeAsset",
      );
      const read = must(await context.host.readAsset({ ref }), "readAsset");
      expect(read.dataUrl === asset.dataUrl, "asset bytes changed");
      expectError(
        await context.host.readAsset({ ref: `${ref}-missing` }),
        "not-found",
        "readAsset of unknown ref",
      );
    },
  },
  {
    id: "files.list-documents",
    run: async (context) => {
      const name = `${context.unique("paper")}.pdf`;
      const asset = { name, mime: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK" };
      const { ref } = must(await context.host.writeAsset({ asset }), "writeAsset of a PDF");
      const listed = must(await context.host.listFiles({ extensions: ["pdf"], limit: 500 }), "listFiles");
      const found = listed.find((file) => file.ref === ref);
      expect(Boolean(found), "a PDF just kept isn't listed");
      expect(found?.name.endsWith(".pdf") === true, "a listed file lost its extension");
      const read = must(await context.host.readAsset({ ref }), "readAsset of a listed PDF");
      expect(read.dataUrl.endsWith(asset.dataUrl.split(",")[1]!), "a listed PDF reads back different bytes");
      const images = must(await context.host.listFiles({ extensions: ["png"], limit: 500 }), "listFiles of images");
      expect(!images.some((file) => file.ref === ref), "listFiles ignored the extensions asked for");
    },
  },
  {
    id: "navigation.reveal",
    run: async (context) => {
      await context.driver.closePanels();
      const created = await makeText(context, "reveal");
      must(
        await context.host.reveal({ ref: created.ref, placement: "main" }),
        "reveal",
      );
      await context.driver.settle();
      const focus = must(await context.host.getFocus(), "getFocus");
      expect(focus.ref === created.ref, "reveal didn't move focus");
      await context.driver.removeOutside({ ref: created.ref });
      await context.driver.settle();
      expectError(
        await context.host.reveal({ ref: created.ref, placement: "main" }),
        "not-found",
        "reveal of removed text",
      );
    },
  },
  {
    id: "navigation.insert-link",
    run: async (context) => {
      const target = await makeText(context, "link-target");
      const page = await makeText(context, "link-page");
      await context.driver.placeCursor({ ref: null });
      expectError(
        await context.host.insertLink({ ref: target.ref }),
        "no-target",
        "insertLink with no cursor",
      );
      await context.driver.placeCursor({ ref: page.ref });
      must(await context.host.insertLink({ ref: target.ref }), "insertLink");
      const text = await context.driver.readAtCursor();
      expect(text.includes(target.title), "link text not inserted");
    },
  },
  {
    id: "navigation.reveal-isnt-hidden-by-a-panel",
    run: async (context) => {
      const created = await makeText(context, "over-panel");
      must(
        await context.host.openSurface({
          route: { surface: "context" },
          placement: "main",
        }),
        "openSurface",
      );
      await context.driver.settle();
      must(
        await context.host.reveal({ ref: created.ref, placement: "main" }),
        "reveal",
      );
      await context.driver.settle();
      expect(
        await context.driver.isVisible({ ref: created.ref }),
        "the text opened behind the panel, where nobody can see it",
      );
      await context.driver.closePanels();
    },
  },
  {
    id: "navigation.open-surface",
    run: async ({ host }) => {
      must(
        await host.openSurface({
          route: { surface: "context" },
          placement: "side",
        }),
        "openSurface",
      );
    },
  },
  {
    id: "events.outside-changes",
    run: async (context) => {
      const created = await makeText(context, "watched");
      await context.driver.settle();
      const { events, stop } = collectEvents(context.host);
      await context.driver.editOutside({ ref: created.ref, body: "edited" });
      await context.driver.settle();
      const title = context.unique("watched-renamed");
      await context.driver.renameOutside({ ref: created.ref, title });
      await context.driver.settle();
      await context.driver.focusOutside({ ref: created.ref });
      await context.driver.settle();
      await context.driver.removeOutside({ ref: created.ref });
      await context.driver.settle();
      stop();
      const has = (type: HostEvent["type"]): boolean =>
        events.some((event) => event.type === type);
      expect(has("text-changed"), "no text-changed");
      expect(has("text-renamed"), "no text-renamed");
      expect(has("focus-changed"), "no focus-changed");
      expect(has("text-removed"), "no text-removed");
    },
  },
  {
    id: "editor.selection-becomes-a-link",
    run: async (context) => {
      const target = await makeText(context, "selection-target");
      const page = await makeText(context, "selection-page", "keep select me keep");
      await context.driver.selectOutside({ ref: page.ref, text: "select me" });
      const selection = must(await context.host.readSelection(), "readSelection");
      expect(selection?.text === "select me", `read ${String(selection?.text)}`);
      must(await context.host.replaceSelection({ ref: target.ref }), "replaceSelection");
      await context.driver.settle();
      const { body } = must(await context.host.readText({ ref: page.ref }), "readText");
      expect(body.includes(target.title), "the link isn't in the text");
      expect(!body.includes("select me"), "the selected words are still there");
      expect(body.includes("keep") && body.split("keep").length === 3, "the words around it changed");
    },
  },
  {
    id: "editor.no-selection-reads-null",
    run: async (context) => {
      const page = await makeText(context, "selection-none", "nothing chosen");
      await context.driver.selectOutside({ ref: page.ref, text: null });
      expect(must(await context.host.readSelection(), "readSelection") === null, "found a selection");
    },
  },
  {
    id: "text.unit-id-lives-in-the-text",
    run: async (context) => {
      const unit = `${context.person.id}#${tid()}`;
      const title = context.unique("unit-id");
      const created = must(await context.host.createText({ title, unit }), "createText");
      const again = must(await (await context.driver.reload()).readText({ ref: created.ref }), "readText");
      expect(again.title === created.title, "the text didn't survive with its id");
    },
  },
  {
    id: "events.rename-is-not-a-removal",
    run: async (context) => {
      const created = await makeText(context, "moved");
      await context.driver.settle();
      const { events, stop } = collectEvents(context.host);
      const title = context.unique("moved-renamed");
      await context.driver.renameOutside({ ref: created.ref, title });
      await context.driver.settle();
      stop();
      expect(
        !events.some((event) => event.type === "text-removed"),
        "a rename reported the text as removed",
      );
    },
  },
  {
    id: "events.record-from-elsewhere",
    run: async (context) => {
      const { events, stop } = collectEvents(context.host);
      const record = makeNode(context, "teammate");
      await context.driver.writeRecordOutside({ record });
      await context.driver.settle();
      stop();
      expect(
        events.some((event) => event.type === "records-changed"),
        "no records-changed",
      );
      const ids = (await allRecords(context.host)).map((item) => item.id);
      expect(ids.includes(record.id), "outside record not listed");
    },
  },
  {
    id: "events.own-writes-also-fire",
    run: async (context) => {
      const { events, stop } = collectEvents(context.host);
      must(
        await context.host.putRecords({ records: [makeNode(context, "own")] }),
        "put",
      );
      await context.driver.settle();
      stop();
      expect(
        events.some((event) => event.type === "records-changed"),
        "own write produced no event",
      );
    },
  },
  {
    id: "events.unsubscribe-stops-delivery",
    run: async (context) => {
      const { events, stop } = collectEvents(context.host);
      stop();
      must(
        await context.host.putRecords({ records: [makeNode(context, "quiet")] }),
        "put",
      );
      await context.driver.settle();
      expect(events.length === 0, "listener still called after unsubscribe");
    },
  },
];

/**
 * Plain functions with no test framework, because a real adapter can only be
 * proven inside its live base, where a test runner isn't available.
 * Fixtures are left behind, so run this against a throwaway graph or vault.
 */
export const runConformance = async ({
  setup,
  only,
}: {
  setup: () => Promise<ConformanceSetup>;
  only?: string[];
}): Promise<CheckResult[]> => {
  const results: CheckResult[] = [];
  let counter = 0;
  for (const check of CHECKS) {
    if (only && !only.includes(check.id)) continue;
    try {
      const { host, driver } = await setup();
      const info = must(await host.describe(), "describe");
      await check.run({
        host,
        driver,
        person: info.person,
        spaceId: info.space.id,
        unique: (label) => {
          counter += 1;
          return `dg-check ${label} ${counter} ${Date.now()}`;
        },
        uniqueTag: () => {
          counter += 1;
          return `dg-check-${counter}-${Date.now()}`;
        },
      });
      results.push({ id: check.id, pass: true });
    } catch (error) {
      results.push({
        id: check.id,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};
