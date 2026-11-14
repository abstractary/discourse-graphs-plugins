// What a command, a menu item or a settings button does. Each takes the plugin and opens or reads something.
import { MarkdownView, Notice, type Editor } from "obsidian";
import { askForName, startCapture } from "@dg/native/capture-menu.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import { frontCanvas, loadedSurfaces, VIEW, type SurfaceView } from "./views.ts";

/** The quick finder. A link it inserts goes where the cursor was in the note. */
export const findUnit = async (plugin: DiscourseGraphsPlugin, intent?: "link"): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "find", ...(intent ? { id: intent } : {}) }, placement: "dialog" });
};

export const openPaperMap = async (plugin: DiscourseGraphsPlugin, canvas?: string): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "papers", ...(canvas ? { id: canvas } : {}) }, placement: "main" });
};

export const openProfile = async (plugin: DiscourseGraphsPlugin, id?: string): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "profile", ...(id ? { id } : {}) }, placement: "main" });
};

export const openRuns = async (plugin: DiscourseGraphsPlugin, id?: string): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "run", ...(id ? { id } : {}) }, placement: "main" });
};

/** A saved notebook becomes its code, the run saved in it and its outputs. Then the run's page opens. */
export const readNotebook = async (plugin: DiscourseGraphsPlugin, path: string): Promise<void> => {
  const core = await plugin.ensureCore();
  try {
    const made = await core.importNotebook({ ref: path, text: (await core.prefs()).notebookText });
    new Notice(
      made.known
        ? "This exact run is already in the graph, so nothing was added."
        : `Read a ${made.status} run with ${made.outputs.length} ${made.outputs.length === 1 ? "output" : "outputs"}.`,
    );
    await openRuns(plugin, made.run.id);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Reads a whole PDF into a graph and opens its canvas. A saved extraction
 * beside the file is used as it is; with none, the upload dialog opens on
 * this file so the person picks where it's read.
 */
export const extractGraph = async (plugin: DiscourseGraphsPlugin, path: string): Promise<void> => {
  const core = await plugin.ensureCore();
  try {
    const name = path.split("/").pop()!;
    const saved = await core.savedExtraction({ name, ref: path });
    if (!saved) {
      await plugin.adapter!.host.openSurface({ route: { surface: "upload", id: path }, placement: "dialog" });
      return;
    }
    const paper = await core.extractPaper({ ref: path, saved: true });
    new Notice(`Read ${paper.units} units and ${paper.relations} links from ${saved.name}.`);
    await core.showCanvas(paper.canvas);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  }
};

/** Reads a crate in the vault: one this app made comes back whole, another tool's becomes units. */
export const importCrate = async (plugin: DiscourseGraphsPlugin, path: string): Promise<void> => {
  const core = await plugin.ensureCore();
  try {
    const read = await core.importCrate({ ref: path });
    const news = read.fresh === 0 ? "nothing new" : `${read.fresh} new ${read.fresh === 1 ? "unit" : "units"}`;
    new Notice(`Read "${read.name}": ${news}${read.skipped ? `, ${read.skipped} files left out` : ""}.`);
    if (read.canvas) await core.showCanvas(read.canvas);
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  }
};

export const openSide = async (plugin: DiscourseGraphsPlugin, surface: "search" | "context"): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface }, placement: "side" });
};

export const openSettings = (plugin: DiscourseGraphsPlugin): void => {
  const setting = (plugin.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
  setting?.open();
  setting?.openTabById(plugin.manifest.id);
};

/** Whether Zotero is answering, and what the PDF library holds when it is the library. */
export const zoteroState = async (plugin: DiscourseGraphsPlugin): Promise<{ ok: boolean; version?: string; problem?: string; on: boolean; files: number }> => {
  const core = await plugin.ensureCore();
  const [status, library] = await Promise.all([core.zoteroStatus(), core.pdfLibrary()]);
  return { ok: status.ok, ...(status.version ? { version: status.version } : {}), ...(status.problem ?? library.problem ? { problem: (status.problem ?? library.problem)! } : {}), on: library.on, files: library.files };
};

export const openDialog = async (plugin: DiscourseGraphsPlugin, surface: "upload" | "welcome" | "zotero" | "grammar"): Promise<void> => {
  await plugin.ensureCore();
  // What comes from Zotero lands on the canvas in front, when there is one.
  const front = surface === "zotero" ? frontCanvas(plugin) : undefined;
  await plugin.adapter!.host.openSurface({ route: { surface, ...(front ? { id: front } : {}) }, placement: "dialog" });
};

/** The menu opens under the end of the selection. */
const caret = (plugin: DiscourseGraphsPlugin): { x: number; y: number } => {
  const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor as
    | (Editor & { cm?: { coordsAtPos: (at: number) => { left: number; bottom: number } | null } })
    | undefined;
  const spot = editor?.cm?.coordsAtPos(editor.posToOffset(editor.getCursor("to")));
  return spot ? { x: spot.left, y: spot.bottom + 4 } : { x: window.innerWidth / 3, y: window.innerHeight / 3 };
};

export const capture = async (plugin: DiscourseGraphsPlugin, mode: "selection" | "page"): Promise<void> => {
  const core = await plugin.ensureCore();
  startCapture({ core, skin: core.info.skin, at: caret(plugin), mode });
};

export const openCanvases = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "canvases" }, placement: "side" });
};

/** The boundary of the holon in focus, in the right sidebar beside the context panel. */
export const openBoundary = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  await plugin.ensureCore();
  await plugin.adapter!.host.openSurface({ route: { surface: "boundary" }, placement: "side" });
};

/** The overview in a tab: a lab, its questions and their claims, laid out from the graph. */
export const openHolons = async (plugin: DiscourseGraphsPlugin, id?: string): Promise<void> => {
  await plugin.ensureCore();
  const { workspace } = plugin.app;
  const open = loadedSurfaces(workspace).find((leaf) => (leaf.view as SurfaceView).route.surface === "holon");
  const route = { surface: "holon" as const, ...(id ? { id } : {}) };
  if (open && (open.view as SurfaceView).route.id === route.id) {
    await workspace.revealLeaf(open);
    return;
  }
  const leaf = open ?? workspace.getLeaf("tab");
  await leaf.setViewState({ type: VIEW, active: true, state: { route } });
  await workspace.revealLeaf(leaf);
};

/**
 * The reader in the main area, split beside the canvas so a highlight lands
 * where it can be seen. One reader at a time: a second PDF replaces the first.
 */
export const openPdf = async (plugin: DiscourseGraphsPlugin, ref?: string): Promise<void> => {
  await plugin.ensureCore();
  const { workspace } = plugin.app;
  const route = { surface: "pdf" as const, ...(ref ? { id: ref } : {}) };
  const surfaces = loadedSurfaces(workspace);
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
};

export const newCanvas = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  const core = await plugin.ensureCore();
  askForName({
    label: "Canvas name",
    skin: core.info.skin,
    onDone: (name) =>
      void core.createCanvas({ title: name }).then((made) => {
        if (made.ok) void plugin.adapter!.host.openSurface({ route: { surface: "canvas", id: made.value }, placement: "main" });
      }),
  });
};

export const setMyName = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  const core = await plugin.ensureCore();
  askForName({ label: "Your name", skin: core.info.skin, onDone: (name) => void core.setName(name) });
};

export const openCanvas = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  const open = loadedSurfaces(plugin.app.workspace).find((leaf) => (leaf.view as SurfaceView).route.surface === "canvas");
  if (open) {
    await plugin.app.workspace.revealLeaf(open);
    return;
  }
  await plugin.adapter!.host.openSurface({ route: { surface: "canvas" }, placement: "main" });
};
