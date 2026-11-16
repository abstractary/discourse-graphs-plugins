# Comparison with the official plugins

This page compares this project, capability by capability, with the official [Discourse Graphs plugins](https://github.com/DiscourseGraphs/discourse-graph) for Roam and Obsidian. It is a list of what each does, not a judgement of either.

As of 13 November 2026, against `discourse-graph` at commit `0042842e` (Roam 0.24.0 and the Obsidian source) and the published Obsidian plugin 1.8.0.

## Method

Each capability is one row of [capabilities.csv](../reports/comparison/capabilities.csv), read from the code on both sides and merged into 95 rows. A full match counts as 1 and a partial match as 0.5, and coverage is that sum over the number of rows.

Rows are not equal in size, and scoring a row is a judgement that anyone can challenge in the CSV. To rescore after changing it:

```bash
python3 -I scripts/compare.py
```

## Coverage by area

"Roam on" and "Obsidian on" count the capabilities that are on by default in that official plugin.

| Area | Capabilities | Roam on | Obsidian on | Here, fully | Here, partly | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| Node creation | 13 | 11 | 11 | 10 | 2 | 85% |
| Relations | 9 | 8 | 7 | 7 | 1 | 83% |
| Context and browsing | 9 | 6 | 5 | 6 | 1 | 72% |
| Canvas | 24 | 22 | 21 | 13 | 5 | 65% |
| Recognition and inline UI | 5 | 3 | 5 | 2 | 2 | 60% |
| Grammar and settings | 11 | 8 | 8 | 6 | 1 | 59% |
| Collaboration and identity | 4 | 2 | 0 | 0 | 3 | 38% |
| Import, export and sharing | 7 | 3 | 0 | 0 | 5 | 36% |
| Telemetry, help and AI | 5 | 4 | 2 | 0 | 3 | 30% |
| Queries and views | 8 | 7 | 1 | 1 | 0 | 12% |
| **All** | **95** | **74** | **60** | **45** | **23** | **59%** |

## Coverage by scope

| Scope | Capabilities | Here, fully | Here, partly | Coverage |
|---|---:|---:|---:|---:|
| On by default in both official plugins | 50 | 38 | 7 | 83% |
| On by default in either | 84 | 44 | 15 | 61% |
| Only in the Obsidian plugin | 7 | 4 | 1 | 64% |
| Only in the Roam plugin | 28 | 1 | 7 | 16% |
| Behind a flag wherever it exists | 11 | 1 | 8 | 45% |

## Largest gaps

- **Queries and views.** The Roam plugin's query builder, saved queries, custom Datalog, tables, charts, timeline and Kanban views are not here. A table per type exists in Obsidian, through Obsidian Bases.
- **Export formats.** JSON-LD and research crates only. No Markdown, CSV, Neo4j, PDF, PNG or SVG.
- **Canvas drawing tools.** No shapes, frames or embeds, no align, group, lock or rotate, and one pen with no eraser.
- **Recognition in the editor.** A candidate tag is not styled where it is written, and a hand-written title is recognised at import, not live.
- **Sharing.** Shared canvases, papers, reactions and notes sync within a lab through a reference server. Public groups and real accounts are not here.
- **Feedback, error reporting and help links.** A walkthrough only.

## Every capability

The Roam and Obsidian columns say whether the official plugin has the capability on by default, behind a flag, or not at all.

### Grammar and settings

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Default node and relation types | On | On | Yes |  |
| Types carry format and color | On | On | Yes | Read from the official plugins on import |
| Settings screen for node types | On | On | Yes | Types and relations dialog |
| Settings screen for relation types and allowed pairs | On | On | Yes | Types and relations dialog |
| Node templates | On | On | Yes | A template per type, with starter headings |
| Folder per node type | No | On | No |  |
| Node type defined by a query | Behind a flag | No | No |  |
| Score attributes | On | No | No |  |
| Configurable trigger keys | On | On | Partly | Canvas actions are Obsidian commands, so any key can be bound; the capture key is set in Settings |
| Export and import of the schema | No | On | Yes | One JSON file by label; also reads the official plugin's export |
| Personal and shared settings | On | No | No |  |

### Node creation

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Create a typed node | On | On | Yes | From the canvas |
| Reuse an existing node while creating | On | On | Yes |  |
| Relate while creating | No | On | Yes | Dropping a connection on empty canvas |
| Create from selected text in the editor | On | On | Yes | Select, press the key, pick a type |
| Hotkey menu in the editor | On | On | Yes | Same key and menu in both bases |
| Insert a link at the cursor | On | On | Yes | From the finder and the search panel |
| Convert the current page to a node | On | On | Yes |  |
| Create from a candidate tag | On | On | Yes | A tag per type; candidates listed in Search and made units there |
| Apply a template on create | On | On | Yes | When the unit gets its note |
| Block-level nodes | On | No | No |  |
| Turn an image into a node | On | On | Yes | A dropped or pasted picture becomes an output; saying what it shows makes evidence |
| Bulk identify existing notes | No | On | Partly | Import does this once; test harness only |
| Inline node search and insert | On | No | Partly | The finder inserts a link; it isn't inline in the editor |

### Recognition and inline UI

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Recognize nodes from titles or frontmatter | On | On | Partly | At import; not live |
| Relation badge beside links | Behind a flag | On | Yes | Live Preview and Reading view; Roam links tags and aliases; off switch per device |
| Context popover from a link | Behind a flag | On | Partly | Opens the context panel rather than a popover |
| Candidate tag styling | On | On | No | Candidates are listed in Search; the tag isn't styled in the editor |
| Type shown in base views | On | On | Yes | Each note carries dg-type, so Obsidian tables show and filter it |

### Relations

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Stored relations | On | On | Yes | Records with union merge |
| Pattern-derived relations | On | No | Partly | Title sources become proposals; If specs aren't read |
| Add a relation from a panel within the grammar | On | On | Yes |  |
| Complement wording by direction | On | On | Yes |  |
| Duplicate guard | On | On | Yes |  |
| Delete a relation | On | On | Yes | Delete prompt on the canvas |
| Review imported or proposed relations | On | On | Yes |  |
| Browse all relations in a table | On | No | No |  |
| Provenance on a relation | No | On | Yes | Shown on hover; person inside a lab and lab from outside it |

### Context and browsing

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Context panel | On | On | Yes |  |
| Follows the current page | On | On | Yes |  |
| Follows the canvas selection | On | On | Yes |  |
| Walk to a related node | On | On | Yes |  |
| Group by target | On | No | No |  |
| Canvas references | On | No | No |  |
| Search with filters and sort | Behind a flag | On | Yes | Search panel |
| Docked search panel | Behind a flag | No | Yes | Search panel |
| Left sidebar sections | Behind a flag | No | Partly | A canvas sidebar with Places, Search and Units; not the base's own sidebar |

### Canvas

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Node cards bound to notes | On | On | Yes |  |
| Relation arrows with labels | On | On | Yes |  |
| Draw a relation between cards | On | On | Yes |  |
| Grammar check on connect | On | On | Yes |  |
| Deleting an arrow keeps the relation | On | On | Yes |  |
| Deleting a card removes its arrows | On | On | Yes |  |
| Renames reach the card | On | On | Yes |  |
| Open a node beside the canvas | On | On | Yes |  |
| Merge outside changes | On | On | Yes | Per item |
| Notes and text | On | On | Yes |  |
| Edit a title from its card | On | On | Yes | Your own units |
| Freehand drawing | On | On | Partly | One pen; no eraser |
| Undo and redo | On | On | Yes | Every edit |
| Drag a link or block in from the base | On | On | Partly | Plain text becomes a note |
| Shapes frames lines media and embeds | On | On | Partly | Pictures as cards; no shapes, frames or embeds |
| Align group lock rotate and reorder | On | On | No |  |
| Copy and paste | On | On | Yes |  |
| Export PNG or SVG | On | On | No |  |
| Convert a shape or arrow | On | On | No |  |
| Key image on a card | On | On | Partly | An output's own picture shows on its card; no key image on other units |
| Create a relation type from the canvas | No | On | No |  |
| Canvas drawer and clipboard | On | No | Partly | A drawer of units not on the canvas; no clipboard |
| Embed a canvas in a block | On | No | No |  |
| Real-time co-editing | Behind a flag | No | No |  |

### Queries and views

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Query builder conditions | On | No | No |  |
| Saved queries and drawer | On | No | No |  |
| Custom Datalog | On | No | No |  |
| Table results | On | No | No |  |
| Charts timeline and Kanban | On | No | No |  |
| Result actions | On | No | No |  |
| SmartBlock and JavaScript API | On | No | No |  |
| Base view per type | No | On | Yes | Open its table, in Types and relations |

### Import, export and sharing

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Export to Markdown JSON CSV Neo4j JSON-LD PDF | On | No | Partly | JSON-LD and RO-Crate; no Markdown, CSV, Neo4j or PDF |
| Send results to a page or canvas | On | No | No |  |
| Send to GitHub | On | No | No |  |
| Publish to groups | Behind a flag | Behind a flag | Partly | Shared canvases reach the lab |
| Import shared nodes | Behind a flag | Behind a flag | Partly | Arrive by sync with their canvas |
| Refresh imported nodes | Behind a flag | Behind a flag | Partly | New revisions arrive by sync |
| Shared assets | Behind a flag | Behind a flag | Partly | Original files in the lab repository; no images |

### Collaboration and identity

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Database sync | Behind a flag | Behind a flag | Partly | Lab records sync through the reference server; not the whole graph |
| Spaces accounts and groups | Behind a flag | Behind a flag | Partly | Labs with join requests on a reference server; no real accounts |
| Per-person clipboard and settings | On | No | No |  |
| Merge teammates' writes without a server | On | No | Partly | Tested as outside records |

### Telemetry, help and AI

| Capability | Roam | Obsidian | Here | Note |
|---|---|---|---|---|
| Usage analytics | On | No | Partly | Local log with no content; nothing is sent |
| Error reporting | On | No | No |  |
| Feedback | On | On | No |  |
| Help links | On | On | Partly | A walkthrough of the interface; no links out |
| AI suggestions and embeddings | Behind a flag | Behind a flag | Partly | Ask a canvas, grounded in chosen units; no suggestions or embeddings |

## Only here

36 capabilities are additions in this project. They are not counted in the coverage above.

| Capability | Here | Note |
|---|---|---|
| Same panels and gestures in both bases | Yes | One bundle |
| Canvases move between bases as records | Partly | Test harness only |
| Change a node's type from its card | Yes |  |
| Auto layout | Yes | Tidy, with arrangements for logic, debate, timeline, kinds, people, focus and centrality |
| Start the next card by dropping a connection | Yes |  |
| Import the official plugins' data with a dry run | Partly | Test harness only; older Roam settings layout |
| JSON Canvas output | Partly | Method exists; no button |
| Empty states that teach | Yes |  |
| No network calls | Yes | CSP blocks them in the frame |
| Every unit has a global id that survives retyping | Yes | DID plus TID, also stored in the text |
| Records validate against AT Protocol lexicons | Yes | science.mira and org.discoursegraphs |
| Identity with no account or network | Yes | did:plc computed on the device |
| Lab attribution and PI custody | Partly | Marks on every unit and PLC operations; no custody screen |
| Reads published science.mira records | Partly | Tested on the 20 MATSUlab records; test harness only |
| Guided walkthrough on the real interface | Yes | Real gestures with a way to remove its examples |
| One list of canvases in every base | Yes | Shared panel plus a native page or note for each canvas |
| Upload a paper, choosing server, model and schema | Yes |  |
| A canvas for each paper, with units staged until exported | Yes |  |
| Export a paper or chosen units to a workspace, lab canvas or folder | Yes |  |
| Lab paper repository with uploader, extractor and breadcrumbs | Yes | Downloading the original file has no button yet |
| Reactions and notes on shared units | Yes |  |
| AI mode with chosen units as grounding | Yes | Tested with search-only answers and a fake model |
| Provenance and everywhere a unit lives | Yes |  |
| Join a lab by identifier, with AI provisioned on acceptance | Yes |  |
| Remove a canvas, or a unit you made | Yes | Canvas menu and Context panel |
| A PDF reader beside the canvas, with highlights that become units | Yes |  |
| Protocol, study, run, code and output units, with run pages | Yes |  |
| Evidence crates: RO-Crate with MIRA, hashed files and a README | Yes |  |
| Reads MIRA evidence bundles and other tools' run crates | Yes |  |
| A Zenodo draft with a reserved DOI | Partly | Not tried against the real service |
| Registry lookups, retraction marks and a Zotero read import | Partly | Zotero highlights and groups only against a stand-in |
| A card lists what its unit is related to, and brings in what isn't on the canvas | Yes |  |
| Canvas actions in the command palette | Yes |  |
| A picture checked against its recorded hash before it is shown | Yes |  |
| Sign-off pinned to the version that was checked | Yes |  |
| A lab-notebook file with runs as experiments, and notebook files read as runs | Partly | Passes the ELN Consortium's checker; not opened in a running notebook |

## Limits

- The official plugins are read at one commit. Work merged there since is not counted.
- Both sides are read from code. Neither official plugin was run, so behaviour that depends on a server or an account is scored from what the code says.
- The Roam adapter in this project passes host conformance and lacks the optional host calls, so it has none of the features that need them. A row marked "Yes" describes Obsidian, and Roam only where its note says so.
- Speed, memory and behaviour on large graphs are not compared.
