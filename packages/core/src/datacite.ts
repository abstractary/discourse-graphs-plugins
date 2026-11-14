import type { JsonObject } from "@dg/contract/records.ts";
import type { Identifier } from "@dg/contract/scholarly.ts";

/**
 * A crate's description in DataCite's own metadata schema (4.6), as JSON: what
 * a repository such as Zenodo, or DataCite itself, needs to give the crate a
 * DOI. Related identifiers say which papers the graph was read from and which
 * works it cites, so the new DOI joins the scholarly record it rests on.
 */

export type DataCiteInput = {
  title: string;
  description: string;
  creators: { name: string; orcid?: string; affiliation?: string }[];
  publisher: string;
  published: string;
  /** A license URL. */
  license?: string;
  licenseName?: string;
  /** Papers the units were read from. */
  derivedFrom: Identifier[];
  /** Works the units cite. */
  references: Identifier[];
  /** Code the runs used, by repository URL or SWHID. */
  software: Identifier[];
  subjects: string[];
  /** The crate's own DOI, once a repository has minted one. */
  doi?: string;
};

const TYPE: Partial<Record<Identifier["scheme"], string>> = { doi: "DOI", pmid: "PMID", arxiv: "arXiv", url: "URL", swhid: "SWHID", isbn: "ISBN" };

const related = (items: Identifier[], relationType: string, resourceTypeGeneral: string): JsonObject[] =>
  items.flatMap((item) =>
    TYPE[item.scheme]
      ? [{ relatedIdentifier: item.value, relatedIdentifierType: TYPE[item.scheme]!, relationType, resourceTypeGeneral }]
      : [],
  );

export const toDataCite = (input: DataCiteInput): JsonObject => ({
  data: {
    type: "dois",
    attributes: {
      ...(input.doi ? { doi: input.doi } : {}),
      titles: [{ title: input.title }],
      creators: input.creators.map(({ name, orcid, affiliation }) => ({
        name,
        nameType: "Personal",
        ...(orcid ? { nameIdentifiers: [{ nameIdentifier: `https://orcid.org/${orcid}`, nameIdentifierScheme: "ORCID", schemeUri: "https://orcid.org" }] } : {}),
        ...(affiliation ? { affiliation: [{ name: affiliation }] } : {}),
      })),
      publisher: input.publisher,
      publicationYear: Number(input.published.slice(0, 4)),
      dates: [{ date: input.published.slice(0, 10), dateType: "Issued" }],
      types: { resourceTypeGeneral: "Dataset", resourceType: "Discourse graph (RO-Crate)" },
      descriptions: [{ description: input.description, descriptionType: "Abstract" }],
      subjects: input.subjects.map((subject) => ({ subject })),
      formats: ["application/zip", "application/ld+json"],
      ...(input.license ? { rightsList: [{ rightsUri: input.license, ...(input.licenseName ? { rights: input.licenseName } : {}) }] } : {}),
      relatedIdentifiers: [
        ...related(input.derivedFrom, "IsDerivedFrom", "JournalArticle"),
        ...related(input.references, "References", "Text"),
        ...related(input.software, "Requires", "Software"),
      ],
      schemaVersion: "http://datacite.org/schema/kernel-4",
    },
  },
});
