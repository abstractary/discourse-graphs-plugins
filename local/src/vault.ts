// A vault on disk as a base for the core: every device's record log in `discourse-graph/records/`,
// read the way the Obsidian plugin reads it, and one log of this program's own. The local app and
// the MCP server both stand on this.
import { readLog } from "@dg/contract/log.ts";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { createMemoryHost, createMemoryStore } from "@dg/contract/memory-host.ts";
import { canonicalJson, uuidv7, type DgRecord } from "@dg/contract/records.ts";
import type { Host } from "@dg/contract/host.ts";
import type { SecretStore } from "@dg/contract/llm.ts";
import type { KeyStore } from "@dg/core/index.ts";

const PAPER_FILES = "Paper files";
const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };

type Settings = { deviceId: string; local: Record<string, unknown> };

export const openVault = ({
  vault,
  keys: KEYS,
  as = "device",
  name = "Local app",
  person,
  onWrite = () => {},
  onArrival = () => {},
}: {
  vault: string;
  /** A folder outside the vault for this program's id, settings and keys. */
  keys: string;
  /** An agent keeps an id and a log of its own, apart from the local app's on the same computer. */
  as?: "device" | "agent";
  /** What this program calls its person until they set a name. */
  name?: string;
  /** Who this program writes as, given the records already in the vault. Its own id when absent. */
  person?: (records: DgRecord[]) => { id: string; name: string } | undefined;
  /** After this program wrote records. */
  onWrite?: () => void;
  /** After another device's records were read. */
  onArrival?: () => void;
}) => {
  const VAULT = resolve(vault);
  const ROOT = join(VAULT, "discourse-graph");
  const RECORDS = join(ROOT, "records");
  mkdirSync(RECORDS, { recursive: true });

  // This device: its id, its settings and its keys live outside the vault, so a tool that syncs the
  // vault to another computer doesn't carry them there. Two computers with one id would write one log.
  mkdirSync(KEYS, { recursive: true, mode: 0o700 });
  const SETTINGS = join(KEYS, `${createHash("sha256").update(`${VAULT}:${as}`).digest("hex").slice(0, 16)}.json`);
  /** Where earlier versions of the local app kept them, inside the vault. Read once and taken out. */
  const OLD_SETTINGS = join(ROOT, "local-app.json");
  const moved = as === "device" && existsSync(OLD_SETTINGS);
  const settings: Settings = existsSync(SETTINGS)
    ? (JSON.parse(readFileSync(SETTINGS, "utf8")) as Settings)
    : moved
      ? (JSON.parse(readFileSync(OLD_SETTINGS, "utf8")) as Settings)
      : { deviceId: `${as === "agent" ? "agent" : "local"}-${uuidv7()}`, local: {} };
  const saveSettings = (): void => writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 1)}\n`, { mode: 0o600 });
  saveSettings();
  if (moved) rmSync(OLD_SETTINGS);
  const deviceLog = join(RECORDS, `${settings.deviceId}.jsonl`);

  const spaceFile = join(ROOT, "space.json");
  const spaceId = existsSync(spaceFile) ? (JSON.parse(readFileSync(spaceFile, "utf8")) as { id: string }).id : uuidv7();
  if (!existsSync(spaceFile)) writeFileSync(spaceFile, JSON.stringify({ id: spaceId }));

  /** Keys stay outside the vault, which may sync elsewhere, in a file only this user can read. */
  const fileKeys = (folder: string): KeyStore => {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
    const pathOf = (name: string) => join(folder, `${createHash("sha256").update(`${VAULT}:${name}`).digest("hex").slice(0, 16)}.json`);
    const load = async (path: string): Promise<CryptoKeyPair> => {
      const { privateKey, publicKey } = JSON.parse(readFileSync(path, "utf8")) as { privateKey: JsonWebKey; publicKey: JsonWebKey };
      return {
        privateKey: await crypto.subtle.importKey("jwk", privateKey, ECDSA, false, ["sign"]),
        publicKey: await crypto.subtle.importKey("jwk", publicKey, ECDSA, true, ["verify"]),
      };
    };
    return {
      get: async (name) => {
        const path = pathOf(name);
        if (!existsSync(path)) {
          const pair = (await crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"])) as CryptoKeyPair;
          const jwk = { privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey), publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
          writeFileSync(path, JSON.stringify(jwk), { mode: 0o600 });
        }
        return load(path);
      },
      put: async () => undefined,
    };
  };

  const store = createMemoryStore();
  store.spaceId = spaceId;
  for (const [key, value] of Object.entries(settings.local)) store.local.set(key, value as never);
  const seen = new Set<string>();

  /** New records from every device's log. */
  const readLogs = (): DgRecord[] => {
    const fresh: DgRecord[] = [];
    for (const name of readdirSync(RECORDS).filter((f) => f.endsWith(".jsonl")).sort()) {
      // Whole records only: a line a sync tool cut short, joined or marked is skipped.
      for (const record of readLog(readFileSync(join(RECORDS, name), "utf8")).records) {
        const key = canonicalJson(record);
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(record);
      }
    }
    return fresh;
  };
  store.records.push(...readLogs());
  const self = person?.(store.records) ?? { id: settings.deviceId, name };

  /** A vault path, kept inside the vault. */
  const inVault = (ref: string): string | null => {
    const path = resolve(VAULT, ref);
    return path.startsWith(VAULT + sep) ? path : null;
  };
  /** Every file in the vault, skipping the hidden folders Obsidian keeps. */
  const vaultFiles = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
      const path = join(folder, entry.name);
      return entry.isDirectory() ? vaultFiles(path) : [path];
    });

  const { host: memory, emit } = createMemoryHost({ store, host: "local" });
  const host: Host = {
    ...memory,
    describe: async () => {
      const info = await memory.describe();
      if (!info.ok) return info;
      return { ...info, value: { ...info.value, space: { id: spaceId, name: VAULT.split(sep).pop() ?? "Vault" }, person: self } };
    },
    // What core writes goes to this device's own log, so Obsidian reads it as another device.
    putRecords: async (args) => {
      const result = await memory.putRecords(args);
      if (result.ok && args.records.length) {
        const lines = args.records.map((record) => {
          seen.add(canonicalJson(record));
          return `${JSON.stringify(record)}\n`;
        });
        appendFileSync(deviceLog, lines.join(""));
        onWrite();
      }
      return result;
    },
    setLocal: async (args) => {
      const result = await memory.setLocal(args);
      settings.local[args.key] = args.value;
      saveSettings();
      return result;
    },
    // Files are the vault's own, by their path in it, the same refs Obsidian uses.
    listFiles: async ({ extensions, limit }) => {
      const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));
      const found = vaultFiles(VAULT).filter((path) => wanted.has(extname(path).slice(1).toLowerCase()));
      const files = found
        .map((path) => ({ path, stat: statSync(path) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
        .slice(0, limit)
        .map(({ path, stat }) => {
          const ref = relative(VAULT, path).split(sep).join("/");
          const folder = dirname(ref);
          return {
            ref,
            name: ref.split("/").pop()!,
            mime: MIME[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream",
            ...(folder !== "." ? { folder } : {}),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        });
      return { ok: true, value: files };
    },
    readAsset: async ({ ref }) => {
      const path = inVault(ref);
      if (!path || !existsSync(path)) return memory.readAsset({ ref });
      const mime = MIME[extname(path).slice(1).toLowerCase()] ?? "application/octet-stream";
      return { ok: true, value: { name: path.split(sep).pop()!, mime, dataUrl: `data:${mime};base64,${readFileSync(path).toString("base64")}` } };
    },
    // A reference library's PDF, read where the library keeps it.
    readLocalFile: async ({ path }) => {
      if (!/\.pdf$/i.test(path)) return { ok: false, error: { code: "unavailable", message: "Only PDFs are read from outside the vault." } };
      if (!existsSync(path)) return { ok: false, error: { code: "not-found", message: `${path.split(sep).pop()} isn't where Zotero says it is. Open it in Zotero once so it downloads.` } };
      return { ok: true, value: { name: path.split(sep).pop()!, mime: "application/pdf", dataUrl: `data:application/pdf;base64,${readFileSync(path).toString("base64")}` } };
    },
    writeAsset: async ({ asset }) => {
      if (asset.mime !== "application/pdf") return memory.writeAsset({ asset });
      mkdirSync(join(VAULT, PAPER_FILES), { recursive: true });
      const clean = asset.name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Document.pdf";
      const dot = clean.lastIndexOf(".");
      const [stem, extension] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot + 1)] : [clean, "pdf"];
      let ref = `${PAPER_FILES}/${stem}.${extension}`;
      for (let n = 2; existsSync(join(VAULT, ref)); n += 1) ref = `${PAPER_FILES}/${stem} ${n}.${extension}`;
      writeFileSync(join(VAULT, ref), Buffer.from(asset.dataUrl.split(",")[1] ?? "", "base64"));
      return { ok: true, value: { ref } };
    },
  };

  /** Model keys sit beside the signing keys, outside the vault, in a file only this user can read. */
  const fileSecrets = (folder: string): SecretStore => {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const path = join(folder, "secrets.json");
    const read = (): Record<string, string> => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {});
    return {
      kind: "file",
      get: async (id) => read()[id] ?? null,
      set: async (id, value) => {
        const all = read();
        if (value) all[id] = value;
        else delete all[id];
        writeFileSync(path, JSON.stringify(all), { mode: 0o600 });
      },
    };
  };

  // Obsidian, or another device, wrote to the log.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(RECORDS, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const fresh = readLogs();
      if (!fresh.length) return;
      store.records.push(...fresh);
      emit({ type: "records-changed" });
      onArrival();
    }, 150);
  });

  return {
    host,
    path: VAULT,
    root: ROOT,
    device: settings.deviceId,
    log: deviceLog,
    recordCount: () => store.records.length,
    keys: fileKeys(KEYS),
    secrets: fileSecrets(KEYS),
    stop: (): void => {
      clearTimeout(pending);
      watcher.close();
    },
  };
};
