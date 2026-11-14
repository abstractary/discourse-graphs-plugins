// Builds the local app's page: one HTML file with its script and styles inline.
//   npm run build:local
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'self'";
const result = await build({
  entryPoints: ["packages/surfaces/src/holon/standalone.tsx"],
  bundle: true,
  minify: process.env.DG_RELEASE === "1",
  write: false,
  outdir: "out",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text.replaceAll("</script", "<\\/script");
const css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>Discourse Graphs</title><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
writeFileSync("dist/local.html", html);
console.log(`dist/local.html, ${(html.length / 1024).toFixed(0)} KB`);
