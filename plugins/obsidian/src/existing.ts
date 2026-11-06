import type { App } from "obsidian";
import type { ExistingGraph } from "@dg/core/migrate.ts";

type Settings = {
  nodeTypes?: { id: string; name: string; format: string; color?: string }[];
  relationTypes?: { id: string; label: string; complement: string; color?: string }[];
  discourseRelations?: { sourceId: string; destinationId: string; relationshipTypeId: string }[];
};

type RelationsFile = {
  relations?: Record<string, { type: string; source: string; destination: string; tentative?: boolean }>;
};

const readJson = async <T>(app: App, path: string, fallback: T): Promise<T> =>
  (await app.vault.adapter.exists(path))
    ? (JSON.parse(await app.vault.adapter.read(path)) as T)
    : fallback;

/** Reads today's plugin files. Everything here is a read. */
export const readExisting = async (app: App): Promise<ExistingGraph> => {
  const settings = await readJson<Settings>(app, `${app.vault.configDir}/plugins/discourse-graph/data.json`, {});
  const stored = await readJson<RelationsFile>(app, "relations.json", {});
  return {
    nodeTypes: (settings.nodeTypes ?? []).map(({ id, name, format, color }) => ({
      key: id,
      label: name,
      format,
      ...(color ? { color } : {}),
    })),
    relationTypes: (settings.relationTypes ?? []).map(({ id, label, complement }) => ({
      key: id,
      label,
      complement,
    })),
    rules: (settings.discourseRelations ?? []).map(({ sourceId, destinationId, relationshipTypeId }) => ({
      relation: relationshipTypeId,
      source: sourceId,
      target: destinationId,
    })),
    nodes: app.vault.getMarkdownFiles().flatMap((file) => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      const type = frontmatter?.nodeTypeId as string | undefined;
      const id = frontmatter?.nodeInstanceId as string | undefined;
      const createdAt = new Date(file.stat.ctime).toISOString();
      return type && id ? [{ key: id, ref: `id:${id}`, title: file.basename, type, createdAt }] : [];
    }).sort((a, b) => a.title.length - b.title.length),
    relations: Object.values(stored.relations ?? {}).map(({ type, source, destination, tentative }) => ({
      relation: type,
      source,
      target: destination,
      ...(tentative === true ? { tentative } : {}),
    })),
  };
};
