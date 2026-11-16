# Cards, identifiers and the scholarly record

This page covers how a unit says where it came from, and how a graph joins scholarly infrastructure: identifiers and the registries behind them, RO-Crate, the ELN file format, DataCite, Zenodo, FAIR Signposting and COAR Notify. It says what each part does, what it reads and writes, and where its code is.

For how to use these in the app, see the [user guide](guide/README.md). For the server's routes, see [services.md](services.md). For Zotero, see [zotero.md](zotero.md).

## Overview

| You want to | What does it | Where |
|---|---|---|
| See on every card what it was read from, by whom, where and when | The **Cards** list on the canvas bar | [`shared/facts.tsx`](../packages/surfaces/src/shared/facts.tsx), [`core/card.ts`](../packages/core/src/card.ts) |
| Read the same facts in the Context panel | The rows under the unit's title | The same component, at panel size |
| Find a paper's other identifiers, and whether it was retracted | **Look it up**, under Published work | [`sync/scholarly.ts`](../packages/sync/src/scholarly.ts), [`core/works.ts`](../packages/core/src/works.ts) |
| Hand a graph to Zenodo, WorkflowHub or a lab notebook | **Export**, then **A research crate** | [`core/rocrate.ts`](../packages/core/src/rocrate.ts), [`core/crate.ts`](../packages/core/src/crate.ts) |
| Read a Workflow Run crate, an `.eln` file or a MIRA evidence bundle | **Import this research crate** | [`core/crate.ts`](../packages/core/src/crate.ts), [`core/mira.ts`](../packages/core/src/mira.ts) |
| Put a crate on Zenodo as a draft with a reserved DOI | **Also start a draft on Zenodo**, in the export dialog | [`core/zenodo.ts`](../packages/core/src/zenodo.ts), [`sync/zenodo.ts`](../packages/sync/src/zenodo.ts) |
| Mark a unit as checked | **Checked** or **Needs work**, in the Context panel | [`core/checks.ts`](../packages/core/src/checks.ts) |
| Tell a paper's repository that a unit was read from it | **Announce**, under Published work | [`core/notify.ts`](../packages/core/src/notify.ts) |
| Serve a stored graph so machines can follow it | The server's landing pages | [`server/signposting.ts`](../server/src/signposting.ts), [`server/notify.ts`](../server/src/notify.ts) |

## The shared vocabulary

[`packages/contract/src/scholarly.ts`](../packages/contract/src/scholarly.ts) holds the types everything else shares. Adding a scheme, a card fact or a notification pattern means adding a row in this file. No other file has a second copy of these lists.

### Identifiers

An identifier is `{ scheme, value }`, always stored in its bare form.

| Scheme | Bare form | Also read from | Opens at |
|---|---|---|---|
| `doi` | `10.1234/abc`, lower case | `doi:…`, `https://doi.org/…`, `https://dx.doi.org/…` | `https://doi.org/…` |
| `pmid` | Digits | `pmid:…`, a `pubmed.ncbi.nlm.nih.gov` link. Bare digits only when the scheme is named | PubMed |
| `pmcid` | `PMC123`, upper case | `pmcid:…`, a PubMed Central article link | PubMed Central |
| `arxiv` | `2101.01234` or `hep-th/9901001`, with an optional `v2` | `arxiv:…`, an `arxiv.org/abs` or `/pdf` link, a `10.48550/arxiv.…` DOI | arXiv |
| `openalex` | `W123…` (also `A`, `S`, `I`, `C`), upper case | `openalex:…`, an `openalex.org` link | OpenAlex |
| `orcid` | `0000-0000-0000-000X` | `orcid:…`, an `orcid.org` link | ORCID |
| `ror` | Nine characters starting with `0` | `ror:…`, a `ror.org` link | ROR |
| `swhid` | `swh:1:(cnt\|dir\|rev\|rel\|snp):<40 hex>`, with optional qualifiers | — | Software Heritage |
| `isbn` | 10 or 13 digits, no hyphens | `isbn:…`, `isbn-13:…` | Nowhere |
| `rrid` | `AB_123456` | `RRID:…` | The SciCrunch resolver |
| `citekey` | A citation key, read only when the scheme is named | `@key` | Nowhere |
| `zotero` | `users/<id>/items/<key>` or `groups/<id>/items/<key>` | A `zotero.org` link, a `zotero://select/` link | `zotero://select/…` |
| `at` | An `at://` address | — | Nowhere |
| `cid` | A content hash starting `bafy` or `bafk` | — | Nowhere |
| `url` | An `http` or `https` link | — | Itself |

- `parseIdentifier` reads any of these forms. With no scheme named it tries them in a fixed order, so a `doi.org` link reads as a DOI before it reads as a link.
- `identifierUrl` gives where one opens. `identifierCurie` gives its short written form, such as `doi:10.1234/abc` or `RRID:AB_123456`.
- `normalDoi` and `sameDoi` compare DOIs without regard to case or prefix. Every DOI comparison in the core uses them.
- `mergeIdentifiers` joins lists, drops repeats and sorts by scheme in the order above.

A citation key and a Zotero item address are locators: ways to find something again. They never decide that two things are the same work.

### Is this the same work?

[`core/work.ts`](../packages/core/src/work.ts) is the one resolver. It is used wherever a paper, a Source unit, a Zotero item or a PDF file are compared.

1. A shared identifier decides first.
2. Then the hash of the PDF's bytes. A reading stores the hash of the PDF it read (`fileCid`).
3. Then the file's name.
4. A title joins two things only when neither has an identifier.

Two different DOIs are never the same work.

### Other shared types

- **A published work.** `WorkMetadata` is one work joined from every registry, with `from` saying which registry each field came from. `WorkStanding` is the part a record keeps.
- **Signposts.** What a landing page says about itself in its `Link` headers.
- **Card facts.** `CARD_FIELDS`, in the order they are always shown.
- **Notifications.** The five COAR Notify patterns and the shape of a notification.
- **Library types.** `LibraryItem`, `LibraryAnnotation`, `LibraryFile` and `PaperShelf`, used by [Zotero](zotero.md).

## What a card shows

Every unit has five facts beyond its title. A card shows the ones switched on in the **Cards** list. The Context panel always shows all five.

| Fact | On the card | Comes from |
|---|---|---|
| Source | The paper or PDF in a few words ("Carroll 2020"), then **Auto**, **By hand** or **Imported** | The paper record, or the source unit a highlight names. Auto means a model read it. By hand means a person highlighted or wrote it. Imported means it arrived in a file |
| Authors | The paper's authors. For a unit that was not read from a paper, whoever made it, labelled "Made by" | The paper's `authors`, the unit's `facts.creators`, or the unit's own author |
| Workspace | Where it was first written: yours, your lab's, or "Another workspace" | The record's `space` |
| Date made | The day and time the unit was first written | The record's `at` |
| Identifiers | The unit's own identifiers, then its paper's, DOI first | `facts.doi`, `facts.identifiers`, the paper's `doi` and `identifiers` |

- **One function computes the facts** ([`cardFacts`](../packages/core/src/card.ts)) and **one component draws them** ([`Facts`](../packages/surfaces/src/shared/facts.tsx)). The card and the panel differ only in a size attribute.
- **The choice is per device**, kept in `Prefs.cardFields`. Only Source is on by default.
- **A click on a card only selects it.** The source and identifier links act once the card is selected. Before that they are plain text.
- **Cards grow when they show more.** Nothing is moved. If cards then cover each other, the bar says how many and offers Tidy. The same check runs when a canvas opens.
- **A retraction shows on the card**, beside the source, once a registry has reported one.
- **The unit's own id** (`did…#key`) is shown in the Context panel. It never changes. A click copies it. Each other identifier has a copy button that copies its `https` address.
- **An imported unit keeps who first made it**, with their ORCID iD, in `facts.creators`. The card names them.

A record carries the id of the space it was written in, not its name. So a workspace that is not yours or your lab's shows as "Another workspace".

## Looking a work up

**Look it up** asks the open registries about the paper behind a unit. Nothing is asked until the button is pressed. Only the paper's identifiers are sent, or its title when it has no DOI, PMID or OpenAlex id. No key, email address or other header about the person is set.

| Registry | Address | Asked when | Gives |
|---|---|---|---|
| doi.org | `doi.org/doiRA/<doi>` | There is a DOI | Which agency registered it, which decides who is asked next |
| Crossref | `api.crossref.org/works/<doi>`, or `works?query.bibliographic=<title>&rows=3` | It registered the DOI, or there is only a title | Title, authors with ORCID iDs, journal, date, volume, pages, license, references, retractions and corrections |
| DataCite | `api.datacite.org/dois/<doi>` | It registered the DOI (arXiv, Zenodo, most datasets and software) | The same for its own records, plus versions of the work |
| OpenAlex | `api.openalex.org/works/<id>` | There is a DOI, PMID or OpenAlex id | PMID and PMCID, open access status, times cited, topics, retraction, and ORCID iDs and ROR ids the registry lacks |
| PubMed | The PMC id converter, then `eutils.ncbi.nlm.nih.gov` `esummary` | There is a PMID, or the converter finds one for the DOI | Journal, date, and retraction or correction notices |
| The paper's own page | The page the DOI or link leads to | There is a DOI or link | Its FAIR Signposting links, and the inbox it takes announcements at |

**How answers are joined.** The agency that registered the DOI is the record of truth for the title, authors, venue and date. OpenAlex fills in what registries do not hold. A work is retracted if any one of them says so.

**Failures.** Each service has eight seconds. One failing never fails the lookup. The panel lists who answered and who did not.

**What is kept.** A paper record gains `identifiers`, `published`, `venue`, `people` (authors with ORCID iDs and affiliations) and `standing` (retraction, open access, times cited, the registering agency, the inbox). Its own title and authors are never overwritten. A cited source that has no paper record keeps the same in its own facts, and only when the unit is yours. What a registry last said is left out of a unit's version hash, so a lookup never makes a pinned version look out of date.

**Adding a registry** means adding one resolver and one row in the precedence table, both in [`sync/scholarly.ts`](../packages/sync/src/scholarly.ts).

**In Obsidian** the registries are reached with Obsidian's own request, because a page cannot read another site's `Link` headers.

## Research crates

**Export**, then **A research crate**, packs a canvas into one archive. It follows [RO-Crate 1.3](https://w3id.org/ro/crate/1.3), and its runs are described as a [Process Run Crate 0.6](https://w3id.org/ro/wfrun/process/0.6). The file is named `<canvas>.crate.zip`. It is saved in the base. Exporting sends nothing.

### What is in the archive

| File | What it is |
|---|---|
| `ro-crate-metadata.json` | The description of everything below, as JSON-LD. Every unit is described in schema.org's terms and in the MIRA schema's, in one graph |
| `README.md` | The crate told as findings: what was observed, the figure and files each finding rests on, the run that made them, the protocol it followed, the code it ran, and who checked it |
| `ro-crate-preview.html` | The metadata as a page a person can read |
| `discourse-graph.jsonld` | The graph as PROV-O, the same export the process ontology checks |
| `dg-records.jsonl` | The graph as Discourse Graphs records, one per line, so importing the crate restores it exactly |
| `<canvas>.canvas` | Where each card sits, as a JSON Canvas |
| `datacite.json` | The crate described in DataCite's schema, for a repository that will mint its DOI |
| `outputs/*` | Each output's own file, when the base holds it. On unless unticked. A second file of the same name is written `2-<name>` |
| `papers/*.pdf` | The papers. Only when the box is ticked |

Units that the chosen ones rest on come along: a run's code and outputs, the protocol it followed, the source of a piece of evidence.

**An output's file is checked before it is packed.** The output's record holds a hash of its bytes. If the file in the base no longer hashes to that, it is left out and the export says how many were. Outputs that live inside a notebook cell are described but not packed as files.

**Every payload file is listed with its size and SHA-256.**

**License.** The export dialog offers CC BY 4.0, CC0 1.0, CC BY-SA 4.0, CC BY-NC 4.0 and CC BY-NC-SA 4.0. With none picked, the crate says in words that none has been chosen. It never assumes one.

### How units are described

| Unit | In the crate | Notes |
|---|---|---|
| Question | `Question` | Listed in the root's `about` |
| Claim | `Claim` | |
| Evidence | `CreativeWork` and `Evidence` | `Evidence` is a term the crate defines itself |
| Source | `ScholarlyArticle` or `CreativeWork` | Its `@id` is the DOI link. Cited from the root |
| A paper | `ScholarlyArticle` | Authors as `Person` with ORCID `@id`s, affiliations with ROR ids, identifiers as `PropertyValue`, `Retracted` when a registry says so |
| Protocol | `HowTo` | Steps as `HowToStep` |
| Study | `CreativeWork` and `Study` | |
| Run | `CreateAction` | `instrument` is the code, `object` is what it used and its parameter values, `result` is its outputs, with `agent`, `startTime`, `endTime` and `actionStatus` |
| Code, one file | `File` and `SoftwareSourceCode` | Its `@id` is the file's own address at the commit that ran. On GitHub that is the raw file, and `url` is the page a person reads |
| Code, a whole repository | `SoftwareApplication` | Repository as `url`, commit as `version`, or "unknown" when none is on record |
| Output | `File` when the crate holds or links its bytes, otherwise `ImageObject`, `Dataset` or `MediaObject` | Size, type and content hash |
| A check | `Review` of its unit | See [Sign-off](#sign-off) |
| Supports, Opposes, Addresses, Informs | Properties of the same names | Defined in the crate |

- Each unit carries its own id as its first `identifier`. Its `@id` is its AT address.
- A unit's own text is carried as `text`.
- A unit with `facts.creators` gives them as `creator` and the person who imported it as `contributor`. Otherwise `creator` is the unit's author.
- Where a property has one value it is written as one value, not a list.
- Terms that schema.org lacks are each defined in the crate with a name and a sentence, and listed in one `DefinedTermSet`.
- Sources with the same DOI share one entity. Authors with the same name share one `Person`.

### The same units in MIRA's terms

[`core/mira.ts`](../packages/core/src/mira.ts) is the only file that knows the MIRA schema's names. Each unit is also typed as its MIRA class and carries MIRA's properties beside the schema.org ones.

| Unit | MIRA class | MIRA properties written |
|---|---|---|
| Question, Claim | `mira:Question`, `mira:Claim` | `mira:addresses`, `mira:supports`, `mira:opposes` |
| Evidence | `mira:Evidence` | `mira:observationStatement` (its title), `mira:observationBase`, `mira:is_grounded_in`, `mira:sourceDocument`, `mira:supports`, `mira:opposes` |
| Run | `mira:Study` | `mira:follows`, `mira:grounds` |
| Protocol | `mira:Protocol` | |
| Source, paper | `mira:SourceDocument` | `mira:describesActivity` |

A run is what MIRA calls a study: the activity that grounds evidence. A Study unit, which is the design, has no MIRA class and stays a Discourse Graphs term.

### The lab-notebook form

Choosing `.eln` writes the crate in [the ELN file format](https://github.com/TheELNConsortium/TheELNFileFormat), version 1.2+20260923, on RO-Crate 1.2. The file is `<canvas>.eln` with the media type `application/vnd.eln+zip`. The format's version has two addresses in use, so the file names both.

A notebook imports only what the crate's root lists, so the file is laid out as entries, each a folder with its own files:

| Entry | From | What a notebook gets |
|---|---|---|
| An experiment | Each run | Its title; a body with the study, the protocol followed, departures, what was observed and its outputs; its parameters as fields; the files it made; each sign-off as a comment |
| A protocol | Each protocol | Its materials, steps and text, with the genre `protocol` |
| A resource | The graph itself | The README as its body, with the graph, its records, the canvas and every file no run made, under `discourse-graph/` |

An entry has no `description` and no `about`, because eLabFTW appends the first to the body and reads the second as a category.

### Reading a crate

**Import this research crate** reads RO-Crate 1.0 to 1.3 as a zip, an `.eln` file, a folder in the base, or a bare `ro-crate-metadata.json`. A bare `evidence.jsonld` can also be imported on its own.

**A crate this app made** is restored from `dg-records.jsonl`: the same units under their own authors, the same canvas, and nothing new when read twice.

**Anyone else's crate** becomes units:

| In the crate | Becomes | Keeps |
|---|---|---|
| `CreateAction` | Run | Status, times, who ran it, parameter values, and links to its code, inputs and outputs |
| `SoftwareSourceCode`, `SoftwareApplication`, `ComputationalWorkflow` | Code | Repository, version, language, license |
| `File`, `Dataset`, `ImageObject` in the root's `hasPart` | Output | Type, size, where its bytes are, and which run made it |
| `ScholarlyArticle`, or anything the root cites | Source | DOI and other identifiers |
| `HowTo` | Protocol | Version and steps |
| `Question`, `Claim` | Question, Claim | |
| `mira:Evidence`, or `Evidence` | Evidence | What was observed as its title, the outputs it rests on (pinned by hash when the files could be read), the run that grounds it, the document it was read from |
| `mira:Study` | Run | Times, who ran it, the protocol it followed, code as its instrument, everything else it used |
| `mira:Protocol` | Protocol | Its description, as the unit's text |
| `mira:SourceDocument` | Source | Its link, and the runs it describes |
| `supports`, `opposes`, `addresses`, `informs`, in either vocabulary | Relations | Between units that both came in |

- **Units get new ids.** Each keeps the entity's `@id` in `facts.sameAs`, its other identifiers in `facts.identifiers`, and its first makers in `facts.creators`. Sources and Code keep no creators.
- **They are marked Imported**, and arrive on a new canvas named for the crate, laid out four to a row.
- **Reading the same crate again**, with nothing new in it, opens that canvas instead of making another.
- **A MIRA evidence bundle** keeps its argument in `evidence.jsonld` beside the crate's metadata. Any JSON-LD file beside the metadata that is written in MIRA's context is read as part of the same graph, joined on `@id`.
- **Files are hashed on the way in.** When the crate is a folder in the base, or a zip, each file it names is read and hashed. The output gets that hash and its size, and evidence that rests on it pins the hash. From a folder, the output also remembers where the file sits, so a later export packs it. From a zip, the bytes are hashed and not copied into the base.
- **Packaging is not a result.** In a crate that holds evidence, Markdown and JSON-LD files that nothing rests on (a README, a methods note, the metadata itself) do not become outputs.
- **A named input with no file**, such as raw data held back, becomes an output with no bytes, so the run still says what it used.
- **A large crate is cut at 300 entities.** Runs and what they name are kept first, and the import says how many files it left out.

**Reading a notebook's file.** An entry becomes a Run, or a Protocol when its genre says protocol, procedure, template or method. Its files become Outputs of that run, hashed from the archive. Its body is kept as the unit's text, with HTML reduced to plain words. A resource, sample or instrument has no kind of unit here, so it is left out and counted. The action that only records how the file was written is left out too.

## Sign-off

A person marks a unit as **checked**, or as **needs work**, from the Context panel, and says how they checked it: read it, read the source, checked the quote, reanalysed the data, or repeated it. [`core/checks.ts`](../packages/core/src/checks.ts) holds it.

- **The mark is pinned to the unit as it stood.** It is an evaluation record with a hash of the unit's title, type, links and facts. Once any of those change, the mark reads as made on an earlier version, on the card and in the panel.
- **The author marking their own unit is a signature. Anyone else is a second pair of eyes.** The panel words the two differently.
- **One standing mark per person per unit.** A new one replaces that person's last. Only its maker can take a mark back.
- **"Needs work" needs a reason,** and outweighs a check made on the same version.
- **It travels.** A crate carries each mark as a `Review` of its unit. The README names who checked each finding. A notebook file carries a run's marks as comments. A unit's note carries `dg-checked`, so a table can filter by it. In a lab, checks on shared units are sent to labmates.

## Sending a crate to Zenodo

**Also start a draft on Zenodo**, in the export dialog, does three things in order:

1. Opens a draft with `POST /api/deposit/depositions`, carrying the crate's title, description, creators, date, license, keywords and related identifiers, with `prereserve_doi` set. Zenodo reserves a DOI for the draft.
2. Packs the crate with that DOI written in as its own identifier: in the metadata, in `datacite.json` and in the README's citation line. The crate is saved in the base first, so nothing is lost if the upload fails.
3. Uploads the archive to the draft's bucket with `PUT`.

**It never publishes.** Publishing registers the DOI for good, so that step stays with the person, on Zenodo. The code has no publish call. The dialog shows the draft's link and the reserved DOI, and lists the last ten drafts.

**What the form says.** The upload type is `dataset` and access is `open`. Names are written "Family, Given". Keywords are the crate's subjects plus `RO-Crate` and `MIRA`. A license is named only when one of the five offered was picked.

**The token.** The person pastes a Zenodo token once. It is kept where the base keeps secrets and is never sent back to a panel, which sees only its last four characters. The dialog asks for a token with only the `deposit:write` scope, which can add drafts and cannot publish. Zenodo's sandbox (`sandbox.zenodo.org`) has its own token and its own tick box.

**Errors.** A refused token (401), a token without the scope (403), a failed upload after a draft was opened, and Zenodo being unreachable each have their own message. After a failed upload the draft exists and the saved crate can be added to it by hand.

## DataCite and Crossref

Both are read on lookup, chosen by who registered the DOI. Going the other way, `datacite.json` in a crate is ready for a repository to register: creators with ORCID iDs, the license, and related identifiers that tie the new DOI to what the graph rests on.

| The crate | Relation | To |
|---|---|---|
| Was read from a paper | `IsDerivedFrom` | The paper's DOI |
| Cites a source | `References` | Its DOI, PMID or arXiv id |
| Ran code | `Requires` | Its SWHID or repository |

A crate's DOI is expected to come from a repository such as Zenodo, which registers with DataCite.

## FAIR Signposting

**Read.** A lookup follows the paper's DOI to its landing page and reads the `Link` headers: `cite-as`, `describedby`, `item`, `license`, `type`, `author`, `linkset`, and the Linked Data Notifications inbox. A linkset, when there is one, is fetched and folded in.

**Served.** Every paper in the reference server's graph store has a landing page at `/works/<doi>` with those headers, plus `graph.json`, `ro-crate-metadata.json` (a detached RO-Crate) and `linkset.json`. The graph is served as the base holds it, with unit ids. [services.md](services.md#landing-pages-and-signposting) has the routes.

A stored graph has no identifier of its own, so `cite-as` on its page gives the paper's DOI, which resolves to the publisher and not back to the page.

## COAR Notify

**Sent.** When a paper's page advertises an inbox, **Announce this unit to the paper's repository** builds an Announce Relationship notification: this unit, `prov:wasDerivedFrom`, that paper. The unit is named by its own id. The panel shows where it will go and the exact JSON. It is sent only when **Send** is pressed, and what is sent is what was shown, under the same id. Replies go to the lab server's inbox, so announcing needs a lab. With no lookup yet, or no inbox on the paper's page, the panel says which.

**Other patterns.** `buildNotification` also makes Announce Review, Announce Endorsement, Request Review and Request Endorsement. The panel offers only Announce Relationship.

**Received.** The reference server has an inbox at `/v1/notify/inbox`, advertised from `/` and from every landing page. The Context panel lists what the lab's server has been told about a unit or its paper. The reference inbox checks a notification's shape and does not check who sent it, so the panel words these as what someone said.

## What leaves the device

[what-leaves-the-device.md](what-leaves-the-device.md) is the full account. For what this page covers:

- **Look it up** sends the paper's identifiers to doi.org, Crossref or DataCite, OpenAlex, PubMed and the paper's own page. The title goes to Crossref only when the paper has no identifier a registry knows.
- **Exporting or importing a crate** sends nothing. **Also start a draft on Zenodo** sends the crate's description, the archive and the token to Zenodo.
- **Announcing a unit** sends the person's name and id, the lab server's address, the unit's id and the paper's DOI to the inbox the paper's page names.
- **In a lab,** the Context panel asks the lab's server what it has been told about the unit and its paper.

## How the parts depend on each other

`npm run dsm` prints two design structure matrices from the real imports: one for the modules, one for the files behind this page. It fails if a part comes to depend on one listed after it. `npm run check-boundaries` fails if a module reaches past its allowed list.

The module matrix. A mark in a row means that row depends on that column.

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **1** contract | ■ |   |   |   |   |   |   |   |   |   |
| **2** layout | × | ■ |   |   |   |   |   |   |   |   |
| **3** core | × |   | ■ |   |   |   |   |   |   |   |
| **4** sync | × |   |   | ■ |   |   |   |   |   |   |
| **5** native | × |   |   |   | ■ |   |   |   |   |   |
| **6** surfaces | × | × |   |   |   | ■ |   |   |   |   |
| **7** obsidian | × |   | × | × | × |   | ■ |   |   |   |
| **8** roam | × |   | × | × | × |   |   | ■ |   |   |
| **9** local | × |   | × | × |   |   |   |   | ■ |   |
| **10** server |   |   |   |   |   |   |   |   |   | ■ |

What holds for the files behind this page:

- **`contract/scholarly.ts` is the file everything shares.** It is types and small pure functions.
- **Each standard has one file that knows it.**

  | Standard | File |
  |---|---|
  | RO-Crate, Process Run Crate, the ELN file format | `core/rocrate.ts`. The versions are constants at its top |
  | MIRA | `core/mira.ts` |
  | DataCite | `core/datacite.ts` |
  | Zenodo's form and its deposit API | `core/zenodo.ts`, `sync/zenodo.ts` |
  | COAR Notify | `core/notify.ts`, `server/notify.ts` |
  | The zip archive | `core/zip.ts` |
  | The registries' APIs | `sync/scholarly.ts` |
  | Zotero's API | `sync/zotero.ts` |
  | FAIR Signposting, served | `server/signposting.ts` |

- **The core features do not know each other.** `card`, `works`, `notify`, `crate`, `library` and `profile` each depend down on the contract and on `process` and `jsonld`. `works` and `crate` use `card` to read a unit's identifiers the same way the card does.
- **Only `crate.ts` pulls the exporters together**, so `rocrate.ts`, `datacite.ts`, `zenodo.ts`, `mira.ts` and `zip.ts` stay pure and are tested without a host.
- **Panels depend on the contract alone.**
- **The network stays in `packages/sync`.** Core asks for a lookup, a deposit or a send through `Services`.
- **The server shares a wire format with the plugins, not code.** It builds its own minimal RO-Crate for a stored extraction and has its own DOI normalising. Both are covered by the server's tests.

## Tests

| What | Where | Run |
|---|---|---|
| Identifiers, lookups, crates, MIRA, DataCite, Zenodo's form, notifications, sign-off | `test/*.test.ts` | `npm test` |
| An `.eln` file walked the way eLabFTW's importer reads it, and two real exports read in | `test/eln.test.ts`, [`test/fixtures/eln`](../test/fixtures/eln/README.md) | `npm test` |
| Landing pages, the linkset and the inbox | `server/` | `npm run test:server` |
| Three discipline examples as crates | [`examples/disciplines`](../examples/disciplines/README.md) | `node examples/disciplines/build.ts` |
| Four published evidence bundles read and exported again | [`examples/evidence-bundles`](../examples/evidence-bundles/README.md) | `node examples/evidence-bundles/reissue.ts` |

The crates from both examples pass every required check of the community [rocrate-validator](https://github.com/crs4/rocrate-validator) for RO-Crate 1.3. The `.eln` files pass the ELN Consortium's own checker at the required level. The validator does not know Process Run Crate 0.6, so that profile is covered by the unit tests alone.

## Limits

**Not run against the real service**

- **Zenodo.** The deposit calls are tested against a stand-in that answers as Zenodo's documented API does. No draft has been made on Zenodo or its sandbox.
- **Lab notebooks.** An `.eln` file has not been opened in a running eLabFTW or RSpace.
- **Repository inboxes.** No real repository has been sent a notification.
- **Roam.** The card rows, the panel and the core features are shared code, but none of this page has been run in Roam, and Roam has no command for importing a crate.

**Identity**

- **Nothing resolves from outside.** A person's DID is computed on the device and never registered. No record is published. The server has pages for papers only, so a unit or a canvas has no address anyone else can open.
- **The `@id` in JSON-LD and in a crate is the unit's AT address**, which includes its type, so it changes when a unit is retyped. A crate carries the unit's own id beside it. The JSON-LD view does not.
- **One work can be two Source units.** A Zotero Source and a reading's own Source are recognised as the same paper wherever they are compared, but they stay two units, and a relation drawn to one is not on the other.
- **Two different hashes are both called `cid`.** A pin holds one kind and AT conversion computes another.
- **The id written in a note is not always the unit id.** Obsidian keeps a legacy id if one is there. Roam writes `dg-id` and never reads it.
- **A unit id is not checked to start with a DID.**
- **A person has a different DID in each vault.**

**Round trips**

- **To AT records:** paper records are not converted, and a unit loses its paper link, its passage and its identifiers.
- **From AT records:** only title, date and type are kept. The author's name becomes the DID.
- **JSON-LD** leaves out untyped units, identifiers, authors and the paper link.
- **A crate this app made** leaves out person records (so ORCID iDs held there), labs and comments.
- **Someone else's crate:** profiles and search go by the importing person, not `facts.creators`.

**Reading identifiers**

- arXiv versions (`v1`, `v2`) count as different works.
- Not recognised: `www.doi.org`, a percent-encoded DOI, `PMID 123`, old PubMed links, an OpenAlex works link. ORCID checksums are not checked.
- PubMed's id converter only knows papers in PubMed Central, so a paper with a PMID and no PMCID gets its PMID from OpenAlex or not at all.
- Some publishers refuse to let a program read their landing page, so those papers have no signposts.
- ORCID iDs and ROR ids arrive with a lookup and are not shown on a card, where authors are names.

**Crates**

- A zipped crate's files are hashed on import and not copied into the base.
- Each Zenodo export starts a new draft. An existing draft is not updated.
- Each lookup is one paper. There is no batch lookup.

## Not built

A record that names a workspace, DOIs and pages for units and stored graphs, review and endorsement in the interface, asking a named person for a check, Crossref deposit, and publishing or updating a Zenodo draft are not built. See [ROADMAP.md](../ROADMAP.md).
