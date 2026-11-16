# Information architecture

The objects a person works with, the one name each has, and which frame of the app is about which object. Interface text and new frames are checked against this page. The [user guide](guide/README.md) shows each frame in use.

## The objects

Eight objects. The rest of the app is views of these.

| Object | Definition | Lives in | Who can change it | Words not used for it |
|---|---|---|---|---|
| **Unit** | One question, claim, piece of evidence, source or other typed statement | A workspace | Its author. A unit a model read keeps the model's wording beside any rewording | Node |
| **Card** | A unit as drawn on one canvas | A canvas | Anyone who can edit the canvas moves it. Its content is the unit's | |
| **Paper** | A work that was read, with its PDF | A workspace | Its details come from registries | |
| **PDF canvas** | One reading of one paper: what a model read, as people have polished it | A workspace | Polished, never extended. See [PDF canvases](#pdf-canvases) | "From a PDF", workspace |
| **Canvas** | An argument a person or group lays out, drawing on any papers | A workspace | The workspace's members | Workspace |
| **Workspace** | A place with members that holds canvases, papers and units | | Its members, by its owner | Space, base, lab canvas |
| **Person** | Someone who writes, with a profile | | Their own name | |
| **Release** | A canvas pinned at a moment | A canvas | Nobody | |

### Workspaces

A workspace is a container with members. It is never one document.

| Workspace | Members | Shown as |
|---|---|---|
| Your workspace | You | "Only you" |
| A lab workspace | A lab's members, with exactly one PI | The lab's name |

Beyond every workspace is **Published**: what a release has made public.

- **The vault is not a workspace.** It is where this device keeps things. It is named only where a file is involved.
- **A canvas lives in exactly one workspace, and moves.** Moving it says who gains access before it happens.
- **A unit stays where it was written.** Its card shows that workspace. A canvas elsewhere draws it by reference.

### Scopes

Views narrow by a short, fixed ladder. Each step sits inside the next.

| Scope | Holds | Where it is used |
|---|---|---|
| A canvas | What is on one canvas | Paper map |
| Only you (Mine, Yours) | What you made | Library filter, profile tab, paper map, Boundary's "Whose records" |
| Lab | Yours and your lab's | The same |
| Everyone | Everything this graph holds | The same |

## Glossary

One word per thing. The same word is used wherever the thing shows.

| Word | Means | Not to be confused with |
|---|---|---|
| **Unit** | See above. One of nine kinds: question, claim, evidence, source, experiment, protocol, run, code, output | |
| **Type** | A lab's name for a kind of unit, such as "Hypothesis" on the claim kind | Kind, which is one of the fixed nine |
| **Relation** | An argument between two units: supports, opposes, addresses, informs | Link, which is the line drawn on a canvas |
| **Link** | A relation or provenance link as drawn between two cards. Also a link to a unit in a note | |
| **Proposed** | A relation someone else asserted that you have not accepted | |
| **Card** | See above | |
| **Sticky** | A plain note on a canvas, not part of the graph | Note |
| **Note** | An Obsidian note. Every unit has one | A comment on a unit, which the interface calls a note in the Notes thread |
| **Canvas**, **PDF canvas** | See above | |
| **Library** | The panel that lists workspaces, canvases, papers, folders and the lab. The first tab of the canvas sidebar is the same panel | A Zotero library, always written "Zotero" |
| **Search units** | The search panel: the sidebar's second tab, the canvas button, the side panel and the command | Find a unit, the quick finder |
| **Units** | The sidebar tab that lists units not on this canvas yet | |
| **Context** | The panel about the selected unit | |
| **Boundary** | The panel about what a question, claim or piece of evidence holds, rests on and leaves open | |
| **Overview** | A workspace's questions, down to evidence, laid out from the graph | |
| **Source** | The Source unit type. Also the card fact that says where a unit was read from | |
| **Paper** | A work that was read. Split into the work, the file and a reading. See [Where papers live](#where-papers-live) | |
| **Shelf** | Where a paper is held, which says who can open its PDF: the lab's, yours, or a labmate's | |
| **Reach** | How far a lab lets a paper's text travel to be read by a model: this computer, the lab's servers, or anywhere | |
| **Lab** | A workspace with one PI | |
| **PI** | The person who started a lab. They invite, remove, and set what the lab sets for everyone | |
| **Let in** | What a device you already use does for a new one, so the new one can sign as you | |
| **Pin** | A link to one version of something | Pin on the sidebar, which keeps it open |
| **Drift** | A pin whose target has changed since | |
| **Gap** | Something a rule noticed. It never blocks you | |
| **Checked**, **Signed** | A person's mark on one version of a unit. Signed is the author's own | Reactions, which carry no weight |
| **Release** | A canvas at one moment, with every unit pinned | |
| **Build on it** | Makes a canvas in your workspace with a PDF canvas's cards, pointing at the same units | |
| **Extract graph** | Reads a whole paper into a PDF canvas | Highlight, which reads one passage |
| **Research crate** | An RO-Crate archive of a canvas | |
| **Candidate** | A line in a note tagged to become a unit later | |
| **Auto**, **Auto, reworded**, **By hand**, **Imported** | How a unit came to be: as the model read it, as a person reworded the model, as a person highlighted or wrote it, as it arrived in a file | |

## The frames

Each frame is about one object and says so at its head.

| Frame | About | Notes |
|---|---|---|
| Canvas tab | One canvas or PDF canvas | A PDF canvas carries a line naming its file, model and date, with **Build on it** beside it |
| Context panel | The selected unit | Identity, then relations, text, method, provenance, where it is. Each fact once |
| Boundary panel | The selected question, claim or evidence. With none selected, the question or claim the canvas is tied to | Its head says which: "The selected unit" or "This canvas is about" |
| Library | The workspaces you are in, and the canvases and papers in each | Grouped by workspace. Each canvas row shows its top papers and its top contributors |
| Overview | One workspace's questions, down to evidence | |
| PDF reader | One paper's PDF | Opens the PDF most of the canvas's cards came from. On a PDF canvas that is its own paper |
| Profile | One person | Audience tabs use the scope words |
| Paper map | Papers, placed by how tied they are in one scope | A tie is links people drew plus citations, never wording |
| Run page | One run | Reads in the order the work happened |

### Three fixed places

Every kind of thing has one side of the window, and keeps it.

| Side | What is there | For |
|---|---|---|
| Left: the canvas sidebar | **Library**, **Search units**, **Units** not on this canvas yet | Getting around and bringing things in |
| Middle: the main view | The one thing being worked on: a canvas, a PDF, the paper map, a run, a profile | The work itself |
| Right: the panels | **Context** and **Boundary**, about the selected unit | Looking closely at one thing |

The sidebar opens from the icon left of the canvas's name. It floats over the canvas and goes when the canvas is clicked. **Pin** keeps it open and the canvas makes room. Its first line says where you are: workspace, then canvas.

### One name wherever a thing shows

The same list or tool can be reached from more than one place, and it carries one name in all of them. The sidebar's first tab and the side panel are both **Library**. The sidebar's second tab, the canvas button, the right-hand panel and the command are all **Search units**. A paper and its PDF canvas go by one name: renaming the canvas's note renames the paper too. A canvas's own note is titled `Canvas - <title>`.

## The Context panel

The panel answers, for one unit: what is it, where does it come from, how does it stand, and where is it.

| Rule | In the panel |
|---|---|
| Identity stays at the top | Title, then Source, Authors, Workspace, Date made with who made it, IDs, and the unit's own id |
| A readable label in front, a durable identifier behind | Identifiers open where they resolve. The unit's own id copies on a click |
| Section labels are short and small | Small capital labels with a count, and a rule above each |
| Color is never the only signal | Open access is a colored mark whose shape differs by kind, beside the words |
| A count says what it counts | Citations show as a mark and a number |
| Arriving somewhere shows what you came for | A link to a canvas opens it, brings the unit's card into view and rings it for a second and a half. With reduced motion it is a still outline |
| The passage is one click from the unit | **Open the passage in the PDF**, and the source at the head of the panel |

## PDF canvases

**The rule is closure.** Everything on a PDF canvas comes from its paper. That one test decides every case.

| On a PDF canvas | Allowed | Why |
|---|---|---|
| Reword a unit | Yes | The unit is a reading of its passage. The passage stays, and the wording is a person's to improve |
| Change a unit's type | Yes | A model can mistake a claim for evidence |
| Add a unit by highlighting in this paper's PDF | Yes | The new unit quotes a passage of the same paper |
| Relate two of the paper's units | Yes | Both ends are the paper's |
| Take a card off, or put one of the paper's units back on | Yes | An extraction has mistakes |
| Move, resize, tidy | Yes | Position is not content |
| Type in a unit with no passage | No | It is not from the paper |
| Bring in a unit from another paper, or a highlight from another PDF | No | That is the start of someone's own argument |
| Stickies and drawings | No | Commentary belongs with the argument |

A refused change offers **Build on it** at that moment.

**Three origins, always shown.** A card's source row says how the unit came to be: **Auto**, **Auto, reworded** or **By hand**.

**The model's words are kept.** The first rewording stores the model's wording on the unit. Context shows it under the title with **Put the model's words back**. Going back clears the mark. The unit's id never changes.

## Relations in the notes

A relation lives in the records. In Obsidian each of the two notes also carries it as a link property, named by the relation's wording from that side ("Supports" on one, "Supported by" on the other), so backlinks, the graph view and renames follow it.

- It is one-way, from the records to the notes. A hand edit to such a property is put back.
- A property of the same name that a person filled with something other than links is left alone.
- Every unit has a note. One read from a paper gets its note as soon as it is read, filed under `Discourse Units/<paper title>`.
- A note a person deletes is not made again.

## Where papers live

A paper is three things with three identities.

| Thing | What it is | Identified by |
|---|---|---|
| **The work** | The paper as the world knows it: title, authors, venue | DOI, PMID or arXiv id. Two workspaces that hold the same DOI hold the same work |
| **The file** | One PDF | The hash of its bytes |
| **A reading** | One run of one model over one file: the PDF canvas and the units read | Its own id |

- The file is kept once per device, in the vault's `Paper files` folder, or opened from Zotero where Zotero keeps it.
- A reading lives in the workspace where it was run. Reading the same paper again opens the canvas that exists.
- Sharing a paper with a lab sends the work and its reading. **The file goes only when ticked,** because a PDF may not be the sharer's to pass on.
- A paper's **shelf** says who can open its PDF: "Lab shelf", "Not on the lab's shelf", or a labmate's own copy, found by its DOI.
- Leaving a lab takes nothing of your own from the device. What others shared is put away.

## Limits

- "Note" has two meanings: an Obsidian note, and a comment in a unit's Notes thread.
- A person is in one lab. Nothing has members except a lab.
- A workspace that is neither yours nor your lab's has no name. Records carry its id only.
- Nothing sets **Published** except marking a release.

## Not built

Shared workspaces with invited members, being in more than one workspace, and a shelf per workspace with files kept once by hash on the server. See [ROADMAP.md](../ROADMAP.md).
