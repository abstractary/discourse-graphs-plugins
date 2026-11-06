// What the real-host test scripts drive. A release build leaves all of this out.
import { createNode, foldRecords, type DgRecord } from "@dg/contract/records.ts";
import type { SurfaceRoute } from "@dg/contract/host.ts";
import type { SurfaceMethod } from "@dg/contract/surface.ts";
import { runConformance as runSuite, type ConformanceDriver, type ConformanceSetup } from "@dg/contract/conformance.ts";
import type { Core } from "@dg/core/index.ts";
import { closeDialogFrame } from "@dg/native/dialog.ts";
import { closeWalkthroughOffer, removeWalkthroughExamples, type WalkthroughBase } from "@dg/native/walkthrough.ts";
import { createFrameProbe, exportRecords, fingerprint, importAndAccept, readAllRecords, summarize, surfaceCaller } from "../../../harness/tools.ts";
import { canvasShowing, leaveCanvasPage } from "./canvases.ts";
import { readExisting } from "./existing.ts";
import { writeForeignRecord, type RoamApi, type RoamHost } from "./host.ts";

declare const __CANVAS_BUILD__: string;

const SETTLE_MS = 1800;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

type Frames = Record<"canvas" | "context" | "canvases" | "dialog", HTMLIFrameElement | null>;

export type TestAccess = {
  api: RoamApi;
  local: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> };
  walkthrough: () => Promise<void>;
  walkthroughBase: () => Promise<WalkthroughBase>;
  capture: (mode: "selection" | "page") => Promise<void>;
  addBlock: (parent: string, string: string) => Promise<string>;
  openSurface: (args: { route: SurfaceRoute; placement: "main" | "side" | "dialog" }) => Promise<unknown>;
  openDialog: (surface: "upload" | "welcome") => Promise<void>;
  firstRun: () => Promise<void>;
  offer: () => Promise<void>;
  ensureCore: () => Promise<Core>;
  ready: () => Promise<RoamHost>;
  fresh: () => Promise<RoamHost>;
  current: () => RoamHost;
  frames: () => Frames;
  forgetFrames: () => void;
  testMode: (on?: boolean) => boolean;
  sync: () => { now: () => Promise<void> } | undefined;
  panel: () => { panelMode: string; report: unknown };
  forgetPanel: () => void;
  route: () => SurfaceRoute;
};

export const installTestHooks = (access: TestAccess): void => {
  const { api } = access;
  const probe = createFrameProbe(() => access.frames().canvas);
  const contextProbe = createFrameProbe(() => access.frames().context);
  const canvasesProbe = createFrameProbe(() => access.frames().canvases);
  const dialogProbe = createFrameProbe(() => access.frames().dialog);
  let caller: ReturnType<typeof surfaceCaller> | null = null;

const titleOf = async (ref: string): Promise<string> => {
  const unit = await access.current().host.readText({ ref });
  if (!unit.ok) throw new Error(`driver: ${unit.error.message}`);
  return unit.value.title;
};

const driver = (): ConformanceDriver => ({
  reload: async () => (await access.fresh()).host,
  editOutside: async ({ ref, body }) => {
    await access.addBlock(ref, body);
  },
  renameOutside: async ({ ref, title }) => {
    await api.data.page.update({ page: { uid: ref, title } });
  },
  removeOutside: async ({ ref }) => {
    await api.data.page.delete({ page: { uid: ref } });
  },
  linkOutside: async ({ from, to }) => {
    await access.addBlock(from, `[[${await titleOf(to)}]]`);
  },
  tagOutside: async ({ ref, tag }) => {
    await access.addBlock(ref, `#${tag}`);
  },
  focusOutside: async ({ ref }) => {
    if (ref) await api.ui.mainWindow.openPage({ page: { uid: ref } });
  },
  selectOutside: async ({ ref, text }) => {
    await api.ui.mainWindow.openPage({ page: { uid: ref } });
    await sleep(500);
    const page = api.data.pull("[{:block/children [:block/uid :block/string]}]", [":block/uid", ref]) as {
      ":block/children"?: { ":block/uid": string; ":block/string": string }[];
    } | null;
    const block = page?.[":block/children"]?.[0];
    if (!block) throw new Error("driver: no block");
    const start = text === null ? 0 : block[":block/string"].indexOf(text);
    await api.ui.setBlockFocusAndSelection({
      location: { "block-uid": block[":block/uid"], "window-id": "main-window" },
      selection: { start, end: text === null ? 0 : start + text.length },
    });
    await sleep(400);
  },
  placeCursor: async ({ ref }) => {
    access.current().setCursor(ref ? await access.addBlock(ref, "cursor") : null);
  },
  readAtCursor: async () => {
    const focus = (
      api.data.fast.q(
        '[:find ?s :where [?b :block/string ?s] [(clojure.string/starts-with? ?s "cursor")]]',
      ) as [string][]
    ).map(([text]) => text);
    return focus.join("\n");
  },
  isVisible: async ({ ref }) => {
    const view = (await api.ui.mainWindow.getOpenView()) as { type?: string };
    const inSidebar = (
      api.ui.rightSidebar.getWindows() as { "block-uid"?: string; "page-uid"?: string }[]
    ).some((window) => window["block-uid"] === ref || window["page-uid"] === ref);
    if (view?.type === "custom" || canvasShowing()) return inSidebar;
    return (
      inSidebar || (await api.ui.mainWindow.getOpenPageOrBlockUid()) === ref
    );
  },
  closePanels: async () => {
    await api.ui.mainWindow.closeComponent();
    document.getElementById("dg-contract-side")?.remove();
    document.getElementById("dg-contract-side-canvases")?.remove();
  },
  writeRecordOutside: async ({ record }) => {
    await writeForeignRecord({ api, record });
  },
  settle: () => sleep(SETTLE_MS),
});

const slice = {
  build: __CANVAS_BUILD__,
  test: (on: boolean) => {
    access.testMode(on);
    if (on) {
      closeWalkthroughOffer();
      closeDialogFrame();
      void access.local.set("walkthrough-offered", true);
      void access.local.set("welcome-shown", true);
    }
    return on;
  },
  walkthrough: () => access.walkthrough(),
  offer: async () => {
    await access.local.set("walkthrough-offered", null);
    await access.offer();
  },
  removeExamples: () => access.walkthroughBase().then(removeWalkthroughExamples),
  setLocal: (key: string, value: unknown) => access.local.set(key, value),
  getLocal: (key: string) => access.local.get(key),
  openCanvases: () => access.openSurface({ route: { surface: "canvases" }, placement: "side" }),
  exportRecords: async () => {
    await access.ready();
    return exportRecords(access.current().host);
  },
  importRecords: async (records: DgRecord[]) => {
    await access.ready();
    return importAndAccept({ host: access.current().host, records });
  },
  fileOpen: async () => {
    const uid = (await api.ui.mainWindow.getOpenPageOrBlockUid()) as string | null;
    const page = uid ? (api.data.pull("[:node/title]", [":block/uid", uid]) as { ":node/title"?: string } | null) : null;
    return page?.[":node/title"] ?? null;
  },
  openHome: async (title: string) => {
    const uid = api.data.fast.q("[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]", title)[0]?.[0] as string | undefined;
    if (uid) await api.ui.mainWindow.openPage({ page: { uid } });
    return Boolean(uid);
  },
  searchBase: (title: string) =>
    (api.data.fast.q("[:find ?t :where [?p :node/title ?t]]") as [string][]).map(([found]) => found).filter((found) => found.includes(title)),
  open: async (id?: string) => {
    await access.ready();
    await access.current().host.openSurface({
      route: { surface: "canvas", ...(id ? { id } : {}) },
      placement: "main",
    });
  },
  // The canvas stays open in Roam, because revealed text goes to the sidebar,
  // so getting back to it only means closing that sidebar.
  focusCanvas: async () => {
    for (const window_ of api.ui.rightSidebar.getWindows() as { type: string; "block-uid"?: string; "page-uid"?: string }[]) {
      await api.ui.rightSidebar.removeWindow({
        window: { type: window_.type, "block-uid": window_["block-uid"] ?? window_["page-uid"] },
      });
    }
    await api.ui.rightSidebar.close();
    await sleep(500);
  },
  // Going elsewhere, the way a person leaves a canvas's page.
  leaveCanvas: async () => {
    await api.ui.mainWindow.openDailyNotes();
    await sleep(1200);
  },
  closeAll: async () => {
    await api.ui.mainWindow.closeComponent();
    document.getElementById("dg-contract-side")?.remove();
    document.getElementById("dg-contract-side-canvases")?.remove();
    await api.ui.rightSidebar.close();
    if (canvasShowing()) {
      await api.ui.mainWindow.openDailyNotes();
      leaveCanvasPage();
    }
    access.forgetFrames();
  },
  locate: (selector: string) => probe.locate(selector),
  text: (selector: string) => probe.text(selector),
  count: (selector: string) => probe.count(selector),
  value: (selector: string) => probe.value(selector),
  choose: (selector: string, value: string) => probe.choose(selector, value),
  focus: () => probe.focus(),
  scroll: () => probe.scroll(),
  drawn: () => probe.drawn(),
  style: (selector: string, prop: string) => probe.style(selector, prop),
  skin: () => access.ensureCore().then((ready) => ready.info.skin),
  frameWidth: (width: number | null) => {
    const frame = access.frames().canvas;
    if (frame) frame.style.width = width ? `${width}px` : "100%";
  },
  doubleClicks: () => probe.doubleClicks(),
  frameTheme: () => probe.theme(),
  summary: async () => {
    const ready = await access.ensureCore();
    return summarize({ host: access.current().host, localSpace: ready.info.space.id });
  },
  findRef: async (title: string) => {
    const found = await access.current().host.searchText({ query: title, limit: 1 });
    return found.ok ? (found.value[0]?.ref ?? null) : null;
  },
  renameOutside: (ref: string, title: string) => driver().renameOutside({ ref, title }),
  writeOutside: (record: DgRecord) => driver().writeRecordOutside({ record }),
  visible: (ref: string) => driver().isVisible({ ref }),
  usage: async () => {
    const ready = await access.ensureCore();
    await ready.flushUsage();
    return access.current().host.getLocal({ key: "usage" });
  },
  theme: () => (document.querySelector(".rm-dark") ? "dark" : "light"),
  core: () => access.ensureCore(),
  existing: () => readExisting(api as never),
  hostCount: (selector: string) => document.querySelectorAll(selector).length,
  hostText: (selector: string) => document.querySelector(selector)?.textContent ?? null,
  prepareSelection: async (title: string, body: string, text: string | null) => {
    await access.ready();
    const made = await access.current().host.createText({ title, body });
    if (!made.ok) throw new Error(made.error.message);
    await driver().selectOutside({ ref: made.value.ref, text });
    return made.value.ref;
  },
  readText: async (ref: string) => {
    const text = await access.current().host.readText({ ref });
    return text.ok ? text.value : null;
  },
  unitInText: (title: string) => {
    const uid = api.data.fast.q("[:find ?u :in $ ?t :where [?p :node/title ?t] [?p :block/uid ?u]]", title)[0]?.[0] as string | undefined;
    const page = uid ? (api.data.pull("[:block/props]", [":block/uid", uid]) as { ":block/props"?: Record<string, unknown> } | null) : null;
    return (page?.[":block/props"]?.[":dg-id"] ?? page?.[":block/props"]?.["dg-id"] ?? null) as string | null;
  },
  runCapture: (mode: "selection" | "page") => access.capture(mode),
  openNote: (ref: string) => api.ui.mainWindow.openPage({ page: { uid: ref } }),
  writePage: async (title: string, lines: string[]) => {
    await access.ready();
    const made = await access.current().host.createText({ title, body: lines[0] ?? "" });
    if (!made.ok) throw new Error(made.error.message);
    for (const line of lines.slice(1)) await access.addBlock(made.value.ref, line);
    return made.value.ref;
  },
  removeOutside: (ref: string) => driver().removeOutside({ ref }),
  renameInBase: (ref: string, title: string) => driver().renameOutside({ ref, title }),
  openPageRef: async () => (await api.ui.mainWindow.getOpenPageOrBlockUid()) as string | null,
  caret: () => ({ focused: Boolean(document.querySelector("textarea.rm-block-input")) }),
  openInSidebar: async (ref: string) => {
    await api.ui.rightSidebar.open();
    await api.ui.rightSidebar.addWindow({ window: { type: "outline", "block-uid": ref } });
  },
  focusOutside: (ref: string) => driver().focusOutside({ ref }),
  // Going to a page remounts Roam's custom view, so wait for it to come back.
  afterFocus: () => access.openSurface({ route: access.route(), placement: "main" }),
  ctx: contextProbe,
  list: canvasesProbe,
  dialog: dialogProbe,
  openDialog: (surface: "upload" | "welcome") => access.openDialog(surface),
  syncNow: () => access.sync()?.now(),
  firstRun: async () => {
    await access.local.set("welcome-shown", null);
    await access.firstRun();
  },
  fingerprint: () => {
    const rows = api.data.fast.q(
      "[:find ?t ?s :where [?p :node/title ?t] [?b :block/page ?p] [?b :block/string ?s]]",
    ) as [string, string][];
    return fingerprint(rows.filter(([title]) => !title.startsWith("roam/js/discourse-graph/records")).map(([title, text]) => `${title}\n${text}`));
  },
  importExisting: async (dryRun: boolean) => {
    await access.ready();
    return (await access.ensureCore()).importExisting({ existing: readExisting(api as never), dryRun });
  },
  call: async (method: SurfaceMethod, params: unknown) => {
    await access.ready();
    caller ??= surfaceCaller(await access.ensureCore());
    return caller(method, params);
  },
};

const harness = {
  runConformance: async () => {
    await access.ready();
    await access.current().host.describe();
    const setup = async (): Promise<ConformanceSetup> => ({
      host: access.current().host,
      driver: driver(),
    });
    const started = Date.now();
    const results = await runSuite({ setup });
    return {
      host: "roam",
      graphType: api.graph.type,
      seconds: (Date.now() - started) / 1000,
      passed: results.filter((result) => result.pass).length,
      total: results.length,
      failed: results.filter((result) => !result.pass),
    };
  },

  openPanel: async () => {
    await access.ready();
    access.forgetPanel();
    const result = await access.current().host.openSurface({
      route: { surface: "check" },
      placement: "main",
    });
    return { result, panelMode: access.panel().panelMode };
  },

  panelReport: () => access.panel(),

  verifyPanel: async () => {
    const host = access.current().host;
    const report = access.panel().report as { claim?: string } | null;
    const info = await host.describe();
    if (!info.ok) throw new Error(info.error.message);
    const graph = foldRecords({
      records: await readAllRecords(host),
      localSpace: info.value.space.id,
    });
    const anchor = [...graph.documents.values()].find(
      (item) => item.kind === "anchor" && item.node === report?.claim,
    ) as { ref: string } | undefined;
    const text = anchor ? await host.readText({ ref: anchor.ref }) : null;
    return {
      anchor: anchor?.ref ?? null,
      titleInBase: text?.ok ? text.value.title : null,
      revealed: anchor ? await driver().isVisible({ ref: anchor.ref }) : false,
      activeRelations: [...graph.relations.values()].filter(
        ({ state }) => state === "active",
      ).length,
    };
  },

  measureRecords: async (count: number) => {
    await access.ready();
    const host = access.current().host;
    const info = await host.describe();
    if (!info.ok) throw new Error(info.error.message);
    const stamp = { space: info.value.space.id, by: info.value.person };
    const records: DgRecord[] = Array.from({ length: count }, (_, index) =>
      createNode({ ...stamp, title: `Load test ${index}` }),
    );
    const writeStart = performance.now();
    for (let i = 0; i < records.length; i += 500) {
      await host.putRecords({ records: records.slice(i, i + 500) });
    }
    const writeMs = performance.now() - writeStart;
    const readStart = performance.now();
    const all = await readAllRecords(host);
    const readMs = performance.now() - readStart;
    const foldStart = performance.now();
    foldRecords({ records: all, localSpace: stamp.space });
    return {
      host: "roam",
      added: count,
      total: all.length,
      writeMs: Math.round(writeMs),
      readMs: Math.round(readMs),
      foldMs: Math.round(performance.now() - foldStart),
    };
  },

  exportExchange: async () => {
    await access.ready();
    return exportRecords(access.current().host);
  },

  importExchange: async (records: DgRecord[]) => {
    await access.ready();
    return importAndAccept({ host: access.current().host, records });
  },

  measureSingles: async (count: number) => {
    await access.ready();
    const info = await access.current().host.describe();
    if (!info.ok) throw new Error(info.error.message);
    const stamp = { space: info.value.space.id, by: info.value.person };
    const started = performance.now();
    for (let i = 0; i < count; i += 1) {
      await access.current().host.putRecords({
        records: [createNode({ ...stamp, title: `Load test single ${i}` })],
      });
    }
    return { singles: count, msEach: (performance.now() - started) / count };
  },

  count: async () => {
    await access.ready();
    const records = await readAllRecords(access.current().host);
    const text = await access.current().host.listText({ limit: 100000 });
    return { records: records.length, texts: text.ok ? text.value.items.length : -1 };
  },
};

  const holder = window as unknown as { dgHarness: typeof harness; dgSlice: typeof slice };
  holder.dgHarness = harness;
  holder.dgSlice = slice;
};
