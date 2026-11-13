# Cards, identifiers and the scholarly record

How a unit says where it came from, and how a graph joins the rest of scholarly infrastructure: DOIs and the registries behind them, RO-Crate, DataCite, FAIR Signposting and COAR Notify. This page says what each part does, where its code lives, and how the parts depend on each other.

For how to use these in the app, see the [user guide](guide/README.md). For the server's routes, see [services.md](services.md).

## The short version

| You want to | What does it | Where |
|---|---|---|
| See on every card what it was read from, by whom, where and when | The **Cards** list on the canvas bar | [`shared/facts.tsx`](../packages/surfaces/src/shared/facts.tsx), [`core/card.ts`](../packages/core/src/card.ts) |
| Read the same facts, laid out the same way, in the Context panel | The rows under the unit's title | The same component, at panel size |
| Find a paper's other identifiers, and whether it was retracted | **Look it up**, under Published work | [`sync/scholarly.ts`](../packages/sync/src/scholarly.ts), [`core/works.ts`](../packages/core/src/works.ts) |
| Hand a graph to Zenodo, WorkflowHub or a lab notebook | **Export**, then **A research crate** | [`core/rocrate.ts`](../packages/core/src/rocrate.ts), [`core/crate.ts`](../packages/core/src/crate.ts) |
| Read someone's Workflow Run crate or `.eln` file | **Import this research crate** | [`core/crate.ts`](../packages/core/src/crate.ts) |
| Tell a paper's repository that a unit was read from it | **Announce**, under Published work | [`core/notify.ts`](../packages/core/src/notify.ts) |
| Bring a reference and its highlights in from Zotero | **From Zotero…** in a canvas's menu. See [zotero.md](zotero.md) | [`sync/zotero.ts`](../packages/sync/src/zotero.ts), [`core/library.ts`](../packages/core/src/library.ts) |
| Serve a stored graph so machines can follow it | The server's landing pages | [`server/signposting.ts`](../server/src/signposting.ts), [`server/notify.ts`](../server/src/notify.ts) |

## One vocabulary, in one file

[`packages/contract/src/scholarly.ts`](../packages/contract/src/scholarly.ts) holds the types everything else shares, and imports nothing:

- **Identifiers.** `{ scheme, value }`, always in the bare form. Fifteen schemes: DOI, PMID, PMCID, arXiv, OpenAlex, ORCID, ROR, SWHID, ISBN, RRID, citation key, Zotero item, AT URI, CID and plain links. `parseIdentifier` reads any form people paste (bare, prefixed or a link). `identifierUrl` says where one resolves.
- **A published work.** `WorkMetadata` is one work joined from every registry, with `from` saying which registry each field came from. `WorkStanding` is the part a record keeps.
- **Signposts.** What a landing page says about itself in its `Link` headers.
- **Card facts.** `CARD_FIELDS` is the list of facts a card can show, in the order they are always shown.
- **Notifications.** The COAR Notify patterns and the shape of a notification.

Adding a scheme, a card fact or a notification pattern means adding a row in this file. Nothing else has a second copy of the list.

## What a card shows

Every unit has five facts beyond its title. A card shows the ones switched on in the **Cards** list. The Context panel always shows all five.

| Fact | On the card | Comes from |
|---|---|---|
| Source | The paper or PDF in a few words ("Carroll 2020"), then **Auto**, **By hand** or **Imported** | The paper record, or the source unit a highlight names. Auto means a model read it. By hand means a person highlighted or wrote it. Imported means it arrived in a file |
| Authors | The paper's authors. For a unit that wasn't read from a paper, whoever made it, labelled "Made by" | The paper's `authors`, or the unit's own author |
| Workspace | The vault or workspace it was first written in. A teammate's unit names their lab | The record's `space` |
| Date made | The day and time the unit was first written | The record's `at` |
| Identifiers | The unit's own identifiers, then its paper's: DOI first | `facts.doi`, `facts.identifiers`, the paper's `doi` and `identifiers` |

**Decisions.**

- **One function computes the facts** ([`cardFacts`](../packages/core/src/card.ts)), and **one component draws them** ([`Facts`](../packages/surfaces/src/shared/facts.tsx)). The card and the panel differ only in a size attribute. They can't drift apart, because there is nothing to keep in step.
- **The choice is per device**, kept in `Prefs.cardFields`. Source is on to begin with.
- **A click on a card only selects it.** The source and identifier links act once the card is selected. Before that they are plain text, so reaching for a card never opens a PDF or a browser tab.
- **Cards grow when they show more, and nothing is moved for you.** If cards then cover each other, the bar says how many and offers Tidy. The same check runs when a canvas opens.
- **A retraction shows on the card**, beside the source, once a registry has reported one.

A workspace other than your own or your lab's shows as "Another workspace". Records carry the id of the space they were written in, not its name, so the name isn't known yet. That needs a small record that names a space, and it is not built.

## Looking a work up

**Look it up** asks the open registries about the paper behind a unit. Nothing is asked until you click. Only the paper's identifiers and title are sent, with no key, no email address and nothing about you.

| Registry | Asked when | Gives |
|---|---|---|
| doi.org | There is a DOI | Which agency registered it, which decides who is asked next |
| Crossref | It registered the DOI, or there is only a title | Title, authors with ORCID iDs, journal, date, volume, pages, license, references, retractions and corrections |
| DataCite | It registered the DOI (arXiv, Zenodo, most datasets and software) | The same for its own records, plus versions of the work |
| OpenAlex | There is a DOI, PMID or OpenAlex id | PMID and PMCID, open access status, times cited, topics, retraction, ORCID iDs and ROR ids the registry lacks |
| PubMed | There is a PMID, or one was just found | Journal, date, and retraction or correction notices |
| The paper's own page | There is a DOI or link | Its FAIR Signposting links, and the inbox it takes announcements at |

**How answers are joined.** The agency that registered the DOI is the record of truth for the title, authors, venue and date. OpenAlex fills in what registries don't hold. A work is retracted if any one of them says so. Each service has eight seconds, and one failing never fails the lookup: the panel lists who answered and who didn't.

**What is kept.** A paper record gains `identifiers`, `published`, `venue`, `people` (authors with ORCID iDs and affiliations) and `standing` (retraction, open access, times cited, the registering agency, the inbox). Its own title and authors are never overwritten. A cited source that has no paper record keeps the same in its own facts, and only when the unit is yours.

**Adding a registry** means adding one resolver and one row in the precedence table, both in [`sync/scholarly.ts`](../packages/sync/src/scholarly.ts).

Two limits found in use. PubMed's id converter only knows papers that are in PubMed Central, so a paper with a PMID but no PMCID gets its PMID from OpenAlex or not at all. And some publishers refuse to let a program read their landing page, so those papers have no signposts.

## Research crates

**Export, then A research crate** packs a canvas into one archive that follows [RO-Crate 1.3](https://w3id.org/ro/crate/1.3), with its runs described as a [Process Run Crate 0.6](https://w3id.org/ro/wfrun/process/0.6).

**What is in the archive**

| File | What it is |
|---|---|
| `ro-crate-metadata.json` | The description of everything below, as JSON-LD |
| `ro-crate-preview.html` | The same description as a page a person can read |
| `discourse-graph.jsonld` | The graph as PROV-O, the same export the process ontology checks |
| `dg-records.jsonl` | The graph as Discourse Graphs records, so importing the crate restores it exactly |
| `<canvas>.canvas` | Where each card sits, as a JSON Canvas |
| `datacite.json` | The crate described in DataCite's schema, for a repository that will mint its DOI |
| `papers/*.pdf` | The papers, only if you tick the box |

Units that the chosen ones rest on come along: a run's code and outputs, the protocol it followed, the source of a piece of evidence.

**How units are described**

| Unit | In the crate | Notes |
|---|---|---|
| Question | `Question` | Listed in the root's `about` |
| Claim | `Claim` | |
| Evidence | `CreativeWork` and `Evidence` | `Evidence` is one of the terms the crate defines itself |
| Source | `ScholarlyArticle` or `CreativeWork` | Its `@id` is the DOI link. Cited from the root |
| A paper | `ScholarlyArticle` | Authors as `Person` with ORCID `@id`s, affiliations with ROR ids, identifiers as `PropertyValue`, `Retracted` when a registry says so |
| Protocol | `HowTo` | Steps as `HowToStep` |
| Study | `CreativeWork` and `Study` | |
| Run | `CreateAction` | `instrument` is the code, `object` is what it used and its parameter values, `result` is its outputs, with `agent`, `startTime`, `endTime` and `actionStatus` |
| Code | `SoftwareSourceCode` | Repository, commit, language, SWHID |
| Output | `File` when the crate holds or links its bytes, otherwise `ImageObject`, `Dataset` or `MediaObject` | Size, type and content hash |
| Supports, Opposes, Addresses, Informs | Properties of the same names | Defined in the crate |

Every payload file is listed with its size and SHA-256. Where a property has one value it is written as one value, as RO-Crate asks. The eleven terms that schema.org lacks are each defined in the crate with a name and a sentence, and listed in one `DefinedTermSet`.

**Checked from outside.** A crate exported from the sandbox vault passes every required check of the community [rocrate-validator](https://github.com/crs4/rocrate-validator) (0.13.1) for RO-Crate 1.3. Five recommended checks remain, and all five ask for something the crate won't invent: an ORCID iD and an affiliation for you, and a contact point. Set your ORCID iD and join a lab, and the first two are met. The validator doesn't yet know Process Run Crate 0.6, so that profile is covered by the unit tests alone.

**License.** You pick one in the export dialog. With none, the crate says in words that none has been chosen. It never assumes one.

**The lab-notebook form.** Choosing `.eln` writes the same crate in [the ELN file format](https://github.com/TheELNConsortium/TheELNFileFormat): one folder inside the archive, RO-Crate 1.2 (which that format pins), and who made the archive. eLabFTW, RSpace and others read that format. It hasn't been opened in either of them yet.

**Reading a crate.** A crate this app made is restored from its records: the same units under their own authors, the same canvas, and nothing new when read twice. Anyone else's crate (RO-Crate 1.0 to 1.3, zipped, as an `.eln` file, or a bare `ro-crate-metadata.json`) becomes units:

| In the crate | Becomes | Keeps |
|---|---|---|
| `CreateAction` | Run | Status, times, who ran it, parameter values, and links to its code, inputs and outputs |
| `SoftwareSourceCode`, `SoftwareApplication`, `ComputationalWorkflow` | Code | Repository, version, language, license |
| `File`, `Dataset`, `ImageObject` in the root's `hasPart` | Output | Type, size, where its bytes are, and which run made it |
| `ScholarlyArticle`, or anything the root cites | Source | DOI and other identifiers |
| `HowTo` | Protocol | Version and steps |
| `Question`, `Claim` | Question, Claim | |

They arrive on a new canvas named for the crate, marked Imported. A crate with more than 300 such entities keeps its runs and what they name first, and says how many files it left out.

## DataCite and Crossref

Both are read on lookup, chosen by who registered the DOI. Going the other way, `datacite.json` in a crate is ready for a repository to register: creators with ORCID iDs, the license, and related identifiers that tie the new DOI to what the graph rests on.

| The crate | Relation | To |
|---|---|---|
| Was read from a paper | `IsDerivedFrom` | The paper's DOI |
| Cites a source | `References` | Its DOI, PMID or arXiv id |
| Ran code | `Requires` | Its SWHID or repository |

Depositing with Crossref needs a member's credentials, so it isn't built. A crate's DOI is expected to come from a repository such as Zenodo, which registers with DataCite.

## FAIR Signposting

**Read.** A lookup follows the paper's DOI to its landing page and reads the `Link` headers: `cite-as`, `describedby`, `item`, `license`, `type`, `author`, `linkset`, and the Linked Data Notifications inbox. A linkset, when there is one, is fetched and folded in.

**Served.** Every paper in the server's graph store has a landing page at `/works/<doi>` with those headers, a linkset, the graph as an item, and a detached RO-Crate as its metadata. [services.md](services.md#landing-pages-and-signposting) has the routes.

One honest gap: `cite-as` should resolve back to the page that states it. A stored graph has no identifier of its own yet, so the page gives the paper's DOI, which resolves to the publisher. It becomes right when graphs get their own DOIs.

## COAR Notify

**Sent.** When a paper's page advertises an inbox, **Announce this unit to the paper's repository** builds an Announce Relationship notification: this unit, `prov:wasDerivedFrom`, that paper. The panel shows where it will go and the exact JSON. It is sent only when you press Send, and what is sent is what you read, under the same id. Replies go to your lab server's inbox, so announcing needs a lab.

No real repository has been sent anything. The tests send to a stand-in, and the server's inbox is tested against the specification's rules.

**Built, not yet offered in the panel.** `buildNotification` also makes Announce Review, Announce Endorsement, Request Review and Request Endorsement. They wait on review and endorsement having a place in the interface.

**Received.** The server has an inbox at `/v1/notify/inbox`, advertised from `/` and from every landing page. The Context panel lists what the lab's server has been told about a unit or its paper. The demo inbox checks a notification's shape and does not check who sent it, so the panel words these as what someone said, never as fact.

## What leaves your device

| You do this | This goes | To |
|---|---|---|
| Look a paper up | Its identifiers and title | doi.org, Crossref or DataCite, OpenAlex, PubMed, and the paper's own page |
| Open an identifier | Nothing from the app. Your browser opens the link | Wherever it resolves |
| Export a crate | Nothing. The archive is saved in your vault | — |
| Announce a unit | Your name, your id, the unit's address and the paper's DOI | The inbox the paper's page names |
| Import a crate | Nothing | — |

## How the parts depend on each other

A design structure matrix, made from the imports in the code by `npm run dsm`. A mark in a row means that row depends on that column. Everything sits below the diagonal: each part depends only on parts listed above it, so there are no cycles and a change travels one way.

**Modules**

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **1** contract | ■ |   |   |   |   |   |   |   |   |   |
| **2** layout | × | ■ |   |   |   |   |   |   |   |   |
| **3** core | × |   | ■ |   |   |   |   |   |   |   |
| **4** sync | × |   |   | ■ |   |   |   |   |   |   |
| **5** native | × |   | × |   | ■ |   |   |   |   |   |
| **6** surfaces | × | × |   |   |   | ■ |   |   |   |   |
| **7** obsidian | × |   | × | × | × |   | ■ |   |   |   |
| **8** roam | × |   | × | × | × |   |   | ■ |   |   |
| **9** local | × |   | × | × |   |   |   |   | ■ |   |
| **10** server |   |   |   |   |   |   |   |   |   | ■ |

The server stands alone on purpose. It shares a wire format with the plugins, not code. That costs two small copies: the server builds its own minimal RO-Crate for a stored extraction, and has its own DOI normalising. Both are covered by the server's tests.

**The files behind this page**

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **1** contract/scholarly.ts | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **2** contract/records.ts | × | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **3** contract/services.ts | × | × | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **4** contract/surface.ts | × | × | × | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **5** core/process.ts |   | × |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **6** core/jsonld.ts |   | × |   |   | × | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **7** core/card.ts | × | × |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **8** core/library.ts | × | × |   | × | × |   | × | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **9** core/profile.ts |   | × |   | × |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **10** core/zip.ts |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **11** core/datacite.ts | × | × |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **12** core/rocrate.ts | × | × |   |   | × | × | × |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **13** core/works.ts | × | × |   | × |   |   | × |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **14** core/notify.ts | × | × |   | × | × | × |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |   |
| **15** core/crate.ts | × | × |   | × | × | × | × |   |   | × | × | × |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |   |
| **16** sync/scholarly.ts | × |   | × |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |   |
| **17** sync/zotero.ts | × |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |   |   |
| **18** sync/client.ts |   | × | × |   |   |   |   |   |   |   |   |   |   |   |   | × | × | ■ |   |   |   |   |   |   |   |   |   |
| **19** surfaces/shared/people.tsx |   |   |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |   |   |
| **20** surfaces/shared/facts.tsx | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | × | ■ |   |   |   |   |   |   |   |
| **21** surfaces/context/Work.tsx | × |   |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |   |   |
| **22** surfaces/canvas/nodes.tsx | × | × |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   | × | × |   | ■ |   |   |   |   |   |
| **23** surfaces/canvas/ExportMenu.tsx |   | × |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |   |   |
| **24** surfaces/profile/App.tsx |   |   |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   | × |   |   |   |   | ■ |   |   |   |
| **25** surfaces/zotero/App.tsx | × |   |   | × |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |   |
| **26** server/notify.ts |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | ■ |   |
| **27** server/signposting.ts |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   |   | × | ■ |

**What the matrix says about maintenance.**

- **`contract/scholarly.ts` is the only file everything touches**, and it imports nothing. It is types and small pure functions, so it changes rarely.
- **Each standard has one file that knows it**: `rocrate.ts` for RO-Crate, `datacite.ts` for DataCite, `notify.ts` for COAR Notify, `zip.ts` for the archive, `sync/scholarly.ts` for the registries' APIs, `sync/zotero.ts` for Zotero, and two server files. A new version of a standard is a change to one file. The RO-Crate versions and the run profile are constants at the top of `rocrate.ts`.
- **The core features don't know each other.** `card`, `works`, `notify`, `crate`, `library` and `profile` each depend down on the contract and on `process` and `jsonld`. `works` and `crate` use `card` for one thing: reading a unit's identifiers the same way the card does.
- **Only `crate.ts` pulls the exporters together**, so `rocrate.ts`, `datacite.ts` and `zip.ts` stay pure and are tested without a host.
- **Panels depend on the contract alone.** `facts.tsx` knows the card facts' shape and nothing about how they are computed.
- **The network stays in one module.** Core asks for a lookup through `Services`. In Obsidian the registries are reached with Obsidian's own request, because a page can't read another site's `Link` headers.

`npm run dsm` fails if a part comes to depend on one listed after it, and `npm run check-boundaries` fails if a module reaches past its allowed list.

## Not built

- A record that names a workspace, so a card can say which vault a stranger's unit came from.
- Looking every paper up at once. Each lookup is one click, by design, and a batch would be the same call in a loop.
- Review and endorsement in the interface, which the other four notification patterns need.
- A DOI for a stored graph, which would make `cite-as` exact.
- Crossref deposit, and sending a crate to Zenodo from inside the app. Both need an account and a decision about whose it is.
- Fetching a foreign crate's files. An imported output records where its bytes are and doesn't copy them.
- Roam. The card rows, the panel and the core features are shared code, so they are there, but none of this was run in Roam, and Roam has no file-menu command for importing a crate.
