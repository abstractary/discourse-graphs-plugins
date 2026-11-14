import { parseTitle } from "@dg/contract/records.ts";
import type { ExistingGraph } from "@dg/core/index.ts";

type RoamApi = {
  data: {
    fast: { q: (query: string, ...args: unknown[]) => unknown[][] };
    pull: (selector: string, id: [string, string]) => unknown;
  };
};

type Block = {
  ":block/uid"?: string;
  ":block/string"?: string;
  ":block/order"?: number;
  ":block/props"?: Record<string, unknown>;
  ":block/children"?: Block[];
};

const NODE_PAGES = "discourse-graph/nodes/";
const CONFIG_PAGE = "roam/js/discourse-graph";
const RELATIONS_PAGE = "roam/js/discourse-graph/relations";
const TREE = "[:block/uid :block/string :block/order :block/props {:block/children ...}]";

const byName = (children: Block[] | undefined, name: string): Block | undefined =>
  children?.find((child) => child[":block/string"]?.trim().toLowerCase() === name.toLowerCase());

const firstValue = (block: Block | undefined): string | undefined =>
  block?.[":block/children"]?.[0]?.[":block/string"]?.trim();

/** Block props can come back with or without the keyword colon. */
const prop = (props: Record<string, unknown> | undefined, key: string): unknown =>
  props?.[`:${key}`] ?? props?.[key];

/** Reads today's plugin layout. Everything here is a read. */
export const readExisting = (api: RoamApi): ExistingGraph => {
  const pages = api.data.fast.q("[:find ?u ?t :where [?p :node/title ?t] [?p :block/uid ?u]]") as [string, string][];
  const tree = (uid: string): Block | null =>
    api.data.pull(TREE, [":block/uid", uid]) as Block | null;
  const pageUid = (title: string): string | undefined => pages.find(([, name]) => name === title)?.[0];

  const nodeTypes = pages
    .filter(([, title]) => title.startsWith(NODE_PAGES))
    .flatMap(([uid, title]) => {
      const children = tree(uid)?.[":block/children"];
      const format = firstValue(byName(children, "Format"));
      const color = firstValue(byName(byName(children, "Canvas")?.[":block/children"], "color"));
      return format
        ? [{ key: uid, label: title.slice(NODE_PAGES.length), format, ...(color ? { color: `#${color.replace(/^#/, "")}` } : {}) }]
        : [];
    });

  const configUid = pageUid(CONFIG_PAGE);
  const grammar = configUid ? byName(tree(configUid)?.[":block/children"], "grammar") : undefined;
  const relationBlocks = byName(grammar?.[":block/children"], "relations")?.[":block/children"] ?? [];
  const relationTypes = relationBlocks.flatMap((block) => {
    const label = block[":block/string"]?.trim();
    const key = block[":block/uid"];
    if (!label || !key) return [];
    return [{ key, label, complement: firstValue(byName(block[":block/children"], "complement")) ?? label }];
  });
  const rules = relationBlocks.flatMap((block) => {
    const source = firstValue(byName(block[":block/children"], "Source"));
    const target = firstValue(byName(block[":block/children"], "Destination"));
    const relation = block[":block/uid"];
    return source && target && relation ? [{ relation, source, target }] : [];
  });

  // Longest prefix first, so a bare format like `@{content}` can't claim another type's pages.
  const formats = nodeTypes
    .map(({ key, format }) => ({ key, format: format.replace(/\s-\s\{(?!content\})[^}]+\}\s*$/, "") }))
    .sort((a, b) => b.format.indexOf("{content}") - a.format.indexOf("{content}"));
  const nodes = pages.flatMap(([uid, title]) => {
    if (title.startsWith(NODE_PAGES) || title.startsWith(CONFIG_PAGE)) return [];
    const type = formats.find(({ format }) => parseTitle({ format, title }) !== null);
    if (!type) return [];
    const made = (api.data.pull("[:create/time]", [":block/uid", uid]) as { ":create/time"?: number } | null)?.[":create/time"];
    return [{ key: uid, ref: uid, title, type: type.key, ...(made ? { createdAt: new Date(made).toISOString() } : {}) }];
  });

  const storedUid = pageUid(RELATIONS_PAGE);
  const stored = storedUid ? (tree(storedUid)?.[":block/children"] ?? []) : [];
  const relations = stored.flatMap((block) => {
    const data = prop(block[":block/props"], "discourse-graph") as Record<string, unknown> | undefined;
    const relation = prop(data, "hasSchema");
    const source = prop(data, "sourceUid");
    const target = prop(data, "destinationUid");
    if (typeof relation !== "string" || typeof source !== "string" || typeof target !== "string") return [];
    return [{ relation, source, target, ...(prop(data, "tentative") === "true" ? { tentative: true } : {}) }];
  });

  return { nodeTypes, relationTypes, rules, nodes, relations };
};
