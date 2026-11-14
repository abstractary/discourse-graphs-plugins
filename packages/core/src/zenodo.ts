import type { JsonObject } from "@dg/contract/records.ts";
import type { Identifier } from "@dg/contract/scholarly.ts";
import type { DataCiteInput } from "./datacite.ts";

/**
 * A crate described the way Zenodo's deposit form takes it. Pure: the caller
 * sends it. A draft made from this is never published by this app. Publishing
 * registers a DOI for good, so that step stays with the person, on Zenodo.
 */

export const ZENODO = {
  live: { server: "https://zenodo.org", name: "Zenodo" },
  sandbox: { server: "https://sandbox.zenodo.org", name: "Zenodo's sandbox" },
  tokenPage: "/account/settings/applications/tokens/new/",
} as const;

/** Zenodo names a license by id. These are the ids of the ones the export dialog offers. */
const LICENSE_ID: Record<string, string> = {
  "https://creativecommons.org/licenses/by/4.0/": "cc-by-4.0",
  "https://creativecommons.org/publicdomain/zero/1.0/": "cc0-1.0",
  "https://creativecommons.org/licenses/by-sa/4.0/": "cc-by-sa-4.0",
  "https://creativecommons.org/licenses/by-nc/4.0/": "cc-by-nc-4.0",
  "https://creativecommons.org/licenses/by-nc-sa/4.0/": "cc-by-nc-sa-4.0",
};

/** Zenodo wants "Family, Given". A name with no space is left as it is. */
const familyFirst = (name: string): string => {
  if (name.includes(",")) return name;
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`;
};

const written = (item: Identifier): string | undefined =>
  item.scheme === "doi" ? item.value : item.scheme === "url" ? item.value : item.scheme === "pmid" ? `pmid:${item.value}` : item.scheme === "arxiv" ? `arXiv:${item.value}` : item.scheme === "swhid" ? item.value : undefined;

const related = (items: Identifier[], relation: string, resourceType?: string): JsonObject[] =>
  items.flatMap((item) => {
    const identifier = written(item);
    return identifier ? [{ identifier, relation, ...(resourceType ? { resource_type: resourceType } : {}) }] : [];
  });

const escape = (text: string): string => text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);

export const toZenodo = (input: DataCiteInput): JsonObject => ({
  title: input.title,
  upload_type: "dataset",
  description: `<p>${escape(input.description)}</p><p>An RO-Crate: open <code>README.md</code> or <code>ro-crate-preview.html</code> inside the archive to read it. Every finding is also described in the MIRA schema.</p>`,
  creators: input.creators.map(({ name, orcid, affiliation }) => ({ name: familyFirst(name), ...(orcid ? { orcid } : {}), ...(affiliation ? { affiliation } : {}) })),
  publication_date: input.published.slice(0, 10),
  access_right: "open",
  ...(input.license && LICENSE_ID[input.license] ? { license: LICENSE_ID[input.license]! } : {}),
  keywords: [...new Set([...input.subjects, "RO-Crate", "MIRA"])],
  related_identifiers: [...related(input.derivedFrom, "isDerivedFrom", "publication-article"), ...related(input.references, "references"), ...related(input.software, "requires", "software")],
  prereserve_doi: true,
});
