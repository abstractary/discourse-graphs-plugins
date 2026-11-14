import { trimmedUrl as trimmed } from "@dg/contract/urls.ts";
import { mergeIdentifiers, parseIdentifier, sameIdentifier } from "@dg/contract/scholarly.ts";
import type {
  Identifier,
  Notification,
  NotificationSummary,
  Signposts,
  WorkAuthor,
  WorkMetadata,
  WorkService,
  WorkUpdate,
} from "@dg/contract/scholarly.ts";
import type { Services } from "@dg/contract/services.ts";

/**
 * Reads one published work from the open registries and its landing page, and
 * sends and lists COAR Notify notifications. Every call is keyless and sends
 * only identifiers or a title: never an email address or anything else about
 * the person asking.
 *
 * To add a registry: write one resolver, add it to `RESOLVERS`, and add its
 * name to the rows of `PRECEDENCE` it can fill.
 */

type Rec = Record<string, unknown>;
type Agency = NonNullable<WorkMetadata["agency"]>;
type Get = (url: string, init?: RequestInit) => Promise<Response>;

/** What one service knows: any of the work's fields, plus the identifiers it gave. */
type Found = Partial<Omit<WorkMetadata, "from" | "services" | "checkedAt">>;

type Ask = {
  ids: Identifier[];
  title?: string;
  /** Who registered the DOI, when doi.org said. */
  agency?: Agency;
  /** A Crossref record already in hand from a title search, so it isn't fetched twice. */
  hit?: Rec;
};

type Resolver = {
  name: WorkService;
  /** How the service is named in a problem a person reads. */
  label: string;
  /** Waits to hear who registered the DOI before deciding whether to ask. */
  afterAgency?: boolean;
  /** Waits for these services, and is told the identifiers they found. */
  after?: WorkService[];
  wants: (ask: Ask) => boolean;
  read: (ask: Ask, get: Get) => Promise<Found>;
};

type Outcome = { name: WorkService; ok: boolean; problem?: string; found?: Found };

const TIMEOUT_MS = 8_000;
const INBOX_REL = "http://www.w3.org/ns/ldp#inbox";

// Small readers for JSON nobody has typed

const rec = (value: unknown): Rec => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const recs = (value: unknown): Rec[] => list(value).map(rec);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const unique = <T>(items: T[], key: (item: T) => string = String): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
};
/** Drops keys with nothing in them, so a field is either useful or absent. */
const compact = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, held]) => held !== undefined && held !== null && held !== "" && !(Array.isArray(held) && held.length === 0)),
  ) as T;

const idOf = (ids: Identifier[], scheme: Identifier["scheme"]): string | undefined => ids.find((id) => id.scheme === scheme)?.value;
const doiPath = (doi: string): string => doi.split("/").map(encodeURIComponent).join("/");
const noTags = (text: string | undefined): string | undefined => str(text?.replace(/<[^>]+>/g, "").replace(/\s+/g, " "));

/** An error whose message is already in plain words, safe to show as it is. */
const problem = (message: string): Error => Object.assign(new Error(message), { plain: true });
const isPlain = (error: unknown): error is Error => error instanceof Error && (error as { plain?: boolean }).plain === true;

/** Gets JSON from a public service, and turns each way it can fail into plain words. */
const readJson = async (get: Get, url: string, label: string): Promise<Rec> => {
  let response: Response;
  try {
    response = await get(url, { headers: { accept: "application/json" } });
  } catch {
    throw problem(`Couldn't reach ${label}.`);
  }
  if (response.status === 404) throw problem(`${label} has no record of this work.`);
  if (response.status === 401 || response.status === 403) throw problem(`${label} refused the request. It may now want an API key.`);
  if (response.status === 429) throw problem(`${label} is busy. Try again in a minute.`);
  if (!response.ok) throw problem(`${label} answered ${response.status}.`);
  try {
    return rec(await response.json());
  } catch {
    throw problem(`${label} sent something that couldn't be read.`);
  }
};

// Names, dates and types

const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Family name plus first initial: enough to tell that two services mean the same author. */
const authorKey = ({ name, given, family }: WorkAuthor): string => {
  const last = plain(family ?? name.split(/\s+/).at(-1) ?? "").replace(/[^a-z]/g, "");
  const first = plain(given ?? name).replace(/[^a-z]/g, "")[0] ?? "";
  return `${last}|${first}`;
};

const orcidOf = (value: unknown): string | undefined => {
  const text = str(value);
  return text ? parseIdentifier(text, "orcid")?.value : undefined;
};
const rorOf = (value: unknown): string | undefined => {
  const text = str(value);
  return text ? parseIdentifier(/^https?:/i.test(text) ? text : `https://ror.org/${text}`, "ror")?.value : undefined;
};

/** `[[2020, 12, 1]]` becomes `2020-12-01`, as precise as it was given. */
const dateFromParts = (value: unknown): string | undefined => {
  const parts = list(list(rec(value)["date-parts"])[0]).filter((part): part is number => typeof part === "number");
  return parts.length ? parts.map((part, at) => String(part).padStart(at ? 2 : 4, "0")).join("-") : undefined;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** PubMed writes `2020 Dec` or `2021 Sep 21`. */
const dateFromPubMed = (value: unknown): string | undefined => {
  const [year, month, day] = (str(value) ?? "").split(/\s+/);
  if (!year || !/^\d{4}$/.test(year)) return undefined;
  const at = MONTHS.indexOf((month ?? "").slice(0, 3).toLowerCase());
  if (at < 0) return year;
  const withMonth = `${year}-${String(at + 1).padStart(2, "0")}`;
  return day && /^\d{1,2}$/.test(day) ? `${withMonth}-${day.padStart(2, "0")}` : withMonth;
};

/** Each registry's own word for a kind of work, in schema.org's words where it has one. */
const TYPE_WORDS: Record<string, string> = {
  "journal-article": "ScholarlyArticle",
  "proceedings-article": "ScholarlyArticle",
  "posted-content": "ScholarlyArticle",
  article: "ScholarlyArticle",
  preprint: "ScholarlyArticle",
  review: "ScholarlyArticle",
  journalarticle: "ScholarlyArticle",
  conferencepaper: "ScholarlyArticle",
  book: "Book",
  monograph: "Book",
  "book-chapter": "Chapter",
  bookchapter: "Chapter",
  dataset: "Dataset",
  software: "SoftwareSourceCode",
  report: "Report",
  dissertation: "Thesis",
  "peer-review": "Review",
  peerreview: "Review",
};
const typeWord = (value: unknown): string | undefined => {
  const text = str(value);
  return text ? TYPE_WORDS[text.toLowerCase()] ?? text : undefined;
};

const UPDATE_WORDS: [RegExp, WorkUpdate["type"]][] = [
  [/retract|withdraw|removal/i, "retraction"],
  [/concern/i, "concern"],
  [/correct|errat|corrigend|addend/i, "correction"],
  [/version|edition/i, "version"],
];
const updateType = (text: string): WorkUpdate["type"] => UPDATE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? "other";
const sameUpdates = (updates: WorkUpdate[]): WorkUpdate[] => unique(updates, ({ type, doi }) => `${type}|${doi ?? ""}`);

// Registration agency

/** Asks doi.org who registered a DOI. Says nothing when it can't tell. */
const readAgency = async (doi: string, get: Get): Promise<Agency | undefined> => {
  try {
    const response = await get(`https://doi.org/doiRA/${doiPath(doi)}`, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const name = str(rec(list(await response.json())[0]).RA)?.toLowerCase();
    return name === undefined ? undefined : name === "crossref" || name === "datacite" ? name : "other";
  } catch {
    return undefined;
  }
};

// Crossref

const crossrefWork = (message: Rec): Found => {
  const doi = str(message.DOI);
  const licenses = recs(message.license);
  // `updated-by` sits on the work that was changed. `update-to` sits on the notice, and says nothing about the notice itself.
  const updates = sameUpdates(
    recs(message["updated-by"]).map((update) =>
      compact({
        type: updateType(str(update.type) ?? ""),
        doi: str(update.DOI)?.toLowerCase(),
        date: dateFromParts(update.updated),
        label: str(update.label),
      }),
    ),
  );
  return compact({
    identifiers: doi ? [{ scheme: "doi" as const, value: doi.toLowerCase() }] : [],
    title: noTags(str(list(message.title)[0])),
    authors: recs(message.author).flatMap((author): WorkAuthor[] => {
      const given = str(author.given);
      const family = str(author.family);
      const name = [given, family].filter(Boolean).join(" ") || str(author.name);
      if (!name) return [];
      const affiliations = recs(author.affiliation).flatMap((place) => (str(place.name) ? [{ name: str(place.name)! }] : []));
      return [compact({ name, given, family, orcid: orcidOf(author.ORCID), affiliations })];
    }),
    published: dateFromParts(message.issued) ?? dateFromParts(message.published),
    venue: noTags(str(list(message["container-title"])[0])),
    publisher: str(message.publisher),
    type: typeWord(message.type),
    volume: str(message.volume),
    issue: str(message.issue),
    pages: str(message.page) ?? str(message["article-number"]),
    license: str((licenses.find((license) => license["content-version"] === "vor") ?? licenses[0])?.URL),
    citedBy: num(message["is-referenced-by-count"]),
    references: unique(recs(message.reference).flatMap((reference) => (str(reference.DOI) ? [str(reference.DOI)!.toLowerCase()] : []))),
    updates,
    retracted: updates.some(({ type }) => type === "retraction") || undefined,
  });
};

const titleWords = (title: string): string[] =>
  plain(noTags(title) ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** True when two titles are the same but for case, accents, punctuation, or one word in ten. */
const titlesMatch = (a: string, b: string): boolean => {
  const [left, right] = [titleWords(a), titleWords(b)];
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const shared = left.filter((word) => right.includes(word)).length;
  return shared / Math.max(left.length, right.length) >= 0.9;
};

/** Looks a title up in Crossref, and takes a hit only when its title matches closely. */
const searchCrossref = async (title: string, get: Get): Promise<Rec> => {
  const found = await readJson(get, `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=3`, "Crossref");
  const hit = recs(rec(found.message).items).find((item) => str(item.DOI) && titlesMatch(str(list(item.title)[0]) ?? "", title));
  if (!hit) throw problem("Crossref has no work with a title that matches closely.");
  return hit;
};

const crossref: Resolver = {
  name: "crossref",
  label: "Crossref",
  afterAgency: true,
  wants: ({ ids, agency, hit }) => Boolean(hit) || (Boolean(idOf(ids, "doi")) && (agency === "crossref" || agency === undefined)),
  read: async ({ ids, hit }, get) =>
    crossrefWork(hit ?? rec((await readJson(get, `https://api.crossref.org/works/${doiPath(idOf(ids, "doi")!)}`, "Crossref")).message)),
};

// DataCite

/** DataCite relations that tell a reader there is another version to look at. */
const VERSION_RELATIONS: Record<string, string> = {
  IsPreviousVersionOf: "Newer version",
  IsObsoletedBy: "Replaced by",
  IsNewVersionOf: "Earlier version",
  IsVersionOf: "Version of",
};

const dataciteWork = (attributes: Rec): Found => {
  const doi = str(attributes.doi)?.toLowerCase();
  const arxiv = doi ? /^10\.48550\/arxiv\.(.+)$/.exec(doi)?.[1] : undefined;
  const dates = recs(attributes.dates);
  const dated = ["Issued", "Available", "Submitted", "Created"].map((kind) => dates.find((date) => date.dateType === kind)).find(Boolean);
  const types = rec(attributes.types);
  const general = typeWord(types.resourceTypeGeneral);
  const related = recs(attributes.relatedIdentifiers).filter((other) => other.relatedIdentifierType === "DOI" && str(other.relatedIdentifier));
  return compact({
    identifiers: [...(doi ? [{ scheme: "doi" as const, value: doi }] : []), ...(arxiv ? [{ scheme: "arxiv" as const, value: arxiv }] : [])],
    title: noTags(str(recs(attributes.titles)[0]?.title)),
    authors: recs(attributes.creators).flatMap((creator): WorkAuthor[] => {
      const given = str(creator.givenName);
      const family = str(creator.familyName);
      // DataCite writes a person as `Family, Given`.
      const name = given && family ? `${given} ${family}` : str(creator.name)?.replace(/^([^,]+),\s*(.+)$/, "$2 $1");
      if (!name) return [];
      const orcid = recs(creator.nameIdentifiers)
        .map((id) => (str(id.nameIdentifierScheme)?.toUpperCase() === "ORCID" ? orcidOf(id.nameIdentifier) : undefined))
        .find(Boolean);
      const affiliations = list(creator.affiliation).flatMap((place) => {
        const placeName = typeof place === "string" ? str(place) : str(rec(place).name);
        const ror = str(rec(place).affiliationIdentifierScheme)?.toUpperCase() === "ROR" ? rorOf(rec(place).affiliationIdentifier) : undefined;
        return placeName ? [compact({ name: placeName, ror })] : [];
      });
      return [compact({ name, given, family: given ? family : undefined, orcid, affiliations })];
    }),
    published: str(dated?.date)?.slice(0, 10) ?? (num(attributes.publicationYear) ? String(attributes.publicationYear) : undefined),
    venue: str(rec(attributes.container).title) ?? str(attributes.publisher),
    publisher: str(attributes.publisher),
    type: general && general !== "Other" && general !== "Text" ? general : str(types.schemaOrg) ?? general,
    license: str(recs(attributes.rightsList).find((rights) => str(rights.rightsUri))?.rightsUri),
    citedBy: num(attributes.citationCount),
    references: unique(related.filter((other) => other.relationType === "References" || other.relationType === "Cites").map((other) => str(other.relatedIdentifier)!.toLowerCase())),
    subjects: unique(recs(attributes.subjects).flatMap((subject) => (str(subject.subject) ? [str(subject.subject)!] : []))).slice(0, 5),
    updates: sameUpdates(
      related.flatMap((other): WorkUpdate[] => {
        const label = VERSION_RELATIONS[str(other.relationType) ?? ""];
        return label ? [{ type: "version", doi: str(other.relatedIdentifier)!.toLowerCase(), label }] : [];
      }),
    ),
  });
};

const datacite: Resolver = {
  name: "datacite",
  label: "DataCite",
  afterAgency: true,
  wants: ({ ids, agency, hit }) => !hit && Boolean(idOf(ids, "doi")) && (agency === "datacite" || agency === undefined),
  read: async ({ ids }, get) => {
    const work = dataciteWork(rec(rec((await readJson(get, `https://api.datacite.org/dois/${doiPath(idOf(ids, "doi")!)}`, "DataCite")).data).attributes));
    // An arXiv id that was asked with its version (`2010.14967v2`) is kept as asked, not listed a second time without it.
    const asked = ids.filter(({ scheme }) => scheme === "arxiv").map(({ value }) => value.replace(/v\d+$/i, "").toLowerCase());
    return { ...work, identifiers: (work.identifiers ?? []).filter(({ scheme, value }) => scheme !== "arxiv" || !asked.includes(value.toLowerCase())) };
  },
};

// OpenAlex

const openalexPath = (ids: Identifier[]): string | undefined => {
  const [doi, pmid, own] = [idOf(ids, "doi"), idOf(ids, "pmid"), idOf(ids, "openalex")];
  return doi ? `doi:${doiPath(doi)}` : pmid ? `pmid:${pmid}` : own?.startsWith("W") ? own : undefined;
};

const openalexWork = (work: Rec, asked: Identifier[]): Found => {
  const theirs = rec(work.ids);
  const own = parseIdentifier(str(theirs.openalex) ?? str(work.id) ?? "", "openalex");
  const doi = parseIdentifier(str(theirs.doi) ?? str(work.doi) ?? "", "doi");
  const pmid = /(\d+)\/?$/.exec(str(theirs.pmid) ?? "")?.[1];
  // OpenAlex gives the PMCID as a link that ends in bare digits.
  const pmc = /(\d+)\/?$/.exec(str(theirs.pmcid) ?? "")?.[1];
  // Asked for a preprint, OpenAlex may answer with the journal version. Its DOI and PubMed ids are then another record's.
  const askedDois = asked.filter(({ scheme }) => scheme === "doi");
  const other = Boolean(doi && askedDois.length && !askedDois.some((id) => sameIdentifier(id, doi)));
  const access = rec(work.open_access);
  return compact({
    identifiers: [
      ...(own ? [own] : []),
      ...(other
        ? []
        : [
            ...(doi ? [doi] : []),
            ...(pmid ? [{ scheme: "pmid" as const, value: pmid }] : []),
            ...(pmc ? [{ scheme: "pmcid" as const, value: `PMC${pmc}` }] : []),
          ]),
    ],
    title: noTags(str(work.title) ?? str(work.display_name)),
    authors: recs(work.authorships).flatMap((authorship): WorkAuthor[] => {
      const author = rec(authorship.author);
      const name = str(author.display_name);
      if (!name) return [];
      const affiliations = recs(authorship.institutions).flatMap((place) =>
        str(place.display_name) ? [compact({ name: str(place.display_name)!, ror: rorOf(place.ror) })] : [],
      );
      return [compact({ name, orcid: orcidOf(author.orcid), affiliations })];
    }),
    published: str(work.publication_date),
    venue: str(rec(rec(work.primary_location).source).display_name),
    type: typeWord(work.type),
    openAccess: str(access.oa_status) || str(access.oa_url) ? compact({ status: str(access.oa_status), url: str(access.oa_url) }) : undefined,
    citedBy: num(work.cited_by_count),
    subjects: unique([rec(work.primary_topic), ...recs(work.topics)].flatMap((topic) => (str(topic.display_name) ? [str(topic.display_name)!] : []))).slice(0, 5),
    retracted: work.is_retracted === true || undefined,
    updates: other && doi ? [{ type: "version" as const, doi: doi.value, label: "Another version" }] : [],
  });
};

const openalex: Resolver = {
  name: "openalex",
  label: "OpenAlex",
  wants: ({ ids }) => Boolean(openalexPath(ids)),
  read: async ({ ids }, get) => openalexWork(await readJson(get, `https://api.openalex.org/works/${openalexPath(ids)}`, "OpenAlex"), ids),
};

// PubMed

const PUBMED_NOTES: Record<string, WorkUpdate["type"]> = {
  "retraction in": "retraction",
  "erratum in": "correction",
  "expression of concern in": "concern",
  "update in": "version",
};

const pubmedWork = (summary: Rec): Found => {
  const articleIds = recs(summary.articleids);
  const held = (kind: string): string | undefined => str(articleIds.find((id) => id.idtype === kind)?.value);
  const doi = parseIdentifier(held("doi") ?? "", "doi");
  const pmc = parseIdentifier(held("pmc") ?? "", "pmcid");
  const updates = sameUpdates(
    recs(summary.references).flatMap((note): WorkUpdate[] => {
      const label = str(note.reftype);
      const type = label ? PUBMED_NOTES[label.toLowerCase()] : undefined;
      const noticeDoi = /\bdoi:\s*(10\.\S+?)\.?(?:\s|$)/i.exec(str(note.refsource) ?? "")?.[1]?.toLowerCase();
      return type && label ? [compact({ type, doi: noticeDoi, label })] : [];
    }),
  );
  return compact({
    identifiers: [...(doi ? [doi] : []), ...(str(summary.uid) ? [{ scheme: "pmid" as const, value: str(summary.uid)! }] : []), ...(pmc ? [pmc] : [])],
    title: noTags(str(summary.title)?.replace(/\.$/, "")),
    // PubMed writes `Carroll TL`: the family name, then initials.
    authors: recs(summary.authors).flatMap((author): WorkAuthor[] => {
      const name = str(author.name);
      const parts = /^(.+)\s+([A-Z]{1,4})$/.exec(name ?? "");
      return name ? [compact({ name, given: parts?.[2], family: parts?.[1] })] : [];
    }),
    published: dateFromPubMed(summary.epubdate) ?? dateFromPubMed(summary.pubdate),
    venue: str(summary.fulljournalname) ?? str(summary.source),
    volume: str(summary.volume),
    issue: str(summary.issue),
    pages: str(summary.pages),
    updates,
    retracted: list(summary.pubtype).includes("Retracted Publication") || updates.some(({ type }) => type === "retraction") || undefined,
  });
};

const pubmed: Resolver = {
  name: "pubmed",
  label: "PubMed",
  after: ["openalex"],
  wants: ({ ids }) => Boolean(idOf(ids, "pmid") ?? idOf(ids, "doi")),
  read: async ({ ids }, get) => {
    let pmid = idOf(ids, "pmid");
    const found: Identifier[] = [];
    if (!pmid) {
      const converted = await readJson(get, `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=${encodeURIComponent(idOf(ids, "doi")!)}&format=json`, "PubMed");
      const record = recs(converted.records)[0] ?? {};
      pmid = record.pmid === undefined ? undefined : String(record.pmid);
      const pmc = parseIdentifier(str(record.pmcid) ?? "", "pmcid");
      if (pmc) found.push(pmc);
      if (!pmid) throw problem("PubMed doesn't list this work.");
    }
    const answer = await readJson(get, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`, "PubMed");
    const summary = rec(rec(answer.result)[pmid]);
    if (!str(summary.uid) || summary.error) throw problem("PubMed doesn't list this work.");
    const work = pubmedWork(summary);
    return { ...work, identifiers: mergeIdentifiers(work.identifiers, found) };
  },
};

// Signposting

type Link = { href: string; rel: string[]; type?: string; profile?: string; anchor?: string };

/**
 * Reads a `Link` header the way RFC 8288 writes it: many links in one header,
 * parameters that may be quoted (and may then hold commas and semicolons), and
 * a `rel` that may name several relations.
 */
export const parseLinkHeader = (header: string): Link[] => {
  const links: Link[] = [];
  let at = 0;
  const skip = (pattern: RegExp): void => {
    while (at < header.length && pattern.test(header[at]!)) at += 1;
  };
  const until = (pattern: RegExp): string => {
    const start = at;
    while (at < header.length && !pattern.test(header[at]!)) at += 1;
    return header.slice(start, at);
  };
  while (at < header.length) {
    skip(/[\s,]/);
    if (header[at] !== "<") {
      // Not a link: move on to whatever follows the next comma.
      until(/,/);
      continue;
    }
    at += 1;
    const href = until(/>/).trim();
    at += 1;
    const params: Record<string, string> = {};
    for (;;) {
      skip(/\s/);
      if (header[at] !== ";") break;
      at += 1;
      skip(/\s/);
      const name = until(/[=;,\s]/).toLowerCase();
      skip(/\s/);
      let value = "";
      if (header[at] === "=") {
        at += 1;
        skip(/\s/);
        if (header[at] === '"') {
          at += 1;
          while (at < header.length && header[at] !== '"') {
            if (header[at] === "\\") at += 1;
            value += header[at] ?? "";
            at += 1;
          }
          at += 1;
        } else {
          value = until(/[;,\s]/);
        }
      }
      // The first of a repeated parameter is the one that counts.
      if (name && !(name in params)) params[name] = value;
    }
    if (href) {
      links.push(
        compact({
          href,
          rel: (params.rel ?? "").split(/\s+/).filter(Boolean).map((rel) => rel.toLowerCase()),
          type: str(params.type),
          profile: str(params.profile),
          anchor: str(params.anchor),
        }),
      );
    }
  }
  return links;
};

const absolute = (href: string, base: string): string => {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
};
const samePage = (a: string, b: string): boolean => trimmed(a.split("#")[0]!) === trimmed(b.split("#")[0]!);

/** Sorts links into the places Signposting names. Earlier links win where only one fits. */
const signpostsFrom = (links: Link[], anchor: string): Signposts => {
  const of = (rel: string): Link[] => links.filter((link) => link.rel.includes(rel)).map((link) => ({ ...link, href: absolute(link.href, anchor) }));
  const hrefs = (rel: string): string[] => unique(of(rel).map(({ href }) => href));
  return compact({
    anchor,
    citeAs: hrefs("cite-as")[0],
    describedBy: unique(
      of("describedby").map(({ href, type, profile }) => compact({ href, type, profile })),
      ({ href, type, profile }) => `${href}|${type ?? ""}|${profile ?? ""}`,
    ),
    items: unique(
      of("item").map(({ href, type }) => compact({ href, type })),
      ({ href, type }) => `${href}|${type ?? ""}`,
    ),
    license: hrefs("license")[0],
    types: hrefs("type"),
    authors: hrefs("author"),
    collection: hrefs("collection")[0],
    linkset: hrefs("linkset")[0],
    inbox: hrefs(INBOX_REL)[0],
  });
};

/** A linkset's links (RFC 9264) for one page, in the same shape as header links. */
const linksetLinks = (body: Rec, anchor: string, linksetUrl: string): Link[] =>
  recs(body.linkset)
    .filter((context) => samePage(absolute(str(context.anchor) ?? linksetUrl, linksetUrl), anchor))
    .flatMap((context) =>
      Object.entries(context).flatMap(([rel, targets]) =>
        rel === "anchor"
          ? []
          : recs(targets).flatMap((target): Link[] =>
              str(target.href)
                ? [compact({ href: absolute(str(target.href)!, linksetUrl), rel: [rel.toLowerCase()], type: str(target.type), profile: str(target.profile) })]
                : [],
            ),
      ),
    );

const readSignposts = async (url: string, get: Get): Promise<Signposts> => {
  const open = async (method: "HEAD" | "GET"): Promise<Response | null> => {
    try {
      const response = await get(url, { method, redirect: "follow" });
      // Only the headers are wanted, so the page itself is let go unread.
      if (method === "GET") void response.body?.cancel().catch(() => {});
      return response;
    } catch {
      return null;
    }
  };
  // Many publishers refuse HEAD, so a refusal is asked again as GET.
  let response = await open("HEAD");
  if (!response?.ok) response = (await open("GET")) ?? response;
  if (!response) throw problem("Couldn't reach the landing page.");
  if (response.status === 401 || response.status === 403) throw problem("The landing page refused to be read by a program.");
  if (response.status === 404) throw problem("The landing page wasn't found.");
  if (!response.ok) throw problem(`The landing page answered ${response.status}.`);

  const anchor = response.url || url;
  const links = parseLinkHeader(response.headers.get("link") ?? "").filter((link) => !link.anchor || samePage(absolute(link.anchor, anchor), anchor));
  const linkset = links.find((link) => link.rel.includes("linkset"));
  if (linkset) {
    // A linkset that can't be read takes nothing away from what the headers said.
    try {
      const linksetUrl = absolute(linkset.href, anchor);
      const answer = await get(linksetUrl, { headers: { accept: "application/linkset+json" } });
      if (answer.ok) links.push(...linksetLinks(rec(await answer.json()), anchor, linksetUrl));
    } catch {
      // Left as the headers had it.
    }
  }
  return signpostsFrom(links, anchor);
};

const landingPage = (ids: Identifier[]): string | undefined => {
  const doi = idOf(ids, "doi");
  return doi ? `https://doi.org/${doiPath(doi)}` : idOf(ids, "url");
};

const signposting: Resolver = {
  name: "signposting",
  label: "The landing page",
  wants: ({ ids }) => Boolean(landingPage(ids)),
  read: async ({ ids }, get) => ({ signposts: await readSignposts(landingPage(ids)!, get) }),
};

// Joining what the services said

/** In the order they are started. A resolver may only wait for ones above it. */
const RESOLVERS: Resolver[] = [crossref, datacite, openalex, pubmed, signposting];

type PlainField = Exclude<keyof Found, "identifiers" | "retracted" | "updates" | "agency">;

/**
 * Which service is believed for each field, best first: the first one with
 * anything to say wins, and `from` records it. The registry that registered
 * the DOI (Crossref or DataCite, never both) holds the record of truth for what
 * the publisher deposited; OpenAlex is believed for what it works out itself.
 * Identifiers, authors' ORCID and ROR gaps, `retracted` and `updates` are
 * joined across every service instead: see `merge`.
 */
const PRECEDENCE: Record<PlainField, WorkService[]> = {
  title: ["crossref", "datacite", "openalex", "pubmed"],
  authors: ["crossref", "datacite", "openalex", "pubmed"],
  published: ["crossref", "datacite", "openalex", "pubmed"],
  venue: ["crossref", "datacite", "openalex", "pubmed"],
  publisher: ["crossref", "datacite"],
  type: ["crossref", "datacite", "openalex"],
  volume: ["crossref", "pubmed"],
  issue: ["crossref", "pubmed"],
  pages: ["crossref", "pubmed"],
  license: ["crossref", "datacite"],
  openAccess: ["openalex"],
  citedBy: ["openalex", "crossref", "datacite"],
  subjects: ["openalex", "pubmed", "datacite"],
  references: ["crossref", "datacite"],
  signposts: ["signposting"],
};

/** Whose identifiers come first, when two services give the same one in different letter case. */
const IDENTIFIER_ORDER: WorkService[] = ["crossref", "datacite", "openalex", "pubmed"];

/** Fills ORCID and affiliation gaps from another service's list. Never adds or reorders authors. */
const fillAuthors = (authors: WorkAuthor[], others: WorkAuthor[]): WorkAuthor[] => {
  const once = (people: WorkAuthor[]): Map<string, WorkAuthor> => {
    const counts = new Map<string, number>();
    for (const person of people) counts.set(authorKey(person), (counts.get(authorKey(person)) ?? 0) + 1);
    // Two authors with the same family name and initial can't be told apart, so neither is matched.
    return new Map(people.filter((person) => counts.get(authorKey(person)) === 1).map((person) => [authorKey(person), person]));
  };
  const [mine, theirs] = [once(authors), once(others)];
  return authors.map((author) => {
    const other = mine.has(authorKey(author)) ? theirs.get(authorKey(author)) : undefined;
    if (!other) return author;
    const [had, offered] = [author.affiliations ?? [], other.affiliations ?? []];
    const affiliations = !had.length
      ? offered
      : had.length === 1 && offered.length === 1 && !had[0]!.ror && offered[0]!.ror
        ? [{ ...had[0]!, ror: offered[0]!.ror }]
        : had;
    return compact({ ...author, orcid: author.orcid ?? other.orcid, affiliations });
  });
};

const hasValue = (value: unknown): boolean => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);

const merge = (asked: Identifier[], found: Map<WorkService, Found>): Found & Pick<WorkMetadata, "identifiers" | "from"> => {
  const work: Record<string, unknown> = {};
  const from: WorkMetadata["from"] = {};
  for (const [field, order] of Object.entries(PRECEDENCE) as [PlainField, WorkService[]][]) {
    const winner = order.find((name) => hasValue(found.get(name)?.[field]));
    if (!winner) continue;
    work[field] = found.get(winner)![field];
    from[field] = winner;
  }
  if (from.authors) {
    const rest = PRECEDENCE.authors.filter((name) => name !== from.authors);
    work.authors = rest.reduce((authors, name) => fillAuthors(authors, found.get(name)?.authors ?? []), work.authors as WorkAuthor[]);
  }
  const all = [...found.entries()];
  const retractedBy = all.find(([, { retracted }]) => retracted)?.[0];
  if (retractedBy) {
    work.retracted = true;
    from.retracted = retractedBy;
  }
  const updates = sameUpdates(all.flatMap(([, { updates: theirs }]) => theirs ?? []));
  if (updates.length) {
    work.updates = updates;
    from.updates = all.find(([, { updates: theirs }]) => theirs?.length)![0];
  }
  return {
    ...(work as Found),
    identifiers: mergeIdentifiers(asked, ...IDENTIFIER_ORDER.map((name) => found.get(name)?.identifiers)),
    from,
  };
};

/** An arXiv identifier implies the DOI DataCite holds for it. */
const withImplied = (ids: Identifier[]): Identifier[] =>
  mergeIdentifiers(
    ids,
    ids.filter(({ scheme }) => scheme === "arxiv").map(({ value }) => ({ scheme: "doi" as const, value: `10.48550/arxiv.${value.replace(/v\d+$/i, "").toLowerCase()}` })),
  );

export const createScholarly = ({
  fetch: send,
  timeoutMs = TIMEOUT_MS,
}: {
  /** Passed in, as for the rest of sync. The global is never used. */
  fetch: typeof fetch;
  /** How long one service gets, across all its calls, before it is given up on. */
  timeoutMs?: number;
}): Pick<Services, "lookupWork" | "signposts" | "sendNotification" | "notifications"> => {
  /** Runs one service's reading against the clock. Never throws: a failure comes back in plain words. */
  const timed = async <T>(label: string, read: (get: Get) => Promise<T>): Promise<{ value: T } | { problem: string }> => {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(problem(`${label} took too long to answer.`));
        stop.abort();
      }, timeoutMs);
    });
    const reading = read((url, init) => send(url, { ...init, signal: stop.signal }));
    // Once the clock has won, whatever the reading does next is of no interest.
    reading.catch(() => {});
    try {
      return { value: await Promise.race([reading, late]) };
    } catch (error) {
      return { problem: isPlain(error) ? error.message : `${label} sent something that couldn't be read.` };
    } finally {
      clearTimeout(timer);
    }
  };

  const lookupWork: Services["lookupWork"] = async ({ identifiers, title }) => {
    const checkedAt = new Date().toISOString();
    let ids = withImplied(identifiers);
    let hit: Rec | undefined;
    const failed: Outcome[] = [];
    /** An identifier a registry can be asked by. A bare link can only be read for its signposts. */
    const known = (): boolean => ids.some(({ scheme }) => scheme === "doi" || scheme === "pmid" || scheme === "openalex");

    if (!known() && title?.trim()) {
      const searched = await timed("Crossref", (get) => searchCrossref(title, get));
      if ("value" in searched) {
        hit = searched.value;
        ids = mergeIdentifiers(ids, [{ scheme: "doi", value: str(hit.DOI)!.toLowerCase() }]);
      } else {
        failed.push({ name: "crossref", ok: false, problem: searched.problem });
      }
    }

    const doi = idOf(ids, "doi");
    const agency: Promise<Agency | undefined> = hit
      ? Promise.resolve("crossref")
      : doi
        ? timed("doi.org", (get) => readAgency(doi, get)).then((answer) => ("value" in answer ? answer.value : undefined))
        : Promise.resolve(undefined);

    const runs = new Map<WorkService, Promise<Outcome | null>>();
    for (const resolver of RESOLVERS) {
      runs.set(
        resolver.name,
        (async (): Promise<Outcome | null> => {
          const earlier = await Promise.all((resolver.after ?? []).map((name) => runs.get(name)));
          const ask: Ask = {
            ids: mergeIdentifiers(ids, ...earlier.map((outcome) => outcome?.found?.identifiers)),
            ...(title ? { title } : {}),
            ...(hit ? { hit } : {}),
            ...(resolver.afterAgency ? { agency: await agency } : {}),
          };
          if (!resolver.wants(ask)) return null;
          const answer = await timed(resolver.label, (get) => resolver.read(ask, get));
          return "value" in answer ? { name: resolver.name, ok: true, found: answer.value } : { name: resolver.name, ok: false, problem: answer.problem };
        })(),
      );
    }
    const outcomes = [...failed, ...(await Promise.all(runs.values())).filter((outcome): outcome is Outcome => outcome !== null)];
    const found = new Map(outcomes.flatMap((outcome) => (outcome.found ? [[outcome.name, outcome.found] as const] : [])));

    // When doi.org couldn't say, the registry that had the record is the one that registered it.
    const registered = (await agency) ?? (found.has("crossref") ? "crossref" : found.has("datacite") ? "datacite" : undefined);
    const merged = merge(ids, found);
    return {
      ...merged,
      ...(registered ? { agency: registered } : {}),
      from: { ...merged.from, ...(registered && registered !== "other" && found.has(registered) ? { agency: registered } : {}) },
      services: outcomes.map(({ name, ok, problem: said }) => ({ name, ok, ...(said ? { problem: said } : {}) })),
      checkedAt,
    };
  };

  const signposts: Services["signposts"] = async (url) => {
    const answer = await timed("The landing page", (get) => readSignposts(url, get));
    if ("problem" in answer) throw new Error(answer.problem);
    return answer.value;
  };

  const sendNotification: Services["sendNotification"] = async ({ inbox, notification }: { inbox: string; notification: Notification }) => {
    let response: Response;
    try {
      response = await send(inbox, { method: "POST", headers: { "content-type": "application/ld+json" }, body: JSON.stringify(notification) });
    } catch {
      throw new Error(`Couldn't reach the inbox at ${inbox}.`);
    }
    if (!response.ok) throw new Error(`The inbox didn't take the notification. It answered ${response.status}.`);
    const location = response.headers.get("location");
    return { status: response.status, ...(location ? { location: absolute(location, inbox) } : {}) };
  };

  const notifications: Services["notifications"] = async ({ server, about }) => {
    let response: Response;
    try {
      response = await send(`${trimmed(server)}/v1/notify/inbox${about ? `?about=${encodeURIComponent(about)}` : ""}`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch {
      throw new Error(`Couldn't reach ${server}. Check that the server is running.`);
    }
    if (!response.ok) {
      const failed = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(failed?.error?.message ?? `The server answered ${response.status}.`);
    }
    return list(rec(await response.json()).notifications) as NotificationSummary[];
  };

  return { lookupWork, signposts, sendNotification, notifications };
};
