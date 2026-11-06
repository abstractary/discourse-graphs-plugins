import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

// A plain build carries the hooks the real-host tests drive. DG_RELEASE=1 leaves them out.
const release = process.env.DG_RELEASE === "1";

mkdirSync("dist/obsidian", { recursive: true });
mkdirSync("dist/roam", { recursive: true });

const bundlePanel = async (stamp) =>
  (
    await build({
      entryPoints: ["harness/panel.ts"],
      bundle: true,
      write: false,
      format: "iife",
      target: "es2022",
      define: { __PANEL_BUILD__: JSON.stringify(stamp) },
    })
  ).outputFiles[0].text;

const shell = readFileSync("harness/panel-shell.html", "utf8");
const stamp = createHash("sha256")
  .update(await bundlePanel("x"))
  .update(shell)
  .digest("hex")
  .slice(0, 12);
const panelJs = (await bundlePanel(stamp)).replaceAll("</script", "<\\/script");
const panelHtml = shell.replace("/*__PANEL_JS__*/", () => panelJs);
writeFileSync("dist/panel.html", panelHtml);

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

const surface = await build({
  entryPoints: ["packages/surfaces/src/main.tsx"],
  bundle: true,
  minify: true,
  write: false,
  outdir: "out",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const surfaceJs = surface.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replaceAll("</script", "<\\/script");
const surfaceCss = surface.outputFiles.find((file) => file.path.endsWith(".css")).text;
const canvasHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>Discourse Graphs canvas</title><style>${surfaceCss}</style></head><body><div id="root"></div><script>${surfaceJs}</script></body></html>`;
writeFileSync("dist/canvas.html", canvasHtml);
const canvasBuild = createHash("sha256").update(canvasHtml).digest("hex").slice(0, 12);

// The demo graphs ship inside the plugin, so "Load demo papers" works with no server.
const demoGraphs = readdirSync("demo/papers")
  .filter((name) => name.endsWith(".graph.json"))
  .sort()
  .map((name) => ({ filename: name.replace(".graph.json", ".pdf"), graph: JSON.parse(readFileSync(`demo/papers/${name}`, "utf8")) }));

const shared = {
  bundle: true,
  minify: release,
  target: "es2022",
  define: {
    __PANEL_HTML__: JSON.stringify(release ? "" : panelHtml),
    __TEST_HOOKS__: JSON.stringify(!release),
    __CANVAS_HTML__: JSON.stringify(canvasHtml),
    __CANVAS_BUILD__: JSON.stringify(canvasBuild),
    __DEMO_GRAPHS__: JSON.stringify(demoGraphs),
  },
};

await build({
  ...shared,
  entryPoints: ["plugins/obsidian/src/main.ts"],
  outfile: "dist/obsidian/main.js",
  format: "cjs",
  external: ["obsidian", "electron", "fs", "path", "@codemirror/language", "@codemirror/state", "@codemirror/view"],
});
writeFileSync(
  "dist/obsidian/manifest.json",
  JSON.stringify({
    id: "discourse-graphs-demo",
    name: "Discourse Graphs (demo)",
    version: "0.1.0",
    minAppVersion: "1.7.0",
    description: "A demo of Discourse Graphs built local first: one canvas, core and set of panels shared with Roam.",
    author: "Discourse Graphs",
    isDesktopOnly: true,
  }),
);

await build({
  ...shared,
  entryPoints: ["plugins/roam/src/main.ts"],
  outfile: "dist/roam/extension.js",
  format: "iife",
});
console.log(`panel build ${stamp}, canvas build ${canvasBuild}, ${Math.round(canvasHtml.length / 1024)} KB`);
