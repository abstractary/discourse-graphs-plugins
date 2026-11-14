import { App, ItemView, Modal, type Menu, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { SurfaceRoute } from "@dg/contract/host.ts";
import { SURFACE_VIEW } from "./host.ts";
import type DiscourseGraphsPlugin from "./main.ts";

declare const __PANEL_HTML__: string;
declare const __CANVAS_HTML__: string;
declare const __PDF_HTML__: string;

export const VIEW = SURFACE_VIEW;

/** A dialog's size, by what it holds. */
const DIALOG_SIZE: Partial<Record<SurfaceRoute["surface"], { width: number; height: number }>> = { grammar: { width: 780, height: 660 } };

/**
 * A panel shown as one of Obsidian's own modals, so it closes, stacks, dims and takes the keyboard the
 * way every other dialog in the app does. The panel inside is the same sandboxed frame as anywhere else.
 */
export class PanelModal extends Modal {
  frame: HTMLIFrameElement | null = null;
  constructor(
    app: App,
    private readonly route: SurfaceRoute,
    private readonly html: string,
    private readonly mount: (frame: HTMLIFrameElement) => void,
    private readonly closed: () => void,
  ) {
    super(app);
  }
  onOpen(): void {
    const { width, height } = DIALOG_SIZE[this.route.surface] ?? { width: 480, height: 640 };
    this.modalEl.dataset.dg = "dialog";
    this.modalEl.dataset.surface = this.route.surface;
    this.modalEl.style.cssText = `width:min(${width}px,calc(100vw - 32px));height:min(${height}px,calc(100vh - 48px));max-width:none;max-height:none;padding:0;overflow:hidden;`;
    this.contentEl.style.cssText = "height:100%;margin:0;padding:0;";
    const frame = this.contentEl.createEl("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", "Discourse Graphs");
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;";
    frame.srcdoc = this.html;
    this.mount(frame);
    this.frame = frame;
  }
  onClose(): void {
    this.contentEl.empty();
    this.frame = null;
    this.closed();
  }
}

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
    if (this.route.surface === "holon") return "Overview";
    if (this.route.surface === "boundary") return "Boundary";
    if (this.route.surface === "profile") return "Profile";
    if (this.route.surface === "papers") return "Paper map";
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
    if (this.route.surface === "profile") return "circle-user";
    if (this.route.surface === "papers") return "waypoints";
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

/**
 * The Discourse Graphs tabs that are loaded. Obsidian leaves a background tab
 * unloaded until it is first shown, and such a tab has no route to read yet.
 */
export const loadedSurfaces = (workspace: { getLeavesOfType: (type: string) => WorkspaceLeaf[] }): WorkspaceLeaf[] => workspace.getLeavesOfType(VIEW).filter((leaf) => (leaf.view as Partial<Pick<SurfaceView, "route">>).route !== undefined);

export const surfaceFrame = (plugin: DiscourseGraphsPlugin, surface: SurfaceRoute["surface"] = "canvas"): HTMLIFrameElement | null => {
  const leaves = loadedSurfaces(plugin.app.workspace).filter((item) => (item.view as SurfaceView).route.surface === surface);
  // With several open, the one a person can see.
  const leaf = leaves.find((item) => item.view.containerEl.offsetParent !== null) ?? leaves[0];
  return leaf ? (leaf.view as SurfaceView).frame : null;
};

/** The canvas a person is looking at, if one is. */
export const frontCanvas = (plugin: DiscourseGraphsPlugin): string | undefined =>
  loadedSurfaces(plugin.app.workspace)
    .map((leaf) => leaf.view as SurfaceView)
    .find((view) => view.route.surface === "canvas" && view.route.id && view.containerEl.offsetParent !== null)?.route.id;
