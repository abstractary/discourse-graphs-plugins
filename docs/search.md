# Search

Search finds units by their words. This page covers the search panel, the quick finder, how a match is found and ranked, candidate tags, and the lists that sit at the top of the panel. Search runs on the device and sends nothing.

## Where it is

| Place | How to open it | What it is for |
|---|---|---|
| **Search units** panel | The command **Search units**, the ribbon menu, the right sidebar in Obsidian, or the Search tab of the canvas sidebar | Browsing, filtering and picking several units |
| **Find a unit** | The command **Find a unit**. In the local app, ⌘K or Ctrl+K | Getting to one unit fast |
| **Link a unit…** | A note's right-click menu | The finder, set to insert a link |

## What is searched

Three fields of every unit that has not been removed:

| Field | What it holds | Weight |
|---|---|---|
| Title | The unit's own words | 3 |
| Passage | The exact words it was read or cut from in a paper | 1.5 |
| Note | The text of its note, read as a person reads it: no front matter, link brackets, heading marks or emphasis marks | 1 |

Notes are read in the background, six at a time, the first time a search needs them. The first search waits up to 0.8 seconds for that, then answers from titles and passages, and the count line says "reading notes…" until the rest is in. A note that changes is read again before the next search. A note that is removed leaves the index.

## How a match is found

- **Case, accents and ligatures are folded away,** so `cafe` finds "Café".
- **A query is split on spaces. A "quoted phrase" stays whole.**
- **Every word has to turn up** in at least one of the fields being searched. A unit missing one word is not a match.
- **A word is found anywhere in the text,** including inside another word.

## How results are ranked

For each word, the best field counts: the field's weight, times 1 when the word starts a word in the text and 0.6 when it is found inside one. The words' scores are added. The title then adds a bonus for the query as a whole:

| The title | Adds |
|---|---|
| Is exactly the query | 6 |
| Starts with it | 3 |
| Contains it | 1.5 |

Ties go to the unit edited most recently.

| Order | Meaning |
|---|---|
| Best match | By score. The default when there are words |
| Last edited | The default when the box is empty |
| Newest | By when the unit was first written |
| Title A–Z | By title |

## The panel

- **The box.** Results update as you type. Escape clears it.
- **Type.** Filters by a type, with a count beside each. Several records can stand for one type, since each device and each paper's reading can bring its own copy of "Claim"; they count as one entry. Units with no type are listed as "No type yet".
- **Credited to.** Filters by the person or lab a unit is credited to. "Me" is first.
- **Sort.** The four orders above.
- **Titles, Passages, Notes.** Choose which fields the words are looked for in. At least one stays on.
- **The count** says how many units match. The list shows 50 at a time.

Each result shows the title with the found words marked in yellow. When the title does not hold every word, a second line shows a passage or note snippet of up to 160 characters around the first word found, cut at word edges, with its words marked. A result also names the canvases the unit is on.

| Action | What it does |
|---|---|
| Click a result | Picks it and shows a preview. Click again to close the preview |
| ⌘, Ctrl or Shift and click | Adds it to, or takes it from, the picked set |
| Up and Down | Move through the results |
| Enter | Opens the unit's note, or the Context panel when it has no note |
| **Put on …** (with several picked) | Places them on the open canvas, and says how many were already there |
| Link | Inserts a link to the unit at the cursor in the note being edited |

## The finder

The finder shows the 12 best matches by title, passage and note.

| Key | Opened as Find a unit | Opened as Link a unit… |
|---|---|---|
| Enter | Opens the unit | Inserts a link at the cursor |
| Alt+Enter | Inserts a link at the cursor | Opens the unit |
| ⌘+Enter or Ctrl+Enter | Puts it on the open canvas | The same |
| Shift+⌘+Enter or Shift+Ctrl+Enter | Opens the panel with the same words | The same |
| Up and Down | Move through the results | The same |
| Escape | Closes it | The same |

A click on a result follows the same keys. A unit with no note cannot be linked, and the finder says so. Linking needs the cursor to be in a note.

## Candidates

A candidate is a line tagged while writing that can become a unit later.

1. In **Types and relations**, give a type a candidate tag, such as `clm-candidate` for Claim.
2. Tag a line in any note: `- Load sets the assembly rate #clm-candidate`.
3. The top of the search panel says how many lines are tagged. Open the list and press **Make it a Claim**.

What happens on that press:

- The line's own words become the unit's title. The tag, the list mark and any checkbox are left out.
- A note is made from the type's title format and template, with `{title}`, `{date}`, `{author}` and `{type}` filled in.
- The line is replaced by a link to the note.
- If a note of that name already stands for a unit, the line links to it and no second unit is made.

Nothing becomes a unit until that press. The list reads up to 500 tagged lines. It needs a base with tags, so it works in Obsidian. A tag is not styled where it is written.

## Proposals

What an agent has proposed is listed at the top of the panel, above candidates, grouped by conversation. Each item, or a whole group, can be accepted or turned down there. See [ai.md](ai.md#proposals).

## Elsewhere: units that say something close

**Elsewhere**, in the Context panel, lists up to six questions, claims and evidence elsewhere whose wording is close. Closeness is by words alone: small words are dropped, endings are cut back roughly, and a word few units use counts for more than a common one. It offers candidates for a person to judge. It never states a relation.

## For an agent

The MCP server's `dg_search` uses the same ranking and adds filters by paper and by date. See [mcp.md](mcp.md).

## Where the code is

| Piece | File |
|---|---|
| Folding, words and marks | `packages/contract/src/words.ts` |
| Index, ranking, filters | `packages/core/src/search.ts` |
| Candidates | `packages/core/src/gather.ts` |
| Similar units | `packages/core/src/similar.ts` |
| Panel and finder | `packages/surfaces/src/search/` |

Tests are in `test/search.test.ts`, and `harness/search-test.mjs` drives the panel in real Obsidian.

## Limits

- A word must appear as written. Search does not match by meaning, by stem or by spelling that is close.
- The panel filters by type and by credit. It does not filter by paper or by date.
- A paper's full text is not searched, only the passages units were read from.
- In the real-app suite, linking a found unit at the cursor fails on some runs.

## Not built

These are planned in [ROADMAP.md](../ROADMAP.md):

- Search by meaning, from an embedding model on the person's own computer.
- Search by person, across everything someone did.
- Search by time.
