import { Plugin } from "obsidian";
import type { CoreForAdapter } from "@dg/contract/core.ts";
import { zoteroState } from "./actions.ts";
import { startBadges } from "./badges.ts";
import { registerCommands } from "./commands.ts";
import { createObsidianHost, type ObsidianHost } from "./host.ts";
import { addRibbon, registerMenus } from "./menus.ts";
import { closeDialog, openCanvasNotesAsCanvases, openSurface, registerSurfaceView } from "./panels.ts";
import { DiscourseGraphsSettings } from "./settings.ts";
import { testHooks } from "./testing.ts";
import type { PanelModal } from "./views.ts";
import { firstRun } from "./walkthrough.ts";
import { createWiring } from "./wiring.ts";

declare const __TEST_HOOKS__: boolean;

const OFFER_DELAY_MS = 3000;

/**
 * The plugin holds what is shared between its parts and starts them in order. What each part does is in
 * its own file: views and panels, commands, menus, settings, the walkthrough, and the wiring of the core.
 */
export default class DiscourseGraphsPlugin extends Plugin {
  adapter?: ObsidianHost;
  private badges?: ReturnType<typeof startBadges>;
  private hooks?: ReturnType<typeof testHooks>;
  panelReport: unknown = null;
  dialogFrame: HTMLIFrameElement | null = null;
  dialogModal: PanelModal | null = null;
  /** The key that makes a node from selected text. Read from the device's choices; empty means off. */
  captureKey = "\\";
  testMode = false;

  wiring = createWiring({
    app: () => this.app,
    host: () => this.adapter!.host,
    onCore: (core) => {
      core.onGraphChange(() => this.badges?.refresh());
      this.badges?.refresh();
    },
  });
  local = this.wiring.local;
  ensureCore = (): Promise<CoreForAdapter> => this.wiring.ensureCore();

  makeAdapter = async (): Promise<ObsidianHost> =>
    createObsidianHost({
      app: this.app,
      plugin: this,
      openSurface: (args) => openSurface(this, args),
      closeDialog: () => closeDialog(this),
    });

  async onload(): Promise<void> {
    this.adapter = await this.makeAdapter();
    const stored = (await this.local.get("prefs")) as { captureKey?: string } | null;
    if (typeof stored?.captureKey === "string") this.captureKey = stored.captureKey;
    registerSurfaceView(this);
    registerCommands(this);
    registerMenus(this);
    this.addSettingTab(new DiscourseGraphsSettings(this.app, this));
    addRibbon(this);
    openCanvasNotesAsCanvases(this);
    this.badges = startBadges({
      plugin: this,
      core: () => this.wiring.core(),
      refOfFile: (file) => this.adapter!.refOfFile(file),
    });
    // A vault with no records has no nodes to badge, and loading alone shouldn't write any.
    this.app.workspace.onLayoutReady(() => {
      void this.adapter!.host.listRecords({ limit: 1 }).then((stored) => {
        if (stored.ok && stored.value.items.length > 0) void this.ensureCore();
      });
      window.setTimeout(() => void firstRun(this), OFFER_DELAY_MS);
    });
  }

  onunload(): void {
    this.wiring.sync()?.stop();
    this.hooks?.stop();
    this.wiring.core()?.stop();
    this.adapter?.dispose();
  }

  /** A test script against a real Zotero calls this by name. */
  zoteroState = () => zoteroState(this);

  /** What the real-host test scripts drive. Left out of a release build. */
  get slice(): ReturnType<typeof testHooks> | undefined {
    return __TEST_HOOKS__ ? (this.hooks ??= testHooks(this)) : undefined;
  }
}
