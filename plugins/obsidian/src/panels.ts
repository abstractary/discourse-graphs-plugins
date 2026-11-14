// Opening panels: the view Obsidian registers, and where each panel the host is asked for goes.
import { MarkdownView, type WorkspaceLeaf, type WorkspaceSplit } from "obsidian";
import { ok, type Placement, type SurfaceRoute } from "@dg/contract/host.ts";
import type { SurfacePort } from "@dg/contract/surface.ts";
import { closeDialogFrame, openDialogFrame } from "@dg/native/dialog.ts";
import { connectFrame } from "@dg/native/frame.ts";
import { openPdf } from "./actions.ts";
import { ROOT } from "./host.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import { fillMenu } from "./menus.ts";
import { loadedSurfaces, PanelModal, SurfaceView, VIEW } from "./views.ts";

declare const __CANVAS_HTML__: string;

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

export const writeReport = async (plugin: DiscourseGraphsPlugin, name: string, body: unknown): Promise<void> => {
  await plugin.app.vault.adapter.write(
    `${ROOT}/${name}.json`,
    JSON.stringify(body, null, 1),
  );
};

export const registerSurfaceView = (plugin: DiscourseGraphsPlugin): void => {
  const held = () => plugin.wiring.core();
  plugin.registerView(VIEW, (leaf) => {
    const view: SurfaceView = new SurfaceView(leaf, (frame, route) => {
        connectFrame({
          frame,
          route,
          test: plugin.testMode,
          connect: async (port) => {
            const core = await plugin.ensureCore();
            core.connectSurface({
              port: watchRoute(port, (id) => view.adopt(id)),
              onReport: (report) => {
                plugin.panelReport = report;
                void writeReport(plugin, "report-panel", report);
              },
            });
            // A canvas's name is known once the core is.
            view.retitle();
          },
        });
      }, (id) => held()?.canvasTitle({ id }) ?? null, (id) => void held()?.canvasClosed({ id }), (menu, here) => fillMenu(plugin, menu, here), (id) => held()?.unitTitle(id) ?? null);
    return view;
  });
};

/** A canvas's own note opens as the canvas, so links, search and the file tree all lead to it. */
export const openCanvasNotesAsCanvases = (plugin: DiscourseGraphsPlugin): void => {
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", (file) => {
      const id = file ? plugin.wiring.core()?.canvasOfRef({ ref: plugin.adapter!.refOfFile(file) }) : null;
      if (!id) return;
      const leaf = plugin.app.workspace.getLeavesOfType("markdown").find((item) => (item.view as MarkdownView).file === file);
      if (leaf) void leaf.setViewState({ type: VIEW, active: true, state: { route: { surface: "canvas", id } } });
    }),
  );
};

/** Where the host puts a panel it is asked to open: a dialog, a tab in the main area, or the right sidebar. */
export const openSurface = async (
  plugin: DiscourseGraphsPlugin,
  {
    route,
    placement,
  }: {
    route: SurfaceRoute;
    placement: Placement;
  },
) => {
  const { workspace } = plugin.app;
  // The quick finder sits high and closes on a click outside it, like Obsidian's own switcher. Every
  // other dialog is one of Obsidian's modals.
  if (placement === "dialog" && route.surface !== "find") {
    const core = await plugin.ensureCore();
    plugin.dialogModal?.close();
    closeDialogFrame();
    const modal = new PanelModal(
      plugin.app,
      route,
      __CANVAS_HTML__,
      (frame) =>
        connectFrame({
          frame,
          route,
          test: plugin.testMode,
          connect: async (port) => {
            core.connectSurface({ port });
          },
        }),
      () => {
        if (plugin.dialogModal === modal) {
          plugin.dialogModal = null;
          plugin.dialogFrame = null;
        }
      },
    );
    plugin.dialogModal = modal;
    modal.open();
    plugin.dialogFrame = modal.frame;
    return ok(null);
  }
  if (placement === "dialog") {
    const core = await plugin.ensureCore();
    plugin.dialogModal?.close();
    openDialogFrame({
      html: __CANVAS_HTML__,
      route,
      skin: core.info.skin,
      connect: (frame) =>
        connectFrame({
          frame,
          route,
          test: plugin.testMode,
          connect: async (port) => {
            core.connectSurface({ port });
          },
        }),
    });
    plugin.dialogFrame = document.querySelector<HTMLIFrameElement>('[data-dg="dialog"] iframe');
    return ok(null);
  }
  if (placement === "main" && route.surface === "pdf") {
    await openPdf(plugin, route.id);
    return ok(null);
  }
  if (placement === "main") {
    const showing = route.id
      ? loadedSurfaces(workspace).find((item) => {
          const shown = (item.view as SurfaceView).route;
          return shown.surface === route.surface && shown.id === route.id;
        })
      : undefined;
    if (showing) {
      await workspace.revealLeaf(showing);
      return ok(null);
    }
    const surfaces = loadedSurfaces(workspace);
    const surfaceOf = (item: WorkspaceLeaf) => (item.view as SurfaceView).route.surface;
    // A run's page replaces the run list or the last run, the way a link does: one tab for runs, and one for profiles.
    const runs = route.surface === "run" || route.surface === "profile" || route.surface === "papers" ? surfaces.find((item) => surfaceOf(item) === route.surface) : undefined;
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
  // Context follows what is picked on a canvas, so the canvas keeps the keyboard too: Delete and undo still work.
  const front = workspace.getMostRecentLeaf();
  const working = route.surface === "context" && front && (front.view as unknown as { route?: SurfaceRoute }).route?.surface === "canvas" ? front : undefined;
  const writing = workspace.getActiveViewOfType(MarkdownView)?.leaf ?? working;
  const open = loadedSurfaces(workspace).find((item) => (item.view as SurfaceView).route.surface === route.surface);
  const leaf = open ?? workspace.getRightLeaf(false);
  if (!leaf) return { ok: false as const, error: { code: "unavailable" as const, message: "No pane." } };
  if (!open) await leaf.setViewState({ type: VIEW, active: true, state: { route } });
  await workspace.revealLeaf(leaf);
  if (writing) workspace.setActiveLeaf(writing, { focus: true });
  if (working) working.view.containerEl.querySelector("iframe")?.focus();
  return ok(null);
};

export const closeDialog = async (plugin: DiscourseGraphsPlugin) => {
  plugin.dialogModal?.close();
  closeDialogFrame();
  plugin.dialogFrame = null;
  return ok(null);
};
