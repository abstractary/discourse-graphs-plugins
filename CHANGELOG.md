# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Canvas**

- A map of the canvas, bottom right, with a frame for the part in view. **Map** hides it, and the choice is kept on the device.
- Picking a card keeps its links and neighbours bright and dims the rest.
- A sidebar with three tabs: Library, Search units, and Units to place. It floats over the canvas or stays beside it when pinned.
- A **Cards** list that sets what every card shows: source and how it was read, authors, workspace, date and identifiers.
- A selected card lists its unit's relations and brings in the ones not on the canvas, with their links.
- Pictures as evidence: a dropped or pasted picture becomes an Output pinned by a hash of its bytes, and **Say what it shows** makes Evidence that rests on it.
- Rename a unit from its card, delete a link, copy and paste, and undo and redo for every edit.
- Remove a canvas you made, or a unit you wrote.
- Freehand lines show a frame when selected, and who drew them and when.
- A **PDF** button that opens the PDF most of a canvas's cards came from.
- Canvas actions as Obsidian commands, and dialogs as Obsidian modals.

**Reading and papers**

- A PDF reader beside the canvas. A selected passage becomes a unit that keeps its exact words and page.
- **Extract graph**, which reads a whole paper from a saved extraction beside it or on a server you pick.
- PDF canvases, which hold only their paper and can be reworded, retyped and linked. **Build on it** makes a canvas of your own with the same cards.
- A paper tag on each card, and "Elsewhere" in Context, listing units in other papers that say something close.
- A paper map that places papers by the links people drew between their units and by citations, at four scopes.
- The reader and the canvas follow each other: picking a highlight marks its card, and picking a card scrolls to its passage.

**Grammar**

- A **Types and relations** dialog: a lab's own types on the nine kinds of unit, each with an abbreviation, note title, template and candidate tag, and the types each relation may join.
- Note templates with `{title}`, `{date}`, `{author}` and `{type}`, and starter headings for each kind.
- A table per type, built with Obsidian Bases over properties each note carries.
- The grammar saved and read as one JSON file. The official plugin's schema export is read too.
- Candidate tags: tagged lines are listed in Search and become units there.

**Method and checks**

- Study, protocol, run, code and output units, with a page for each run.
- Reading a Jupyter notebook into code, a run and its outputs.
- Sign-off: a unit marked as checked or as needing work, pinned to a hash of the unit as it stood.

**Search**

- A search panel over titles, passages and notes, with filters by type and credit, four orders, and found words marked.
- A quick finder that opens a unit, puts it on the canvas, or links it at the cursor.

**Labs, identity and sync**

- Invitations: a one-line invitation, good once for a week by default.
- Lab settings that members inherit: the lab's shelf of papers, its model servers and first choice, and its reach.
- One grammar per lab, changed only by the PI.
- Removing a member, which revokes their tokens and puts the lab's shared work away on their device.
- Signed records, checked on arrival. A record names the key that signed it.
- A key per device. A new device is let in from one already trusted, and a lost one is removed the same way.
- Shelves: a paper is on the lab's shelf, in your own library, or in a labmate's.
- Reach: how far a lab's work may travel to a model, for reading papers and for questions.
- Clock correction from the lab server's time.
- Removals, checks and a unit's source now reach labmates.
- Profiles: your whole history for you, your lab work for your lab, and counts alone for anyone else.
- Moving a canvas from your workspace to your lab's.

**AI and agents**

- Ask AI with your own key: Anthropic, OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio) and Gemini, from the device or through the lab's server.
- Keys kept in Obsidian's keychain where there is one.
- An MCP server with six read-only tools: `dg_search`, `dg_unit`, `dg_argument`, `dg_canvas`, `dg_paper` and `dg_grammar`.
- The `agent` role for a device key. What it signs is only ever a proposal.
- A review list for proposals at the top of the Search panel, with accept and turn down for one or a whole conversation.

**Zotero**

- **From Zotero:** bring a reference in as a source, with chosen highlights as units that quote their passages.
- A setting that makes Zotero the PDF library. Its PDFs are read where Zotero keeps them, and nothing is written to Zotero.
- A count in the reader of Zotero highlights that are not units yet.

**The scholarly record**

- **Look it up:** a paper's identifiers, venue and retractions from Crossref or DataCite, OpenAlex, PubMed and the paper's own page.
- Research crates: export a canvas as an RO-Crate 1.3 archive or an `.eln` file, and import crates from here or from other tools.
- Crates carry MIRA types, packed files checked against their hashes, and a README that tells each finding.
- Reading MIRA evidence bundles, and `.eln` exports from eLabFTW, RSpace, Kadi4Mat and PASTA.
- A Zenodo draft from the export dialog, with a reserved DOI. It is never published from the app.
- FAIR Signposting landing pages and a COAR Notify inbox on the server, and announcing a unit to a paper's repository.
- A unit brought in from a crate keeps who first made it, with their ORCID iD.

**Obsidian**

- Relations written into each note as link properties, so backlinks, the graph view and renames follow them.
- A note for every unit, including units read from a paper.
- Search, Context, Library and Boundary each keep a tab in the right sidebar, and **Put the side panels back** restores them.

**Project**

- A local app that shows the same panels in a browser over a vault's record log.
- A simulation of four people and their devices around one lab server (`npm run sim`).
- `npm run dsm`, which prints the dependency matrix and fails on a cycle.
- `npm run check:routes`, which fails when the generated route and wire files are stale.
- Worked examples from biology, computer science and sociology, and re-issued MATSUlab evidence bundles.

### Changed

- A panel that cannot load says so and offers **Try again**. A thing that was removed says it is gone.
- Buttons that failed silently now report the failure. A change that is not yours to make says who can make it.
- Type colors follow one palette that keeps green and red for Supports and Opposes. Old default colors are mapped to it.
- One word for each object across the interface: workspace, lab, canvas, PDF canvas, unit, Library, Search units.
- The Context panel says each fact once, and its head shows who made the unit, when, and its identifier.
- The Library groups canvases by workspace and is the same panel in the right sidebar and the canvas sidebar.
- The Boundary panel follows the selected question, claim or evidence.
- A version beats what it replaces, and of two made apart the later stands.
- On a canvas, an edit made apart from a removal stands. For memberships and devices, the removal stands.
- A lab's reach defaults to the lab.
- A personal Zotero library's address works only for its owner. A group library's works for every member.
- The `.eln` file is built around entries: each run an experiment, each protocol a protocol.
- Calls follow one scheme: a read is `get` or `list`, a decision is `accept` or `reject`, and the subject is `id`. Units are reached through `unit.*` and the overview through `overview.*`.
- A canvas names what it is tied to in `whole`. Logs that say `holon` are still read.
- Every server route is declared once in `packages/contract/src/routes.ts`, and every shape that crosses to the server in `packages/contract/src/wire.ts`.
- The core's features each live in their own file and share one shape. The Obsidian plugin is eight files.
- A failure keeps its kind from the base through the core to the panel.
- In Obsidian, a tab saved as the Overview, or a hotkey bound to opening it, needs opening or binding again.
- The walkthrough covers invitations, the lab's shelf, signed work and reading a PDF.

### Fixed

- Tidy works on PDF canvases for every arrangement, and old headings no longer come back.
- A type is listed once in the search filter and the canvas drawer, however many copies the vault holds.
- Hints inside the canvas's export and related menus are no longer drawn as sticky notes.
- Opening a view no longer fails when another Discourse Graphs tab has not loaded.
- Opening Context from a picked card no longer takes the keyboard from the canvas.
- A card whose unit was removed is not shown, and removing a unit removes the lines drawn to it.
- A log that a file-sync tool has damaged still loads. Bad lines are skipped.
- Obsidian keeps its device id and its link to a lab on the device, not in the data file that travels with the vault.
- The local app keeps its device id and settings outside the vault.
- A revised record no longer carries the old signature's key name.
- The server tells two copies of a record apart by content, however the keys are ordered.
- The server refuses anything that does not have a record's shape, and the core checks what a lab sends before reading it.
- The core refuses a base that speaks another version of the host contract.
- A member accepted before the lab's record arrives is joined when it does.
- A labmate's record that arrives before their own person record is held and checked.
- A personal Zotero library, whose id is 0, is no longer read as "no library".
- In crates: prefixed keys are spelled out in the context, a run's `environment` has a definition, and a data file is no longer typed as a folder.
- The boundary check reads imports in either quote style, so it covers the server.

### Removed

- The units drawer under the canvas. Its contents are the sidebar's Units tab.
- The separate canvas list in the canvas sidebar.

## [0.1.0] - 2026-11-06

The first version.

### Added

- One core, one canvas and one set of panels running inside Roam and Obsidian, behind one host contract.
- Uploading a paper, with a choice of compute server, model and schema.
- A canvas for each paper, and export to a workspace, a lab canvas or a folder.
- Labs: joining by identifier, shared canvases, a paper repository, reactions, notes and breadcrumbs.
- AI mode for asking about a canvas, grounded in the units you pick.
- Tidy with nine arrangements, link badges, capture from selected text and a guided walkthrough.
- A reference server for compute, graph storage, labs and sync.

[Unreleased]: https://github.com/abstractary/discourse-graphs-plugins/compare/main...HEAD
