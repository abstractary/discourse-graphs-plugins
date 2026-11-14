# Changelog

## Refactor and tracking (13 November 2026)

Nothing a person sees changed, apart from four fixes.

- **Fixed: values meant for one device no longer travel with a synced vault.** In Obsidian the link to a lab and the device's id are kept on the device, and moved there from the plugin's data file.
- **Fixed: a revised record no longer carries the old signature's key name.**
- **Fixed: the server tells two copies of a record apart by content, however the keys are ordered.**
- **Fixed: the boundary check reads imports in either quote style,** so it covers the server.
- **The core's features share one shape.** Devices, relations and the screen plumbing moved out of the entry file into features of their own. The unit and canvas handlers are still there.
- **The contract's records file is five files:** what a record is, JSON, titles, validation and the fold.
- **Unit tests have one set-up,** used by the newest files. CI now runs the dependency matrix and the simulation.
- **[docs/audit-2026-11.md](docs/audit-2026-11.md)** records the investigation, and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** the code as it stands.
- **Work is tracked in GitHub** as fourteen topic issues, one to a feature area, with each piece of work a sub-issue. [docs/features.md](docs/features.md) is the same map in the repository.

## Groundwork for agents (13 November 2026)

- **A record names the key that signed it.** The name is signed over, and a labmate's vault checks the record against that key.
- **A key can have the role `agent`.** What it signs is only ever a proposal: a unit, a relation or a check, set apart from the graph. It can't change or remove what a person wrote, can't let another device in, and nothing it signed is sent to a lab or taken in from one.
- **Proposals can be accepted or turned down,** one at a time or a conversation at once, from the top of the Search panel. Accepting makes a record of your own that says which proposal it began as.
- **The core can run as an agent,** which is how the MCP server will use it. There is no server yet.
- **In the simulation** an agent reads Mira's vault and proposes. 135 of 135 expectations hold.

## MCP design, walkthrough and guide (13 November 2026)

- **[docs/mcp.md](docs/mcp.md): the MCP server's design.** Reached by going up from the core's 161 calls and down from nine things people would ask an agent. Ten tools: six read, three propose, one follows up. Every write is a proposal that lands in the person's own space. An agent is a device key with the role `agent`. Nine changes to the rest of the software are listed. Not built.
- **The walkthrough** names invitations, the lab's shelf and signed work, and reading a PDF beside uploading a paper.
- **The guide** says what joining a lab and adding a device send, what is checked on the way in, what happens on leaving, and where a device's key and id are kept.
- **The architecture page** has a table of the rules for records between people.

## Tidy fixes (13 November 2026)

- **Tidy works on PDF canvases for every arrangement.** The headings that Kinds, Timeline, People, Papers and the rankings draw were being refused there as content not from the paper, which stopped the whole tidy.
- **Old headings no longer come back.** On canvases made before versions named what they replace, a heading or card taken off could reappear, which stacked the headings of several arrangements on one canvas.
- **The "cards cover another" notice clears when you tidy.**
- **Tried and removed:** a "Lines of thought" arrangement that grouped cards by community. Three versions were built and looked at on real papers. None read better than Logic, so it was taken out.

## Devices, removal that puts work away, and a simulation that replays (13 November 2026)

- **A key per device.** A second computer asks to sign as you, and a device you already use lets it in. Labmates check that chain. Until it is let in, a new device shares nothing. A lost device is removed the same way. See **Your devices** on the Lab tab.
- **Leaving a lab puts its shared work away.** On the device of someone removed, what the others shared leaves the graph and its notes go to the trash. Their own work and their own grammar stay. An invitation back returns it all.
- **On a canvas, an edit made apart from a removal stands.** For memberships and devices, the removal does.
- **Reach defaults to the lab,** and covers questions asked of a model as well as reading papers.
- **A log a sync tool has damaged still loads.** Half-written, joined, repeated or marked lines are skipped. Before this, one bad line stopped a vault from loading.
- **Obsidian keeps its device id on the device.** It was in the plugin's data file, which travels with the vault, so two devices could write to one log.
- **Refusals are named.** The Lab tab says whose records were refused, which is how an out-of-date app shows up. It also says when this computer's clock is off.
- **A labmate's record that arrives before their own record** is held and checked, where before it was let through.
- **The simulation replays exactly.** Time, ids, keys and signatures come from the seed. It now has a second device for the PI, a file sync that damages logs, and an older and a newer app. 121 of 121 hold.
- **A real Obsidian in a lab:** `harness/lab-real-test.mjs` runs the real app among simulated labmates.
- **Research:** [docs/tooling.md](docs/tooling.md) lists open-source tools for contracts, testing and upkeep, with a first five to adopt.
- **Not built:** routing model work to a labmate's computer. The role `agent` exists on a device key and nothing enforces it yet.

## Labs: invitations, inherited settings, signed records (13 November 2026)

- **Invitations.** The PI makes a one-line invitation, good once for a week. Whoever pastes it into Join a lab is in at once. Asking with the lab's identifier still works.
- **What the PI sets, members inherit:** the lab's shelf of papers, the model servers it offers and its first choice, and how far a paper's text may travel to be read by a model. Set on the Lab tab, carried on the lab's own record.
- **One grammar per lab.** A member's own types that the lab also has give way to the lab's on joining. Only the PI changes the lab's types.
- **The PI can remove a member.** The server stops serving them, everyone's records say so, and their vault tells them. A new invitation lets them back.
- **Versions name what they replace.** A version beats what it replaces; of two made apart, the later stands. Edit counts no longer outvote time.
- **Clocks are corrected** from the lab server's time, and a version is never stamped before the one it replaces.
- **Records are signed** by whoever wrote them and checked on arrival. A unit's words and its existence are its author's alone.
- **Shelves.** A paper is on the lab's shelf (its Zotero group, or the lab's repository with no Zotero), in your own library, or in a labmate's. The PDF chooser lists the lab's shelf first, and a unit's facts say whose copy its paper is.
- **Reach.** Reading a paper on a server outside what the lab allows is refused, with the reason.
- **Server:** invitations, member removal with revoked tokens, and its own time in every record exchange.
- **Not done:** a second device can't sign yet, so a person works in a lab from one device. The Lab tab's new controls are built and bundled, and were not driven in real Obsidian.
- **Tests:** `test/versions.test.ts`, `test/lab-share.test.ts`, and the simulation, which holds 95 of 95.

## Four vaults (13 November 2026)

- **A simulation of four people, each with a vault, around one lab server:** `node harness/four-vaults.ts`. It runs the real core, sync loop and reference server in one process, plays a scripted story and a seeded random walk, and reports what held under convergence, privacy, intent, liveness, membership and integrity. See [docs/four-vaults.md](docs/four-vaults.md).
- **Removals now reach labmates.** A card taken off a shared canvas, a unit its author removed, a shared canvas its owner removed and a relation taken back were never sent. They are now.
- **Checks reach the person whose unit was checked,** and everyone else on the canvas.
- **Evidence travels with its source,** so a labmate sees which paper it came from.
- **A member's relation is drawn on the lab's shared canvases,** not only on canvases the member made, so it is shared.
- **A card whose unit was removed is not shown,** and removing a unit removes the lines drawn to it.
- **A member accepted before the lab's record arrives** is joined when it does.
- **Still open, by design decision:** edit counts outvote time, slow clocks lose, authorship is taken at its word, a PI can't remove a member, and each vault makes its own grammar.
- **Tests:** `test/lab-share.test.ts`.

## Zotero as the PDF library (13 November 2026)

- **A setting makes Zotero the PDF library.** Its PDFs are listed first, named for their references, and read where Zotero keeps them. Nothing is copied into the vault and nothing is written to Zotero.
- **One work, one listing.** A vault copy of a paper Zotero holds is found by its identifiers and is not listed beside Zotero's.
- **What is read from Zotero's file is that reference.** A highlight's source, or an extracted paper, carries the DOI, PMID and other identifiers Zotero has.
- **One Zotero mark throughout:** on cards, in the Context panel, in Search, the PDF chooser, the reader's bar, the Library panel, the Paper map and the canvas menu.
- **Checking again.** The reader counts highlights made in Zotero that aren't units yet and opens From Zotero at that reference.
- **Run against the real Zotero for the first time** (10.0.9): 17 checks pass in real Obsidian. It found two faults the stand-in had hidden: a personal library's id is 0, which was read as "no library"; and a personal address was being used to recognise a source across people.
- **A personal library's address now belongs to its owner.** It marks, matches and opens an item only for the person whose unit carries it. A group library's address works for every member.
- **Tests:** `test/zotero-library.test.ts`, shaped like the real app's answers, and `harness/zotero-real-test.mjs`.

## Sign-off, and a notebook file a notebook can import (13 November 2026)

- **Sign-off.** A unit can be marked as checked, or as needing work, with how it was checked. The mark is pinned to a hash of the unit, so it reads as made on an earlier version once the unit changes. Cards show it, tables can filter by it, and crates carry it.
- **The `.eln` file is rebuilt around entries.** Each run is an experiment, each protocol a protocol and the graph a resource, each a folder with its own files. Before, the file listed loose files and a notebook would have imported no experiments.
- **Checked against the ELN Consortium's own checker,** which now passes all five checks on the four re-issued files, and against eLabFTW's importer as its source reads. It has not been opened in a running notebook.
- **A notebook's file is read here.** Exports from eLabFTW, RSpace, Kadi4Mat and PASTA come in as runs with their files hashed.
- **Fixed on the way:** prefixed keys are spelled out in a crate's context, a packed file is read straight by its reference, and an entry's people are named from given and family names.
- **Tests:** `test/checks.test.ts`, `test/eln.test.ts` with two real notebook exports as fixtures, and `harness/check-test.mjs` in real Obsidian.

## Pictures, a card's relations, candidates and native commands (13 November 2026)

- **Pictures as evidence.** A picture dropped or pasted on a canvas is kept in the base and becomes an Output, pinned by a hash of its bytes. **Say what it shows** makes Evidence that rests on it. A changed file is shown as changed.
- **What a card is related to.** A selected card lists its unit's relations and brings in the ones not on the canvas, with their links.
- **Candidates.** A type can have a candidate tag. Tagged lines are listed in Search and become units there, and the line becomes a link.
- **Commands.** Canvas actions are Obsidian commands, so they can be found and bound to keys.
- **Dialogs are Obsidian modals**, and Escape closes them from inside.
- **The comparison page** now stands at 59%, and 83% of what is on by default in both official plugins.
- **Tests:** `test/gather.test.ts`, and `harness/gather-test.mjs` in real Obsidian.

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
