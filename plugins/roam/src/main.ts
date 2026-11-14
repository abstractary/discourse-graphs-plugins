import type { ExtractionGraph } from "@dg/contract/services.ts";
import { installTestHooks } from "./testing.ts";
import { browserKeys } from "@dg/core/index.ts";
import { askForName, startCapture } from "@dg/native/capture-menu.ts";
import { startBadges } from "./badges.ts";
import { connectFrame } from "@dg/native/frame.ts";
import { askBreadcrumb, closeDialogFrame, openDialogFrame } from "@dg/native/dialog.ts";
import { createServices } from "@dg/sync/client.ts";
import { createLlm } from "@dg/sync/providers.ts";
import { startLabSync } from "@dg/sync/lab-sync.ts";
import { canvasShowing, leaveCanvasPage, startCanvasPages } from "./canvases.ts";
import {
  closeWalkthroughOffer,
  offerWalkthrough,
  removeWalkthroughExamples,
  startWalkthrough,
  type WalkthroughBase,
} from "@dg/native/walkthrough.ts";
import { ok, type Host, type SurfaceRoute } from "@dg/contract/host.ts";
import { createCore, type Core } from "@dg/core/index.ts";
import { createRoamHost, type RoamApi, type RoamHost } from "./host.ts";

declare const __PANEL_HTML__: string;
declare const __CANVAS_HTML__: string;
declare const __PDF_HTML__: string;
declare const __CANVAS_BUILD__: string;
declare const __DEMO_GRAPHS__: { filename: string; graph: ExtractionGraph }[];
declare const __TEST_HOOKS__: boolean;

const COMPONENT_ID = "dg-contract-panel";
const OFFER_DELAY_MS = 3000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const api = (window as unknown as { roamAlphaAPI: RoamApi }).roamAlphaAPI;

let adapter: RoamHost;
let core: Core | undefined;
let coreReady: Promise<Core> | undefined;
let panelReport: unknown = null;
let panelMode = "none";
let route: SurfaceRoute = { surface: "canvas" };
let testMode = false;
let canvasFrame: HTMLIFrameElement | null = null;
let contextFrame: HTMLIFrameElement | null = null;
let canvasesFrame: HTMLIFrameElement | null = null;
let searchFrame: HTMLIFrameElement | null = null;
let dialogFrame: HTMLIFrameElement | null = null;
let openCanvasId: string | null = null;
let sync: ReturnType<typeof startLabSync> | undefined;

const services = createServices({
  fetch: (input, init) => window.fetch(input, init),
  store: { get: (key) => local.get(key), set: (key, value) => local.set(key, value) },
});

const ensureCore = async (): Promise<Core> => {
  adapter ??= await makeAdapter();
  coreReady ??= createCore({
    host: adapter.host,
    keys: browserKeys(),
    titleFormat: (abbreviation) => `[[${abbreviation}]] - {content}`,
    canvasFormat: "Canvas/{content}",
    services,
    llm: createLlm({ browser: true, fetch: (url, init) => window.fetch(url, init) }),
    // Roam has no keychain. The key stays in this browser's own storage, never in the graph, and the panel says so.
    secrets: {
      kind: "plain",
      get: async (id) => ((await local.get(`secret:${id}`)) as string | null) || null,
      set: async (id, value) => local.set(`secret:${id}`, value),
    },
    demoGraphs: __DEMO_GRAPHS__,
    askBreadcrumb: (paper) =>
      askBreadcrumb({
        skin: core!.info.skin,
        title: paper.title,
        onAnswer: (leave, remember) => void core!.answerBreadcrumb({ paper: paper.id, leave, remember }),
      }),
  }).then((made) => {
    const holder = window as unknown as { dgStopBadges?: () => void; dgStopSync?: () => void };
    holder.dgStopBadges?.();
    holder.dgStopBadges = startBadges({ core: made });
    holder.dgStopSync?.();
    sync = startLabSync({ services, target: made });
    holder.dgStopSync = sync.stop;
    return made;
  });
  core = await coreReady;
  return core;
};

const mountFrame = (surface: SurfaceRoute): HTMLIFrameElement => {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "Discourse Graphs");
  frame.srcdoc = surface.surface === "check" ? __PANEL_HTML__ : surface.surface === "pdf" ? __PDF_HTML__ : __CANVAS_HTML__;
  frame.style.cssText = "border:0;width:100%;height:100%;display:block;";
  if (surface.surface === "canvas") canvasFrame = frame;
  if (surface.surface === "context") contextFrame = frame;
  if (surface.surface === "canvases") canvasesFrame = frame;
  if (surface.surface === "search") searchFrame = frame;
  connectFrame({
    frame,
    route: surface,
    test: testMode,
    connect: async (port) => {
      const ready = await ensureCore();
      ready.connectSurface({
        port,
        onReport: (report) => {
          panelReport = report;
        },
      });
    },
  });
  return frame;
};

const sideId = (surface: SurfaceRoute["surface"]): string =>
  surface === "context" ? "dg-contract-side" : `dg-contract-side-${surface}`;

/** Roam has no slot for custom sidebar content, so these surfaces are injected. */
const mountInSidebar = async (surface: SurfaceRoute): Promise<void> => {
  await api.ui.rightSidebar.open();
  await sleep(300);
  const sidebar = document.querySelector("#right-sidebar");
  if (!sidebar) throw new Error("no right sidebar");
  const id = sideId(surface.surface);
  const frame = surface.surface === "canvases" ? canvasesFrame : surface.surface === "search" ? searchFrame : contextFrame;
  if (document.getElementById(id)?.isConnected && frame) return;
  document.getElementById(id)?.remove();
  const holder = document.createElement("div");
  holder.id = id;
  // Leaves room below for text opened from a card, which lands in this sidebar too.
  holder.style.cssText = `height:${surface.surface === "canvases" ? "min(40vh,380px)" : "min(62vh,640px)"};width:100%;flex:none;border-bottom:1px solid rgba(16,22,26,.15);`;
  holder.appendChild(mountFrame(surface));
  sidebar.prepend(holder);
  panelMode = "sidebar-injected";
};

const React = (window as unknown as { React?: any }).React; // eslint-disable-line @typescript-eslint/no-explicit-any

const PanelComponent = (): unknown => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const holder = ref.current as HTMLElement | null;
    if (!holder || holder.childElementCount > 0) return;
    holder.appendChild(mountFrame(route));
    panelMode = "roam-component";
  }, []);
  return React.createElement("div", {
    ref,
    id: "dg-contract-component",
    // Below Roam's top bar, which must stay usable.
    style: { width: "100%", height: "calc(100vh - 46px)" },
  });
};

const openSurface: Host["openSurface"] = async ({ route: next, placement }) => {
  if (placement === "dialog") {
    const ready = await ensureCore();
    openDialogFrame({
      html: __CANVAS_HTML__,
      route: next,
      skin: ready.info.skin,
      connect: (frame) => {
        dialogFrame = frame;
        connectFrame({
          frame,
          route: next,
          test: testMode,
          connect: async (port) => {
            ready.connectSurface({ port });
          },
        });
      },
    });
    return ok(null);
  }
  if (placement === "side") {
    await mountInSidebar(next);
    return ok(null);
  }
  // A PDF reads beside the canvas page, in the sidebar, the way Roam opens anything alongside.
  if (next.surface === "pdf") {
    await api.ui.rightSidebar.open();
    await sleep(300);
    const sidebar = document.querySelector("#right-sidebar");
    if (!sidebar) return { ok: false as const, error: { code: "unavailable" as const, message: "No sidebar." } };
    document.getElementById(sideId("pdf"))?.remove();
    const holder = document.createElement("div");
    holder.id = sideId("pdf");
    holder.style.cssText = "height:min(86vh,1100px);width:100%;flex:none;border-bottom:1px solid rgba(16,22,26,.15);";
    holder.appendChild(mountFrame(next));
    sidebar.prepend(holder);
    return ok(null);
  }
  // A canvas lives on its own page. Only with no canvas at all is there nowhere to go.
  if (next.surface === "canvas") {
    const ready = await ensureCore();
    const id = next.id ?? (await ready.usualCanvas());
    const home = id ? await ready.canvasHome({ id }) : null;
    if (home?.ok) {
      await api.ui.mainWindow.closeComponent();
      await api.ui.mainWindow.openPage({ page: { uid: home.value } });
      return ok(null);
    }
  }
  route = next.surface === "canvas" ? { ...next, pinned: true } : next;
  await api.ui.mainWindow.closeComponent();
  api.ui.mainWindow.registerComponent(COMPONENT_ID, PanelComponent);
  await api.ui.mainWindow.openComponent(COMPONENT_ID);
  return ok(null);
};

const makeAdapter = (): Promise<RoamHost> =>
  createRoamHost({
    api,
    openSurface,
    closeDialog: async () => {
      closeDialogFrame();
      dialogFrame = null;
      return ok(null);
    },
  });

const local = {
  get: async (key: string): Promise<unknown> => {
    adapter ??= await makeAdapter();
    const stored = await adapter.host.getLocal({ key });
    return stored.ok ? stored.value : null;
  },
  set: async (key: string, value: unknown): Promise<void> => {
    adapter ??= await makeAdapter();
    await adapter.host.setLocal({ key, value: value as never });
  },
};

const walkthroughBase = async (): Promise<WalkthroughBase> => {
  const ready = await ensureCore();
  return {
    core: ready,
    place: "graph",
    note: "page",
    canvasesButton: '[data-dg="roam-canvases"]',
    // A closed sidebar keeps its entries in place, but nobody can see or click them.
    showNavigation: async () => {
      await api.ui.leftSidebar?.open();
      await sleep(350);
    },
    browsing: {
      selector: ".rm-left-sidebar__all-pages",
      text: "Look for \"Canvas/Walkthrough canvas\" in All Pages. Search, links and shortcuts find it too, and the page shows the canvas.",
    },
    writeNote: async (title, lines) => {
      const made = await adapter.host.createText({ title, body: lines[0] ?? "" });
      if (!made.ok) throw new Error(made.error.message);
      for (const line of lines.slice(1)) await addBlock(made.value.ref, line);
      return made.value.ref;
    },
    readNote: async (ref) => {
      const text = await adapter.host.readText({ ref });
      return text.ok ? text.value.body : "";
    },
    openNote: async (ref) => {
      await api.ui.mainWindow.openPage({ page: { uid: ref } });
      await sleep(500);
    },
    select: async (ref, text) => {
      const page = api.data.pull("[{:block/children [:block/uid :block/string]}]", [":block/uid", ref]) as {
        ":block/children"?: { ":block/uid": string; ":block/string": string }[];
      } | null;
      const block = page?.[":block/children"]?.find((child) => child[":block/string"].includes(text));
      if (!block) return;
      const start = block[":block/string"].indexOf(text);
      await api.ui.setBlockFocusAndSelection({
        location: { "block-uid": block[":block/uid"], "window-id": "main-window" },
        selection: { start, end: start + text.length },
      });
      await sleep(300);
    },
    selectionBox: () => document.querySelector("textarea.rm-block-input")?.getBoundingClientRect() ?? null,
    leaveEditing: async () => {
      const editing = document.querySelector<HTMLTextAreaElement>("textarea.rm-block-input");
      if (!editing) return;
      editing.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      await sleep(250);
      // The first Escape leaves the block selected, and the second lets go of it.
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
      await sleep(250);
    },
    frame: (surface) => (surface === "canvas" ? canvasFrame : surface === "context" ? contextFrame : surface === "canvases" ? canvasesFrame : null),
    openCanvases: () => openSurface({ route: { surface: "canvases" }, placement: "side" }).then(() => {}),
    showCanvas: async (id) => {
      await openSurface({ route: { surface: "canvas", id }, placement: "main" });
    },
    closeExamples: async () => {
      await api.ui.mainWindow.openDailyNotes();
      leaveCanvasPage();
      await sleep(300);
    },
    getLocal: local.get,
    setLocal: local.set,
  };
};

const walkthrough = (): Promise<void> => walkthroughBase().then(startWalkthrough);

const addBlock = async (parent: string, string: string): Promise<string> => {
  const uid: string = api.util.generateUID();
  await api.data.block.create({
    location: { "parent-uid": parent, order: "last" },
    block: { string, uid },
  });
  return uid;
};

if (__TEST_HOOKS__) {
  installTestHooks({
    api,
    local,
    walkthrough,
    walkthroughBase,
    capture: (mode) => capture(mode),
    addBlock,
    openSurface,
    openDialog: (surface) => openDialog(surface),
    firstRun: () => firstRun(true),
    offer: () => offerNow(),
    ensureCore,
    ready: async () => (adapter ??= await makeAdapter()),
    fresh: makeAdapter,
    current: () => adapter,
    frames: () => ({ canvas: canvasFrame, context: contextFrame, canvases: canvasesFrame, dialog: dialogFrame }),
    forgetFrames: () => {
      canvasFrame = null;
      contextFrame = null;
      canvasesFrame = null;
    },
    testMode: (on) => {
      if (on !== undefined) testMode = on;
      return testMode;
    },
    sync: () => sync,
    panel: () => ({ panelMode, report: panelReport }),
    forgetPanel: () => {
      panelReport = null;
    },
    route: () => route,
  });
}

// The same two ways in as Obsidian's command palette.
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Open canvas",
  callback: () => void makeAdapter().then((made) => {
    adapter ??= made;
    return openSurface({ route: { surface: "canvas" }, placement: "main" });
  }),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Open context panel",
  callback: () => void makeAdapter().then((made) => {
    adapter ??= made;
    return openSurface({ route: { surface: "context" }, placement: "side" });
  }),
});
const openCanvases = (): void => void openSurface({ route: { surface: "canvases" }, placement: "side" });
api.ui.commandPalette?.addCommand?.({ label: "Discourse Graphs: Find a canvas", callback: openCanvases });
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Find a unit",
  callback: () => void ensureCore().then(() => openSurface({ route: { surface: "find" }, placement: "dialog" })),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Search units",
  callback: () => void ensureCore().then(() => openSurface({ route: { surface: "search" }, placement: "side" })),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: New canvas",
  callback: () =>
    void ensureCore().then((ready) =>
      askForName({
        label: "Canvas name",
        skin: ready.info.skin,
        onDone: (name) =>
          void ready.createCanvas({ title: name }).then((made) => {
            if (made.ok) void openSurface({ route: { surface: "canvas", id: made.value }, placement: "main" });
          }),
      }),
    ),
});

const CAPTURE_KEY = "\\";

/** The menu opens under the block being edited. */
const caret = (): { x: number; y: number } => {
  const box = (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
  return box ? { x: box.left, y: box.bottom + 4 } : { x: window.innerWidth / 3, y: window.innerHeight / 3 };
};

const capture = async (mode: "selection" | "page"): Promise<void> => {
  const ready = await ensureCore();
  startCapture({ core: ready, skin: ready.info.skin, at: caret(), mode });
};

// Only with a selection, so a plain backslash still types a backslash.
const onCaptureKey = (event: KeyboardEvent): void => {
  if (event.key !== CAPTURE_KEY || event.metaKey || event.ctrlKey) return;
  const input = document.activeElement as HTMLTextAreaElement | null;
  if (!input?.matches?.("textarea.rm-block-input") || input.selectionStart === input.selectionEnd) return;
  event.preventDefault();
  event.stopPropagation();
  void capture("selection");
};
const previous = (window as unknown as { dgCaptureKey?: (event: KeyboardEvent) => void }).dgCaptureKey;
if (previous) document.removeEventListener("keydown", previous, true);
(window as unknown as { dgCaptureKey?: (event: KeyboardEvent) => void }).dgCaptureKey = onCaptureKey;
document.addEventListener("keydown", onCaptureKey, true);

api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Create node from selection",
  callback: () => void capture("selection"),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Turn this page into a node",
  callback: () => void capture("page"),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Toggle link badges",
  callback: () => void ensureCore().then((ready) => ready.toggleBadges()),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Start walkthrough",
  callback: () => void walkthrough(),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Remove walkthrough examples",
  callback: () => void walkthroughBase().then(removeWalkthroughExamples),
});
api.ui.commandPalette?.addCommand?.({
  label: "Discourse Graphs: Set my name",
  callback: () =>
    void ensureCore().then((ready) =>
      askForName({ label: "Your name", skin: ready.info.skin, onDone: (name) => void ready.setName(name) }),
    ),
});

const openDialog = async (surface: "upload" | "welcome"): Promise<void> => {
  await ensureCore();
  await openSurface({ route: { surface }, placement: "dialog" });
};

/** First boot: the lab question comes first, then the offer of a walkthrough. */
const firstRun = async (always = false): Promise<void> => {
  if (testMode && !always) return;
  if (!(await local.get("welcome-shown"))) {
    await local.set("welcome-shown", true);
    await openDialog("welcome");
    return;
  }
  await offerNow();
};

api.ui.commandPalette?.addCommand?.({ label: "Discourse Graphs: Upload a paper", callback: () => void openDialog("upload") });
api.ui.commandPalette?.addCommand?.({ label: "Discourse Graphs: Join or start a lab", callback: () => void openDialog("welcome") });

const offerNow = async (): Promise<void> => {
  adapter ??= await makeAdapter();
  const info = await adapter.host.describe();
  if (!info.ok) return;
  await offerWalkthrough({
    skin: info.value.skin,
    getLocal: local.get,
    setLocal: local.set,
    onStart: () => void walkthrough(),
  });
};
window.setTimeout(() => {
  if (!testMode) void firstRun();
}, OFFER_DELAY_MS);

const pageWatch = window as unknown as { dgStopPages?: () => void };
pageWatch.dgStopPages?.();
pageWatch.dgStopPages = startCanvasPages({
  core: () => core,
  openPage: async () => ((await api.ui.mainWindow.getOpenPageOrBlockUid()) ?? null) as string | null,
  mountCanvas: (id) => {
    openCanvasId = id;
    return mountFrame({ surface: "canvas", id, pinned: true });
  },
  onUnmount: () => {
    canvasFrame = null;
    if (openCanvasId) void core?.canvasClosed({ id: openCanvasId });
    openCanvasId = null;
  },
  openPanel: openCanvases,
});

// A graph with no records has no nodes to badge, and loading alone shouldn't write any.
void makeAdapter().then(async (made) => {
  adapter ??= made;
  const stored = await adapter.host.listRecords({ limit: 1 });
  if (stored.ok && stored.value.items.length > 0) await ensureCore();
});
