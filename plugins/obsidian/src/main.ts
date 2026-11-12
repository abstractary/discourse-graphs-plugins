import {
  App,
  ItemView,
  MarkdownView,
  Menu,
  Notice,
  TFile,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
  type Editor,
  type ViewStateResult,
  type WorkspaceLeaf,
  type WorkspaceSplit,
} from "obsidian";
import type { ExtractionGraph } from "@dg/contract/services.ts";
import { ok, type Placement, type SurfaceRoute } from "@dg/contract/host.ts";
import type { SurfacePort } from "@dg/contract/surface.ts";
import { createCore, type Core } from "@dg/core/index.ts";
import { createObsidianHost, ROOT, SURFACE_VIEW, type ObsidianHost } from "./host.ts";
import { testHooks } from "./testing.ts";
import { browserKeys } from "@dg/core/identity.ts";
import { askForName, startCapture } from "@dg/native/capture-menu.ts";
import { startBadges } from "./badges.ts";
import { connectFrame } from "@dg/native/frame.ts";
import { askBreadcrumb, closeDialogFrame, openDialogFrame } from "@dg/native/dialog.ts";
import { createServices } from "@dg/sync/client.ts";
import { createLlm } from "@dg/sync/providers.ts";
import { AI_PROVIDERS, type SecretStore } from "@dg/contract/llm.ts";
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
declare const __PDF_HTML__: string;
declare const __CANVAS_BUILD__: string;
declare const __DEMO_GRAPHS__: { filename: string; graph: ExtractionGraph }[];
declare const __TEST_HOOKS__: boolean;

const VIEW = SURFACE_VIEW;
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
    private readonly menuOf: (menu: Menu, here: SurfaceRoute["surface"]) => void,
    private readonly unitName: (id: string) => string | null = () => null,
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
    if (this.route.surface === "holon") return "Holons";
    if (this.route.surface === "boundary") return "Holon boundary";
    if (this.route.surface === "pdf") return this.route.id?.split("/").pop()?.replace(/\.pdf$/i, "") ?? "PDF";
    if (this.route.surface === "search") return "Search units";
    if (this.route.surface === "run") return (this.route.id ? this.unitName(this.route.id) : null) ?? "Runs and notebooks";
    return (this.route.id ? this.canvasName(this.route.id) : null) ?? "Canvas";
  }
  getIcon(): string {
    if (this.route.surface === "context") return "panel-right";
    if (this.route.surface === "holon") return "network";
    if (this.route.surface === "boundary") return "layers";
    if (this.route.surface === "pdf") return "file-text";
    if (this.route.surface === "search") return "search";
    if (this.route.surface === "run") return "flask-conical";
    return this.route.surface === "canvases" ? "layout-list" : "layout-dashboard";
  }
  getState(): Record<string, unknown> {
    return { route: this.route };
  }
  /** Every Discourse Graphs panel is one step away from the ⋯ menu of any of them. */
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (source === "more-options") this.menuOf(menu, this.route.surface);
  }
  async setState(state: { route?: SurfaceRoute }, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const next = state?.route ?? this.route;
    if (this.frame && next.surface === this.route.surface && next.id === this.route.id) return;
    this.route = next;
    this.render();
    this.retitle();
  }
  async onOpen(): Promise<void> {
    if (!this.frame) this.render();
    this.retitle();
  }
  /** The tab and the header above the panel both say what it shows. */
  retitle(): void {
    (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
    this.containerEl.querySelector(".view-header-title")?.setText(this.getDisplayText());
  }
  override async onClose(): Promise<void> {
    if (this.route.surface === "canvas" && this.route.id) this.closed(this.route.id);
  }
  /**
   * The canvas moved to another canvas inside this tab, such as going into a
   * holon. The tab takes it as its route, so its title, its saved layout and a
   * restart all follow, without reloading the frame.
   */
  adopt(id: string): void {
    if ((this.route.surface !== "canvas" && this.route.surface !== "pdf") || this.route.id === id) return;
    if (this.route.surface === "canvas" && this.route.id) this.closed(this.route.id);
    this.route = { ...this.route, id };
    this.retitle();
    this.app.workspace.requestSaveLayout();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.style.padding = "0";
    const frame = this.contentEl.createEl("iframe", {
      attr: {
        sandbox: "allow-scripts",
        srcdoc: this.route.surface === "check" ? __PANEL_HTML__ : this.route.surface === "pdf" ? __PDF_HTML__ : __CANVAS_HTML__,
        title: "Discourse Graphs",
      },
    });
    frame.style.cssText = "border:0;width:100%;height:100%;display:block;";
    this.frame = frame;
    this.mount(frame, this.route);
  }
}

/** Notices when a frame says it now shows another canvas, or another PDF. */
const watchRoute = (port: SurfacePort, onShown: (id: string) => void): SurfacePort => ({
  send: (message) => port.send(message),
  onMessage: (listener) =>
    port.onMessage((message) => {
      const call = message as { method?: string; params?: { canvas?: string; ref?: string; data?: boolean } };
      if (call.method === "holon.focus.set" && call.params?.canvas) onShown(call.params.canvas);
      if (call.method === "pdf.open" && call.params?.ref && call.params.data !== false) onShown(call.params.ref);
      listener(message);
    }),
});

/**
 * Everything a person can choose, in one place, grouped by what it affects.
 * The page is drawn at once and filled in when the core answers, so opening
 * Settings never waits. Choices are per device and kept by the core, so every
 * panel sees the same ones. A model key goes to the keychain, never to `data.json`.
 */
class DiscourseGraphsSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: DiscourseGraphsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("dg-settings");
    const { plugin } = this;
    const heading = (title: string, about?: string): void => {
      const made = new Setting(containerEl).setName(title).setHeading();
      if (about) made.setDesc(about);
    };

    // ---------------------------------------------------------------- You
    heading("You");
    const name = new Setting(containerEl).setName("Your name").setDesc("Shown on the units, relations and canvases you make.");
    const lab = new Setting(containerEl).setName("Lab").setDesc("Checking…");
    lab.addButton((button) => button.setButtonText("Join or start a lab").onClick(() => void plugin.openDialog("welcome")));

    // ---------------------------------------------------------------- AI
    heading("Ask AI", "Whose model answers questions about a canvas. With none set up, a question quotes the closest units word for word.");
    const source = new Setting(containerEl).setName("Model").setDesc("Checking…");
    const provider = new Setting(containerEl).setName("Provider");
    const address = new Setting(containerEl).setName("Address").setDesc("For OpenAI, OpenRouter, or a model server on this computer such as Ollama (http://localhost:11434/v1).");
    const key = new Setting(containerEl).setName("API key");
    const model = new Setting(containerEl).setName("Model name");
    const route = new Setting(containerEl).setName("Send questions").setDesc("Straight from this device to the provider, or through your lab's server, which uses the key for that one question and doesn't keep it.");
    const test = new Setting(containerEl).setName("Check the setup").setDesc("Sends one short test message with the saved key.");

    // ---------------------------------------------------------------- Notes
    heading("In your notes");
    const capture = new Setting(containerEl)
      .setName("Key that makes a node from selected text")
      .setDesc("With text selected in a note, this key opens the list of node types. Leave it empty to turn the key off; “Create node from selection” stays in the command palette and can take any hotkey.");
    const badges = new Setting(containerEl).setName("Type badges on links").setDesc("Shows a node's type beside each link to it in your notes.");
    new Setting(containerEl)
      .setName("Hotkeys")
      .setDesc("Every Discourse Graphs action is a command, so each can have a key of your choosing.")
      .addButton((button) =>
        button.setButtonText("Open hotkeys").onClick(() => {
          const setting = (this.app as unknown as { setting?: { openTabById: (id: string) => { searchComponent?: { setValue: (value: string) => void }; updateHotkeyVisibility?: () => void } | undefined } }).setting;
          const tab = setting?.openTabById("hotkeys");
          tab?.searchComponent?.setValue("Discourse Graphs");
          tab?.updateHotkeyVisibility?.();
        }),
      );

    // ---------------------------------------------------------------- Canvas
    heading("Canvas");
    const links = new Setting(containerEl)
      .setName("When you delete a link between cards")
      .setDesc("A link can come off this canvas only, or its relation can be withdrawn from the graph. Only the person who asserted a relation can withdraw it. Undo brings either back.");

    // ---------------------------------------------------------------- Reading and notebooks
    heading("Papers and notebooks");
    new Setting(containerEl)
      .setName("PDFs")
      .setDesc("Obsidian's own viewer stays the default. “Read this PDF” on a file, or “Read a PDF…”, opens it beside the canvas, where a highlight becomes a unit. A PDF you drop into the reader is kept in the “Paper files” folder.");
    const notebookText = new Setting(containerEl)
      .setName("Keep printed text from notebooks")
      .setDesc("Reading a Jupyter notebook always keeps its figures and tables as outputs. Turn this on to keep printed text and plain results too.");

    // ---------------------------------------------------------------- Help
    heading("Help and privacy");
    new Setting(containerEl)
      .setName("Walkthrough")
      .setDesc("A short tour on your own graph. Its example units can be removed afterwards.")
      .addButton((button) => button.setButtonText("Start").onClick(() => void plugin.walkthrough()))
      .addButton((button) => button.setButtonText("Remove examples").onClick(() => void plugin.walkthroughBase().then(removeWalkthroughExamples)));
    const usage = new Setting(containerEl).setName("Usage log").setDesc("Checking…");
    new Setting(containerEl)
      .setName("What leaves this device")
      .setDesc(
        "Nothing, until you choose it. A lab you join receives the canvases you share with it. A model provider you set up above receives your question and the units on the canvas you ask about. Papers you upload go to the server you pick in the upload dialog.",
      );

    void plugin.ensureCore().then(async (core) => {
      const prefs = await core.prefs();

      name.addText((text) => {
        text.setValue(core.personName() ?? "").setPlaceholder("Your name");
        text.inputEl.addEventListener("change", () => {
          const next = text.getValue().trim();
          if (next) void core.setName(next);
        });
      });
      const link = await plugin.labLink();
      lab.setDesc(link?.token ? `You're in ${link.name}. Shared canvases sync with ${link.server}.` : link?.pending ? `Waiting for ${link.name} to accept your request.` : "You're not in a lab. Everything stays on this device.");

      // --- AI: redrawn from the saved setup after each change, so the rows always show what is stored.
      const drawAi = async (): Promise<void> => {
        const ai = await core.ai.settings();
        const spec = AI_PROVIDERS.find((item) => item.kind === ai.provider)!;
        const own = ai.source === "own";
        for (const row of [source, provider, address, key, model, route, test]) row.controlEl.empty();
        const kept = { keychain: "Obsidian's keychain (Settings → Keychain), encrypted by the operating system", file: "a file on this computer", plain: "this vault's plugin data on this device, unencrypted, because this version of Obsidian has no keychain", nowhere: "nowhere" }[ai.keptIn];

        source.setDesc(ai.inLab ? "Your lab has a model. You can use it, or your own." : "You're not in a lab, so answers come from your own key.");
        source.addDropdown((dropdown) => {
          if (ai.inLab) dropdown.addOption("lab", "My lab's model");
          dropdown
            .addOption("own", "My own key")
            .setValue(ai.inLab ? ai.source : "own")
            .onChange((value) => void core.ai.configure({ source: value as "lab" | "own" }).then(drawAi));
        });
        for (const row of [provider, address, key, model, route, test]) row.settingEl.toggle(own || !ai.inLab);
        address.settingEl.toggle((own || !ai.inLab) && spec.customUrl);
        route.settingEl.toggle(own && ai.inLab);

        provider.addDropdown((dropdown) => {
          for (const item of AI_PROVIDERS) dropdown.addOption(item.kind, item.label);
          dropdown.setValue(ai.provider).onChange((value) => void core.ai.configure({ provider: value as typeof ai.provider }).then(drawAi));
        });
        address.addText((text) => {
          text.setPlaceholder(spec.baseUrl).setValue(ai.baseUrl ?? "");
          text.inputEl.addEventListener("change", () => void core.ai.configure({ baseUrl: text.getValue() }).then(drawAi, (error: Error) => new Notice(error.message)));
        });

        key.setDesc(`${spec.keyHelp} ${ai.hasKey ? `A key ending ${ai.keyHint ?? "…"} is saved in ${kept}.` : `It will be kept in ${kept}.`} It is never written to your notes.`);
        key.addText((text) => {
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.setPlaceholder(ai.hasKey ? "Paste a new key to replace it" : "Paste your key");
          text.inputEl.addEventListener("change", () => {
            const value = text.getValue().trim();
            if (value) void core.ai.configure({ key: value, source: "own" }).then(drawAi);
          });
        });
        if (ai.hasKey) key.addButton((button) => button.setButtonText("Remove").setWarning().onClick(() => void core.ai.configure({ key: null }).then(drawAi)));

        model.setDesc("Chosen from the list your key can use. If the list can't be read, type the model's id.");
        let listed: { id: string; label?: string }[] = [];
        try {
          listed = ai.hasKey || !spec.needsKey ? await core.ai.models({}) : [];
        } catch {
          listed = [];
        }
        if (listed.length) {
          model.addDropdown((dropdown) => {
            if (!listed.some((item) => item.id === ai.model) && ai.model) dropdown.addOption(ai.model, ai.model);
            for (const item of listed) dropdown.addOption(item.id, item.label ? `${item.label} (${item.id})` : item.id);
            dropdown.setValue(ai.model).onChange((value) => void core.ai.configure({ model: value }));
          });
        } else {
          model.addText((text) => {
            text.setPlaceholder(spec.defaultModel || "A model id").setValue(ai.model);
            text.inputEl.addEventListener("change", () => void core.ai.configure({ model: text.getValue().trim() }));
          });
        }

        route.addDropdown((dropdown) =>
          dropdown
            .addOption("device", "Straight from this device")
            .addOption("lab", "Through my lab's server")
            .setValue(ai.route)
            .onChange((value) => void core.ai.configure({ route: value as "device" | "lab" }).then(drawAi)),
        );
        test.addButton((button) =>
          button.setButtonText("Test").onClick(async () => {
            button.setDisabled(true).setButtonText("Testing…");
            const result = await core.ai.test();
            test.setDesc(result.ok ? `It works. ${result.message}` : result.message);
            button.setDisabled(false).setButtonText("Test");
          }),
        );
      };
      await drawAi();

      capture.addText((text) => {
        text.setValue(prefs.captureKey).setPlaceholder("Off");
        text.inputEl.maxLength = 1;
        text.inputEl.style.width = "4em";
        text.inputEl.addEventListener("change", () => {
          const next = text.getValue().trim().slice(0, 1);
          plugin.captureKey = next;
          void core.setPrefs({ captureKey: next });
        });
      });
      badges.addToggle((toggle) => toggle.setValue(core.badgesOn()).onChange((on) => void (on !== core.badgesOn() ? core.toggleBadges() : null)));
      links.addDropdown((dropdown) =>
        dropdown
          .addOption("ask", "Ask each time")
          .addOption("canvas", "Take it off this canvas only")
          .addOption("withdraw", "Withdraw the relation, if it's mine")
          .setValue(prefs.linkDelete)
          .onChange((value) => void core.setPrefs({ linkDelete: value as "ask" | "canvas" | "withdraw" })),
      );
      notebookText.addToggle((toggle) => toggle.setValue(prefs.notebookText).onChange((on) => void core.setPrefs({ notebookText: on })));

      const drawUsage = (): void => {
        const count = core.usageCount();
        usage.setDesc(`A list of which actions you used, kept on this device to show what gets used. It holds no titles or text, and nothing sends it anywhere. ${count} ${count === 1 ? "entry" : "entries"} now.`);
      };
      drawUsage();
      usage.addButton((button) => button.setButtonText("Clear").onClick(() => void core.clearUsage().then(drawUsage)));
    });
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
    if (placement === "main" && route.surface === "pdf") {
      await this.openPdf(route.id);
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
      const surfaces = workspace.getLeavesOfType(VIEW);
      const surfaceOf = (item: WorkspaceLeaf) => (item.view as SurfaceView).route.surface;
      // A run's page replaces the run list or the last run, the way a link does: one tab for runs.
      const runs = route.surface === "run" ? surfaces.find((item) => surfaceOf(item) === "run") : undefined;
      if (runs) {
        await runs.setViewState({ type: VIEW, active: true, state: { route } });
        await workspace.revealLeaf(runs);
        return ok(null);
      }
      // A canvas opened while a paper is being read goes beside the reader, never over it.
      const reader = route.surface === "canvas" ? surfaces.find((item) => surfaceOf(item) === "pdf") : undefined;
      if (reader) {
        const beside = surfaces.find((item) => surfaceOf(item) === "canvas" && item.parent !== reader.parent);
        const leaf = beside ? workspace.createLeafInParent(beside.parent as unknown as WorkspaceSplit, (beside.parent as unknown as { children: unknown[] }).children.length) : workspace.createLeafBySplit(reader, "vertical", true);
        await leaf.setViewState({ type: VIEW, active: true, state: { route } });
        await workspace.revealLeaf(leaf);
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
  /** The key that makes a node from selected text. Read from the device's choices; empty means off. */
  captureKey = "\\";

  /** The quick finder. A link it inserts goes where the cursor was in the note. */
  async findUnit(intent?: "link"): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface: "find", ...(intent ? { id: intent } : {}) }, placement: "dialog" });
  }

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
    const stored = (await this.local.get("prefs")) as { captureKey?: string } | null;
    if (typeof stored?.captureKey === "string") this.captureKey = stored.captureKey;
    this.registerView(VIEW, (leaf) => {
      const view: SurfaceView = new SurfaceView(leaf, (frame, route) => {
          connectFrame({
            frame,
            route,
            test: this.testMode,
            connect: async (port) => {
              const core = await this.ensureCore();
              core.connectSurface({
                port: watchRoute(port, (id) => view.adopt(id)),
                onReport: (report) => {
                  this.panelReport = report;
                  void this.writeReport("report-panel", report);
                },
              });
              // A canvas's name is known once the core is.
              view.retitle();
            },
          });
        }, (id) => this.core?.canvasTitle({ id }) ?? null, (id) => void this.core?.canvasClosed({ id }), (menu, here) => this.fillMenu(menu, here), (id) => this.core?.unitTitle(id) ?? null);
      return view;
    });
    this.addCommand({
      id: "open-canvas",
      name: "Open canvas",
      icon: "layout-dashboard",
      callback: () => void this.openCanvas(),
    });
    this.addCommand({
      id: "find-canvas",
      name: "Open the Library",
      icon: "library",
      callback: () => void this.openCanvases(),
    });
    this.addCommand({
      id: "new-canvas",
      name: "New canvas",
      icon: "square-plus",
      callback: () => void this.newCanvas(),
    });
    this.addCommand({
      id: "upload-paper",
      name: "Upload a paper",
      icon: "upload",
      callback: () => void this.openDialog("upload"),
    });
    this.addCommand({
      id: "join-or-start-lab",
      name: "Join or start a lab",
      icon: "users",
      callback: () => void this.openDialog("welcome"),
    });
    this.addCommand({
      id: "set-name",
      name: "Set my name",
      icon: "user",
      callback: () => void this.setMyName(),
    });
    this.addCommand({
      id: "start-walkthrough",
      name: "Start walkthrough",
      icon: "route",
      callback: () => void this.walkthrough(),
    });
    this.addCommand({
      id: "remove-walkthrough-examples",
      name: "Remove walkthrough examples",
      icon: "trash-2",
      callback: () => void this.walkthroughBase().then(removeWalkthroughExamples),
    });
    this.addCommand({
      id: "capture-selection",
      name: "Create node from selection",
      icon: "circle-plus",
      editorCheckCallback: (checking, editor) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) void this.capture("selection");
        return true;
      },
    });
    this.addCommand({
      id: "convert-page",
      name: "Turn this note into a node",
      icon: "file-plus",
      callback: () => void this.capture("page"),
    });
    // Only with a selection, so a plain backslash still types a backslash.
    this.registerDomEvent(
      document,
      "keydown",
      (event: KeyboardEvent) => {
        // AltGr reports Ctrl and Alt together, and is how many layouts type a backslash.
        const altGr = event.ctrlKey && event.altKey;
        if (!this.captureKey || event.key !== this.captureKey || event.metaKey || (event.ctrlKey && !altGr)) return;
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
      icon: "tag",
      callback: () => void this.ensureCore().then((core) => core.toggleBadges()),
    });
    this.addCommand({
      id: "open-context",
      name: "Open context panel",
      icon: "panel-right",
      callback: () => void this.adapter!.host.openSurface({ route: { surface: "context" }, placement: "side" }),
    });
    // No default hotkey: Obsidian's guidelines leave keys to the person. Both show in the command palette.
    this.addCommand({
      id: "find-unit",
      name: "Find a unit",
      icon: "text-search",
      callback: () => void this.findUnit(),
    });
    this.addCommand({
      id: "search-units",
      name: "Search units",
      icon: "search",
      callback: () => void this.adapter!.host.openSurface({ route: { surface: "search" }, placement: "side" }),
    });
    this.addCommand({
      id: "open-holons",
      name: "Open holons",
      icon: "network",
      callback: () => void this.openHolons(),
    });
    this.addCommand({
      id: "open-holon-boundary",
      name: "Open holon boundary",
      icon: "layers",
      callback: () => void this.openBoundary(),
    });
    this.addCommand({
      id: "open-runs",
      name: "Open runs and notebooks",
      icon: "flask-conical",
      callback: () => void this.openRuns(),
    });
    this.addCommand({
      id: "read-this-notebook",
      name: "Read this notebook into the graph",
      icon: "notebook-pen",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "ipynb") return false;
        if (!checking) void this.readNotebook(file.path);
        return true;
      },
    });
    this.addCommand({
      id: "open-pdf",
      name: "Read a PDF…",
      icon: "file-text",
      callback: () => void this.openPdf(),
    });
    this.addCommand({
      id: "extract-graph",
      name: "Extract graph from this PDF",
      icon: "sparkles",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "pdf") return false;
        if (!checking) void this.extractGraph(file.path);
        return true;
      },
    });
    this.addCommand({
      id: "read-this-pdf",
      name: "Read this PDF",
      icon: "file-text",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "pdf") return false;
        if (!checking) void this.openPdf(file.path);
        return true;
      },
    });
    // Obsidian's own viewer stays the default; reading into the graph is one click away.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "ipynb") {
          menu.addItem((item) =>
            item
              .setTitle("Read into Discourse Graphs")
              .setIcon("notebook-pen")
              .onClick(() => void this.readNotebook(file.path)),
          );
        }
        if (!(file instanceof TFile) || file.extension !== "pdf") return;
        menu.addItem((item) =>
          item
            .setTitle("Read in Discourse Graphs")
            .setIcon("file-text")
            .onClick(() => void this.openPdf(file.path)),
        );
        menu.addItem((item) =>
          item
            .setTitle("Extract graph")
            .setIcon("sparkles")
            .onClick(() => void this.extractGraph(file.path)),
        );
      }),
    );
    // Right-clicking in a note offers the two things a note leads to: a node from the words, or a link to one.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (editor.somethingSelected()) {
          menu.addItem((item) =>
            item.setTitle("Create node from selection").setIcon("circle-plus").setSection("discourse-graphs").onClick(() => void this.capture("selection")),
          );
        }
        menu.addItem((item) =>
          item.setTitle("Link a unit…").setIcon("text-search").setSection("discourse-graphs").onClick(() => void this.findUnit("link")),
        );
      }),
    );
    this.addSettingTab(new DiscourseGraphsSettings(this.app, this));
    // One ribbon icon, as Obsidian asks of plugins: it opens every panel and action, grouped. Each is a command too.
    this.addRibbonIcon("network", "Discourse Graphs", (event) => {
      const menu = new Menu();
      this.fillMenu(menu);
      menu.showAtMouseEvent(event);
    });
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

  /**
   * Everything the plugin opens, grouped the way the canvas bar groups it: the
   * ribbon's menu, and each panel's ⋯ menu. The panel already showing is left out.
   */
  fillMenu(menu: Menu, here?: SurfaceRoute["surface"]): void {
    const section = "discourse-graphs";
    const label = (title: string) => menu.addItem((item) => item.setTitle(title).setIsLabel(true).setSection(section));
    const add = (title: string, icon: string, run: () => unknown, surface?: SurfaceRoute["surface"]) => {
      if (surface && surface === here) return;
      menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(() => void run()));
    };
    // In a panel's ⋯ menu it's one titled group; from the ribbon, each group has its own heading.
    const group = (title: string) => (here ? null : label(title));
    if (here) {
      menu.addSeparator();
      label("Discourse Graphs");
    }
    group("Canvases");
    add("Open canvas", "layout-dashboard", () => this.openCanvas(), "canvas");
    add("Library", "library", () => this.openCanvases(), "canvases");
    add("Holons", "network", () => this.openHolons(), "holon");
    add("New canvas…", "square-plus", () => this.newCanvas());
    group("Panels");
    add("Search units", "search", () => this.openSide("search"), "search");
    add("Context", "panel-right", () => this.openSide("context"), "context");
    add("Holon boundary", "layers", () => this.openBoundary(), "boundary");
    group("Find and read");
    add("Find a unit…", "text-search", () => this.findUnit());
    add("Read a PDF…", "file-text", () => this.openPdf());
    add("Upload a paper…", "upload", () => this.openDialog("upload"));
    add("Runs and notebooks", "flask-conical", () => this.openRuns(), "run");
    if (!here) menu.addSeparator();
    add("Settings", "settings", () => this.openSettings());
  }

  labLink = () => this.services.link();

  async openRuns(id?: string): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface: "run", ...(id ? { id } : {}) }, placement: "main" });
  }

  /** A saved notebook becomes its code, the run saved in it and its outputs. Then the run's page opens. */
  async readNotebook(path: string): Promise<void> {
    const core = await this.ensureCore();
    try {
      const made = await core.importNotebook({ ref: path, text: (await core.prefs()).notebookText });
      new Notice(
        made.known
          ? "This exact run is already in the graph, so nothing was added."
          : `Read a ${made.status} run with ${made.outputs.length} ${made.outputs.length === 1 ? "output" : "outputs"}.`,
      );
      await this.openRuns(made.run.id);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Reads a whole PDF into a graph and opens its canvas. A saved extraction
   * beside the file is used as it is; with none, the upload dialog opens on
   * this file so the person picks where it's read.
   */
  async extractGraph(path: string): Promise<void> {
    const core = await this.ensureCore();
    try {
      const name = path.split("/").pop()!;
      const saved = await core.savedExtraction({ name, ref: path });
      if (!saved) {
        await this.adapter!.host.openSurface({ route: { surface: "upload", id: path }, placement: "dialog" });
        return;
      }
      const paper = await core.extractPaper({ ref: path, saved: true });
      new Notice(`Read ${paper.units} units and ${paper.relations} links from ${saved.name}.`);
      await core.showCanvas(paper.canvas);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async openSide(surface: "search" | "context"): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface }, placement: "side" });
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

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
      canvasesButton: '.side-dock-ribbon-action[aria-label="Discourse Graphs"]',
      canvasesHint: "Click the Discourse Graphs icon here, then Library, to see your canvases.",
      menus: ".menu",
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

  /** The boundary of the holon in focus, in the right sidebar beside the context panel. */
  async openBoundary(): Promise<void> {
    await this.ensureCore();
    await this.adapter!.host.openSurface({ route: { surface: "boundary" }, placement: "side" });
  }

  /** The note's unit as a holon: its own canvas, made from the graph if it has none. */
  async openNoteAsHolon(): Promise<void> {
    const core = await this.ensureCore();
    const node = core.focusedNode();
    const ref = node ? await core.locateHolon(node) : null;
    if (!ref) {
      await this.openHolons(node ? `unit|${node}` : undefined);
      return;
    }
    const { id } = await core.holonCanvas(ref);
    await this.adapter!.host.openSurface({ route: { surface: "canvas", id }, placement: "main" });
    await this.openBoundary();
  }

  /** The holon explorer in a tab: the top of the holarchy, or a holon without a canvas. */
  async openHolons(id?: string): Promise<void> {
    await this.ensureCore();
    const { workspace } = this.app;
    const open = workspace.getLeavesOfType(VIEW).find((leaf) => (leaf.view as SurfaceView).route.surface === "holon");
    const route = { surface: "holon" as const, ...(id ? { id } : {}) };
    if (open && (open.view as SurfaceView).route.id === route.id) {
      await workspace.revealLeaf(open);
      return;
    }
    const leaf = open ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true, state: { route } });
    await workspace.revealLeaf(leaf);
  }

  /**
   * The reader in the main area, split beside the canvas so a highlight lands
   * where it can be seen. One reader at a time: a second PDF replaces the first.
   */
  async openPdf(ref?: string): Promise<void> {
    await this.ensureCore();
    const { workspace } = this.app;
    const route = { surface: "pdf" as const, ...(ref ? { id: ref } : {}) };
    const surfaces = workspace.getLeavesOfType(VIEW);
    const open = surfaces.find((leaf) => (leaf.view as SurfaceView).route.surface === "pdf");
    if (open) {
      // With no file named, the reader goes back to its list of PDFs, as it would with no reader open.
      if ((open.view as SurfaceView).route.id !== ref) await open.setViewState({ type: VIEW, active: true, state: { route } });
      await workspace.revealLeaf(open);
      return;
    }
    const canvas =
      surfaces.find((leaf) => (leaf.view as SurfaceView).route.surface === "canvas" && leaf.view.containerEl.offsetParent !== null) ??
      surfaces.find((leaf) => (leaf.view as SurfaceView).route.surface === "canvas");
    const leaf = canvas ? workspace.createLeafBySplit(canvas, "vertical") : workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true, state: { route } });
    await workspace.revealLeaf(leaf);
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

  /**
   * A model key goes in Obsidian's keychain (Settings → Keychain), which the
   * operating system encrypts and which stays out of the vault and out of
   * `data.json`. Before Obsidian 1.11.4 there is no keychain, so the key is
   * kept with the plugin's other device-only values and the panel says so.
   */
  private secrets = (): SecretStore => {
    const keychain = (this.app as App & { secretStorage?: { getSecret: (id: string) => string | null; setSecret: (id: string, secret: string) => void } }).secretStorage;
    if (keychain) {
      return {
        kind: "keychain",
        get: async (id) => keychain.getSecret(id) || null,
        // The keychain has no delete, so an emptied secret stands for none.
        set: async (id, value) => keychain.setSecret(id, value ?? ""),
      };
    }
    return {
      kind: "plain",
      get: async (id) => ((await this.local.get(`secret:${id}`)) as string | null) || null,
      set: async (id, value) => this.local.set(`secret:${id}`, value),
    };
  };

  /**
   * The window's own fetch streams an answer as it arrives. A model server
   * that doesn't allow calls from an app window fails there, so the call is
   * made again through Obsidian's own request, which waits for the whole answer.
   */
  private llm = createLlm({
    browser: true,
    fetch: async (url, init) => {
      try {
        return await window.fetch(url, init);
      } catch (error) {
        if (init.signal?.aborted) throw error;
        const reply = await requestUrl({
          url,
          method: init.method ?? "GET",
          headers: init.headers as Record<string, string>,
          ...(typeof init.body === "string" ? { body: init.body } : {}),
          throw: false,
        });
        return new Response(reply.text, { status: reply.status });
      }
    },
  });

  ensureCore = async (): Promise<Core> => {
    this.coreReady ??= createCore({
      host: this.adapter!.host,
      keys: browserKeys(),
      services: this.services,
      llm: this.llm,
      secrets: this.secrets(),
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
