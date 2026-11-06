import {
  ItemView,
  MarkdownView,
  Plugin,
  type Editor,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { ExtractionGraph } from "@dg/contract/services.ts";
import { ok, type Placement, type SurfaceRoute } from "@dg/contract/host.ts";
import { createCore, type Core } from "@dg/core/index.ts";
import { createObsidianHost, ROOT, SURFACE_VIEW, type ObsidianHost } from "./host.ts";
import { testHooks } from "./testing.ts";
import { browserKeys } from "@dg/core/identity.ts";
import { askForName, startCapture } from "@dg/native/capture-menu.ts";
import { startBadges } from "./badges.ts";
import { connectFrame } from "@dg/native/frame.ts";
import { askBreadcrumb, closeDialogFrame, openDialogFrame } from "@dg/native/dialog.ts";
import { createServices } from "@dg/sync/client.ts";
import { startLabSync } from "@dg/sync/lab-sync.ts";
import {
  closeWalkthroughOffer,
  offerWalkthrough,
  removeWalkthroughExamples,
  startWalkthrough,
  type WalkthroughBase,
} from "@dg/native/walkthrough.ts";

declare const __PANEL_HTML__: string;
declare const __CANVAS_HTML__: string;
declare const __CANVAS_BUILD__: string;
declare const __DEMO_GRAPHS__: { filename: string; graph: ExtractionGraph }[];
declare const __TEST_HOOKS__: boolean;

const VIEW = SURFACE_VIEW;
const CAPTURE_KEY = "\\";
const OFFER_DELAY_MS = 3000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export class SurfaceView extends ItemView {
  route: SurfaceRoute = { surface: "canvas" };
  frame: HTMLIFrameElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly mount: (frame: HTMLIFrameElement, route: SurfaceRoute) => void,
    private readonly canvasName: (id: string) => string | null,
    private readonly closed: (id: string) => void,
  ) {
    super(leaf);
    this.navigation = false;
  }
  getViewType(): string {
    return VIEW;
  }
  getDisplayText(): string {
    if (this.route.surface === "context") return "Context";
    if (this.route.surface === "canvases") return "Library";
    return (this.route.id ? this.canvasName(this.route.id) : null) ?? "Canvas";
  }
  getIcon(): string {
    if (this.route.surface === "context") return "panel-right";
    return this.route.surface === "canvases" ? "layout-list" : "layout-dashboard";
  }
  getState(): Record<string, unknown> {
    return { route: this.route };
  }
  async setState(state: { route?: SurfaceRoute }, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const next = state?.route ?? this.route;
    if (this.frame && next.surface === this.route.surface && next.id === this.route.id) return;
    this.route = next;
    this.render();
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
  }
  async onOpen(): Promise<void> {
    if (!this.frame) this.render();
  }
  override async onClose(): Promise<void> {
    if (this.route.surface === "canvas" && this.route.id) this.closed(this.route.id);
  }
  private render(): void {
    this.contentEl.empty();
    this.contentEl.style.padding = "0";
    const frame = this.contentEl.createEl("iframe", {
      attr: {
        sandbox: "allow-scripts",
        srcdoc: this.route.surface === "check" ? __PANEL_HTML__ : __CANVAS_HTML__,
        title: "Discourse Graphs",
      },
    });
    frame.style.cssText = "border:0;width:100%;height:100%;display:block;";
    this.frame = frame;
    this.mount(frame, this.route);
  }
}

export default class DiscourseGraphsPlugin extends Plugin {
  adapter?: ObsidianHost;
  private core?: Core;
  private coreReady?: Promise<Core>;
  private badges?: ReturnType<typeof startBadges>;
  private hooks?: ReturnType<typeof testHooks>;
  panelReport: unknown = null;

  surfaceFrame(surface: SurfaceRoute["surface"] = "canvas"): HTMLIFrameElement | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW).filter((item) => (item.view as SurfaceView).route.surface === surface);
    // With several open, the one a person can see.
    const leaf = leaves.find((item) => item.view.containerEl.offsetParent !== null) ?? leaves[0];
    return leaf ? (leaf.view as SurfaceView).frame : null;
  }

  async writeReport(name: string, body: unknown): Promise<void> {
    await this.app.vault.adapter.write(
      `${ROOT}/${name}.json`,
      JSON.stringify(body, null, 1),
    );
  }

  private openSurface = async ({
    route,
    placement,
  }: {
    route: SurfaceRoute;
    placement: Placement;
  }) => {
    const { workspace } = this.app;
    if (placement === "dialog") {
      const core = await this.ensureCore();
      openDialogFrame({
        html: __CANVAS_HTML__,
        route,
        skin: core.info.skin,
        connect: (frame) =>
          connectFrame({
            frame,
            route,
            test: this.testMode,
            connect: async (port) => {
              core.connectSurface({ port });
            },
          }),
      });
      this.dialogFrame = document.querySelector<HTMLIFrameElement>('[data-dg="dialog"] iframe');
      return ok(null);
    }
    if (placement === "main") {
      const showing = route.id
        ? workspace.getLeavesOfType(VIEW).find((item) => {
            const shown = (item.view as SurfaceView).route;
            return shown.surface === route.surface && shown.id === route.id;
          })
        : undefined;
      if (showing) {
        await workspace.revealLeaf(showing);
        return ok(null);
      }
      const leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true, state: { route } });
      return ok(null);
    }
    // A side panel keeps a person company, so the note they were in keeps the keyboard.
    const writing = workspace.getActiveViewOfType(MarkdownView)?.leaf;
    const open = workspace.getLeavesOfType(VIEW).find((item) => (item.view as SurfaceView).route.surface === route.surface);
    const leaf = open ?? workspace.getRightLeaf(false);
    if (!leaf) return { ok: false as const, error: { code: "unavailable" as const, message: "No pane." } };
    if (!open) await leaf.setViewState({ type: VIEW, active: true, state: { route } });
    await workspace.revealLeaf(leaf);
    if (writing) workspace.setActiveLeaf(writing, { focus: true });
    return ok(null);
  };

  dialogFrame: HTMLIFrameElement | null = null;

  makeAdapter = async (): Promise<ObsidianHost> =>
    createObsidianHost({
      app: this.app,
      plugin: this,
      openSurface: this.openSurface,
      closeDialog: async () => {
        closeDialogFrame();
        this.dialogFrame = null;
        return ok(null);
      },
    });

  async onload(): Promise<void> {
    this.adapter = await this.makeAdapter();
    this.registerView(
      VIEW,
      (leaf) =>
        new SurfaceView(leaf, (frame, route) => {
          connectFrame({
            frame,
            route,
            test: this.testMode,
            connect: async (port) => {
              const core = await this.ensureCore();
              core.connectSurface({
                port,
                onReport: (report) => {
                  this.panelReport = report;
                  void this.writeReport("report-panel", report);
                },
              });
            },
          });
        }, (id) => this.core?.canvasTitle({ id }) ?? null, (id) => void this.core?.canvasClosed({ id })),
    );
    this.addCommand({
      id: "open-canvas",
      name: "Open canvas",
      callback: () => void this.openCanvas(),
    });
    this.addCommand({
      id: "find-canvas",
      name: "Find a canvas",
      callback: () => void this.openCanvases(),
    });
    this.addCommand({
      id: "new-canvas",
      name: "New canvas",
      callback: () => void this.newCanvas(),
    });
    this.addCommand({
      id: "upload-paper",
      name: "Upload a paper",
      callback: () => void this.openDialog("upload"),
    });
    this.addCommand({
      id: "join-or-start-lab",
      name: "Join or start a lab",
      callback: () => void this.openDialog("welcome"),
    });
    this.addCommand({
      id: "set-name",
      name: "Set my name",
      callback: () => void this.setMyName(),
    });
    this.addCommand({
      id: "start-walkthrough",
      name: "Start walkthrough",
      callback: () => void this.walkthrough(),
    });
    this.addCommand({
      id: "remove-walkthrough-examples",
      name: "Remove walkthrough examples",
      callback: () => void this.walkthroughBase().then(removeWalkthroughExamples),
    });
    this.addCommand({
      id: "capture-selection",
      name: "Create node from selection",
      editorCheckCallback: (checking, editor) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) void this.capture("selection");
        return true;
      },
    });
    this.addCommand({
      id: "convert-page",
      name: "Turn this note into a node",
      callback: () => void this.capture("page"),
    });
    // Only with a selection, so a plain backslash still types a backslash.
    this.registerDomEvent(
      document,
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== CAPTURE_KEY || event.metaKey || event.ctrlKey) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.editor.somethingSelected() || !view.editor.hasFocus()) return;
        event.preventDefault();
        event.stopPropagation();
        void this.capture("selection");
      },
      { capture: true },
    );
    this.addCommand({
      id: "toggle-link-badges",
      name: "Toggle link badges",
      callback: () => void this.ensureCore().then((core) => core.toggleBadges()),
    });
    this.addCommand({
      id: "open-context",
      name: "Open context panel",
      callback: () => void this.adapter!.host.openSurface({ route: { surface: "context" }, placement: "side" }),
    });
    this.addRibbonIcon("layout-dashboard", "Open Discourse Graphs canvas", () => void this.openCanvas());
    this.addRibbonIcon("layout-list", "Discourse Graphs canvases", () => void this.openCanvases());
    // A canvas's own note opens as the canvas, so links, search and the file tree all lead to it.
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        const id = file ? this.core?.canvasOfRef({ ref: this.adapter!.refOfFile(file) }) : null;
        if (!id) return;
        const leaf = this.app.workspace.getLeavesOfType("markdown").find((item) => (item.view as MarkdownView).file === file);
        if (leaf) void leaf.setViewState({ type: VIEW, active: true, state: { route: { surface: "canvas", id } } });
      }),
    );
    this.badges = startBadges({
      plugin: this,
      core: () => this.core,
      refOfFile: (file) => this.adapter!.refOfFile(file),
    });
    // A vault with no records has no nodes to badge, and loading alone shouldn't write any.
    this.app.workspace.onLayoutReady(() => {
      void this.adapter!.host.listRecords({ limit: 1 }).then((stored) => {
        if (stored.ok && stored.value.items.length > 0) void this.ensureCore();
      });
      window.setTimeout(() => void this.firstRun(), OFFER_DELAY_MS);
    });
  }

  local = {
    get: async (key: string): Promise<unknown> => {
      const stored = await this.adapter!.host.getLocal({ key });
      return stored.ok ? stored.value : null;
    },
    set: async (key: string, value: unknown): Promise<void> => {
      await this.adapter!.host.setLocal({ key, value: value as never });
    },
  };

  async openDialog(surface: "upload" | "welcome"): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface }, placement: "dialog" });
  }

  /** First boot: the lab question comes first, then the offer of a walkthrough. */
  async firstRun(always = false): Promise<void> {
    if (this.testMode && !always) return;
    if (!(await this.local.get("welcome-shown"))) {
      await this.local.set("welcome-shown", true);
      await this.openDialog("welcome");
      return;
    }
    await this.offer();
  }

  async offer(): Promise<void> {
    if (this.testMode) return;
    const info = await this.adapter!.host.describe();
    if (!info.ok) return;
    await offerWalkthrough({
      skin: info.value.skin,
      getLocal: this.local.get,
      setLocal: this.local.set,
      onStart: () => void this.walkthrough(),
    });
  }

  async walkthrough(): Promise<void> {
    await startWalkthrough(await this.walkthroughBase());
  }

  walkthroughBase = async (): Promise<WalkthroughBase> => {
    const core = await this.ensureCore();
    const { workspace } = this.app;
    const host = this.adapter!.host;
    const editor = (): (Editor & { cm?: { coordsAtPos: (at: number) => { left: number; right: number; top: number; bottom: number } | null } }) | undefined =>
      workspace.getActiveViewOfType(MarkdownView)?.editor ?? (workspace.getLeavesOfType("markdown")[0]?.view as MarkdownView | undefined)?.editor;
    return {
      core,
      place: "vault",
      note: "note",
      canvasesButton: '.side-dock-ribbon-action[aria-label="Discourse Graphs canvases"]',
      browsing: {
        selector: '.workspace-leaf-content[data-type="file-explorer"]',
        text: "Look for \"Canvas - Walkthrough canvas\" in your files. The quick switcher, search and links find it too, and opening it opens the canvas.",
      },
      writeNote: async (title, lines) => {
        const made = await host.createText({ title, body: lines.join("\n\n") });
        if (!made.ok) throw new Error(made.error.message);
        return made.value.ref;
      },
      readNote: async (ref) => {
        const text = await host.readText({ ref });
        return text.ok ? text.value.body : "";
      },
      openNote: async (ref) => {
        await host.reveal({ ref, placement: "main" });
        await sleep(350);
      },
      select: async (_ref, text) => {
        const open = editor();
        if (!open) return;
        const start = open.getValue().indexOf(text);
        if (start < 0) return;
        open.focus();
        open.setSelection(open.offsetToPos(start), open.offsetToPos(start + text.length));
      },
      selectionBox: () => {
        const open = editor();
        if (!open?.cm || !open.somethingSelected()) return null;
        const from = open.cm.coordsAtPos(open.posToOffset(open.getCursor("from")));
        const to = open.cm.coordsAtPos(open.posToOffset(open.getCursor("to")));
        return from && to ? new DOMRect(from.left, from.top, Math.max(to.right - from.left, 40), to.bottom - from.top) : null;
      },
      leaveEditing: async () => {},
      frame: (surface) => this.surfaceFrame(surface as SurfaceRoute["surface"]),
      openCanvases: () => this.openCanvases(),
      showCanvas: async (id) => {
        await host.openSurface({ route: { surface: "canvas", id }, placement: "main" });
      },
      closeExamples: async ({ canvases, texts }) => {
        for (const leaf of workspace.getLeavesOfType(VIEW)) {
          const { id, surface } = (leaf.view as SurfaceView).route;
          if (surface === "canvas" && id && canvases.includes(id)) leaf.detach();
        }
        for (const leaf of workspace.getLeavesOfType("markdown")) {
          const { file } = leaf.view as MarkdownView;
          if (file && texts.includes(this.adapter!.refOfFile(file))) leaf.detach();
        }
      },
      getLocal: this.local.get,
      setLocal: this.local.set,
    };
  };

  testMode = false;

  /** The menu opens under the end of the selection. */
  private caret(): { x: number; y: number } {
    const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor as
      | (Editor & { cm?: { coordsAtPos: (at: number) => { left: number; bottom: number } | null } })
      | undefined;
    const spot = editor?.cm?.coordsAtPos(editor.posToOffset(editor.getCursor("to")));
    return spot ? { x: spot.left, y: spot.bottom + 4 } : { x: window.innerWidth / 3, y: window.innerHeight / 3 };
  }

  async capture(mode: "selection" | "page"): Promise<void> {
    const core = await this.ensureCore();
    startCapture({ core, skin: core.info.skin, at: this.caret(), mode });
  }

  async openCanvases(): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface: "canvases" }, placement: "side" });
  }

  async newCanvas(): Promise<void> {
    const core = await this.ensureCore();
    askForName({
      label: "Canvas name",
      skin: core.info.skin,
      onDone: (name) =>
        void core.createCanvas({ title: name }).then((made) => {
          if (made.ok) void this.adapter!.host.openSurface({ route: { surface: "canvas", id: made.value }, placement: "main" });
        }),
    });
  }

  async setMyName(): Promise<void> {
    const core = await this.ensureCore();
    askForName({ label: "Your name", skin: core.info.skin, onDone: (name) => void core.setName(name) });
  }

  async openCanvas(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(VIEW).find((leaf) => (leaf.view as SurfaceView).route.surface === "canvas");
    if (open) {
      await this.app.workspace.revealLeaf(open);
      return;
    }
    await this.adapter!.host.openSurface({ route: { surface: "canvas" }, placement: "main" });
  }

  onunload(): void {
    this.sync?.stop();
    this.hooks?.stop();
    this.core?.stop();
    this.adapter?.dispose();
  }

  private services = createServices({
    fetch: (input, init) => window.fetch(input, init),
    store: { get: (key) => this.local.get(key), set: (key, value) => this.local.set(key, value) },
  });
  sync?: ReturnType<typeof startLabSync>;

  ensureCore = async (): Promise<Core> => {
    this.coreReady ??= createCore({
      host: this.adapter!.host,
      keys: browserKeys(),
      services: this.services,
      demoGraphs: __DEMO_GRAPHS__,
      askBreadcrumb: (paper) =>
        askBreadcrumb({
          skin: this.core!.info.skin,
          title: paper.title,
          onAnswer: (leave, remember) => void this.core!.answerBreadcrumb({ paper: paper.id, leave, remember }),
        }),
    }).then((made) => {
      this.core = made;
      made.onGraphChange(() => this.badges?.refresh());
      this.badges?.refresh();
      this.sync = startLabSync({ services: this.services, target: made });
      return made;
    });
    return this.coreReady;
  };

  /** What the real-host test scripts drive. Left out of a release build. */
  get slice(): ReturnType<typeof testHooks> | undefined {
    return __TEST_HOOKS__ ? (this.hooks ??= testHooks(this)) : undefined;
  }
}
