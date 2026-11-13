# Changelog

## Types, templates, tables and removing things (13 November 2026)

- **Types and relations** is a new dialog. A lab adds and changes its own types on the nine kinds of unit, sets each type's abbreviation, note title and template, and says which types a relation may join. A type or relation in use can't be removed.
- **Templates.** A new note starts from its type's template, with `{title}`, `{date}`, `{author}` and `{type}` filled in. Each kind has starter headings in the words a lab notebook uses.
- **A table per type.** Each unit's note now carries its type, date, maker, run status and paper as properties, and **Open its table** makes an Obsidian Bases table over them.
- **Schema files.** The grammar is saved and read as one JSON file, by name. The official plugin's schema export is read too. Reading adds what is missing and changes nothing.
- **Removing.** A canvas can be removed by its maker, and a unit by its author. Units on a removed canvas stay.
- **First authors.** A unit brought in from a crate keeps who first made it, with their ORCID iD.
- **The comparison page was re-scored:** 56% of today's capabilities, up from 42% on 6 November, and 76% of what is on by default in both official plugins.
- **Tests:** `test/grammar.test.ts`, and `harness/grammar-test.mjs` in real Obsidian.

## Evidence crates: MIRA, files, a README and Zenodo (13 November 2026)

- **A crate speaks MIRA.** Every unit in an exported crate is also typed in the MIRA schema and carries MIRA's properties, in the one metadata graph. `core/mira.ts` is the only file that knows the schema's names.
- **A crate reads MIRA.** Importing a MATSUlab evidence bundle now gives evidence, the study that grounds it, its protocol, code, files and source, with their links. Before, it gave nine loose files. Arguments between units are read too.
- **Files travel, checked.** An output's file is packed in the crate when the base holds it and it still matches the hash on record. Files a crate names are hashed on import.
- **A README in every crate** tells each finding: what was observed, the figure, what it rests on, and how it was produced.
- **Also start a draft on Zenodo**, in the export dialog. It reserves a DOI, writes it into the crate, uploads the crate to a draft, and never publishes. Not yet tried against the real service.
- **Fixed on the way:** a run's `environment` was written without a definition; a repository cited without a file failed the validator's script check; an agent named in words got an id that wasn't one; a data file was typed as a folder.
- **Examples:** `examples/evidence-bundles/reissue.ts` re-issues the four MATSUlab bundles through the importer and exporter. `examples/disciplines/build.ts` records one real study each from biology, computer science and sociology. All seven crates pass the RO-Crate validator's required checks.
- **Tests:** `test/evidence-crate.test.ts`, and `harness/evidence-test.mjs` in real Obsidian.
- **The sandbox vault was cleared** of test leftovers with `scripts/clear-sandbox.py`.

## Unreleased (13 November 2026)

### Paper map and type colors (13 November 2026)

- **Paper map.** A new view places papers by how tied they are: links people drew between their units, and one paper citing the other. Lines say whether the links support, oppose or both. Scopes: one canvas, only you, a lab, everyone. Open it from the Library, the panel menu, or the command "Open paper map".
- **Type colors.** A new palette keeps green and red for Supports and Opposes, so evidence is blue and questions are violet. Cards carry a full-strength colored edge. Old default colors, ours and the official plugin's, now follow the palette. See `docs/color.md`.
- **Fix.** Opening a view no longer fails when another Discourse Graphs tab has not loaded yet.
- **Paper and canvas follow each other.** Picking a highlight in the reader marks its card for a moment, and the mark lets go by itself. Picking a card scrolls an open reader to its passage, marks it for a moment, and opens Context.
- **Relations show in Obsidian's own links.** Each note carries its relations as link properties ("Supports", "Supported by"), written from the records, so backlinks, the graph view and renames follow them. One-way: hand edits are put back.
- **Every unit has a note in Obsidian.** Units read from a paper used to have none; they now get one, filed under the paper's name, so their relations show in Obsidian too. A note you delete is not remade.
- **A card click keeps the keyboard.** Opening Context from a picked card no longer takes the keyboard from the canvas, so Delete and undo work straight after.
- **One name per thing.** The sidebar tab is Library, like the panel; search is "Search units" in every place; renaming a PDF canvas renames its paper.
- **Canvas sidebar.** An icon left of the canvas title opens a sidebar with three tabs: Library (every workspace with its canvases and papers, the open one marked), Search units, and Units to place. It floats over the canvas, or stays beside it when pinned. The units drawer under the canvas moved into it; the strip at the bottom now opens that tab.
- **Freehand lines** show a frame when selected, and who drew them and when. A selected relation line is drawn thicker.

- A **Cards** list on the canvas switches what every card shows: source and how it was read, authors, workspace, date and time made, identifiers. The Context panel heads with the same rows
- **Look it up** asks Crossref or DataCite, OpenAlex, PubMed and the paper's own page for a paper's identifiers, venue and retractions
- **Research crates:** export a canvas as an RO-Crate 1.3 archive or an `.eln` file, and import crates from here or from other tools
- The server gives each stored graph a FAIR Signposting landing page, and has a COAR Notify inbox. A unit can be announced to a paper's repository, after the person reads what will be sent
- **Profiles:** a person's history for themselves, their lab work for their lab, and counts alone for anyone. Initials show a card on hover and open the profile on click
- **From Zotero:** bring a reference in as a source, with the highlights chosen as units that quote their passages
- Notes on a canvas say who wrote them and when
- Removed the leftover unit-holon code and wording
- `npm run dsm` prints the dependency matrix and fails on a cycle
- **One word per object** ([docs/information-architecture.md](docs/information-architecture.md)): a workspace is a place with members, a lab is a workspace with one PI, a canvas people lay out is a "canvas", and a paper's reading is a "PDF canvas". "Node" is "unit" throughout
- **PDF canvases can be polished and hold only their paper.** Reword or retype a card, link two, take one off, or highlight in the paper's PDF to add one. A reworded card says so and keeps the model's wording. Anything not from the paper is refused and offered **Build on it**, which makes a canvas of your own with the same cards
- The canvas's **PDF** button opens the PDF most of its cards came from
- The **Boundary** panel follows the selected question, claim or evidence, and says which it is about
- The **Context** panel says each fact once, under clearer section labels. Its head shows who made the unit beside when, and the unit's own identifier, which copies on a click. Open access is a coloured mark and citations a number. A link to a canvas opens it and rings the unit's card for a moment
- The Library groups canvases by workspace, and each row shows the papers it draws on and who did most on it. A canvas in your workspace can be moved to your lab's, after naming who will see it

## 0.1.0 (demo)

The first version shared with the Discourse Graphs team.

- One core, canvas and set of panels running inside Roam and Obsidian
- Upload a paper, choosing the compute server, model and schema
- A canvas for each paper, and export to a workspace, lab canvas or folder
- Labs: join by identifier, shared canvases, a paper repository, reactions, notes and breadcrumbs
- AI mode for asking about a canvas, grounded in the units you pick
- Tidy with nine arrangements, link badges, capture and a guided walkthrough
- A reference server for compute, graph storage, labs and sync
