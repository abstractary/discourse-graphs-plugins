// Re-issues the four MATSUlab evidence bundles through our own importer and
// exporter, from the real files. Run from the repository root:
//   node examples/evidence-bundles/reissue.ts
// MATSULAB_REPO points at a checkout of DiscourseGraphs/MATSUlab-issue-exchange-analysis
// (CC BY 4.0); it defaults to ../org-repos/MATSUlab-issue-exchange-analysis.
// Each bundle is read as a folder, the way it would sit in a vault, and saved
// as `<name>.crate.zip` under examples/evidence-bundles/out, with the archive
// unpacked beside it so a validator can read it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createCore } from "@dg/core/index.ts";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import type { JsonObject } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfaceMethod, SurfaceMethods, SurfacePort } from "@dg/contract/surface.ts";
import { unzip } from "@dg/core/zip.ts";

const REPO = process.env.MATSULAB_REPO ?? "../org-repos/MATSUlab-issue-exchange-analysis";
const BUNDLES = join(REPO, "output/evidence_bundles");
const OUT = "examples/evidence-bundles/out";
const COMMIT = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const MIME: Record<string, string> = { json: "application/json", jsonld: "application/ld+json", csv: "text/csv", png: "image/png", gif: "image/gif", html: "text/html", md: "text/markdown" };
const walk = (folder: string): string[] => readdirSync(folder).flatMap((name) => (statSync(join(folder, name)).isDirectory() ? walk(join(folder, name)) : [join(folder, name)]));

type Call = <M extends SurfaceMethod>(method: M, params: SurfaceMethods[M]["params"]) => Promise<SurfaceMethods[M]["result"]>;

const reissue = async (bundle: string) => {
  // A base that holds the bundle's files where a vault would: by folder and name.
  const { host } = createMemoryHost({ store: createMemoryStore() });
  const held = walk(join(BUNDLES, bundle)).map((path) => ({ ref: relative(BUNDLES, path), bytes: readFileSync(path) }));
  const saved = new Map<string, Uint8Array>();
  const base = {
    ...host,
    listFiles: async ({ extensions, limit }: { extensions: string[]; limit: number }) => ({
      ok: true as const,
      value: held
        .filter(({ ref }) => extensions.includes(ref.split(".").pop()!.toLowerCase()))
        .slice(0, limit)
        .map(({ ref, bytes }) => ({ ref, name: ref.split("/").pop()!, mime: MIME[ref.split(".").pop()!] ?? "application/octet-stream", folder: dirname(ref), size: bytes.length })),
    }),
    readAsset: async ({ ref }: { ref: string }) => {
      const file = held.find((item) => item.ref === ref);
      if (!file) return { ok: false as const, error: { code: "not-found" as const, message: `No asset ${ref}.` } };
      const mime = MIME[ref.split(".").pop()!] ?? "application/octet-stream";
      return { ok: true as const, value: { name: ref.split("/").pop()!, mime, dataUrl: `data:${mime};base64,${file.bytes.toString("base64")}` } };
    },
    saveFile: async ({ name, dataBase64 }: { name: string; dataBase64: string }) => (saved.set(name, Buffer.from(dataBase64, "base64")), { ok: true as const, value: { where: OUT } }),
  };
  const core = await createCore({ host: base as never });
  const pending = new Map<string, (message: SurfaceMessage) => void>();
  let listener: (message: SurfaceMessage) => void = () => {};
  const port: SurfacePort = { send: (message) => void ("id" in message && pending.get(message.id)?.(message)), onMessage: (handler) => ((listener = handler), () => {}) };
  core.connectSurface({ port });
  let next = 0;
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `r${(next += 1)}`;
      pending.set(id, (message) => {
        const reply = message as { ok: boolean; result?: unknown; error?: { message: string } };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(reply.error?.message));
      });
      listener({ id, method, params } as SurfaceMessage);
    });

  const read = await call("crate.import", { ref: `${bundle}/ro-crate-metadata.json` });
  const theirs = JSON.parse(readFileSync(join(BUNDLES, bundle, "ro-crate-metadata.json"), "utf8")) as { "@graph": JsonObject[] };
  const root = theirs["@graph"].find((entity) => entity["@id"] === "./")!;
  const made = await call("crate.export", {
    canvas: read.canvas!,
    name: String(root.name),
    description: `${root.description} Re-issued from ${REPO.split("/").pop()} at commit ${COMMIT.slice(0, 12)} by reading the bundle and exporting it again, with nothing added by hand.`,
    license: "https://creativecommons.org/licenses/by/4.0/",
  });
  const archive = saved.get(made.name)!;
  writeFileSync(join(OUT, made.name), archive);
  const folder = join(OUT, bundle);
  rmSync(folder, { recursive: true, force: true });
  for (const entry of await unzip(archive)) {
    mkdirSync(dirname(join(folder, entry.path)), { recursive: true });
    writeFileSync(join(folder, entry.path), entry.bytes);
  }
  const ours = JSON.parse(readFileSync(join(folder, "ro-crate-metadata.json"), "utf8")) as { "@graph": JsonObject[] };
  const count = (graph: JsonObject[], test: (entity: JsonObject) => boolean): number => graph.filter(test).length;
  const typed = (name: string) => (entity: JsonObject): boolean => [entity["@type"]].flat().includes(name);
  return {
    bundle,
    read: { units: read.units, filesHashed: read.hashed },
    theirs: { entities: theirs["@graph"].length, withHash: count(theirs["@graph"], (entity) => "sha256" in entity), miraInCrate: count(theirs["@graph"], (entity) => JSON.stringify(entity["@type"]).includes("mira:")) },
    ours: {
      archive: made.name,
      bytes: archive.length,
      entities: ours["@graph"].length,
      filesWithHash: count(ours["@graph"], (entity) => "sha256" in entity),
      outputsPacked: made.outputs,
      evidence: count(ours["@graph"], typed("mira:Evidence")),
      studies: count(ours["@graph"], typed("mira:Study")),
      protocols: count(ours["@graph"], typed("mira:Protocol")),
      code: count(ours["@graph"], typed("SoftwareSourceCode")),
    },
  };
};

mkdirSync(OUT, { recursive: true });
const results = [];
for (const bundle of readdirSync(BUNDLES).filter((name) => name.startsWith("evd")).sort()) results.push(await reissue(bundle));
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify({ source: "DiscourseGraphs/MATSUlab-issue-exchange-analysis", commit: COMMIT, results }, null, 1)}\n`);
console.log(JSON.stringify(results, null, 1));
