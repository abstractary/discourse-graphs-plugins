// What the real-host test scripts drive. A release build leaves all of this out.
import { appendFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { MarkdownView, type FileSystemAdapter } from "obsidian";
import { createNode, foldRecords, type DgRecord, type HostRef } from "@dg/contract/records.ts";
import type { Host } from "@dg/contract/host.ts";
import type { SurfaceMethod } from "@dg/contract/surface.ts";
import { runConformance as runSuite, type ConformanceDriver, type ConformanceSetup } from "@dg/contract/conformance.ts";
import { closeDialogFrame } from "@dg/native/dialog.ts";
import { closeWalkthroughOffer, removeWalkthroughExamples } from "@dg/native/walkthrough.ts";
import {
  createFrameProbe,
  exportRecords,
  fingerprint,
  importAndAccept,
  readAllRecords,
  summarize,
  surfaceCaller,
} from "../../../harness/tools.ts";
import { readExisting } from "./existing.ts";
import { ROOT, SURFACE_VIEW, type ObsidianHost } from "./host.ts";
import type DiscourseGraphsPlugin from "./main.ts";
import type { SurfaceView } from "./main.ts";

declare const __CANVAS_BUILD__: string;

const VIEW = SURFACE_VIEW;
const SETTLE_MS = 1700;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export const testHooks = (plugin: DiscourseGraphsPlugin) => {
  const probe = createFrameProbe(() => plugin.surfaceFrame());
  const contextProbe = createFrameProbe(() => plugin.surfaceFrame("context"));
  const canvasesProbe = createFrameProbe(() => plugin.surfaceFrame("canvases"));
  const holonProbe = createFrameProbe(() => plugin.surfaceFrame("holon"));
  const boundaryProbe = createFrameProbe(() => plugin.surfaceFrame("boundary"));
  const pdfProbe = createFrameProbe(() => plugin.surfaceFrame("pdf"));
  const dialogProbe = createFrameProbe(() => plugin.dialogFrame);
  let caller: ReturnType<typeof surfaceCaller> | null = null;

  const makeDriver = (adapter: ObsidianHost): ConformanceDriver => {
    const { vault, workspace } = plugin.app;
    const base = (vault.adapter as FileSystemAdapter).getBasePath();
    const pathOf = async (ref: HostRef): Promise<string> => {
      const unit = await adapter.host.readText({ ref });
      if (!unit.ok) throw new Error(`driver: ${unit.error.message}`);
      return join(base, `${unit.value.title}.md`);
    };
    return {
      reload: async () => (await plugin.makeAdapter()).host,
      editOutside: async ({ ref, body }) => {
        const path = await pathOf(ref);
        const text = readFileSync(path, "utf8");
        const head = text.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? "";
        writeFileSync(path, `${head}${body}`);
      },
      renameOutside: async ({ ref, title }) => {
        renameSync(await pathOf(ref), join(base, `${title}.md`));
      },
      removeOutside: async ({ ref }) => {
        unlinkSync(await pathOf(ref));
      },
      linkOutside: async ({ from, to }) => {
        const target = await adapter.host.readText({ ref: to });
        if (!target.ok) throw new Error("driver: no link target");
        appendFileSync(await pathOf(from), `\n[[${target.value.title}]]\n`);
      },
      tagOutside: async ({ ref, tag }) => {
        appendFileSync(await pathOf(ref), `\n#${tag}\n`);
      },
      focusOutside: async ({ ref }) => {
        if (ref) await adapter.host.reveal({ ref, placement: "main" });
      },
      selectOutside: async ({ ref, text }) => {
        await adapter.host.reveal({ ref, placement: "main" });
        await new Promise((done) => window.setTimeout(done, 250));
        const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        if (!editor) throw new Error("driver: no editor");
        if (text === null) {
          editor.setCursor(0, 0);
          return;
        }
        const start = editor.getValue().indexOf(text);
        editor.setSelection(editor.offsetToPos(start), editor.offsetToPos(start + text.length));
      },
      placeCursor: async ({ ref }) => {
        if (!ref) {
          adapter.forgetCursor();
          return;
        }
        await adapter.host.reveal({ ref, placement: "main" });
        const view = workspace.getActiveViewOfType(MarkdownView);
        if (!view) throw new Error("driver: no markdown view");
        adapter.useCursor(view);
      },
      readAtCursor: async () => adapter.cursorView()?.editor.getValue() ?? "",
      isVisible: async ({ ref }) => {
        const unit = await adapter.host.readText({ ref });
        if (!unit.ok) return false;
        return workspace
          .getLeavesOfType("markdown")
          .some(
            (leaf) =>
              (leaf.view as MarkdownView).file?.basename === unit.value.title,
          );
      },
      closePanels: async () => {
        for (const leaf of workspace.getLeavesOfType(VIEW)) leaf.detach();
      },
      writeRecordOutside: async ({ record }) => {
        appendFileSync(
          join(base, ROOT, "records", "another-device.jsonl"),
          `${JSON.stringify(record)}\n`,
        );
      },
      settle: () => sleep(SETTLE_MS),
    };
  };

  const runConformance = async (): Promise<void> => {
    const adapter = plugin.adapter!;
    await adapter.host.putRecords({ records: [] });
    const setup = async (): Promise<ConformanceSetup> => ({
      host: adapter.host,
      driver: makeDriver(adapter),
    });
    const started = Date.now();
    const results = await runSuite({ setup });
    await plugin.writeReport("report-conformance", {
      host: "obsidian",
      seconds: (Date.now() - started) / 1000,
      passed: results.filter((result) => result.pass).length,
      total: results.length,
      failed: results.filter((result) => !result.pass),
    });
  };

  const openPanel = async (): Promise<void> => {
    await plugin.adapter!.host.openSurface({
      route: { surface: "check" },
      placement: "main",
    });
  };

  /** Reads what the panel wrote straight back out of the vault. */
  const verifyPanel = async (): Promise<void> => {
    const host = plugin.adapter!.host;
    const report = plugin.panelReport as { claim?: string } | null;
    const info = await host.describe();
    if (!info.ok) throw new Error(info.error.message);
    const records = await readAllRecords(host);
    const graph = foldRecords({ records, localSpace: info.value.space.id });
    const anchor = [...graph.documents.values()].find(
      (item) => item.kind === "anchor" && item.node === report?.claim,
    ) as { ref: string } | undefined;
    const text = anchor ? await host.readText({ ref: anchor.ref }) : null;
    await plugin.writeReport("report-panel-verify", {
      anchor: anchor?.ref ?? null,
      titleInBase: text?.ok ? text.value.title : null,
      revealed: anchor
        ? await makeDriver(plugin.adapter!).isVisible({ ref: anchor.ref })
        : false,
      activeRelations: [...graph.relations.values()].filter(
        ({ state }) => state === "active",
      ).length,
    });
  };

  const slice = () => {
    const host = plugin.adapter!.host;
    const driver = makeDriver(plugin.adapter!);
    return {
      build: __CANVAS_BUILD__,
      test: (on: boolean) => {
        plugin.testMode = on;
        if (on) {
          closeWalkthroughOffer();
          closeDialogFrame();
          void plugin.local.set("walkthrough-offered", true);
          void plugin.local.set("welcome-shown", true);
        }
        return on;
      },
      walkthrough: () => plugin.walkthrough(),
      offer: async () => {
        await plugin.local.set("walkthrough-offered", null);
        plugin.testMode = false;
        await plugin.offer();
        plugin.testMode = true;
      },
      removeExamples: () => plugin.walkthroughBase().then(removeWalkthroughExamples),
      setLocal: (key: string, value: unknown) => plugin.local.set(key, value),
      getLocal: (key: string) => plugin.local.get(key),
      openCanvases: () => plugin.openCanvases(),
      exportRecords: () => exportRecords(host),
      importRecords: (records: DgRecord[]) => importAndAccept({ host, records }),
      fileOpen: () => plugin.app.workspace.getActiveFile()?.basename ?? null,
      openHome: async (title: string) => {
        const file = plugin.app.vault.getMarkdownFiles().find((item) => item.basename === title);
        if (file) await plugin.app.workspace.getLeaf("tab").openFile(file);
        return Boolean(file);
      },
      searchBase: (title: string) => plugin.app.vault.getMarkdownFiles().filter((item) => item.basename.includes(title)).map((item) => item.path),
      open: (id?: string) => {
        if (!id) return plugin.openCanvas();
        return host.openSurface({ route: { surface: "canvas", id }, placement: "main" });
      },
      // Text opens beside the canvas, so getting back only means closing that pane.
      focusCanvas: async () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) leaf.detach();
        await new Promise((done) => window.setTimeout(done, 500));
      },
      leaveCanvas: async () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW)) if ((leaf.view as SurfaceView).route.surface === "canvas") leaf.detach();
        await sleep(600);
      },
      closeAll: () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW)) leaf.detach();
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) leaf.detach();
      },
      locate: (selector: string) => probe.locate(selector),
      text: (selector: string) => probe.text(selector),
      count: (selector: string) => probe.count(selector),
      value: (selector: string) => probe.value(selector),
      choose: (selector: string, value: string) => probe.choose(selector, value),
      focus: () => probe.focus(),
      doubleClicks: () => probe.doubleClicks(),
      frameTheme: () => probe.theme(),
      scroll: () => probe.scroll(),
      drawn: () => probe.drawn(),
      style: (selector: string, prop: string) => probe.style(selector, prop),
      openHolons: (id?: string) => plugin.openHolons(id),
      holonText: (selector: string) => holonProbe.text(selector),
      holonCount: (selector: string) => holonProbe.count(selector),
      holonLocate: (selector: string) => holonProbe.locate(selector),
      holonTheme: () => holonProbe.theme(),
      openBoundary: () => plugin.openBoundary(),
      openNoteAsHolon: () => plugin.openNoteAsHolon(),
      boundaryText: (selector: string) => boundaryProbe.text(selector),
      boundaryTheme: () => boundaryProbe.theme(),
      openLibrary: () => plugin.openCanvases(),
      boundaryCount: (selector: string) => boundaryProbe.count(selector),
      boundaryLocate: (selector: string) => boundaryProbe.locate(selector),
      libraryText: (selector: string) => canvasesProbe.text(selector),
      libraryCount: (selector: string) => canvasesProbe.count(selector),
      libraryLocate: (selector: string) => canvasesProbe.locate(selector),
      openPdf: (ref?: string) => plugin.openPdf(ref),
      pdfText: (selector: string) => pdfProbe.text(selector),
      pdfCount: (selector: string) => pdfProbe.count(selector),
      pdfLocate: (selector: string) => pdfProbe.locate(selector),
      pdfValue: (selector: string) => pdfProbe.value(selector),
      pdfChoose: (selector: string, value: string) => pdfProbe.choose(selector, value),
      pdfTheme: () => pdfProbe.theme(),
      pdfSelection: () => pdfProbe.selection(),
      // A vault file dropped on the reader as if from the desktop. The bytes stay inside Obsidian.
      pdfDropVaultFile: async (selector: string, path: string, name: string) => {
        const view = new Uint8Array(await plugin.app.vault.adapter.readBinary(path));
        let binary = "";
        for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
        return pdfProbe.dropFile(selector, { name, type: "application/pdf", base64: btoa(binary) });
      },
      dragTo: (selector: string, at: { x: number; y: number }) => probe.dragTo(selector, at),
      canvasReveal: (selector: string) => probe.reveal(selector),
      // Which tabs show what, and side by side or not, for checking the reader lands beside the canvas.
      layout: () =>
        plugin.app.workspace.getLeavesOfType(VIEW).map((leaf) => {
          const view = leaf.view as SurfaceView;
          const box = view.containerEl.getBoundingClientRect();
          return { surface: view.route.surface, id: view.route.id ?? null, title: view.getDisplayText(), header: view.containerEl.querySelector(".view-header-title")?.textContent ?? null, x: Math.round(box.left), width: Math.round(box.width), shown: view.containerEl.offsetParent !== null };
        }),
      skin: () => plugin.ensureCore().then((core) => core.info.skin),
      frameWidth: (width: number | null) => {
        const frame = (plugin.app.workspace.getLeavesOfType(VIEW).map((leaf) => leaf.view as SurfaceView).find((view) => view.route.surface === "canvas"))?.frame;
        if (frame) frame.style.width = width ? `${width}px` : "100%";
      },
      summary: async () => {
        const core = await plugin.ensureCore();
        return summarize({ host, localSpace: core.info.space.id });
      },
      findRef: async (title: string) => {
        const found = await host.searchText({ query: title, limit: 1 });
        return found.ok ? (found.value[0]?.ref ?? null) : null;
      },
      renameOutside: (ref: string, title: string) => driver.renameOutside({ ref, title }),
      writeOutside: (record: DgRecord) => driver.writeRecordOutside({ record }),
      visible: (ref: string) => driver.isVisible({ ref }),
      usage: async () => {
        const core = await plugin.ensureCore();
        await core.flushUsage();
        return (await host.getLocal({ key: "usage" })) as unknown;
      },
      theme: () => (document.body.classList.contains("theme-dark") ? "dark" : "light"),
      core: () => plugin.ensureCore(),
      existing: () => readExisting(plugin.app),
      hostCount: (selector: string) => document.querySelectorAll(selector).length,
      hostText: (selector: string) => document.querySelector(selector)?.textContent ?? null,
      prepareSelection: async (title: string, body: string, text: string | null) => {
        const made = await host.createText({ title, body });
        if (!made.ok) throw new Error(made.error.message);
        await driver.selectOutside({ ref: made.value.ref, text });
        plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor.focus();
        return made.value.ref;
      },
      readText: async (ref: string) => {
        const text = await host.readText({ ref });
        return text.ok ? text.value : null;
      },
      unitInText: async (title: string) => {
        const file = plugin.app.vault.getMarkdownFiles().find((item) => item.basename === title);
        return file ? (/^dg-id:\s*(\S+)/m.exec(await plugin.app.vault.read(file))?.[1] ?? null) : null;
      },
      runCapture: (mode: "selection" | "page") => plugin.capture(mode),
      openNote: async (ref: string) => host.reveal({ ref, placement: "main" }),
      writePage: async (title: string, lines: string[]) => {
        const made = await host.createText({ title, body: lines.join("\n\n") });
        if (!made.ok) throw new Error(made.error.message);
        return made.value.ref;
      },
      removeOutside: (ref: string) => driver.removeOutside({ ref }),
      renameInBase: async (ref: string, title: string) => {
        const unit = await host.readText({ ref });
        const file = unit.ok ? plugin.app.vault.getFileByPath(`${unit.value.title}.md`) ?? plugin.app.vault.getMarkdownFiles().find((item) => item.basename === unit.value.title) : null;
        // Otherwise Obsidian stops to ask before updating the links.
        (plugin.app.vault as unknown as { setConfig: (key: string, value: unknown) => void }).setConfig("alwaysUpdateLinks", true);
        if (file) await plugin.app.fileManager.renameFile(file, file.path.replace(/[^/]+\.md$/, `${title}.md`));
      },
      openPageRef: async () => {
        const open = await host.getFocus();
        return open.ok ? open.value.ref : null;
      },
      caret: () => {
        const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
        return editor ? { ...editor.getCursor(), focused: editor.hasFocus() } : null;
      },
      readingMode: async (on: boolean) => {
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView) ?? (plugin.app.workspace.getLeavesOfType("markdown")[0]?.view as MarkdownView | undefined);
        await view?.setState({ ...view.getState(), mode: on ? "preview" : "source", source: false }, { history: false });
      },
      focusOutside: (ref: string) => driver.focusOutside({ ref }),
      afterFocus: () => {
        const leaf = plugin.app.workspace.getLeavesOfType(VIEW).find((item) => (item.view as SurfaceView).route.surface === "canvas");
        if (leaf) void plugin.app.workspace.revealLeaf(leaf);
      },
      ctx: contextProbe,
      list: canvasesProbe,
      dialog: dialogProbe,
      openDialog: (surface: "upload" | "welcome") => plugin.openDialog(surface),
      syncNow: () => plugin.sync?.now(),
      firstRun: async () => {
        await plugin.local.set("welcome-shown", null);
        await plugin.firstRun(true);
      },
      fingerprint: async () =>
        fingerprint(await Promise.all(plugin.app.vault.getMarkdownFiles().map(async (file) => `${file.path}\n${await plugin.app.vault.read(file)}`))),
      importExisting: async (dryRun: boolean) =>
        (await plugin.ensureCore()).importExisting({ existing: await readExisting(plugin.app), dryRun }),
      call: async (method: SurfaceMethod, params: unknown) => {
        caller ??= surfaceCaller(await plugin.ensureCore());
        return caller(method, params);
      },
    };
  };

  const exportExchange = async (): Promise<void> => {
    await plugin.writeReport("exchange", await exportRecords(plugin.adapter!.host));
  };

  const importExchange = async (records: DgRecord[]): Promise<void> => {
    await plugin.writeReport(
      "report-exchange",
      await importAndAccept({ host: plugin.adapter!.host, records }),
    );
  };

  const measureRecords = async (count: number): Promise<void> => {
    const host: Host = plugin.adapter!.host;
    const info = await host.describe();
    if (!info.ok) throw new Error(info.error.message);
    const stamp = { space: info.value.space.id, by: info.value.person };
    const records: DgRecord[] = Array.from({ length: count }, (_, index) =>
      createNode({ ...stamp, title: `Load test ${index}` }),
    );
    const writeStart = performance.now();
    for (let i = 0; i < records.length; i += 500) {
      await host.putRecords({ records: records.slice(i, i + 500) });
    }
    const writeMs = performance.now() - writeStart;
    const readStart = performance.now();
    const all = await readAllRecords(host);
    const readMs = performance.now() - readStart;
    const foldStart = performance.now();
    foldRecords({ records: all, localSpace: stamp.space });
    const foldMs = performance.now() - foldStart;
    await plugin.writeReport("report-measure", {
      host: "obsidian",
      added: count,
      total: all.length,
      writeMs: Math.round(writeMs),
      readMs: Math.round(readMs),
      foldMs: Math.round(foldMs),
    });
  };

  const stop = (): void => {
    for (const each of [probe, contextProbe, canvasesProbe, holonProbe, boundaryProbe, pdfProbe, dialogProbe]) each.stop();
  };

  return { ...slice(), runConformance, openPanel, verifyPanel, exportExchange, importExchange, measureRecords, stop };
};
