import type { NodeRecord, PaperRecord } from "@dg/contract/records.ts";
import { sameIdentifier, type Identifier } from "@dg/contract/scholarly.ts";
import { identifiersOf, paperIdentifiers } from "./card.ts";

/**
 * One answer to "is this the same paper?", for every way a paper arrives:
 * read by a model, brought from a reference library, highlighted in a file,
 * imported in a crate. The order is fixed. An identifier the world shares
 * decides first, then the bytes of the file, and a title only when neither
 * side has an identifier to disagree with.
 */

/** The schemes that name a work. A library key or a citation key only says where one copy is kept. */
const NAMES_A_WORK: ReadonlySet<Identifier["scheme"]> = new Set(["doi", "pmid", "pmcid", "arxiv", "openalex", "isbn"]);
const naming = (ids: Identifier[]): Identifier[] => ids.filter(({ scheme }) => NAMES_A_WORK.has(scheme));

export type WorkKey = { identifiers: Identifier[]; cid?: string | undefined; title?: string | undefined; filename?: string | undefined };

export const keyOfPaper = (paper: PaperRecord): WorkKey => ({ identifiers: naming(paperIdentifiers(paper)), cid: paper.fileCid, title: paper.title, filename: paper.filename });
export const keyOfSource = (source: NodeRecord): WorkKey => ({
  identifiers: naming(identifiersOf(source)),
  cid: source.facts?.cid,
  title: source.title,
  filename: source.facts?.uri?.split("/").pop(),
});

const clean = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Why two keys are the same work, or `null` when they aren't known to be. */
export const sameWork = (a: WorkKey, b: WorkKey): "identifier" | "file" | "name" | null => {
  if (a.identifiers.some((held) => b.identifiers.some((other) => sameIdentifier(held, other)))) return "identifier";
  // Two identifiers of one scheme that differ are two works, whatever else matches.
  if (a.identifiers.some((held) => b.identifiers.some((other) => other.scheme === held.scheme && !sameIdentifier(held, other)))) return null;
  if (a.cid && a.cid === b.cid) return "file";
  // Different bytes can still be one paper (a preprint and its print), so a file mismatch doesn't rule it out.
  if (a.filename && a.filename === b.filename) return "name";
  // A title alone joins only what has nothing better to go on.
  if (!a.identifiers.length && !b.identifiers.length && clean(a.title) && clean(a.title) === clean(b.title)) return "name";
  return null;
};

const STRENGTH = { identifier: 0, file: 1, name: 2 } as const;

/** The paper record a source unit stands for: the reading it came with, or the best match among the others. */
export const paperOfWork = (papers: PaperRecord[], source: NodeRecord): PaperRecord | undefined => {
  const own = papers.find((paper) => paper.id === source.source?.paper);
  if (own) return own;
  const key = keyOfSource(source);
  return papers
    .flatMap((paper) => {
      const why = sameWork(keyOfPaper(paper), key);
      return why ? [{ paper, why }] : [];
    })
    .sort((a, b) => STRENGTH[a.why] - STRENGTH[b.why] || b.paper.at.localeCompare(a.paper.at))[0]?.paper;
};

/** Whether a source unit stands for this paper. */
export const standsFor = (source: NodeRecord, paper: PaperRecord): boolean =>
  source.source?.paper === paper.id || sameWork(keyOfPaper(paper), keyOfSource(source)) !== null;
