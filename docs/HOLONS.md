# Holon views and the canvas repository

Claim–evidence graphs, seen the same way at every level. Draft, 11 November 2026.

## The holarchy

A **holon** is a whole that is also a part.

**Levels.** DG's views follow the argument holarchy:

| Level | Holds |
|---|---|
| Lab | its questions |
| Question | the claims that address it, and the evidence that informs it |
| Claim | the evidence and claims for and against it |
| Evidence | the outputs it rests on |
| Output | a leaf: its bytes, by CID |

**Shared parts.** Containment isn't exclusive, so a claim that addresses two questions sits inside both. Requests (MIRA's request for work on a claim) are questions by base type, but not questions of the lab.

**The process layer.** Runs, studies, protocols, code and sources are not levels. They are **what stands behind** evidence and outputs, shown at those levels.

## One view, every level

`holon.view` returns the same shape for every level (`HolonView` in `packages/contract/src/surface.ts`).

**Parts:** the holon's children.
- Each part shows its type, its gap flags, its privacy and who made it.
- Each part that is itself a holon opens into it.

**Behind:** for evidence and outputs, the run, its study, protocol, code and source. For an output, it also lists other runs that made the same bytes.

**Canvas.** Canvases are the holons' views.
- A canvas whose `holon` field names this unit, or this lab's DID, is the holon's own canvas.
- Without one, the canvas is laid out in columns from the graph, and "Save as a canvas" makes it an authored one.
- A canvas can hold another canvas as a JSON Canvas `file` node with `dg.canvas`. Obsidian draws that node as the embedded canvas.

**Boundary.** It has four parts:

| Part | What it shows |
|---|---|
| **In and out** | What comes in: units from another lab or space, evidence reported in a source, arguments proposed by others, the same bytes from another run. What goes out: parts that also sit in other holons, and parts published in a release. |
| **Gaps** | The rules as checks: unsupported claims, single-run claims, drift, stale outputs, failed runs, ungrounded evidence, runs in no study, unpinned code, unreviewed claims, arguments waiting, open questions, unfiled claims. These match the warnings in `ontology/dg_process.shacl.ttl`. |
| **Privacy** | How many parts are private, shared with the lab, or published. It also says what a release would make public. |
| **Whose records count** | A stance: **mine**, **lab** (default) or **everyone**. It changes which arguments are active. Others' arguments become pending, not hidden. Claim flags and gaps follow the stance, not how the base folded the log, so a lab's evidence counts the same in any vault it lands in. |

**History:** the holon's records over time, newest first.

The views only read. Anything a person changes is a new record through `Context.put`.

## The canvas repository

`repository.canvases` lists every canvas as a lab shelf:
- its holon;
- what units it holds, by type;
- who edited it, and how many edits it has;
- its releases, its forks and what it was forked from;
- the canvases it holds and the ones it sits in;
- its gaps and its privacy.

**History.** The log keeps every edit. `canvas.at` folds the log up to a moment, so you can move through a canvas's history.

**Releases.** `canvas.release` writes a `release` record with:
- each live item's revision;
- each card's unit, pinned by `unitCid`.

A release is the only thing that can be published. Writing it to a PDS is a separate, explicit step that isn't built.

**Forks.** `canvas.fork` copies a release's item revisions into a new canvas with `forkOf`.

**Diffs.** `canvas.diff` compares a release with now, or two releases. It reports added, removed, changed (different CID) and moved units.

## In the workspace

The holarchy lives in the plugin's own panels, not in a separate app.

| Panel | Where | What it does with holons |
|---|---|---|
| **Canvas tab** | Main area | A canvas tied to a holon shows a breadcrumb up the holarchy (lab / question / claim). A holon card has an open-inside button, which opens that holon's own canvas in the same tab and makes one from the graph if it has none. The breadcrumb goes back up. The tab's title and saved state follow, so a restart reopens where you were. A loose canvas can be made a holon's canvas from the breadcrumb row |
| **Boundary panel** | Right sidebar, beside the context panel | Follows the holon in focus: the canvas in front, or the holon of the note being read. It holds parts, gaps, in and out, privacy, whose records count and history. A unit picked here moves the context panel to it and lights it on the canvas, and a gap lights all its units |
| **Library: Canvases** | Right sidebar | The repository: each canvas with its holon, what it holds, edits, releases, forks, nesting, gaps and privacy. Its history, releases, forks and comparisons open in place |
| **Holons tab** | Main area | The explorer, for the top of the holarchy and for holons nobody has a canvas for yet. It is laid out by Tidy's Logic mode, read-only, and offers to make the canvas |

**Opening a holon.** Every holon card has its own open-inside button. On top of that, each device picks one more way, in the plugin's settings or in the Holon menu on the breadcrumb row:

| Choice | Double-click | Zoom |
|---|---|---|
| Open-inside button (default) | Opens the card's text, as everywhere else | Only zooms |
| Double-click | Opens the holon; the card's open button opens its text | Only zooms |
| Zooming in | Opens the card's text | Zooming far into a holon card (200%) opens it; zooming far out (25%) goes up a level |

**Rules kept from the canvas design:**
- Cards are 240 px wide.
- A canvas never opens below 70% zoom.
- A holon canvas made from the graph is marked `needsLayout`, so the canvas tab tidies it with its own engine the first time it opens.
- A nested canvas is a JSON Canvas `file` node with `dg.canvas`. The DG canvas shows it as a card that opens in place, and Obsidian's own Canvas shows the same node as the embedded canvas.

**Where the code sits:**
- **Core:** `packages/core/src/holons.ts` holds holon focus, `holon.canvas`, `canvas.setHolon`, `canvas.highlight` and `prefs`.
- **Canvas tab:** `packages/surfaces/src/canvas/holons.tsx`.
- **Boundary panel:** `packages/surfaces/src/boundary/`.
- **Library repository:** `packages/surfaces/src/library/Repository.tsx`.
- **Explorer:** `packages/surfaces/src/holon/`.
- **Obsidian:** the plugin watches each canvas frame's port, so the tab takes the canvas the frame moved to.

**Commands in Obsidian:**
- "Open this note as a holon";
- "Open the holon boundary panel";
- "Open holons";
- "Open the canvas repository".

**Tests:** `harness/holons-test.mjs` passes 13 of 13 in real Obsidian.

**The local app.** `local/` lays out the same panels in a browser the way Obsidian does: the Library on the left, the canvas or explorer in the middle, and boundary and context on the right. It answers `canvas.show`, `panel.open` and `base.reveal` the way a base would.

## What this takes from the W3C Holon Graph Community Group

[`w3c-cg/holon`](https://github.com/w3c-cg/holon) at `3590f5e` (24 July 2026) is an Editor's Draft at 0.1.x. It has one editor, and its files disagree on class names, portal terms and containment.

**Taken as patterns:**
- A projection only reads and never asserts.
- Containment isn't exclusive.
- Shapes act as a holon's boundary.
- Zoom by depth.
- Trust-ordered graphs, our "whose records count".
- "What's new for me", which is left for later.

**Not taken:**
- Its vocabulary and namespace, which isn't settled.
- The LLM "Cartographer" as the basis of views.
- Bayesian and Markov-blanket layers, which the draft marks at risk.
- Viewer profiles that record claims about the viewer.
- Server-owned registration status.

**Conflicts with AT Protocol:**
- It has no CIDs or signatures.
- It assumes a central registry.
- Its agent IRIs are scoped to a holon, not one DID per person.

A DataBook export of a release (Markdown with fenced Turtle) would be an easy bridge later. The record log stays canonical.

## Open questions

- **Canvases per holon:** should a holon have one canonical canvas, or many with one chosen?
- **Gaps:** which gaps should a PI see by default, and which only on request?
- **Publishing a release:** is it a lab decision, a PI's, or the author's?
