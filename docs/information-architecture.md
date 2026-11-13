# Information architecture

The objects a person works with, the one name each has, and which frame of the app is about which object. UI strings and new frames are checked against this page. It was written on 13 November 2026 because the words on screen and the model behind them had drifted apart.

**Status: decided on 13 November 2026**, for the four forks under [What was decided](#what-was-decided). [What is built](#what-is-built) says how much of the app matches it so far.

## What the audit found

Every user-visible string in the surfaces, the Obsidian plugin and the guide was read into a grid of terms against objects.

**One word, several things**

| Word | What it names today |
|---|---|
| Workspace | A kind of canvas (built by hand). The card fact for the vault a unit was written in. One particular canvas, "My workspace", where exports land |
| Note | A Markdown note, a sticky note on a canvas, a comment on a unit, a release note, a Zotero comment, a canvas's own note |
| Repository | The lab's paper store, a paper's publisher, a data archive |
| Published | A privacy state, a flag on a release, work a journal published, a public profile |
| Library | This app's side panel, and the person's Zotero library |
| Source | The Source unit type, and the card row for where a unit was read from |
| Lab | The group, a tab, a privacy level, a filter, a stance, a card row, and the top of the Overview even when it is "My space" |
| Mine / Lab / Everyone | Which canvases are listed, whose arguments count, and who can see a profile |

**One thing, several words**

| Thing | Words used |
|---|---|
| A unit | Unit, node, card |
| A paper's own canvas | "From a PDF", "Read from a PDF", "this paper's canvas", "a canvas of its own" |
| The store on this device | Vault, base, space, and the card fact "Workspace" |
| Seen only by you | "Private", "Only you" |
| The Overview | "Overview" in Obsidian, "Holons" in the local app, and "holon" in its own text |
| The lab's shared canvas | "Lab canvas", "<lab>'s canvas" |

**Things the words promise that don't exist**

- A canvas made while in a lab is tagged "Lab", but only canvases explicitly shared are synced.
- "Published" can be shown but nothing sets it.
- There is no control that shares a canvas. The call exists and no button uses it.
- A person is in one lab. Nothing has members except a lab, and nothing can be invited to.

## What the literature says

Read on 13 November 2026. Each rule says how well it is supported.

| Rule | Support | Source |
|---|---|---|
| Design the objects and their operations first, and keep one lexicon: one name per object, with the synonyms it bans | Well supported | Johnson and Henderson, *Conceptual Models*; Nielsen heuristic 4 |
| Fewer concepts is better. Resist adding one | Well supported | Johnson and Henderson |
| "Workspace" names a container that has members, never one document | Vendor convention | Slack, Notion, Figma all use it that way. No vendor read uses it for a single document |
| A short, fixed ladder of scopes. Each item lives in exactly one place, and the place is always shown | Vendor convention | Notion, Google Drive, Figma |
| Say whether crossing a scope moves or copies. Zotero copies, Drive moves | Inference | Zotero groups, Drive shared drives |
| A fixed object stays fixed. Offer the working copy at the first attempted edit, and keep a visible way to it | Vendor convention | GitHub fork-on-edit, Overleaf "Copy the Project", Colab "Save a copy" |
| Show a lock as a label on the object, with the reason, and link the copy back to its source | Vendor convention | GitHub; NN/g on disabled controls |
| In a toolbar, disable with a reason. In a context menu, hide | Well supported | Apple HIG, menus |
| An inspector describes the selected item. A panel says at its head which object it is about | Vendor convention | Apple HIG, panels; Figma's right sidebar |
| Rank an object's attributes once. Each appears once, most needed first | Supported for ranking, inference for "once" | Nielsen, progressive disclosure; Prater, OOUX |
| Three to five faces, then "+N". Say what the order means, because faces usually mean "here recently" | Vendor convention, inference on ordering | Fluent, Primer, Notion |
| Name the audience on the action. Inviting to one item and adding to a group are two actions. Say who gains access before confirming | Vendor convention | Hypothesis, Notion, Drive |
| Source material and the analyst's own schema are different objects, with every schema item linked back to its source | Inference | Pirolli and Card; Russell et al. |

**Where evidence is thin.** No study was found that measures term drift, compares scope models, compares copy-up-front with copy-on-edit, or tests what order people assume in a row of faces. Those rules are convention.

## The objects

Eight objects. The rest of the app is views of these.

| Object | One-line definition | Lives in | Can it change? | Banned words |
|---|---|---|---|---|
| **Unit** | One question, claim, piece of evidence, source or other typed statement | A workspace | By its author. A unit a model read keeps the model's wording beside any rewording | Node |
| **Card** | A unit as drawn on one canvas | A canvas | Position always. Content is the unit's | — |
| **Paper** | A work that was read, with its PDF | A workspace | Its details, from registries | — |
| **PDF canvas** | One reading of one paper: what a model read, as people have polished it | A workspace | Polished, never extended. See [Polishing a PDF canvas](#polishing-a-pdf-canvas) | "From a PDF", workspace |
| **Canvas** | An argument a person or group lays out, drawing on any papers | A workspace | By the workspace's members | Workspace |
| **Workspace** | A place with members that holds canvases, papers and units | — | Its members, by its owner | Space, base, lab canvas |
| **Person** | Someone who writes, with a profile | — | Their own name | — |
| **Release** | A canvas pinned at a moment | A canvas | No | — |

**Workspaces come in a fixed ladder.**

| Workspace | Members | Shown as |
|---|---|---|
| Your workspace | You | "Only you" |
| A shared workspace | People its owner invited, from a lab or outside it | Its name and its faces |
| A lab workspace | A lab's members. It is a shared workspace of a special kind, with exactly one PI | The lab's name |

Beyond every workspace is **Published**: what a release has made public.

**The vault is not a workspace.** It is where this device keeps things. It is named only where a file is involved.

**"Note" is an Obsidian note.** A comment on a unit is a comment. A sticky on a canvas is a sticky.

## The frames

Each frame is about one object and says so at its head.

| Frame | About | Changes from today |
|---|---|---|
| Canvas tab | One canvas or PDF canvas | A PDF canvas carries a label naming its file, model and date, and what can be done there, with **Build on it** beside it |
| Context panel | The selected unit | Identity, then text, then relations, then provenance, then where it is. Each fact once |
| Boundary panel | The selected question, claim or evidence. With none selected, the question or claim the canvas is tied to | Its head says which: "The selected unit" or "This canvas is about" |
| Library | The workspaces you are in, and the canvases and papers in each | Grouped by workspace. Each canvas row shows its top papers and its top contributors |
| Overview | One workspace's questions, down to evidence | Says "workspace", never "holon" or "Lab" for your own |
| PDF reader | One paper's PDF | Opens the canvas's own paper. **Another PDF…** is one click |
| Profile | One person | Audience tabs use the ladder's words |
| Paper map | Papers, placed by how tied they are in one scope | Scope tabs use the ladder's words: a canvas, Only you, the lab's name, Everyone. A tie is links people drew plus citations, never wording |

## Three fixed places (13 November 2026)

Every kind of thing has one side of the window, and keeps it.

| Side | What is there | Why |
|---|---|---|
| Left: the canvas sidebar | **Library** (every workspace, its canvases and papers, with the open one marked), **Search units**, **Units** not on this canvas yet | Getting around and bringing things in |
| Middle: the main view | The one thing being worked on: a canvas, a PDF, the paper map, a run, a profile | The work itself |
| Right: the panels | **Context** and **Boundary**, about the selected unit | Looking closely at one thing |

The sidebar opens from the icon left of the canvas title. It floats over the canvas and goes when the canvas is clicked; **Pin** keeps it open and the canvas makes room. It reopens on the tab it was last on. Its first line says where you are: workspace, then canvas.

**One name wherever a thing shows (13 Nov).** The same list or tool can still be reached from more than one place, and it carries one name in all of them. The sidebar's first tab and the side panel are both **Library**. The sidebar's second tab, the canvas button, the right-hand panel and the command are all **Search units**. A paper and its PDF canvas go by one name: renaming the canvas's note renames the paper too. A canvas's own note keeps its "Canvas - " prefix, by decision.

**Relations in the notes.** A relation lives in the records. In Obsidian each of the two notes also carries it as a link property, named by the relation's wording from that side ("Supports" on one, "Supported by" on the other), so backlinks, the graph view and renames follow it. It is one-way: a hand edit to such a property is put back, and a property of the same name that a person filled with something other than links is left alone. In Obsidian every unit has a note: one read from a paper gets its note as soon as it is read, filed under `Discourse Units/<paper title>`, so all relations show. A note a person deletes is not made again. Roam gets neither the notes nor the links.

## How the seven requests land

| Request | In this model |
|---|---|
| Context panel repeats itself | One ranked attribute list. The title, the quote and the paper each appear once |
| The question is tied to a claim but isn't caught | The Boundary panel follows the selection, with no tying step |
| PDF button opens the parent PDF | The reader opens the paper most of the canvas's cards come from. On a PDF canvas that is its own paper |
| A PDF's graph is its paper's, and can be polished | Everything on a PDF canvas comes from its paper. The core refuses anything else, and the bar says why |
| Highlighting from another PDF onto a PDF canvas | The first attempted change offers **Build on it**: a canvas in your workspace, linked back to the PDF canvas |
| Workspaces list their top papers and contributors | On each workspace and each canvas row: up to three papers as text, up to four faces labelled "Most contributed" |
| Invite others to a canvas; offer a new workspace | **Invite** on a canvas in your workspace. Inviting someone makes a shared workspace and moves the canvas into it, after saying who will see it |

## What was decided

| Fork | Decision |
|---|---|
| What "workspace" means | A place with members that holds canvases, papers and units. A canvas people lay out is a "canvas" |
| Where the lab sits | The lab is a workspace of a special kind, with exactly one PI |
| What "Build on it" makes | A canvas in your workspace with the same cards, pointing at the same units |
| What the Boundary panel is about | The selected question, claim or evidence |

## Polishing a PDF canvas

Decided on 13 November 2026: "modifying a pdf canvas is allowable, but the content must be derived from highlighting new information or modifying translations… without it becoming an accidental workspace."

**The rule is closure, not a lock.** Everything on a PDF canvas comes from its paper. That one test decides every case, and it is what translation tools do: a translator can edit any segment and can't add a source string.

| On a PDF canvas | Allowed | Why |
|---|---|---|
| Reword a unit | Yes | The unit is a translation of its passage. The passage stays; the wording is the person's to improve |
| Change a unit's type | Yes | The model can mistake a claim for evidence |
| Add a unit by highlighting in this paper's PDF | Yes | The new unit quotes a passage of the same paper |
| Relate two of the paper's units | Yes | Both ends are the paper's |
| Take a card off, or put one of the paper's units back on | Yes | An extraction has mistakes |
| Move, resize, tidy | Yes | Position isn't content |
| Type in a unit with no passage | No | It isn't from the paper |
| Bring in a unit from another paper, or a highlight from another PDF | No | That is the start of someone's own argument |
| Stickies and drawings | No | Commentary belongs with the argument |

A refused change is offered **Build on it** at that moment.

**Three origins, always shown.** A card's source row says how the unit came to be: **Auto** (as the model read it), **Auto, reworded** (a person has changed the model's words), **By hand** (a person highlighted it). This is the same split translation tools and labelling tools show: as generated, edited, added.

**The model's words are kept.** The first rewording stores the model's wording on the unit. The Context panel shows it under the title with **Put the model's words back**. Going back clears the mark. The unit's identifier never changes.

**Not built yet:** showing a removed unit as struck out with a reason, as Wikidata deprecates instead of deleting; a second person marking a polished reading as checked; and counting on the canvas's label how much of a reading has been polished.

## The Context panel

The panel answers, for one unit: what is it, where does it come from, how does it stand, and where is it. The literature and the products people trust agree on a few rules, and the panel follows them.

| Rule | Where it comes from | In the panel |
|---|---|---|
| Identity stays at the top: name, origin, maker, identifiers | Zotero 7's pinned header; Apple's inspector guidance | Title, then Source, Author, Workspace, Made with who made it, IDs, Unit ID |
| A human label in front, a durable identifier behind | AT Protocol: show the handle, link the DID; Crossref and DataCite: a DOI is a link | Identifiers open where they resolve. The unit's own identifier copies on a click |
| Section labels are short, small and separated by space first, a hairline second | Carbon, Apple; uppercase only for one- or two-word labels (Sawyer et al., via NN/g) | Small capital labels with a count, a rule above each |
| Colour is never the only signal | WCAG 1.4.1; Carbon's status pattern | Open access is a coloured mark whose shape differs by kind, beside the words, with the kind in the tooltip |
| A count is a number with a mark, and says what it counts | scite, Altmetric: counts must open their evidence | Citations as a mark and a number. Opening the citing works is not built |
| Arriving somewhere shows what you came for, briefly, without motion that sweeps | GitHub's permalink highlight; WCAG 2.3.3 | A link to a canvas opens it, brings the unit's card into view and rings it for a second and a half. With reduced motion it is a still outline |
| The passage is one click from the unit | scite, Elicit; small studies agree the passage is what moves trust | **Open the passage in the PDF** |

**What the research says would matter most, in order:** the passage first; a banner at the very top for a retraction or a newer version; typed counts that open their evidence; identifiers as a compact, copyable, resolvable strip; and a visible origin on every unit with a way back. The first, fourth and fifth are built. The banner is a line in the Published work section today and should move to the top. Typed counts are not built.

**Where it is still thin.** No study was found comparing a mark and number with a sentence for counts, or giving a duration for an arrival highlight. Those are convention and judgement.

## Where papers live

With several workspaces, private and shared, a paper can't belong to one of them. It is split into three things with three homes.

| Thing | What it is | Identified by | Lives |
|---|---|---|---|
| **The work** | The paper as the world knows it: title, authors, venue | DOI, PMID or arXiv id | Nowhere in particular. Two workspaces that hold the same DOI hold the same work |
| **The file** | One PDF | The hash of its bytes | Once per device, in the vault's paper folder. Once per server, however many workspaces list it |
| **A reading** | One run of one model over one file: the PDF canvas and the units read | Its own id | In the workspace where it was run |

**Each workspace has a shelf**, which is the list of works its members can see, each with the file (if someone added it) and its readings. The lab's "paper repository" is the lab workspace's shelf, and stops being a separate thing.

**Rules**

1. **A canvas lives in exactly one workspace, and moves.** Moving it says who gains access before it happens.
2. **Works, files and readings are listed, never moved.** When a canvas moves to another workspace, the works its cards draw on are added to that shelf with their readings. The PDF canvas is fixed, so two workspaces listing the same reading can't conflict.
3. **The file goes only when ticked.** A PDF may not be the mover's to share, so the default is the work and its readings without the file, as it is today when sharing a paper with a lab.
4. **A unit stays where it was written.** Its card shows that workspace. A canvas elsewhere draws it by reference.
5. **A file is readable by a member of any workspace whose shelf lists it with the file.** The server keeps one copy by hash and checks membership per shelf.
6. **Leaving a workspace takes nothing from the device.** What was read stays in the vault. It stops receiving changes.
7. **A reading is run in one workspace and can be listed in others.** Reading the same file again, with any model, makes a new reading beside the old one.

**What a person sees.** The Library's Papers tab becomes the shelf of the workspace in view, with a row per work: its readings (each a PDF canvas), whether the file is here, and which other workspaces of yours list it. The reader's chooser lists files from every shelf you can see, and says which.

**Open:** whether the PI alone adds files to a lab shelf; and what an invited outsider can see of a lab shelf when a shared workspace draws on it. The rules above give an outsider only the works and readings the shared workspace lists.

## What is built

| Part | State |
|---|---|
| PDF canvases can be polished and take nothing foreign, in the core and on the canvas bar. A reworded unit keeps the model's wording and can go back to it | Built. A unit taken off a PDF canvas is not yet shown as struck out with a reason |
| **Build on it**, from the canvas bar and from the reader's highlight popup | Built |
| The PDF button opens the PDF most of a canvas's cards came from | Built |
| Boundary follows the selection and names its subject | Built |
| Context says each fact once, in one order | Built |
| Library grouped by workspace, with each canvas's top papers and faces | Built for the two workspaces that exist: yours and your lab's |
| Move a canvas from your workspace to your lab's, after saying who will see it | Built on the existing lab sharing |
| "Unit" for "node", "PDF canvas", "Canvas", "Only you", workspace names | Built in the strings found. "Note" still has several meanings, and "base" remains in three places |
| Shared workspaces with invited members, and being in more than one | Not built. A person has one lab and nothing else has members, in the records, the sync client and the server |
| Shelves per workspace, files kept once by hash on the server | Not built. Designed above |
| Inviting someone by a link or a name, and what an outsider sees | Not decided |

## Sources

Johnson and Henderson, "Conceptual Models in a Nutshell", Boxes and Arrows, 2013. Nielsen, "10 Usability Heuristics", NN/g, reviewed 2024. Nielsen, "Progressive Disclosure", NN/g, 2006. Prater, "Object-Oriented UX", A List Apart, 2015. Apple Human Interface Guidelines: Panels, The menu bar, Context menus. Laubheimer, "Modes in User Interfaces", NN/g, 2019. Friedman, "Hidden vs. Disabled In UX", Smashing Magazine, 2024. Vendor documentation for Slack, Notion, Figma, Google Drive, Zotero, GitHub, Overleaf and Hypothesis. Fluent UI Facepile and Primer Avatar stack guidance. Read as abstracts or summaries only: Smetters and Good, SOUPS 2009; Pirolli and Card, 2005; Russell et al., 1993; Erickson and Kellogg, 2000. Not loaded: Material 3 side sheets, Observable.
