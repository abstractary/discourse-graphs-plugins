/**
 * How Discourse Graphs meets the rest of scholarly infrastructure: the
 * identifiers a unit can carry, what a lookup of a published work returns,
 * what a landing page says about itself (FAIR Signposting), and the facts a
 * card shows. Types and pure functions only, and no imports, so every module
 * can share them.
 */

// Identifiers

export const ID_SCHEMES = ["doi", "pmid", "pmcid", "arxiv", "openalex", "orcid", "ror", "swhid", "isbn", "rrid", "citekey", "zotero", "at", "cid", "url"] as const;
export type IdScheme = (typeof ID_SCHEMES)[number];

/** One identifier, in its bare form: a DOI without `https://doi.org/`, an ORCID iD without its URL. */
export type Identifier = { scheme: IdScheme; value: string };

const SCHEMES: Record<IdScheme, { label: string; read: (text: string) => string | null; url?: (value: string) => string }> = {
  doi: {
    label: "DOI",
    read: (text) => {
      const bare = text.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
      return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare.toLowerCase() : null;
    },
    url: (value) => `https://doi.org/${value}`,
  },
  pmid: {
    label: "PMID",
    read: (text) => /^(?:pmid:\s*|https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{1,9})\/?$/i.exec(text)?.[1] ?? null,
    url: (value) => `https://pubmed.ncbi.nlm.nih.gov/${value}/`,
  },
  pmcid: {
    label: "PMCID",
    read: (text) => {
      const found = /^(?:pmcid:\s*|https?:\/\/(?:www\.ncbi\.nlm\.nih\.gov\/pmc|pmc\.ncbi\.nlm\.nih\.gov)\/articles\/)?(PMC\d+)\/?$/i.exec(text)?.[1];
      return found ? found.toUpperCase() : null;
    },
    url: (value) => `https://pmc.ncbi.nlm.nih.gov/articles/${value}/`,
  },
  arxiv: {
    label: "arXiv",
    read: (text) => {
      const found =
        /^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i.exec(text)?.[1] ??
        /^10\.48550\/arxiv\.(.+)$/i.exec(text)?.[1];
      return found ?? null;
    },
    url: (value) => `https://arxiv.org/abs/${value}`,
  },
  openalex: {
    label: "OpenAlex",
    read: (text) => {
      const found = /^(?:openalex:\s*|https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?)?([WASIC]\d{4,})$/i.exec(text)?.[1];
      return found ? found.toUpperCase() : null;
    },
    url: (value) => `https://openalex.org/${value}`,
  },
  orcid: {
    label: "ORCID",
    read: (text) => /^(?:orcid:\s*|https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$/i.exec(text)?.[1]?.toUpperCase() ?? null,
    url: (value) => `https://orcid.org/${value}`,
  },
  ror: {
    label: "ROR",
    read: (text) => /^(?:ror:\s*|https?:\/\/ror\.org\/)(0[a-hj-km-np-tv-z0-9]{6}\d{2})$/i.exec(text)?.[1]?.toLowerCase() ?? null,
    url: (value) => `https://ror.org/${value}`,
  },
  swhid: {
    label: "SWHID",
    read: (text) => /^(swh:1:(?:cnt|dir|rev|rel|snp):[0-9a-f]{40}(?:;\S+)?)$/i.exec(text)?.[1] ?? null,
    url: (value) => `https://archive.softwareheritage.org/${value}`,
  },
  isbn: {
    label: "ISBN",
    read: (text) => {
      const digits = /^(?:isbn(?:-1[03])?:?\s*)([\dX -]{10,17})$/i.exec(text)?.[1]?.replace(/[ -]/g, "").toUpperCase();
      return digits && (digits.length === 10 || digits.length === 13) ? digits : null;
    },
  },
  rrid: {
    label: "RRID",
    read: (text) => /^RRID:\s*([A-Za-z]+[_:][A-Za-z0-9_:-]+)$/.exec(text)?.[1] ?? null,
    url: (value) => `https://scicrunch.org/resolver/RRID:${value}`,
  },
  // A citation key names a work only inside one person's library, so it is read only when the scheme is named.
  citekey: { label: "Citekey", read: (text) => /^@?([\p{L}\p{N}_:.+-]{2,80})$/u.exec(text)?.[1] ?? null },
  // An item in a Zotero library: `users/<id>/items/<key>` or `groups/<id>/items/<key>`. A locator, not an identity:
  // the same paper has a different key in each library, and a merge can change it.
  zotero: {
    label: "Zotero",
    read: (text) => /^(?:https?:\/\/(?:www\.)?zotero\.org\/|zotero:\/\/select\/)?((?:users|groups)\/\d+\/items\/[A-Z0-9]{8})$/.exec(text)?.[1] ?? null,
    url: (value) => {
      const [kind, id, , key] = value.split("/");
      return kind === "groups" ? `zotero://select/groups/${id}/items/${key}` : `zotero://select/library/items/${key}`;
    },
  },
  at: { label: "AT URI", read: (text) => (/^at:\/\/\S+$/.test(text) ? text : null) },
  cid: { label: "CID", read: (text) => (/^(?:bafy|bafk)[a-z2-7]{20,}$/.test(text) ? text : null) },
  url: { label: "Link", read: (text) => (/^https?:\/\/\S+$/i.test(text) ? text : null), url: (value) => value },
};

/** Tried in this order, so a doi.org link reads as a DOI before it reads as a link. */
const READ_ORDER: IdScheme[] = ["arxiv", "doi", "pmid", "pmcid", "openalex", "orcid", "ror", "swhid", "isbn", "rrid", "zotero", "at", "cid", "url"];

/** Reads an identifier in any of the forms people paste: bare, prefixed, or as a link. */
export const parseIdentifier = (text: string, scheme?: IdScheme): Identifier | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const name of scheme ? [scheme] : READ_ORDER) {
    // A bare PMID is only digits, so it is read as one only when the scheme is named.
    const value = scheme === "pmid" && /^\d{1,9}$/.test(trimmed) ? trimmed : SCHEMES[name].read(trimmed);
    if (value) return { scheme: name, value };
  }
  return null;
};

export const identifierLabel = (scheme: IdScheme): string => SCHEMES[scheme].label;

/** Where the identifier resolves, when its scheme has a resolver. */
export const identifierUrl = ({ scheme, value }: Identifier): string | undefined => SCHEMES[scheme].url?.(value);

/** The compact form used in exports, such as `doi:10.1063/5.0024890`. */
export const identifierCurie = ({ scheme, value }: Identifier): string =>
  scheme === "url" || scheme === "at" || scheme === "swhid" ? value : scheme === "rrid" ? `RRID:${value}` : scheme === "citekey" ? `@${value}` : `${scheme}:${value}`;

/** A DOI in its one stored form: bare and lowercase. A link, a `doi:` prefix or capitals all come to the same thing. */
export const normalDoi = (text: string | undefined): string | undefined => {
  if (!text?.trim()) return undefined;
  return parseIdentifier(text, "doi")?.value.toLowerCase() ?? text.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
};
/** True when both are the same DOI, however each was written. Two missing DOIs are not the same work. */
export const sameDoi = (a: string | undefined, b: string | undefined): boolean => {
  const [x, y] = [normalDoi(a), normalDoi(b)];
  return x !== undefined && x === y;
};

export const sameIdentifier = (a: Identifier, b: Identifier): boolean => a.scheme === b.scheme && a.value.toLowerCase() === b.value.toLowerCase();

/** Joins lists, keeps the first of each, and puts them in the order people look for them. */
export const mergeIdentifiers = (...lists: (Identifier[] | undefined)[]): Identifier[] => {
  const kept: Identifier[] = [];
  for (const item of lists.flatMap((list) => list ?? [])) {
    if (!kept.some((other) => sameIdentifier(other, item))) kept.push(item);
  }
  return kept.sort((a, b) => ID_SCHEMES.indexOf(a.scheme) - ID_SCHEMES.indexOf(b.scheme));
};

export const isIdentifier = (value: unknown): value is Identifier =>
  typeof value === "object" &&
  value !== null &&
  (ID_SCHEMES as readonly string[]).includes((value as Identifier).scheme) &&
  typeof (value as Identifier).value === "string" &&
  (value as Identifier).value.length > 0;

// Published works

export const WORK_SERVICES = ["crossref", "datacite", "openalex", "pubmed", "signposting"] as const;
/** A service a work's metadata was read from. */
export type WorkService = (typeof WORK_SERVICES)[number];

export type WorkAuthor = {
  name: string;
  given?: string;
  family?: string;
  orcid?: string;
  affiliations?: { name: string; ror?: string }[];
};

/** What a landing page says about itself in its `Link` headers: FAIR Signposting, plus its LDN inbox. */
export type Signposts = {
  /** The page the links were read from, after redirects. */
  anchor?: string;
  /** The persistent identifier to cite. */
  citeAs?: string;
  describedBy?: { href: string; type?: string; profile?: string }[];
  /** The content itself: the PDF, the data files. */
  items?: { href: string; type?: string }[];
  license?: string;
  types?: string[];
  authors?: string[];
  collection?: string;
  linkset?: string;
  /** Where the page takes Linked Data Notifications, which is how COAR Notify reaches it. */
  inbox?: string;
};

/** Changes to a published work that a reader must know about. */
export type WorkUpdate = { type: "retraction" | "correction" | "concern" | "version" | "other"; doi?: string; date?: string; label?: string };

/**
 * One published work, joined from every service that knows it. `from` says
 * which service each field was taken from, so a reader can weigh it.
 */
export type WorkMetadata = {
  identifiers: Identifier[];
  title?: string;
  authors?: WorkAuthor[];
  /** As precise as the publisher gave it: `2020`, `2020-12` or `2020-12-01`. */
  published?: string;
  /** The journal, conference or repository. */
  venue?: string;
  publisher?: string;
  /** In schema.org's words where it has one: `ScholarlyArticle`, `Dataset`, `SoftwareSourceCode`. */
  type?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  /** A license URL. */
  license?: string;
  openAccess?: { status?: string; url?: string };
  retracted?: boolean;
  updates?: WorkUpdate[];
  citedBy?: number;
  /** DOIs of the works it cites, when the registry lists them. */
  references?: string[];
  /** MeSH headings or OpenAlex topics: a few words on what it is about. */
  subjects?: string[];
  /** Who registered the DOI. It decides which registry holds the record of truth. */
  agency?: "crossref" | "datacite" | "other";
  signposts?: Signposts;
  from: Partial<Record<keyof Omit<WorkMetadata, "from" | "services" | "checkedAt">, WorkService>>;
  /** Every service that was asked, and how it went. */
  services: { name: WorkService; ok: boolean; problem?: string }[];
  checkedAt: string;
};

/** The part of a lookup a record keeps: what changes how a reader weighs the work. */
export type WorkStanding = {
  retracted?: boolean;
  updates?: WorkUpdate[];
  openAccess?: { status?: string; url?: string };
  citedBy?: number;
  agency?: "crossref" | "datacite" | "other";
  /** The landing page's inbox, so an announcement has somewhere to go. */
  inbox?: string;
  services: WorkService[];
  checkedAt: string;
};

export const standingOf = (work: WorkMetadata): WorkStanding => ({
  ...(work.retracted ? { retracted: true } : {}),
  ...(work.updates?.length ? { updates: work.updates } : {}),
  ...(work.openAccess ? { openAccess: work.openAccess } : {}),
  ...(work.citedBy !== undefined ? { citedBy: work.citedBy } : {}),
  ...(work.agency ? { agency: work.agency } : {}),
  ...(work.signposts?.inbox ? { inbox: work.signposts.inbox } : {}),
  services: work.services.filter(({ ok }) => ok).map(({ name }) => name),
  checkedAt: work.checkedAt,
});

/** How a list of authors reads in one line. */
export const authorLine = (names: string[], most = 3): string =>
  names.length <= most ? names.join(", ") : `${names[0]} and ${names.length - 1} others`;

// A reference library, such as Zotero

/** One item in a person's reference library, in the few fields a graph needs. */
export type LibraryItem = {
  /** Where it sits: `users/<id>/items/<key>` or `groups/<id>/items/<key>`. */
  ref: string;
  key: string;
  library: { kind: "user" | "group"; id: number; name?: string };
  /** The library's own word for the kind of thing: `journalArticle`, `preprint`, `book`. */
  type: string;
  title: string;
  authors: WorkAuthor[];
  /** As precise as the library holds it. */
  published?: string;
  venue?: string;
  identifiers: Identifier[];
  tags: string[];
  /** Its PDFs and other files, which are what annotations hang from. */
  attachments: { key: string; title: string; mediaType?: string; filename?: string }[];
  /** Opens the item in the library's own app. */
  open: string;
};

export const LIBRARY_ANNOTATION_TYPES = ["highlight", "underline", "note", "text", "image", "ink"] as const;

/** One mark a person made while reading. Only highlights and underlines quote the text. */
export type LibraryAnnotation = {
  key: string;
  ref: string;
  /** The file it was made on. */
  attachment: string;
  type: (typeof LIBRARY_ANNOTATION_TYPES)[number];
  /** The words marked, exactly. */
  text?: string;
  /** What the person wrote about them. */
  comment?: string;
  /** As the library holds it, such as `#ffd400`. What a colour means is each person's own convention. */
  color?: string;
  pageLabel?: string;
  /** Counted from zero, as the file counts pages. */
  pageIndex?: number;
  /** Reading order within the file. */
  order?: string;
  tags: string[];
  author?: string;
  /** Opens the file at this mark in the library's own app. */
  open: string;
};

/** Whether the library can be reached, and why not when it can't, in words a person can act on. */
export type LibraryStatus = { ok: boolean; app: "zotero"; problem?: string; canWrite?: boolean; serverId?: string };

// The facts a card shows

/**
 * The facts every unit can show, on its card and in the context panel, in
 * this order. A card shows the ones a person has switched on; the panel shows
 * them all.
 */
export const CARD_FIELDS = [
  { id: "source", label: "Source", hint: "The PDF or paper it was read from, and whether a person or a model read it" },
  { id: "authors", label: "Authors", hint: "The paper's authors, or whoever made the unit" },
  { id: "origin", label: "Workspace", hint: "The workspace it was first written in: yours, your lab's or someone else's" },
  { id: "created", label: "Date made", hint: "When it was first written" },
  { id: "identifiers", label: "Identifiers", hint: "Its DOI and other identifiers" },
] as const;
export type CardField = (typeof CARD_FIELDS)[number]["id"];
export const CARD_FIELD_IDS: CardField[] = CARD_FIELDS.map(({ id }) => id);
export const DEFAULT_CARD_FIELDS: CardField[] = ["source"];

/** `auto`: a model read it from the paper. `manual`: a person highlighted or wrote it. `imported`: it arrived in a file. */
export type ReadHow = "auto" | "manual" | "imported";
export const READ_HOW_LABEL: Record<ReadHow, string> = { auto: "Auto", manual: "By hand", imported: "Imported" };

export type CardFacts = {
  /** Absent for a unit that wasn't read from anything. */
  source?: {
    /** A few words: `Carroll 2020`, or the file's name. */
    name: string;
    /** The paper's full title, or the file's full name. */
    title: string;
    how: ReadHow;
    /** What read it, for `auto`: the model's name. */
    by?: string;
    /** Set when a person has reworded what a model read. */
    reworded?: true;
    /** The paper record's id. */
    paper?: string;
  };
  /** The paper's authors when it was read from a paper, otherwise whoever made it. */
  authors: { names: string[]; role: "paper" | "maker" };
  origin: { name: string; kind: "here" | "lab" | "elsewhere" };
  created: string;
  identifiers: Identifier[];
  /** Set when a registry says the work it was read from is retracted. */
  retracted?: true;
};

// COAR Notify

export const NOTIFY_PATTERNS = ["announce-endorsement", "announce-review", "announce-relationship", "request-endorsement", "request-review"] as const;
export type NotifyPattern = (typeof NOTIFY_PATTERNS)[number];

/** A service that sends or takes notifications: its home, and its LDN inbox. */
export type NotifyService = { id: string; inbox: string };

/** A COAR Notify notification, as the JSON-LD that travels. */
export type Notification = { id: string; type: string | string[]; [key: string]: unknown };

/** One notification an inbox holds, in the few fields a list needs. */
export type NotificationSummary = {
  id: string;
  types: string[];
  /** What it is about: the `object`'s id, or for a relationship its subject and object. */
  about: string[];
  /** The work it concerns, when the notification names one: `context.id`. */
  context?: string;
  from: string;
  actor?: string;
  receivedAt: string;
  notification: Notification;
};
