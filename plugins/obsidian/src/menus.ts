import { Menu, TFile } from "obsidian";
import type { SurfaceRoute } from "@dg/contract/host.ts";
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
  openSettings,
  openSide,
  readNotebook,
} from "./actions.ts";
import type DiscourseGraphsPlugin from "./main.ts";

/**
 * Everything the plugin opens, grouped the way the canvas bar groups it: the
 * ribbon's menu, and each panel's ⋯ menu. The panel already showing is left out.
 */
export const fillMenu = (plugin: DiscourseGraphsPlugin, menu: Menu, here?: SurfaceRoute["surface"]): void => {
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
  add("Open canvas", "layout-dashboard", () => openCanvas(plugin), "canvas");
  add("Library", "library", () => openCanvases(plugin), "canvases");
  add("Overview", "network", () => openHolons(plugin), "holon");
  add("Paper map", "waypoints", () => openPaperMap(plugin), "papers");
  add("New canvas…", "square-plus", () => newCanvas(plugin));
  group("Panels");
  add("Search units", "search", () => openSide(plugin, "search"), "search");
  add("Context", "panel-right", () => openSide(plugin, "context"), "context");
  add("Boundary", "layers", () => openBoundary(plugin), "boundary");
  add("My profile", "circle-user", () => openProfile(plugin), "profile");
  group("Find and read");
  add("Find a unit…", "text-search", () => findUnit(plugin));
  add("Read a PDF…", "file-text", () => openPdf(plugin));
  add("Upload a paper…", "upload", () => openDialog(plugin, "upload"));
  add("From Zotero…", "library-big", () => openDialog(plugin, "zotero"));
  add("Types and relations…", "shapes", () => openDialog(plugin, "grammar"));
  add("Runs and notebooks", "flask-conical", () => openRuns(plugin), "run");
  if (!here) menu.addSeparator();
  add("Settings", "settings", () => openSettings(plugin));
};

/** What the plugin adds to Obsidian's own menus: on a file, and in a note. */
export const registerMenus = (plugin: DiscourseGraphsPlugin): void => {
  // Obsidian's own viewer stays the default; reading into the graph is one click away.
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension === "ipynb") {
        menu.addItem((item) =>
          item
            .setTitle("Read into Discourse Graphs")
            .setIcon("notebook-pen")
            .onClick(() => void readNotebook(plugin, file.path)),
        );
      }
      if (file instanceof TFile && (file.extension === "eln" || /(\.crate\.zip|ro-crate-metadata\.json)$/i.test(file.name))) {
        menu.addItem((item) =>
          item
            .setTitle("Import this research crate")
            .setIcon("package-open")
            .onClick(() => void importCrate(plugin, file.path)),
        );
      }
      if (!(file instanceof TFile) || file.extension !== "pdf") return;
      menu.addItem((item) =>
        item
          .setTitle("Read in Discourse Graphs")
          .setIcon("file-text")
          .onClick(() => void openPdf(plugin, file.path)),
      );
      menu.addItem((item) =>
        item
          .setTitle("Extract graph")
          .setIcon("sparkles")
          .onClick(() => void extractGraph(plugin, file.path)),
      );
    }),
  );
  // Right-clicking in a note offers the two things a note leads to: a node from the words, or a link to one.
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      if (editor.somethingSelected()) {
        menu.addItem((item) =>
          item.setTitle("Create unit from selection").setIcon("circle-plus").setSection("discourse-graphs").onClick(() => void capture(plugin, "selection")),
        );
      }
      menu.addItem((item) =>
        item.setTitle("Link a unit…").setIcon("text-search").setSection("discourse-graphs").onClick(() => void findUnit(plugin, "link")),
      );
    }),
  );
};

/** One ribbon icon, as Obsidian asks of plugins: it opens every panel and action, grouped. Each is a command too. */
export const addRibbon = (plugin: DiscourseGraphsPlugin): void => {
  plugin.addRibbonIcon("network", "Discourse Graphs", (event) => {
    const menu = new Menu();
    fillMenu(plugin, menu);
    menu.showAtMouseEvent(event);
  });
};
