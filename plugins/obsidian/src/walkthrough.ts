// The first run: the lab question, then the offer of a walkthrough, and what the walkthrough needs from Obsidian.
import { MarkdownView, type Editor } from "obsidian";
import type { SurfaceRoute } from "@dg/contract/host.ts";
import { offerWalkthrough, startWalkthrough, type WalkthroughBase } from "@dg/native/walkthrough.ts";
import { openCanvases, openDialog } from "./actions.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import { loadedSurfaces, surfaceFrame, type SurfaceView } from "./views.ts";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/** First boot: the lab question comes first, then the offer of a walkthrough. */
export const firstRun = async (plugin: DiscourseGraphsPlugin, always = false): Promise<void> => {
  if (plugin.testMode && !always) return;
  if (!(await plugin.local.get("welcome-shown"))) {
    await plugin.local.set("welcome-shown", true);
    await openDialog(plugin, "welcome");
    return;
  }
  await offer(plugin);
};

export const offer = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  if (plugin.testMode) return;
  const info = await plugin.adapter!.host.describe();
  if (!info.ok) return;
  await offerWalkthrough({
    skin: info.value.skin,
    getLocal: plugin.local.get,
    setLocal: plugin.local.set,
    onStart: () => void walkthrough(plugin),
  });
};

export const walkthrough = async (plugin: DiscourseGraphsPlugin): Promise<void> => {
  await startWalkthrough(await walkthroughBase(plugin));
};

export const walkthroughBase = async (plugin: DiscourseGraphsPlugin): Promise<WalkthroughBase> => {
  // The walkthrough reads the graph to find what it made, which is more than the contract names for a plugin.
  const core = await plugin.wiring.wholeCore();
  const { workspace } = plugin.app;
  const host = plugin.adapter!.host;
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
    frame: (surface) => surfaceFrame(plugin, surface as SurfaceRoute["surface"]),
    openCanvases: () => openCanvases(plugin),
    showCanvas: async (id) => {
      await host.openSurface({ route: { surface: "canvas", id }, placement: "main" });
    },
    closeExamples: async ({ canvases, texts }) => {
      for (const leaf of loadedSurfaces(workspace)) {
        const { id, surface } = (leaf.view as SurfaceView).route;
        if (surface === "canvas" && id && canvases.includes(id)) leaf.detach();
      }
      for (const leaf of workspace.getLeavesOfType("markdown")) {
        const { file } = leaf.view as MarkdownView;
        if (file && texts.includes(plugin.adapter!.refOfFile(file))) leaf.detach();
      }
    },
    getLocal: plugin.local.get,
    setLocal: plugin.local.set,
  };
};
