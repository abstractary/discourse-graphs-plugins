import { revise, type DgRecord, type NodeRecord, type PaperRecord } from "@dg/contract/records.ts";
import { isIdentifier, mergeIdentifiers, parseIdentifier, sameIdentifier, standingOf, type Identifier, type WorkMetadata } from "@dg/contract/scholarly.ts";
import type { WorkLookup, WorkView } from "@dg/contract/surface.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";
import type { Context, Handlers } from "./context.ts";

/**
 * Looks a published work up in the open registries and keeps what they say:
 * its other identifiers, when and where it was published, and whether it has
 * been retracted. A paper record takes the answer. A cited source takes it on
 * its own unit. Nothing is asked until a person asks.
 */

const without = (list: Identifier[], scheme: Identifier["scheme"]): Identifier[] => list.filter((item) => item.scheme !== scheme);
const first = (list: Identifier[], scheme: Identifier["scheme"]): string | undefined => list.find((item) => item.scheme === scheme)?.value;

/** What a paper record gains from a lookup. A paper's own title and authors are never overwritten. */
export const paperChanges = (paper: PaperRecord, work: WorkMetadata): Partial<PaperRecord> => {
  const doi = paper.doi ?? first(work.identifiers, "doi");
  const identifiers = without(mergeIdentifiers(paper.identifiers, work.identifiers), "doi");
  return {
    ...(doi ? { doi } : {}),
    ...(identifiers.length ? { identifiers } : {}),
    ...(work.published ? { published: work.published } : {}),
    ...(work.venue ? { venue: work.venue } : {}),
    ...(work.authors?.length ? { people: work.authors } : {}),
    ...(paper.authors.length === 0 && work.authors?.length ? { authors: work.authors.map(({ name }) => name) } : {}),
    ...(!paper.license && work.license ? { license: work.license } : {}),
    standing: standingOf(work),
  };
};

/** What a source unit gains: identifiers and standing in its facts. Its title stays as its author wrote it. */
export const sourceChanges = (node: NodeRecord, work: WorkMetadata): Partial<NodeRecord> => {
  const facts = node.facts ?? {};
  const doi = facts.doi ?? first(work.identifiers, "doi");
  const openalex = facts.openalex ?? first(work.identifiers, "openalex");
  const identifiers = mergeIdentifiers(facts.identifiers, work.identifiers).filter(({ scheme }) => scheme !== "doi" && scheme !== "openalex");
  return {
    facts: {
      ...facts,
      ...(doi ? { doi } : {}),
      ...(openalex ? { openalex } : {}),
      ...(identifiers.length ? { identifiers } : {}),
      standing: standingOf(work),
    },
  };
};

export const worksFeature = (context: Context) => {
  const paperAt = (id: string | undefined): PaperRecord | undefined => (id ? context.documents("paper").find((paper) => paper.id === id) : undefined);
  const baseOf = (node: NodeRecord) => context.typeOf(node.type)?.base;

  /** What a unit's lookup is about: a source cited by a paper is its own work, anything else is its paper. */
  const targetOf = (node: NodeRecord): { paper: PaperRecord } | { unit: NodeRecord } | undefined => {
    const own = paperAt(context.summarize(node).card.source?.paper);
    if (baseOf(node) === "source" && !node.source?.own) {
      // A source unit that stands for a held paper is that paper.
      const standsFor = context.documents("paper").find((paper) => (paper.doi !== undefined && paper.doi === node.facts?.doi) || paper.title === node.title);
      return standsFor ? { paper: standsFor } : { unit: node };
    }
    return own ? { paper: own } : undefined;
  };

  const viewOf = (node: NodeRecord): WorkView | undefined => {
    const target = targetOf(node);
    if (!target) return undefined;
    if ("paper" in target) {
      const { paper } = target;
      return {
        target: "paper",
        title: paper.title,
        identifiers: paperIdentifiers(paper),
        ...(paper.published ? { published: paper.published } : {}),
        ...(paper.venue ? { venue: paper.venue } : {}),
        ...(paper.standing ? { standing: paper.standing } : {}),
      };
    }
    const { unit } = target;
    return { target: "unit", title: unit.title, identifiers: identifiersOf(unit), ...(unit.facts?.standing ? { standing: unit.facts.standing } : {}) };
  };

  const handlers: Pick<Handlers, "work.lookup" | "unit.identify"> = {
    "work.lookup": async ({ unit }): Promise<WorkLookup> => {
      if (!context.services) throw new Error("Looking a work up needs the network, and this base has none set up.");
      const node = context.nodeOf(unit);
      const target = node ? targetOf(node) : undefined;
      if (!node || !target) throw new Error("This unit wasn't read from a paper, so there is nothing to look up.");
      const identifiers = "paper" in target ? paperIdentifiers(target.paper) : identifiersOf(target.unit);
      const title = "paper" in target ? target.paper.title : target.unit.title;
      const work = await context.services.lookupWork({ identifiers, title });
      const found = work.services.some(({ ok }) => ok) && (work.identifiers.length > 0 || Boolean(work.title));
      if (!found) return { work, saved: false, target: "paper" in target ? "paper" : "unit", title };
      const by = context.me();
      if ("paper" in target) {
        const records: DgRecord[] = [revise({ record: target.paper, changes: paperChanges(target.paper, work), by })];
        // The paper's own source unit carries the same identifiers, so an export of the unit alone still has them.
        const source = context
          .documents("node")
          .find((item) => !item.removed && item.source?.paper === target.paper.id && item.source.own && item.by.id === by.id);
        if (source) records.push(revise({ record: source, changes: sourceChanges(source, work), by }));
        await context.put(records);
        return { work, saved: true, target: "paper", title };
      }
      // A teammate's unit is theirs to change. The answer is still shown.
      const mine = target.unit.by.id === by.id;
      if (mine) await context.put([revise({ record: target.unit, changes: sourceChanges(target.unit, work), by })]);
      return { work, saved: mine, target: "unit", title };
    },
    "unit.identify": async ({ node: id, add, remove }) => {
      const node = context.nodeOf(id);
      if (!node) throw new Error(`No node ${id}`);
      if (node.by.id !== context.me().id) throw new Error("Only whoever made a unit can change its identifiers.");
      const fresh = (add ?? []).map((text) => {
        const found = typeof text === "string" ? parseIdentifier(text) : isIdentifier(text) ? text : null;
        if (!found) throw new Error(`"${String(text)}" isn't an identifier this reads. Paste a DOI, PMID link, arXiv id, ORCID iD, RRID or a web address.`);
        return found;
      });
      const facts = node.facts ?? {};
      const dropped = (item: Identifier): boolean => (remove ?? []).some((other) => sameIdentifier(other, item));
      const all = mergeIdentifiers(identifiersOf(node), fresh).filter((item) => !dropped(item));
      const doi = first(all, "doi");
      const openalex = first(all, "openalex");
      // The DOI and OpenAlex id keep their own fields, which the lexicon already knows.
      const rest = all.filter(({ scheme, value }) => !(scheme === "doi" && value === doi) && !(scheme === "openalex" && value === openalex) && !(scheme === "swhid" && value === facts.swhid) && !(scheme === "cid" && value === facts.cid));
      const { doi: _doi, openalex: _openalex, identifiers: _identifiers, ...kept } = facts;
      await context.put([
        revise({
          record: node,
          changes: { facts: { ...kept, ...(doi ? { doi } : {}), ...(openalex ? { openalex } : {}), ...(rest.length ? { identifiers: rest } : {}) } },
          by: context.me(),
        }),
      ]);
      return context.summarize(context.nodeOf(id)!);
    },
  };
  return { handlers, viewOf };
};
