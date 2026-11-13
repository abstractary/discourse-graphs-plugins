# Zotero

How Discourse Graphs and Zotero should fit together over the long run, what was built toward that, and what was learned from the plugins people use today.

The short version: **Zotero stays the library, and Discourse Graphs is the argument built on it.** A reference becomes one Source unit that points back at its Zotero item. A highlight becomes a unit that quotes its passage. Nothing is mirrored, nothing arrives unasked, and what makes two things the same paper is a DOI, never a Zotero key.

For the facts this rests on and where each was read, see [What was checked](#what-was-checked) at the end.

## What exists today, and what it teaches

The official Discourse Graphs docs send Obsidian users to **Zotsidian**, a community plugin with "built-in discourse graph support", and the official example vault ships with it. It was read closely for this page. Three other tools set what people expect.

| Tool | How it reaches Zotero | What it puts in the vault | State |
|---|---|---|---|
| **Zotsidian** (0.2.1, Oct 2026) | Zotero's local API, with Better BibTeX for citation keys | A page per reference named `@citekey`, with its annotations in a managed block. Discourse nodes made from an annotation | Active, one author. It ships as a built bundle with no source |
| Zotero Integration (611,000 downloads) | Better BibTeX, and a helper program for annotations inside the PDF | A templated literature note | Archived. Last release August 2024 |
| ZotLit | Reads Zotero's database file directly | Notes, and its own reader | Active |
| zotero-mcp | Reads the database, writes through the local API | Nothing. It gives an agent tools | Active, widely used |

**What Zotsidian gets right, and is kept:**

- It reads through the local API, which needs no key and no account.
- It turns one annotation into one node whose statement is the quoted text.
- It marks an annotation it has used with a `dg/<type>` tag in Zotero. People who use it have already typed their highlights.
- It keeps one page per reference, named for its citation key.

**Where it will not carry the project, and why this design differs:**

| In Zotsidian | The trouble | Here |
|---|---|---|
| A reference's identity is its citation key, through the filename | A citation key is one person's label. Change it, or merge two items, and the page and every node pointing at it are orphaned. Two labmates rarely share keys | Identity is the DOI, PMID or arXiv id. The Zotero item and the citation key are kept as ways to find it again |
| It reads the official plugin's settings file, and writes its `relations.json` directly | These are the official plugin's internals, not a contract. They can change in any release | Everything goes through the record log and the Host contract, the same in Obsidian, Roam and Logseq |
| An evidence node points at its source with a wikilink in frontmatter | No quote, no page a reader can use. Only Zotero can open the passage | The unit holds the exact words and the page, so this app's reader, an export, or any other tool can find the passage |
| Obsidian only | Discourse Graphs also runs in Roam, and Logseq is next | The mapping is in the shared core. Only the HTTP call differs by base |
| Two write keys kept in plugin settings | A stored key that can change a whole library | Nothing is written to Zotero yet. When it is, the key goes in the system keychain, as model keys do |

Zotsidian does not send `Zotero-Allowed-Request` with its local API calls. Zotero's source drops any request that looks like it came from a browser unless it carries that header. Whether Zotsidian's calls get through as they are was not tested, since nothing was run.

## The seven rules

1. **Zotero is the library.** Discourse Graphs holds a pointer to an item, not a copy of the library. There is no background sync and no index of everything.
2. **Pull only.** A person searches, picks a reference, and picks which highlights to bring. Nothing else arrives. This is the same rule as lookups and analysis.
3. **Identity is the work, not the item.** DOI first, then PMID, PMCID, arXiv id, ISBN. A Zotero item address (`users/<id>/items/<key>`) and a citation key are locators: good for finding the item again, never for deciding that two things are the same paper.
4. **A passage is its words.** A unit keeps the quoted text and the page. Zotero's own coordinates are a way to open the passage in Zotero, not the anchor.
5. **When it is your PDF library, it is the only one.** With **Use Zotero as your PDF library** on in Settings, the papers to read are Zotero's. Each is opened where Zotero keeps it and never copied into the base. A copy in the base of a paper Zotero holds is the same work, so it is not listed beside Zotero's.
6. **A personal library's address is one person's.** On its own computer a personal library is always `users/0`, so that address means a different library on every teammate's machine. It is kept as a fact about the unit, and it marks, matches and opens an item only for the person whose unit carries it. A group library's address (`groups/…`) is the same for every member and is used by all of them.
7. **One file knows Zotero.** `packages/sync/src/zotero.ts` is the only place that knows Zotero's API. Zotero ships a major version every six to ten weeks and has tightened that API twice, so the change has to land in one place.

## What maps to what

| In Zotero | In Discourse Graphs | Kept |
|---|---|---|
| An item (article, preprint, book) | One **Source** unit | Title, authors, date, venue. DOI, PMID, PMCID, arXiv id, ISBN, citation key, and the item's address in the library |
| A PDF attachment | Nothing by itself. It is what annotations hang from | Its key, inside the link that opens a passage |
| A highlight or underline | A unit that quotes it. **Evidence** unless it says otherwise | The exact words, the page, the reader's comment beside it, and a link that opens it in Zotero |
| A note annotation | A unit whose statement is the note. **Claim** unless it says otherwise | The page and the link |
| A picture or a drawing | Not brought in yet | — |
| A tag on an annotation | Its type, when the tag names one: `dg/claim`, `claim` or `CLM` | — |
| A colour | Shown, never interpreted | — |
| A group library | The same, with the group in the item's address | — |

**Colour is not a type.** The older plugins let each person decide in a template what yellow means, so there is no shared meaning to read. Tags are explicit, and Zotsidian users already have them, so tags decide.

**A highlight is "By hand".** A person read and marked it. Its card says so, cites the source as "Carroll 2020", and lists the paper's identifiers, the same as a highlight made in this app's own reader.

**Bringing the same thing in twice makes nothing new.** A source is found by its identifiers, then by its item address. A highlight is found by its annotation's address.

**A source already in the graph is joined, not doubled.** If a paper was read with Extract graph, or a source was typed by hand with a DOI, the Zotero item attaches to that unit. The unit learns the item's address and any identifier Zotero knows that it didn't. Its title stays as its author wrote it.

**A vault that already has `@citekey` pages keeps them.** When a page with that name exists, the Source unit is tied to it, so an existing Zotsidian vault is not given a second page per reference.

## What was built

| Part | Where | What it does |
|---|---|---|
| Library types | [`contract/scholarly.ts`](../packages/contract/src/scholarly.ts) | `LibraryItem`, `LibraryAnnotation`, and the `zotero` and `citekey` identifier schemes |
| The Zotero client | [`sync/zotero.ts`](../packages/sync/src/zotero.ts) | Status, search, one item, and its annotations, over the local API |
| The mapping | [`core/library.ts`](../packages/core/src/library.ts) | Finds the Source an item belongs to, suggests a type for each mark, makes the units, places them on the canvas |
| The dialog | [`surfaces/zotero/App.tsx`](../packages/surfaces/src/zotero/App.tsx) | **From Zotero…** in a canvas's menu: search, pick a reference, tick highlights, choose types, bring them in |
| The way back | Context panel | **Open the passage in Zotero** on a highlight, **Show it in Zotero** on a source |
| Zotero as the PDF library | [`core/reading.ts`](../packages/core/src/reading.ts), `Context.readFile` in [`core/index.ts`](../packages/core/src/index.ts) | Lists Zotero's PDFs first, reads each from Zotero's own folder, and finds the paper or source a file already has by its identifiers |
| Reading a file in place | `Host.readLocalFile` in [`contract/host.ts`](../packages/contract/src/host.ts) | The base reads one PDF from outside itself, at the path Zotero gives. Obsidian and the local app have it; Roam in a browser can't |
| The mark | `LibraryMark` in [`surfaces/shared/ui.tsx`](../packages/surfaces/src/shared/ui.tsx), `inLibraryOf` in [`core/card.ts`](../packages/core/src/card.ts) | One mark wherever a source is shown, worked out in one place |
| Checking again | The reader's **N in Zotero** button, and `zotero.show` | Opens From Zotero at that reference, with the highlights made since ticked |

**It reads and never writes.** No key is asked for and nothing in the library changes.

**When Zotero can't be reached, the dialog says what to do**: open Zotero, or tick the setting under Settings, Advanced that lets other apps talk to it.

### Where the mark shows

The same small **Z** mark says "this is in your Zotero library" everywhere a source appears. Where there is room to act, it is a button that shows the item, or the passage, in Zotero.

| Place | What it does |
|---|---|
| A card's Source row, and a Source unit's own card | Says it is in Zotero. Opens it there once the card is selected |
| The head of the Context panel, and **Show it in Zotero** under Where it came from | Opens the item or the passage |
| Every "Carroll 2020" label beside a unit: in Context, in Search | Says the paper is in Zotero |
| The PDF chooser | Marks each of Zotero's PDFs, under **In Zotero** |
| The reader's bar | **Zotero** shows the reference. **N in Zotero** offers highlights made there that aren't units yet |
| The Library panel and the Paper map | Marks each paper that is in Zotero |
| A canvas's menu | **From Zotero…** carries the mark |

### What it has been run against

**Zotero itself, since 13 November.** Zotero 10.0.9 on this computer, with one reference and its PDF. `harness/zotero-real-test.mjs` passes 17 checks in real Obsidian: Zotero answers Obsidian's own request; the PDF is listed under In Zotero and named for its reference; its 1.4 MB are read from Zotero's storage folder with nothing copied into the vault; the reader draws it; a highlight made from it becomes a unit whose source carries the reference's DOI, PMID and PMCID; the card, the panel and the settings line all say so.

**What that run found.** Two faults the stand-in had hidden:

- A personal library read on its own computer has the id 0. The code took 0 for "no library" and never recorded where an item sits, so nothing brought in from a real personal library could be found again in Zotero.
- The same address, `users/0/items/…`, names a different item on every computer. It was being used to recognise a source across people. It now only does that for its owner.

**Still only against the stand-in:** anything to do with highlights, because the real library has none. That covers bringing highlights in, the **N in Zotero** count, and opening a passage. Group libraries were not run at all, since the real library has no groups. `zotero://` links were built as Zotero's source writes them and were not clicked.

## Where it goes next

In the order that buys the most for the least risk.

| Step | What | Why then |
|---|---|---|
| **1. Read, on this computer** | Built: search, item, highlights, the way back | It needs no account and can't harm a library |
| **2. Check again** | Built 13 November, from the reader: **N in Zotero** opens the reference with highlights made since | People keep reading after the first import |
| **3. The PDF itself** | Built 13 November: a Zotero PDF opens in this app's reader, read in place. Zotero's highlights are counted and offered, and are lit once brought in. Drawing them before they are units is not built | The local API gives the file's path, not its bytes, so the base reads the file itself |
| **4. Where Zotero isn't running** | The web API with a person's own key, for Roam in a browser and for group libraries on another computer | The item JSON is the same shape, so the mapping is reused. Only the client grows |
| **5. Write back, asked for** | Tag a used annotation `dg/<type>`. Add a link on the Zotero item to its Source. Make a Zotero highlight from one made in this app's reader | Zotero 10 lets an app ask for write access with a dialog in Zotero itself. Each write is one click here and visible there |
| **6. Inside Zotero** | A small Zotero plugin: "Add to Discourse Graphs" in the reader's selection popup, and a pane on an item listing the claims that rest on it | This is the only way to act at the moment of reading. It is a separate program under Zotero's licence terms, and its APIs change with each major version, so it comes last and stays small |

**For agents, nothing new is needed.** The planned `resolve_identifier` tool answers "which units carry this DOI", and the existing Zotero MCP server answers the same for the library. An agent joins the two by DOI.

### Decisions that are yours

1. **Should a used annotation be tagged in Zotero?** Zotsidian does. It makes the library show what has been argued from, and it is a write.
2. **Does colour ever suggest a type?** The answer here is no. A per-person setting could offer it.
3. **One page per reference, or none?** A Source has no note until it is exported. Zotsidian users expect a page per reference from the start.
4. **Is a Zotero plugin wanted at all?** It is the deepest integration and the most upkeep.
5. **Whose key, for labs?** A group library read through the web API needs someone's key. The lab's server could hold one for the lab, or each member could use their own.

## The hardest parts

1. **There is no stable handle on "this item, this version".** Local version numbers belong to one Zotero installation and say nothing to another. Keys are per library and can change on a merge. So change is detected by content (the words of a highlight, the fields of an item), and identity by DOI.
2. **A passage has to survive outside Zotero.** PDF rectangles need exact handling of rotation and crop. EPUB and web snapshot annotations use selectors, not rectangles. Annotations saved inside a PDF file by another program are not in Zotero's database at all. Keeping the quoted words covers all three, at the cost of an occasional passage that can't be found again.
3. **Zotero moves fast, and asks before it trusts.** Three major versions shipped in 2026. Writes need a dialog in Zotero and an unscoped key. Tools that read the database file directly now meet a locking mode that makes that fragile, which is why this design uses only the API.

## First checks with a real Zotero

| Check | Result, 13 November |
|---|---|
| 1. Does Obsidian's own request get through with `Zotero-Allowed-Request`? | **Yes.** No other header was needed. A request that looks like a browser's and lacks the header is dropped, as the source says |
| 2. Do `zotero://select/…` and `zotero://open-pdf/…` open the right thing? | **Not run.** The links are built and handed to the system. Nothing clicked them, and the library has no group or highlight to try |
| 3. Does a highlight's quoted text find its passage in this app's reader? | **Not run.** The real library has no highlights. A highlight made in this app's reader on Zotero's PDF does light up |
| 4. What comes back for a highlight another program saved inside the PDF? | **Not run.** None to try |
| 5. In a vault that uses Zotsidian, does a Source tie itself to the `@citekey` page? | **Not run.** No such vault here |

To finish 2 to 4, highlight a passage in Zotero's own reader and run `node harness/zotero-real-test.mjs` again.

## What was checked

Read on 13 November 2026.

- **Zotero's source** for the local API's routes, the rule that drops browser-like requests, the link forms, and the annotation fields. The current version was 10.0.9. The local API arrived in Zotero 7, gained annotations in 8 and writes in 10.
- **Zotero's documentation** for the web API: keys, paging, sync by version, rate limits, and writing.
- **Zotsidian's published bundle**, statically. It was not run. Line references are in the working notes, not here.
- **The official Discourse Graphs docs and plugin source**, for how nodes and relations are stored today.
- **Not verified:** anything that needs a running Zotero; Zotsidian's behaviour at run time; what Zotero's licence means for a plugin that runs inside it, which is a legal question.

The earlier sketch in [llm-and-mcp-spec.md](llm-and-mcp-spec.md) section 5 had four things wrong, corrected here: the local API is older than Zotero 10; an item's key and version are not a fingerprint; group libraries work; and PMID is now a field of its own.
