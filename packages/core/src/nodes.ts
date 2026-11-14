import { formatTitle, revise, type DgId, type NodeRecord } from "@dg/contract/records.ts";
import type { Result } from "@dg/contract/host.ts";
import type { Captured, CaptureRequest } from "@dg/contract/core.ts";
import type { Provenance, UnitSocial } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import { refuse, value } from "./refuse.ts";

type NodeHandlers = Pick<Handlers, "node.query" | "node.create" | "node.setType" | "node.remove" | "node.rename" | "node.insertLink" | "node.view">;

/**
 * A unit by itself: finding it, making it, renaming and retyping it, removing it, and everything
 * the context panel shows about one.
 */
export const nodeFeature = (
  context: Context,
  {
    capture,
    pdfOf,
    workOf,
    libraryLinkOf,
    provenance,
    social,
  }: {
    capture: (request: CaptureRequest) => Promise<Result<Captured>>;
    /** Where in a PDF a unit was read from. */
    pdfOf: (node: NodeRecord) => Promise<Provenance["pdf"] | undefined>;
    /** The published work a unit stands for. */
    workOf: (node: NodeRecord) => Provenance["work"] | undefined;
    libraryLinkOf: (node: NodeRecord) => Provenance["library"] | undefined;
    provenance: (node: NodeRecord) => Provenance;
    social: (unit: DgId) => UnitSocial;
  },
) => {
  const { host, put, documents, nodeOf, summarize } = context;
  const me = () => context.me();
  const liveHome = (id: DgId) => {
    const anchor = context.anchorOf(id);
    return anchor && context.hasLiveText(anchor.ref) ? anchor : undefined;
  };
  const onSharedCanvas = (node: DgId): boolean =>
    documents("canvas-item").some(
      (item) => !item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === node && context.canvasOf(item.canvas)?.shared !== undefined,
    );

  const handlers: NodeHandlers = {
    "node.query": async ({ text, types, limit }) => {
      const needle = text?.toLowerCase();
      return documents("node")
        .filter((node) => !node.removed)
        .filter((node) => !needle || node.title.toLowerCase().includes(needle))
        .filter((node) => !types || (node.type && types.includes(node.type)))
        .slice(0, limit)
        .map(summarize);
    },
    "node.create": async ({ title, type }) => {
      const created = value(await capture({ text: title, ...(type ? { type } : {}) }));
      return summarize(nodeOf(created.node)!);
    },
    "node.setType": async ({ id, type }) => {
      const node = nodeOf(id);
      if (!node) throw refuse("not-found", `No node ${id}`);
      // The type goes first: the rename fires an event, and parsing that title
      // needs the new format, or the prefix would land in the node's title.
      if (type === null) {
        const { type: _gone, ...untyped } = node;
        await put([revise({ record: untyped as NodeRecord, changes: {}, by: me() })]);
      } else {
        await put([revise({ record: node, changes: { type }, by: me() })]);
      }
      const format = type === null ? undefined : context.typeOf(type)?.titleFormat;
      const anchor = context.anchorOf(id);
      if (anchor && (format || type === null)) {
        const renamed = await host.renameText({
          ref: anchor.ref,
          title: formatTitle({ ...(format ? { format } : {}), content: node.title }),
        });
        if (!renamed.ok && renamed.error.code !== "conflict") throw refuse(renamed.error.code, renamed.error.message);
      }
      return summarize(nodeOf(id)!);
    },
    "node.remove": async ({ id }) => {
      const node = nodeOf(id);
      if (!node || node.removed) return null;
      if (node.by.id !== me().id) throw refuse("read-only", `Only ${context.nameOf(node.by)} can remove this unit.`);
      const cards = documents("canvas-item").filter((item) => !item.removed && (item.item as { dg?: { node?: DgId } }).dg?.node === id);
      const home = liveHome(id);
      // The lines drawn to its cards go with them, so no canvas keeps a relation to a unit that is gone.
      const cardIds = new Set(cards.map((card) => card.id));
      const lines = documents("canvas-item").filter((item) => {
        const edge = item.item as { fromNode?: DgId; toNode?: DgId };
        return !item.removed && Boolean((edge.fromNode && cardIds.has(edge.fromNode)) || (edge.toNode && cardIds.has(edge.toNode)));
      });
      await put([revise({ record: node, changes: { removed: true }, by: me() }), ...[...cards, ...lines].map((item) => revise({ record: item, changes: { removed: true }, by: me() }))]);
      if (home) await host.removeText({ ref: home.ref });
      return null;
    },
    "node.rename": async ({ id, title: wanted }) => {
      const node = nodeOf(id);
      if (!node || node.removed) throw refuse("not-found", "That unit is gone.");
      if (node.by.id !== me().id) throw refuse("read-only", `Only ${context.nameOf(node.by)} can rename this unit.`);
      const title = wanted.replace(/\s+/g, " ").trim();
      if (!title) throw refuse("invalid", "A unit needs a title.");
      if (title === node.title) return summarize(node);
      // The record goes first, so the rename's own event finds nothing left to change.
      // A unit a model read keeps the model's wording beside the person's, from the first rewording on.
      const source = node.source && node.source.asRead === undefined ? { ...node.source, asRead: node.title } : node.source;
      const back = source?.asRead === title;
      const { asRead: _kept, ...plainSource } = source ?? ({} as NonNullable<typeof source>);
      await put([revise({ record: node, changes: { title, ...(source ? { source: back ? plainSource : source } : {}) }, by: me() })]);
      const anchor = liveHome(id);
      if (anchor) {
        const format = context.typeOf(node.type)?.titleFormat;
        const renamed = await host.renameText({ ref: anchor.ref, title: formatTitle({ ...(format ? { format } : {}), content: title }) });
        if (!renamed.ok) {
          await put([revise({ record: nodeOf(id)!, changes: { title: node.title }, by: me() })]);
          throw refuse(renamed.error.code, renamed.error.code === "conflict" ? `There's already a note called "${title}".` : renamed.error.message);
        }
      }
      return summarize(nodeOf(id)!);
    },
    "node.insertLink": async ({ id }) => {
      const anchor = liveHome(id);
      if (!anchor) throw refuse("no-target", "This unit has no note to link to yet.");
      value(await host.insertLink({ ref: anchor.ref }));
      return null;
    },
    "node.view": async ({ id }) => {
      const node = nodeOf(id);
      if (!node) throw refuse("not-found", `No node ${id}`);
      const graph = context.graph();
      const anchor = context.anchorOf(id);
      const text = anchor ? await host.readText({ ref: anchor.ref }) : null;
      const touching = [...graph.relations.values()].filter(({ record }) => record.source === id || record.target === id);
      const related = new Set<string>(touching.map(({ record }) => (record.source === id ? record.target : record.source)));
      const lab = context.labOf(node);
      const pdf = await pdfOf(node);
      const work = workOf(node);
      // The unit's own place in the library, or else that of the source it was read from.
      const readFrom = nodeOf(node.facts?.anchor?.source ?? node.prov?.sourceDocument ?? "");
      const inLibrary = libraryLinkOf(node) ?? (readFrom ? libraryLinkOf(readFrom) : undefined);
      return {
        node: summarize(node),
        checks: context.offers.checks?.checksOf(id) ?? [],
        body: text?.ok ? text.value.body : null,
        context: touching.flatMap(({ record, state }) => {
          const other = nodeOf(record.source === id ? record.target : record.source);
          if (!other) return [];
          const label = record.source === id ? context.relationLabel(record.type) : (context.relationTypeOf(record.type)?.complement ?? context.relationLabel(record.type));
          return [{ relation: record, label, state, other: summarize(other) }];
        }),
        mentionedIn: anchor
          ? value(await host.listBacklinks({ ref: anchor.ref }))
              // A related unit's note links here through its properties, and is already listed as a relation.
              .filter(({ ref }) => !related.has(context.anchoredAt(ref) ?? ""))
              .map(({ title }) => ({ title }))
          : [],
        attribution: {
          person: context.nameOf(node.by),
          ...(lab ? { lab: lab.name } : {}),
        },
        provenance: { ...provenance(node), ...(pdf ? { pdf } : {}), ...(work ? { work } : {}), ...(inLibrary ? { library: inLibrary } : {}) },
        ...(onSharedCanvas(id) ? { social: social(id) } : {}),
      };
    },
  };
  return { handlers };
};
