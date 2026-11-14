import { MarkdownView } from "obsidian";
import type { CanvasCommand } from "@dg/contract/surface.ts";
import { removeWalkthroughExamples } from "@dg/native/walkthrough.ts";
import {
  capture,
  extractGraph,
  findUnit,
  importCrate,
  newCanvas,
  openBoundary,
  openCanvas,
  openCanvases,
  openDialog,
  openHolons,
  openPaperMap,
  openPdf,
  openProfile,
  openRuns,
  readNotebook,
  setMyName,
} from "./actions.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import { frontCanvas } from "./views.ts";
import { walkthrough, walkthroughBase } from "./walkthrough.ts";

/** Every action as a command, so each is in the palette and can take a hotkey, and the key that captures a selection. */
export const registerCommands = (plugin: DiscourseGraphsPlugin): void => {
  plugin.addCommand({
    id: "open-canvas",
    name: "Open canvas",
    icon: "layout-dashboard",
    callback: () => void openCanvas(plugin),
  });
  plugin.addCommand({
    id: "find-canvas",
    name: "Open the Library",
    icon: "library",
    callback: () => void openCanvases(plugin),
  });
  plugin.addCommand({
    id: "new-canvas",
    name: "New canvas",
    icon: "square-plus",
    callback: () => void newCanvas(plugin),
  });
  plugin.addCommand({
    id: "upload-paper",
    name: "Upload a paper",
    icon: "upload",
    callback: () => void openDialog(plugin, "upload"),
  });
  // What a canvas's own buttons do, as commands: found in the palette, and bound to any key a person likes.
  // Each is offered only while a canvas is in front.
  const onCanvas: [id: string, name: string, icon: string, command: CanvasCommand][] = [
    ["canvas-add-unit", "Canvas: add a unit", "plus", "add-unit"],
    ["canvas-tidy", "Canvas: tidy", "layout-grid", "tidy"],
    ["canvas-fit", "Canvas: fit to view", "maximize", "fit"],
    ["canvas-cards", "Canvas: choose what cards show", "list", "cards"],
    ["canvas-ask-ai", "Canvas: ask AI", "sparkles", "ask-ai"],
    ["canvas-export", "Canvas: export…", "upload", "export"],
    ["canvas-undo", "Canvas: undo", "undo-2", "undo"],
    ["canvas-redo", "Canvas: redo", "redo-2", "redo"],
  ];
  for (const [id, name, icon, command] of onCanvas) {
    plugin.addCommand({
      id,
      name,
      icon,
      checkCallback: (checking) => {
        const front = frontCanvas(plugin);
        if (!front) return false;
        if (!checking) void plugin.ensureCore().then((core) => core.command(front, command));
        return true;
      },
    });
  }
  plugin.addCommand({
    id: "types-and-relations",
    name: "Types and relations…",
    icon: "shapes",
    callback: () => void openDialog(plugin, "grammar"),
  });
  plugin.addCommand({
    id: "from-zotero",
    name: "Bring in from Zotero…",
    icon: "library-big",
    callback: () => void openDialog(plugin, "zotero"),
  });
  plugin.addCommand({
    id: "join-or-start-lab",
    name: "Join or start a lab",
    icon: "users",
    callback: () => void openDialog(plugin, "welcome"),
  });
  plugin.addCommand({
    id: "set-name",
    name: "Set my name",
    icon: "user",
    callback: () => void setMyName(plugin),
  });
  plugin.addCommand({
    id: "start-walkthrough",
    name: "Start walkthrough",
    icon: "route",
    callback: () => void walkthrough(plugin),
  });
  plugin.addCommand({
    id: "remove-walkthrough-examples",
    name: "Remove walkthrough examples",
    icon: "trash-2",
    callback: () => void walkthroughBase(plugin).then(removeWalkthroughExamples),
  });
  plugin.addCommand({
    id: "capture-selection",
    name: "Create unit from selection",
    icon: "circle-plus",
    editorCheckCallback: (checking, editor) => {
      if (!editor.somethingSelected()) return false;
      if (!checking) void capture(plugin, "selection");
      return true;
    },
  });
  plugin.addCommand({
    id: "convert-page",
    name: "Turn this note into a unit",
    icon: "file-plus",
    callback: () => void capture(plugin, "page"),
  });
  // Only with a selection, so a plain backslash still types a backslash.
  plugin.registerDomEvent(
    document,
    "keydown",
    (event: KeyboardEvent) => {
      // AltGr reports Ctrl and Alt together, and is how many layouts type a backslash.
      const altGr = event.ctrlKey && event.altKey;
      if (!plugin.captureKey || event.key !== plugin.captureKey || event.metaKey || (event.ctrlKey && !altGr)) return;
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.editor.somethingSelected() || !view.editor.hasFocus()) return;
      event.preventDefault();
      event.stopPropagation();
      void capture(plugin, "selection");
    },
    { capture: true },
  );
  plugin.addCommand({
    id: "toggle-link-badges",
    name: "Toggle link badges",
    icon: "tag",
    callback: () => void plugin.ensureCore().then((core) => core.toggleBadges()),
  });
  plugin.addCommand({
    id: "open-context",
    name: "Open context panel",
    icon: "panel-right",
    callback: () => void plugin.adapter!.host.openSurface({ route: { surface: "context" }, placement: "side" }),
  });
  // No default hotkey: Obsidian's guidelines leave keys to the person. Both show in the command palette.
  plugin.addCommand({
    id: "find-unit",
    name: "Find a unit",
    icon: "text-search",
    callback: () => void findUnit(plugin),
  });
  plugin.addCommand({
    id: "search-units",
    name: "Search units",
    icon: "search",
    callback: () => void plugin.adapter!.host.openSurface({ route: { surface: "search" }, placement: "side" }),
  });
  plugin.addCommand({
    id: "open-holons",
    name: "Open the overview",
    icon: "network",
    callback: () => void openHolons(plugin),
  });
  plugin.addCommand({
    id: "open-holon-boundary",
    name: "Open boundary",
    icon: "layers",
    callback: () => void openBoundary(plugin),
  });
  plugin.addCommand({
    id: "open-paper-map",
    name: "Open paper map",
    icon: "waypoints",
    callback: () => void openPaperMap(plugin),
  });
  plugin.addCommand({
    id: "open-profile",
    name: "Open my profile",
    icon: "circle-user",
    callback: () => void openProfile(plugin),
  });
  plugin.addCommand({
    id: "open-runs",
    name: "Open runs and notebooks",
    icon: "flask-conical",
    callback: () => void openRuns(plugin),
  });
  plugin.addCommand({
    id: "read-this-notebook",
    name: "Read this notebook into the graph",
    icon: "notebook-pen",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "ipynb") return false;
      if (!checking) void readNotebook(plugin, file.path);
      return true;
    },
  });
  plugin.addCommand({
    id: "open-pdf",
    name: "Read a PDF…",
    icon: "file-text",
    callback: () => void openPdf(plugin),
  });
  plugin.addCommand({
    id: "extract-graph",
    name: "Extract graph from this PDF",
    icon: "sparkles",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "pdf") return false;
      if (!checking) void extractGraph(plugin, file.path);
      return true;
    },
  });
  plugin.addCommand({
    id: "import-crate",
    name: "Import this research crate (RO-Crate or .eln)",
    icon: "package-open",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || !(file.extension === "eln" || file.extension === "zip" || /ro-crate-metadata\.json$/i.test(file.name))) return false;
      if (!checking) void importCrate(plugin, file.path);
      return true;
    },
  });
  plugin.addCommand({
    id: "read-this-pdf",
    name: "Read this PDF",
    icon: "file-text",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file?.extension !== "pdf") return false;
      if (!checking) void openPdf(plugin, file.path);
      return true;
    },
  });
};
