import { createAnchor, createCanvasItem, createNode, createNodeType, liveCanvasItems, revise, type DgId, type DgRecord, type NodeRecord, type NodeTypeRecord } from "@dg/contract/records.ts";
import { mergeIdentifiers, sameIdentifier, type Identifier, type LibraryAnnotation, type LibraryItem } from "@dg/contract/scholarly.ts";
import type { LibraryImported, LibraryItemView } from "@dg/contract/surface.ts";
import { citeAs, identifiersOf } from "./card.ts";
import type { Context, Handlers } from "./context.ts";
import { baseOf } from "./process.ts";

/**
 * A reference library, read into the graph only when a person asks. Zotero
 * stays the library: an item becomes one Source unit that points back at it,
 * and each highlight the person picks becomes a unit that quotes its passage.
 * Nothing is mirrored, and nothing is written back.
 *
 * What makes two things the same work is a DOI, PMID or arXiv id. A Zotero key
 * only says where an item sits in one library, so it finds an item again but
 * never decides identity.
 */

const IDENTITY: Identifier["scheme"][] = ["doi", "pmid", "pmcid", "arxiv", "isbn"];
/** How a source is cited in a few words: "Carroll 2020", "Dambre et al. 2012". */
export const sourceLabel = citeAs;

/** The type a mark most likely is: one the person tagged it with, else Evidence for a quote. */
export const suggestType = (mark: LibraryAnnotation, types: NodeTypeRecord[]): NodeTypeRecord | undefined => {
  // People who already tag annotations for a discourse graph write `dg/claim`, `claim` or `CLM`.
  for (const tag of mark.tags) {
    const word = tag.replace(/^#?(dg\/)?/i, "").toLowerCase();
    const named = types.find((type) => type.label.toLowerCase() === word || type.abbreviation?.toLowerCase() === word || type.base === word);
    if (named) return named;
  }
  return mark.text ? types.find((type) => type.base === "evidence") : types.find((type) => type.base === "claim");
};

const titleOf = (mark: LibraryAnnotation): string => {
  const said = (mark.text ?? mark.comment ?? "").replace(/\s+/g, " ").trim();
  return said.length > 300 ? `${said.slice(0, 297).trimEnd()}…` : said;
};

export const libraryFeature = (context: Context) => {
  const services = () => {
    if (!context.services?.zotero) throw new Error("Reading from Zotero needs the desktop app, and this base can't reach it.");
    return context.services.zotero;
  };
  const nodes = (): NodeRecord[] => context.documents("node").filter((node) => !node.removed);
  const base = (node: NodeRecord) => baseOf(context.graph(), node);

  /** The Source unit that already stands for this item: same work first, same library item second. */
  const sourceFor = (item: LibraryItem): NodeRecord | undefined => {
    const sources = nodes().filter((node) => base(node) === "source");
    const shares = (schemes: Identifier["scheme"][]) => (node: NodeRecord) =>
      identifiersOf(node).some((held) => schemes.includes(held.scheme) && item.identifiers.some((other) => sameIdentifier(held, other)));
    const paper = context.documents("paper").find((record) => record.doi && item.identifiers.some((id) => id.scheme === "doi" && id.value === record.doi));
    return (paper ? sources.find((node) => node.source?.paper === paper.id && node.source.own) : undefined) ?? sources.find(shares(IDENTITY)) ?? sources.find(shares(["zotero"]));
  };
  const markRef = (mark: LibraryAnnotation): Identifier => ({ scheme: "zotero", value: mark.ref });
  const unitFor = (mark: LibraryAnnotation): NodeRecord | undefined => nodes().find((node) => node.facts?.identifiers?.some((held) => sameIdentifier(held, markRef(mark))));

  const typesHere = (): NodeTypeRecord[] => context.nodeTypes().filter((type) => type.base === "question" || type.base === "claim" || type.base === "evidence");

  const handlers: Pick<Handlers, "zotero.status" | "zotero.search" | "zotero.item" | "zotero.import"> = {
    "zotero.status": async () => services().status(),
    "zotero.search": async ({ text, limit }) => {
      const found = await services().search({ text, ...(limit ? { limit } : {}) });
      return found.map((item) => {
        const held = sourceFor(item);
        return { item, label: sourceLabel(item.authors.map(({ name }) => name), item.published, item.title), ...(held ? { held: held.id } : {}) };
      });
    },
    "zotero.item": async ({ ref }): Promise<LibraryItemView> => {
      const [item, marks] = await Promise.all([services().item({ ref }), services().annotations({ ref })]);
      const held = sourceFor(item);
      const types = typesHere();
      return {
        item,
        label: sourceLabel(item.authors.map(({ name }) => name), item.published, item.title),
        ...(held ? { held: held.id } : {}),
        types: types.map(({ id, label, abbreviation, base: kind }) => ({ id, label, ...(abbreviation ? { abbreviation } : {}), ...(kind ? { base: kind } : {}) })),
        annotations: marks.map((mark) => {
          const here = unitFor(mark);
          const suggested = suggestType(mark, types);
          return { ...mark, ...(suggested ? { suggested: suggested.id } : {}), ...(here ? { held: here.id } : {}), usable: Boolean(mark.text || mark.comment) };
        }),
      };
    },
    "zotero.import": async ({ ref, annotations = [], canvas }): Promise<LibraryImported> => {
      const [item, marks] = await Promise.all([services().item({ ref }), annotations.length ? services().annotations({ ref }) : Promise.resolve([])]);
      const stamp = context.stamp();
      const me = context.me();
      const fresh: DgRecord[] = [];

      // The source: found by what it is, made if it isn't here, and told where it sits in the library either way.
      let sourceType = context.nodeTypes().find((type) => type.base === "source");
      if (!sourceType) {
        sourceType = createNodeType({ ...stamp, fields: { label: "Source", base: "source", abbreviation: "SRC", titleFormat: context.titleFormat?.("SRC") ?? "SRC - {content}" } });
        fresh.push(sourceType);
      }
      const names = item.authors.map(({ name }) => name);
      const doi = item.identifiers.find(({ scheme }) => scheme === "doi")?.value;
      const existing = sourceFor(item);
      let source: NodeRecord;
      if (!existing) {
        const rest = item.identifiers.filter(({ scheme }) => scheme !== "doi");
        source = createNode({
          ...stamp,
          title: item.title,
          type: sourceType.id,
          facts: {
            ...(doi ? { doi } : {}),
            ...(rest.length ? { identifiers: rest } : {}),
            ...(names.length ? { authors: names } : {}),
            ...(item.published ? { published: item.published } : {}),
            ...(item.venue ? { venue: item.venue } : {}),
            provenance: { method: "imported", agent: "Zotero" },
          },
        });
        fresh.push(source);
      } else {
        source = existing;
        // A source of this person's own learns where it sits in the library, and anything the library knows that it didn't.
        const known = identifiersOf(existing);
        const gained = item.identifiers.filter((id) => id.scheme !== "doi" && !known.some((held) => sameIdentifier(held, id)));
        const facts = existing.facts ?? {};
        const adds = {
          ...(gained.length ? { identifiers: mergeIdentifiers(facts.identifiers, gained) } : {}),
          ...(!facts.doi && doi ? { doi } : {}),
          ...(!facts.authors?.length && names.length ? { authors: names } : {}),
          ...(!facts.published && item.published ? { published: item.published } : {}),
          ...(!facts.venue && item.venue ? { venue: item.venue } : {}),
        };
        if (existing.by.id === me.id && Object.keys(adds).length) {
          source = revise({ record: existing, changes: { facts: { ...facts, ...adds } }, by: me });
          fresh.push(source);
        }
      }

      // A vault that already keeps a page per reference, named for its citekey, keeps using that page.
      const citekey = item.identifiers.find(({ scheme }) => scheme === "citekey")?.value;
      if (citekey && !context.anchorOf(source.id)) {
        const pages = await context.host.searchText({ query: `@${citekey}`, limit: 5 });
        const page = pages.ok ? pages.value.find((entry) => entry.scope === "page" && entry.title.toLowerCase() === `@${citekey}`.toLowerCase()) : undefined;
        if (page) fresh.push(createAnchor({ ...stamp, node: source.id, ref: page.ref }));
      }

      const wanted = new Map(annotations.map((entry) => [entry.key, entry.type]));
      const types = context.nodeTypes();
      const units: NodeRecord[] = [];
      let already = 0;
      for (const mark of marks) {
        if (!wanted.has(mark.key)) continue;
        const held = unitFor(mark);
        if (held) {
          already += 1;
          units.push(held);
          continue;
        }
        const title = titleOf(mark);
        if (!title) continue;
        const type = types.find((entry) => entry.id === wanted.get(mark.key)) ?? suggestType(mark, typesHere());
        const page = mark.pageLabel ?? (mark.pageIndex !== undefined ? String(mark.pageIndex + 1) : undefined);
        const unit = createNode({
          ...stamp,
          title,
          ...(type ? { type: type.id } : {}),
          prov: { sourceDocument: source.id },
          facts: {
            anchor: { source: source.id, ...(mark.text ? { exact: mark.text } : {}), ...(page ? { page } : {}), ...(mark.text && mark.comment ? { comment: mark.comment } : {}) },
            identifiers: [markRef(mark)],
            sameAs: [mark.open],
            // The person read and marked this themselves, in Zotero.
            provenance: { method: "authored", agent: mark.author && mark.author !== me.name ? `Zotero annotation by ${mark.author}` : "Zotero annotation" },
          },
        });
        fresh.push(unit);
        units.push(unit);
      }

      // Onto the canvas the person was on, in a block beside what is there.
      if (canvas && context.canvasOf(canvas)) {
        const live = liveCanvasItems({ graph: context.graph(), canvas });
        const on = new Set(live.flatMap(({ item: placed }) => ((placed as { dg?: { node?: DgId } }).dg?.node ? [(placed as { dg: { node: DgId } }).dg.node] : [])));
        const right = live.reduce((most, { item: placed }) => ("x" in placed && "width" in placed ? Math.max(most, placed.x + placed.width) : most), 0);
        const top = live.reduce((least, { item: placed }) => ("y" in placed ? Math.min(least, placed.y) : least), 0);
        [source, ...units]
          .filter((node) => !on.has(node.id))
          .forEach((node, index) => {
            const spot = index === 0 ? { x: right + 420, y: top } : { x: right + 80, y: top + (index - 1) * 190 };
            fresh.push(createCanvasItem({ ...stamp, canvas, item: { type: "text" as const, text: node.title, ...spot, width: 280, height: 110, dg: { node: node.id } }, z: live.length + index + 1 }));
          });
      }
      if (fresh.length) await context.put(fresh);
      return { source: context.summarize(context.nodeOf(source.id) ?? source), made: units.length - already, already, units: units.map(({ id }) => id), ...(canvas ? { canvas } : {}), wasHere: Boolean(existing) };
    },
  };

  /** Where a unit sits in the library, so the panel can open it there. */
  const linkOf = (node: NodeRecord): { app: "zotero"; open: string; what: "item" | "passage"; exact?: string; comment?: string } | undefined => {
    const passage = node.facts?.sameAs?.find((link) => link.startsWith("zotero://open-pdf/"));
    const anchor = node.facts?.anchor;
    if (passage) return { app: "zotero", open: passage, what: "passage", ...(anchor?.exact ? { exact: anchor.exact } : {}), ...(anchor?.comment ? { comment: anchor.comment } : {}) };
    const ref = identifiersOf(node).find(({ scheme }) => scheme === "zotero")?.value;
    if (!ref) return undefined;
    const [kind, id, , key] = ref.split("/");
    return { app: "zotero", open: kind === "groups" ? `zotero://select/groups/${id}/items/${key}` : `zotero://select/library/items/${key}`, what: "item" };
  };
  return { handlers, linkOf };
};
