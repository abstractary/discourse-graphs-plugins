# Zotero

This page covers how Discourse Graphs reads a Zotero library: what is asked of Zotero, what each thing in Zotero becomes, how Zotero serves as the PDF library, and how a lab shares a Zotero group.

Zotero stays the library, and Discourse Graphs is the argument built on it. A reference becomes one Source unit that points back at its Zotero item. A highlight becomes a unit that quotes its passage. Zotero is only read, and only when a person asks.

## Requirements

- The Zotero desktop app, running on the same computer. The local API exists from Zotero 7. Annotations are served from Zotero 8.
- In Zotero, under Settings, Advanced, the setting that lets other applications on the computer communicate with Zotero is on.
- No Zotero account, key or web access is needed.
- A base that can reach `localhost`. Obsidian and the local app can. Roam in a browser cannot read a file in place.

When Zotero cannot be reached, the dialog says which it is: Zotero is not open, or the setting is off.

## The rules

1. **Zotero is the library.** Discourse Graphs holds a pointer to an item, not a copy of the library. There is no background sync and no index of everything.
2. **Pull only.** A person searches, picks a reference, and picks which highlights to bring. Nothing else arrives.
3. **Identity is the work, not the item.** DOI first, then PMID, PMCID, arXiv id, ISBN. A Zotero item address (`users/<id>/items/<key>`) and a citation key are locators. They find an item again. They never decide that two things are the same paper. The comparison is made by the one resolver in [`core/work.ts`](../packages/core/src/work.ts), described in [scholarly.md](scholarly.md#is-this-the-same-work).
4. **A passage is its words.** A unit keeps the quoted text and the page. Zotero's own coordinates are kept only inside the link that opens the passage in Zotero.
5. **When Zotero is the PDF library, it is the only one.** With **Use Zotero as your PDF library** on in Settings, the papers to read are Zotero's. Each is opened where Zotero keeps it and never copied into the base. A copy in the base of a paper Zotero holds is the same work, so it is not listed beside Zotero's.
6. **A personal library's address is one person's.** On its own computer a personal library is always `users/0`, so that address means a different library on every teammate's machine. It is kept as a fact about the unit. It marks, matches and opens an item only for the person whose unit carries it. A group library's address (`groups/…`) is the same for every member and is used by all of them.
7. **One file knows Zotero.** [`packages/sync/src/zotero.ts`](../packages/sync/src/zotero.ts) is the only place that knows Zotero's API.

## What is asked of Zotero

Every request goes to `http://localhost:23119/api` with three headers: `Zotero-Allowed-Request: 1`, `Zotero-API-Version: 3` and `accept: application/json`. Zotero drops a request that looks like it came from a web page unless it carries the first. Each request has eight seconds.

| Call | Request | Used for |
|---|---|---|
| Status | `/users/0/items?limit=1&format=keys` | Whether Zotero answers. Reads its version from `X-Zotero-Version` and its id from `Zotero-Server-ID` |
| Groups | `/users/0/groups` | The group libraries this person belongs to |
| Search | `/users/0/items/top?q=<words>&qmode=titleCreatorYear&limit=20&sort=dateModified&direction=desc` | Finding a reference by title, author or year. Attachments and notes are left out |
| One item | `/<library>/items/<key>`, then `/children` | A reference and its attachments |
| Annotations | `/children` of each attachment | A reference's highlights, in reading order |
| PDFs | `/<library>/items?itemType=attachment&sort=dateModified&direction=desc`, 100 a page, then the parents 50 at a time | Listing up to 500 PDFs across the personal library and every group |
| One PDF | `/<library>/items/<key>`, then its parent | Where one PDF sits on disk, and its reference |

| Zotero answers | The person is told |
|---|---|
| Nothing | Zotero is not open |
| 403 | The setting under Advanced is off |
| 404 | Zotero no longer has that item. It may have been merged or deleted |
| Any other error | Zotero answered with an error, with its status |

The local API gives a PDF's path, not its bytes. The base reads the file itself through `Host.readLocalFile` in [`contract/host.ts`](../packages/contract/src/host.ts).

Nothing is sent to zotero.org, and nothing is written to Zotero. [what-leaves-the-device.md](what-leaves-the-device.md) has the full account.

## What maps to what

| In Zotero | In Discourse Graphs | Kept |
|---|---|---|
| An item (article, preprint, book) | One **Source** unit | Title, authors, date, venue. DOI, PMID, PMCID, arXiv id, ISBN, citation key, and the item's address in the library |
| A PDF attachment | Nothing by itself. It is what annotations hang from | Its key, inside the link that opens a passage |
| A highlight or underline | A unit that quotes it. **Evidence** unless a tag says otherwise | The exact words, the page, the reader's comment, and a link that opens it in Zotero |
| A note or text annotation | A unit whose statement is the note. **Claim** unless a tag says otherwise | The page and the link |
| A picture or a drawing | Listed in the dialog and not brought in | — |
| A tag on an annotation | Its type, when the tag names one | — |
| A colour | Shown, never interpreted | — |
| A group library | The same, with the group in the item's address | — |

- **Venue** is the first of: publication title, proceedings title, book title, repository, publisher.
- **Identifiers without a field of their own** are read from `Label: value` lines in the item's Extra field.
- **A tag names a type** when, with any leading `#` or `dg/` removed and case ignored, it equals a type's label, its abbreviation or its base. So `dg/claim`, `claim` and `CLM` all read as Claim.
- **A unit's title** is the quoted words, or the comment when there are none, cut at 300 characters.
- **A highlight is "By hand".** A person read and marked it. Its card says so, cites the source as "Carroll 2020", and lists the paper's identifiers, the same as a highlight made in this app's own reader.
- **The links back** are `zotero://select/library/items/<key>` (or `…/groups/<id>/items/<key>`) for an item, and `zotero://open-pdf/…?page=<n>&annotation=<key>` for a passage.

### Bringing the same thing in twice

- **Nothing new is made.** A source is found by its identifiers, then by its item address. A highlight is found by its annotation's address.
- **A source already in the graph is joined, not doubled.** If a paper was read with Extract graph, or a source was typed by hand with a DOI, the Zotero item attaches to that unit. The unit learns the item's address and any identifier Zotero knows that it did not. Its title stays as its author wrote it.
- **A vault that already has `@citekey` pages keeps them.** When a page with that name exists, the Source unit is tied to it, so the vault is not given a second page per reference.

## The parts

| Part | Where | What it does |
|---|---|---|
| Library types | [`contract/scholarly.ts`](../packages/contract/src/scholarly.ts) | `LibraryItem`, `LibraryAnnotation`, `LibraryFile`, `PaperShelf`, and the `zotero` and `citekey` identifier schemes |
| The Zotero client | [`sync/zotero.ts`](../packages/sync/src/zotero.ts) | The calls above |
| The mapping | [`core/library.ts`](../packages/core/src/library.ts) | Finds the Source an item belongs to, suggests a type for each mark, makes the units, places them on the canvas |
| The dialog | [`surfaces/zotero/App.tsx`](../packages/surfaces/src/zotero/App.tsx) | **From Zotero…** in a canvas's menu: search, pick a reference, tick highlights, choose types, bring them in |
| The way back | Context panel | **Open the passage in Zotero** on a highlight, **Show it in Zotero** on a source |
| Zotero as the PDF library | [`core/reading.ts`](../packages/core/src/reading.ts), `Context.readFile` in [`core/index.ts`](../packages/core/src/index.ts) | Lists Zotero's PDFs, reads each from Zotero's own folder, and finds the paper or source a file already has by its identifiers |
| The mark | `LibraryMark` in [`surfaces/shared/ui.tsx`](../packages/surfaces/src/shared/ui.tsx), `inLibraryOf` in [`core/card.ts`](../packages/core/src/card.ts) | One mark wherever a source is shown, worked out in one place |
| Checking again | The reader's **N in Zotero** button, and `zotero.show` | Opens From Zotero at that reference, with the highlights made since ticked |

The surface calls are `zotero.status`, `zotero.groups`, `zotero.search`, `zotero.get`, `zotero.import`, `zotero.show` and `zotero.pending`.

### Where the mark shows

The same small **Z** mark says "this is in your Zotero library" everywhere a source appears. Where there is room to act, it is a button that shows the item, or the passage, in Zotero.

| Place | What it does |
|---|---|
| A card's Source row, and a Source unit's own card | Says it is in Zotero. Opens it there once the card is selected |
| The head of the Context panel, and **Show it in Zotero** under Where it came from | Opens the item or the passage |
| Every "Carroll 2020" label beside a unit, in Context and in Search | Says the paper is in Zotero |
| The PDF chooser | Marks each of Zotero's PDFs, under **In Zotero** |
| The reader's bar | **Zotero** shows the reference. **N in Zotero** offers highlights made there that are not units yet |
| The Library panel and the Paper map | Marks each paper that is in Zotero |
| A canvas's menu | **From Zotero…** carries the mark |

## Reading a Zotero PDF

With **Use Zotero as your PDF library** on:

- The PDF chooser lists Zotero's PDFs, each named for its reference.
- A PDF opens in this app's reader, read from Zotero's storage folder. Nothing is copied into the base.
- A highlight made in the reader becomes a unit whose source carries the reference's identifiers.
- Zotero's own highlights on that PDF are counted on the reader's bar and offered. Once brought in, they are lit in the reader. They are not drawn before they are units.

## A lab's shelf and your own library

A lab's PI picks one Zotero group as the lab's shelf, on the Lab tab. Every member inherits the choice as part of the lab's settings. See [labs-and-sync.md](labs-and-sync.md#what-the-pi-sets).

| Shelf | What it is | Who can open the PDF |
|---|---|---|
| The lab's | The Zotero group the PI chose. With no Zotero, the lab server's paper repository | Every member, each from their own Zotero, or by getting the file from the lab |
| Yours | Your own Zotero library, or a file in your vault | Only you. Labmates see the reference and its DOI |
| A labmate's | Their own library or vault | Only them. You are told whose copy it is |
| Another group | A Zotero group that is not the lab's | Whoever is in that group |

- **The lab's shelf.** Its items have the same address for every member, so a unit read from one carries the mark for everyone in the group, and each opens the PDF from their own Zotero. The PDF never goes through the lab server.
- **Your own library** stays yours. A unit read from it travels with its reference and DOI.
- **The PDF chooser** lists the lab's shelf first, under the group's name, then your own library.
- **A member with no Zotero**, in a lab that uses a group, sees every reference and is told the PDF is in Zotero.
- **A unit's facts say which shelf its paper is on.** A card says so only when labmates cannot open it.
- **Permissions are Zotero's.** Who may read or add to the group is set in Zotero. The local API does not say what role a person has, and nothing is written to Zotero, so a paper is moved onto the lab's shelf in Zotero.

## Tests

| What | Where | Run |
|---|---|---|
| The client, against responses in the shape Zotero's local API returns | `test/zotero.test.ts`, [`test/fixtures/zotero`](../test/fixtures/zotero/README.md) | `npm test` |
| The mapping, joining and the PDF library | `test/zotero-library.test.ts`, `test/work.test.ts` | `npm test` |
| A lab's shelf across four people | `harness/four-vaults.ts` | `npm run sim` |
| Obsidian against a stand-in Zotero | `harness/people-test.mjs` | See [testing.md](testing.md) |
| Obsidian against the Zotero on this computer | `harness/zotero-real-test.mjs` | See [testing.md](testing.md). Needs Zotero open with at least one reference and its PDF |

## Limits

- **Run against a real Zotero (10.0.9) in Obsidian:** reaching it, listing its PDFs, reading one in place, and making a highlight in this app's reader on it.
- **Run only against the stand-in:** bringing Zotero's own highlights in, the **N in Zotero** count, opening a passage, and group libraries.
- **`zotero://` links** are built in the form Zotero's source writes them and handed to the system. They have not been clicked in a test.
- **Search covers the personal library.** Group libraries are read for PDFs and by item address, not searched.
- **Pictures and drawings** are listed and not brought in.
- **Annotations saved inside a PDF file by another program** are not in Zotero's database, so they are not offered.
- **The same paper in a personal library and in the lab's group** is read as two places for one work. The source keeps the address it was first read from.
- **A passage is found again by its words.** Now and then one cannot be found in this app's reader.
- **Zotero must be running on the same computer.** There is no route through zotero.org, so Roam in a browser and a group library on another computer are out of reach.
- **Roam.** The mapping is shared code. It has not been run in Roam.

## Not built

Reading through Zotero's web API, writing back to Zotero (tagging a used annotation, linking an item to its Source), and a plugin inside Zotero are not built. See [ROADMAP.md](../ROADMAP.md).
