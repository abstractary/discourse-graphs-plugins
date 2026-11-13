import type { Author, DgId, FoldedGraph, NodeRecord, PaperRecord } from "@dg/contract/records.ts";
import { mergeIdentifiers, parseIdentifier, type CardFacts, type Identifier, type ReadHow } from "@dg/contract/scholarly.ts";

/**
 * The facts a unit's card can show: what it was read from and how, who wrote
 * it, where it was first written, when, and what else names it. One function,
 * so the card and the context panel can never disagree.
 */

const citeAs = (authors: string[] | undefined, published: string | undefined, title: string): string => {
  const family = (name: string): string => (name.includes(",") ? name.split(",")[0]! : name.trim().split(/\s+/).pop()!).trim();
  const who = !authors?.length ? "" : authors.length === 1 ? family(authors[0]!) : authors.length === 2 ? `${family(authors[0]!)} and ${family(authors[1]!)}` : `${family(authors[0]!)} et al.`;
  const when = /\b(1[5-9]|20)\d{2}\b/.exec(published ?? "")?.[0];
  return [who, when].filter(Boolean).join(" ") || (title.length > 36 ? `${title.slice(0, 34).trimEnd()}…` : title);
};
export { citeAs };

const fileStem = (name: string): string => (name.split("/").pop() ?? name).replace(/\.[a-z0-9]{2,5}$/i, "");

/** A model read it unless the unit itself says a person did. A passage a person highlighted is by hand. */
const howRead = (node: NodeRecord): ReadHow => {
  const method = node.facts?.provenance?.method;
  if (method === "imported") return "imported";
  if (method === "authored") return "manual";
  if (method === "aiGenerated" || method === "aiAssisted") return "auto";
  return node.source ? "auto" : "manual";
};

const read = (text: string | undefined, scheme?: Parameters<typeof parseIdentifier>[1]): Identifier[] => {
  const found = text ? parseIdentifier(text, scheme) : null;
  return found ? [found] : [];
};

/** A unit's own identifiers, wherever its facts keep them. */
export const identifiersOf = (node: NodeRecord): Identifier[] => {
  const facts = node.facts ?? {};
  return mergeIdentifiers(
    read(facts.doi, "doi"),
    read(facts.openalex, "openalex"),
    facts.identifiers,
    read(facts.swhid, "swhid"),
    read(facts.cid, "cid"),
    (facts.sameAs ?? []).flatMap((item) => read(item)),
    read(facts.preregistration),
  );
};

/** Everything that names a paper, its DOI first. */
export const paperIdentifiers = (paper: PaperRecord): Identifier[] => mergeIdentifiers(read(paper.doi, "doi"), paper.identifiers);

export type CardInput = {
  graph: FoldedGraph;
  node: NodeRecord;
  localSpace: string;
  spaceName: string;
  nameOf: (author: Author) => string;
  labName: (did: string) => string | undefined;
  /** How a paper is cited in a few words, such as "Carroll 2020". */
  labelOf: (paper: PaperRecord) => string;
  /** The paper a source unit stands for, when it stands for one. */
  paperOfSource: (source: NodeRecord) => PaperRecord | undefined;
};

export const cardFacts = ({ graph, node, localSpace, spaceName, nameOf, labName, labelOf, paperOfSource }: CardInput): CardFacts => {
  const nodeAt = (id: DgId | undefined): NodeRecord | undefined => {
    const record = id ? graph.documents.get(id) : undefined;
    return record?.kind === "node" && !record.removed ? record : undefined;
  };
  const extractedFrom = node.source ? graph.documents.get(node.source.paper) : undefined;
  const paper = extractedFrom?.kind === "paper" ? extractedFrom : undefined;
  // A highlight names the source unit it was read in, which may stand for a paper.
  const sourceUnit = paper ? undefined : (nodeAt(node.facts?.anchor?.source) ?? nodeAt(node.prov?.sourceDocument));
  const sourcePaper = paper ?? (sourceUnit ? paperOfSource(sourceUnit) : undefined);
  const how = howRead(node);

  const source: CardFacts["source"] = sourcePaper
    ? {
        name: labelOf(sourcePaper),
        title: sourcePaper.filename && fileStem(sourcePaper.filename) !== sourcePaper.title ? `${sourcePaper.title} (${sourcePaper.filename})` : sourcePaper.title,
        how,
        ...(how === "auto" && paper?.model ? { by: paper.model } : {}),
        ...(node.source?.asRead !== undefined && node.source.asRead !== node.title ? { reworded: true as const } : {}),
        paper: sourcePaper.id,
      }
    : sourceUnit
      ? {
          // A source from a reference library is cited as papers are; a bare file by its name.
          name: sourceUnit.facts?.authors?.length || sourceUnit.facts?.published ? citeAs(sourceUnit.facts.authors, sourceUnit.facts.published, sourceUnit.title) : fileStem(sourceUnit.facts?.uri ?? sourceUnit.title),
          title: sourceUnit.title,
          how,
        }
      : undefined;
  const sourceAuthors = sourcePaper?.authors.length ? sourcePaper.authors : (sourceUnit?.facts?.authors ?? (node.facts?.authors?.length ? node.facts.authors : []));

  const lab = node.lab ? labName(node.lab) : undefined;
  const origin: CardFacts["origin"] =
    node.space === localSpace
      ? { name: "Your workspace", kind: "here" }
      : lab
        ? { name: lab, kind: "lab" }
        : { name: "Someone else's workspace", kind: "elsewhere" };

  return {
    ...(source ? { source } : {}),
    authors: sourceAuthors.length ? { names: sourceAuthors, role: "paper" } : { names: node.facts?.creators?.length ? node.facts.creators.map(({ name }) => name) : [nameOf(node.by)], role: "maker" },
    origin,
    created: node.at,
    // A unit read from a paper is found by the paper's identifiers, after any of its own.
    identifiers: mergeIdentifiers(identifiersOf(node), sourcePaper ? paperIdentifiers(sourcePaper) : sourceUnit ? identifiersOf(sourceUnit).filter(({ scheme }) => scheme !== "zotero" && scheme !== "citekey") : undefined),
    ...(sourcePaper?.standing?.retracted ? { retracted: true as const } : {}),
  };
};
