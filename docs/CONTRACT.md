# Discourse Graphs contract, draft 1

Status: run in real Obsidian and real Roam, using an offline Roam graph, with a real core, a real canvas and a real context panel. Hosted Roam graphs are untested. See "Results on real hosts".

This defines how a shared HTML interface works with any base. The direction it serves: a rendered HTML interface, local first with optional sync, opened as a panel inside each base, so Roam and Obsidian users share one mental model.

## Shape

```
HTML surfaces      canvas, context, Library, upload, welcome
      |            Surface API: messages across the frame boundary
DG core            records, grammar rules, papers, units, labs
      |            Host contract: what a base must provide
Roam adapter       Obsidian adapter
```

There are two seams here, and a third, Services, joins core to a server. [ARCHITECTURE.md](ARCHITECTURE.md) has the whole picture.

- **Host contract** ([host.ts](../packages/contract/src/host.ts)): what a base provides to core. Each adapter implements it and must pass the conformance suite.
- **Surface API** ([surface.ts](../packages/contract/src/surface.ts)): what surfaces can ask of core, sent as messages across the frame. It's the same in every base.

Core runs in the plugin, not in the frame. Capture and inline badges need the graph while no panel is open, and several panels should share one index. [src/core.ts](../packages/contract/src/core.ts) lists what the adapter's native UI calls.

Sync and usage logging attach to core. They never touch a base directly.

## Rules

1. **The base owns prose.** Surfaces can create text, rename it, reveal it and insert links. They can't edit a body. Writing happens in the base.
2. **Surfaces never see a `HostRef` or the host's name.** They work with DG IDs, so they can't depend on a base.
3. **Everything crossing a seam is plain JSON**, so transport can change without rewriting either side.
4. **Host calls never reject.** Failure is a returned value with a code.
5. **Records are never deleted.** They're superseded, withdrawn or rejected, so history and attribution survive.
6. **Indexes are disposable.** Core can rebuild from records and text at any time.
7. **Events are hints.** A listener re-reads. Teammates, file sync and hand edits all take the same path as the plugin's own writes.

## Records

Source: [records.ts](../packages/contract/src/records.ts). Every record carries `v`, `id` (UUIDv7), `kind`, `space`, `at`, `by`, and an optional `ext`. Unknown fields must be preserved, so older adapters don't damage newer records.

There are two classes, and that split is what makes local-first merging simple.

**Assertions** never change, so merging is a union. Two people disagreeing is content, not a conflict.

| Kind | Meaning |
|---|---|
| `relation` | Someone asserts that `source` relates to `target` by `type` |
| `retraction` | The author withdraws their own record |
| `decision` | A space accepts or rejects something that arrived from elsewhere |

**Documents** are replaced whole. They add `rev`, `editedAt` and `editedBy`, while `by` and `at` keep the original author. The highest `rev` wins, with deterministic tie-breaks, so every replica converges.

| Kind | Meaning |
|---|---|
| `node` | A discourse unit: `title` (content only), and `type` once someone has typed it |
| `anchor` | Ties a node to text in one space |
| `node-type` | A local label pointing at a nearest base type |
| `relation-type` | Label, complement, and which node types it can connect |
| `canvas` | A named canvas |
| `canvas-item` | One card or edge on a canvas |
| `snapshot` | A node's full text, for readers in other spaces |
| `person` | Links one person's identities, for display only |

Decisions that follow from DG's intent:

- **Incremental formalization:** `type` is optional, so a node can exist before anyone commits to what it is.
- **Local labels:** `base` is what interoperates, not the label. A lab's "Hypothesis" is a `node-type` with `base: "claim"`. Types are never matched by name.
- **Reified relations:** relations are records, never fields on a node.
- **One accept state:** a relation's state comes from `foldRecords`, as `active`, `pending`, `rejected` or `withdrawn`. This replaces today's two opposite `tentative` flags.
- **Local records:** anchors and decisions describe one space, so sync must not carry them.

`buildCanvas` assembles a canvas into plain JSON Canvas 1.0. A discourse node is a text card with a `dg.node` ID, so the output still reads as an ordinary canvas. Positions must be integers, as that spec requires.

## Host contract

| Operation | Purpose | Roam | Obsidian |
|---|---|---|---|
| `describe` | Space, person, appearance | `graph.name`, `user.uid` | ID stored in the vault, local profile |
| `listText`, `readText` | Reach text as Markdown | Flatten the block tree | `cachedRead` plus metadata |
| `searchText` | Find by title or tag | Query | Metadata scan |
| `listBacklinks` | What mentions this | `:block/refs` | Resolved links |
| `createText` | New page or file | Create page | Create file with an ID in frontmatter |
| `renameText` | Rename | Update page | `renameFile` |
| `pinText` | Make a ref survive renames | Nothing to do, UIDs are stable | Write an ID to frontmatter, as `ensureNodeInstanceId` does today |
| `listRecords`, `putRecords` | Store records in the base | Per-device block trees, batches in props | Per-device `.jsonl` logs in a visible folder |
| `readAsset`, `writeAsset` | Figures, images and PDFs. A PDF goes where a person would look for it | `file.get`, `file.upload`, plus a PDF embed on "Discourse Graphs/PDFs"; block props in offline graphs | `readBinary`, `createBinary`; a PDF goes to "Paper files" |
| `listFiles` | The PDFs a base holds, for the reader | `{{pdf: ...}}` embeds, and PDFs kept in block props | `getFiles`, by extension |
| `getFocus` | What's open | Open page or focused block | Active file |
| `reveal` | Open text in the base | Main window, or the sidebar when a panel covers it | `openFile` in a leaf |
| `insertLink` | Link at the last cursor | Edit the block | Edit at the saved cursor |
| `openSurface` | Mount a panel, side or main | `ui.mainWindow.openComponent`, or injected into the sidebar | `ItemView` in a leaf |
| `getLocal`, `setLocal` | Per-device state | Browser storage | Plugin data |
| `subscribe` | Change hints | Polling today; see "Results on real hosts" | Vault and workspace events |

Details an adapter must get right:

- **Refs:** opaque, and stable once pinned. Refs from `createText` are always pinned. A file path alone isn't enough, because a rename outside the plugin would break it.
- **Titles:** `createText` returns the title actually stored, because hosts restrict characters.
- **Cursors:** `listRecords` always returns a `next` cursor, even on the last page. Reads are at-least-once: repeats are fine, misses are not.
- **Versions:** `listRecords` may return several versions of a document, and `foldRecords` picks the winner. A store that overwrites by ID fails the suite, because a stale write could beat a newer one.
- **Focus:** a panel click takes focus from the editor, so the adapter must remember the last cursor for `insertLink`.
- **Failures:** wrap the host in `neverRejects`, because bases throw. Roam's write limit arrives as an exception.

**What stays in the adapter:** capture (`\`, with the same key and result everywhere), inline badges, commands, menus and graph view styling.

## Identity and AT Protocol

[ids.ts](../packages/contract/src/ids.ts) makes ids, [atproto.ts](../packages/contract/src/atproto.ts) turns records into AT records with CIDs, and [core/identity.ts](../packages/core/src/identity.ts) handles DIDs. [lexicons/](../lexicons/) holds the lexicons. `science.mira.*` is copied from the unfiled draft in `mira-lexicon/`, and `org.discoursegraphs.*` adds tool records beside the team's prototype.

Records stay in their local log, which is what lets offline devices merge. AT records are a projection of that log, with lexicon validation in the tests. Nothing has been published: no PLC registration, no PDS and no lexicon records.

A node's collection follows its type, so its AT URI can change while its id and record key never do. After publishing, retyping a node would mean deleting and recreating that record, and updating references to it.

## Surface API

[surface.ts](../packages/contract/src/surface.ts) lists what the canvas and context panel use: nodes, relations, canvases, the grammar, reveal and focus. [core/index.ts](../packages/core/src/index.ts) answers these the same way on both hosts. Surfaces never receive a `HostRef`, so they can't depend on a base.

## Usage logging

[usage.ts](../packages/contract/src/usage.ts) wraps the host once, so both bases are measured the same way. It records operation names, outcomes and timing, and never arguments, because arguments can hold research content. Events go to a local log first. Obsidian's directory bans client-side telemetry in listed plugins, so sending the log has to be a separate step, and Obsidian should confirm that step complies.

## Conformance

[conformance.ts](../packages/contract/src/conformance.ts) has 37 checks. It uses no test framework, because a real adapter can only be proven inside its live base. Each adapter supplies a small driver that plays the part of a person or another device: renaming outside the plugin, restarting, or a teammate's write. Run it against a throwaway graph or vault, since it leaves fixtures behind.

```bash
npm test
```

```bash
npm run check-types
```

The tests also feed the suite deliberately broken hosts, to confirm it catches real faults: path-style refs, dropped fields, stale overwrites, lost cursors, forgetting on restart, silent changes, and thrown errors.

## Coverage of today's plugins

```bash
npm run coverage
```

[scripts/host_coverage.py](../scripts/host_coverage.py) sorts every host call in both plugins into a contract area, adapter-private work, native UI, or not carried over.

| Area | Roam | Obsidian |
|---|---|---|
| Read | 231 | 132 |
| Write | 82 | 40 |
| Navigate | 64 | 33 |
| Watch | 14 | 37 |
| Identify | 34 | 7 |
| Assets | 6 | 10 |
| Local state | 0 | 2 |
| Adapter private | 44 | 36 |
| Native UI | 10 | 39 |
| Not carried over | 3 | 0 |
| Unclassified | 0 | 0 |

This shows every call has a home. It doesn't show each one is easy. Many of Roam's reads are Datalog queries that core's index must replace, which is real work. It also doesn't count Roam's DOM observers, which aren't API calls. Roam's native semantic search is the only thing dropped, and that's a choice to revisit.

## Settled decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Base relations | Supports, Opposes, Addresses, Informs, Derived from. `interpretedAs` and `curatedTo` are read as aliases of `derivedFrom` | The first three are in the schema. Informs is both plugins' default and the only low-formality link. Derived from is PROV's term, which the schema says that link should map to |
| 2 | Title format | `node.title` holds content only. `titleFormat` is local presentation, so Roam keeps `[[CLM]] - {content}` and Obsidian keeps `CLM - {content}` | Both bases keep their habits and surfaces show the same thing. Proven on both hosts: same record title, different base title |
| 3 | Evidence and its source | A relation only. `titleFormat` rejects anything but `{content}`, so `{Source}` can't come back | "Relations should be separate assertions" |
| 4 | Roam's pattern-based relations | They become `proposed` relations, pending until someone decides. Tools and AI use the same path | A pattern match isn't anyone's assertion. Migration can accept in bulk |
| 5 | Node recognition | A title in a type's format makes a node. A candidate tag only suggests one. Roam's Datalog specifications don't carry over | Writing the format is an explicit act, so write-first still works |
| 6 | Canvas concurrency | One `canvas-item` record per card or edge | Edits to different items never collide, using the same merge rule as everything else. Same-item edits are last-writer-wins |
| 7 | Full text in sync | `snapshot` records, written only by sync. The base stays the source of truth | Readers elsewhere get text without a copy of the page |
| 8 | People across bases | `person` records link identities for display only. Withdrawal still needs an exact ID | An unsigned alias is only a claim. Authority can widen once sync has signatures |
| 9 | Roam record storage | A block tree per device, with batches of up to 200 records in block props | Measured below. Props avoid a real hazard: `[[...]]` in a block string becomes a page reference |
| 10 | Canvas engine | React Flow 12 in the frame, with JSON Canvas 1.0 as the format. Freehand strokes are a DG item that `buildCanvas` leaves out of `.canvas` files | MIT licensed, and one bundle runs on both hosts. See [CANVAS-ENGINES.md](CANVAS-ENGINES.md) |
| 11 | Unit ids | Every record's id is its author's DID and a TID, such as `did:plc:abc#3lz4qk7mfja2c`. The AT URI is derived from it | A type isn't part of the id, so typing a node later never changes it. The id is also written into new notes and pages |
| 12 | Lexicons | Nodes and relations use `science.mira.*`. Grammar, canvases, labs and people use `org.discoursegraphs.*`. Anchors and decisions stay local | DG speaks the shared science schema, without asking MIRA to take on tool data |
| 13 | Identity | A did:plc computed on the device, with private keys unextractable in IndexedDB. Nothing is sent | The same DID can be registered later, so no id ever changes. Keys stay out of a vault or graph that may sync |
| 14 | Repos and labs | One repo per person. A lab has its own DID, and the person who sets it up is its custodian. Joining is a choice, and it ranks the PI's key above the member's on their DID | Real authorship with real custody, and no shared signing key. The lab is credited in `attributedTo`, and the custodian can also withdraw a member's relation |
| 15 | Editor capture | Select text, press `\`, and press a letter. A plain `\` with nothing selected stays a backslash. One menu serves both bases | The same gesture everywhere. Today's plugins differ here, and Obsidian swallows the key |
| 16 | Link badges | One badge beside every link to a node, drawn by the adapter from `core.badgeFor`. It opens the context panel rather than its own popover, and the note keeps the keyboard | One place to read context in every base. The count comes from the core synchronously, because editors draw synchronously |
| 17 | Tidy | Layouts are judged on the curves as drawn, with crossings first, in the surface and with no new dependency. A benchmark holds it against ELK | The layout needs the renderer's own geometry and the person's frame. ELK would add 1.6 MB and leaves more crossings on these canvases |
| 18 | Tidy modes | Nine modes, stored on the canvas record, because positions are shared and so are the headings. An arrow keeps saying who asserted what, and a relation's base type decides which way it leans | `derived from` points at what it rests on, so arrows alone can't give reading order |
| 19 | Credit | `creditFor` picks a person inside a lab and the lab from outside it. Names come from the person record, so setting a name reaches earlier work, and old records stay as written | The same unit reads differently from each side, and history doesn't change |
| 20 | Canvas homes | A canvas's home is an ordinary note or page, tied to the canvas by an anchor. The host contract gained only `removeText` | The base's search, lists and links work with no new contract. In Roam the canvas lives on its page, so leaving is just going somewhere else |
| 21 | Walkthrough | One set of steps in `packages/native/src/walkthrough.ts`, with each base supplying words and places. It writes to the real graph, as the person chose, and tracks what it made | A demo canvas would teach less, and tracking makes it safe to remove |
| 22 | Services | Core gets `Services` injected and never touches the network itself. Only `@dg/sync` calls `fetch`, and everything works without it | Local first has to be structural, and a test can pass a fake server |
| 23 | Papers | A paper is a record with its own canvas. Its units stay on that canvas until exported, and only then get a note or page | One paper can be 30 units, and reading shouldn't fill a vault |
| 24 | What's kept on the service | A paper with a DOI has its extraction and DOI kept, and never its file. With no DOI, nothing is kept | Decided by the product lead, and said in the upload pop-up |
| 25 | Lab sync | Each member holds a full copy, and the server exchanges opaque records. Only what's on shared canvases is offered | Losing the server costs freshness, not work |
| 26 | Reactions and notes | They live on shared canvases only, one reaction per person, and they never notify. Notes stay apart from the unit, and only their author can remove them | From MIRA: reactions must not read as approval, and PIs shouldn't be nudged |
| 27 | Breadcrumbs | Offered on closing a lab paper, with ask, always or never as a default kept on the device. Nothing is recorded until a person chooses, and the uploader isn't asked | Being seen reading is a choice, and the repository already names the uploader |
| 28 | Test hooks | Each plugin's hooks are in `testing.ts`, and a release build leaves them out | A shipped plugin shouldn't carry a test surface |
| 29 | Reading PDFs | DG's own reader panel, beside the canvas, with pdf.js in its own bundle. Obsidian's viewer stays the default for PDFs and gets a "Read in Discourse Graphs" entry. The host contract gained only `listFiles` | Hooking Obsidian's viewer means undocumented internals that break between releases, and Roam and the local app would still need a reader. One panel works and is tested in every base |
| 30 | A highlight's unit | A highlight becomes a staged unit with `facts.anchor` (the words, the page and the source) and `prov.sourceDocument`. The file is a source unit pinned by its content hash, made the first time anything is read from it, or the paper's own source if it has one | The words are a W3C text quote, found again by their text, so the mark survives re-rendering, and a renamed file is still the same source |

Decision 1 needs the schema owners to update the conceptual schema and `dg_core.ttl` to match.

## Results on real hosts

Obsidian 1.15.0, in a throwaway vault, as a real plugin. Roam Desktop 0.0.42, in an offline graph, with the bundle loaded over a debug port rather than through Roam Depot. Both ran the same panel and canvas builds. Raw reports and screenshots are in [reports/](../reports/).

| | Obsidian | Roam |
|---|---|---|
| Conformance | 36 of 36 | 36 of 36 |
| Panel checks | 8 of 8 | 8 of 8 |
| Canvas slice, with real mouse and keys | 35 of 35 | 35 of 35 |
| Real data and context panel | 29 of 29 | 29 of 29 |
| Editor capture, with real keys | 24 of 24 | 24 of 24 |
| Link badges, with real clicks and keys | 23 of 23 | 24 of 24 |
| Tidy, judged on the lines drawn | 14 of 14 | 14 of 14 |
| Tidy modes, finding canvases and credit | 21 of 21 | 21 of 21 |
| Walkthrough, with real keys and clicks | 29 of 29 | 29 of 29 |
| Two labs sharing work across bases | 14 of 14, over both | |
| Papers, labs, reactions, breadcrumbs and AI | 110 of 110, over both | |
| Panel to core round trip | 0.2 to 3 ms | About 0.25 ms |
| 5,000 records: write, read, fold | 135, 52, 1 ms | 234, 7, 2 ms |
| Records survive a real reload | Yes | Yes |
| Records taken from the other host | 58 arrived, 3 relations pending, 3 accepted | 79 arrived, 6 pending, 6 accepted |

The timing rows and the exchange counts are from before the core was replaced, and weren't remeasured.

Exchange worked in both directions. Titles, relation types and canvases arrived intact, and each relation waited as pending until accepted, with nothing shared but records.

### Canvas slice

[harness/slice-test.mjs](../harness/slice-test.mjs) drives the same canvas bundle in both bases, then reads the result back out of the base. It covers:

- Creating nodes, which makes real pages and notes
- Moving a card, which writes one record
- Drawing a relation, including the grammar blocking one that isn't allowed, and complement wording when drawn backwards
- Typing a node, which renames its text in the base
- Strokes and notes
- A rename in the base, and a teammate's record, both reaching an open canvas
- Opening a card in the base
- Deleting an item, and deleting an edge while the relation stays
- Following the host's theme
- Logging usage locally with no content
- Surviving a reload
- Long titles, dropping a connection on empty canvas, undo, and each measured frame width

Two further checks ran by hand:

- **A canvas made in Obsidian opened in Roam** from 40 records. Layout, cards, the relation, a note and a stroke all arrived. Cards say "No text in this base", because the text stayed in the vault. See [media/obsidian-canvas-in-roam.png](media/obsidian-canvas-in-roam.png).
- **Obsidian's own Canvas keeps DG links.** After opening a built `.canvas`, moving a card and saving, `dg` was still on all 3 cards and the edge. Strokes aren't in that file, by decision 10.

Real hosts changed the design in these ways:

- **Roam has its own panel slot.** `ui.mainWindow.registerComponent` and `openComponent` host a custom main view. It isn't in anything I read and DG doesn't use it, so check that it's stable. Only the sidebar panel still needs DOM injection.
- **`reveal` could hide behind a panel.** In Roam, `openPage` changes the page under an open custom view. The adapter now uses the sidebar, and a conformance check guards this.
- **Offline Roam assets can't be read back.** `local-asset://` fails with `file.get`, `fetch`, XHR and `<img>`, so offline graphs keep assets in block props. A 2 MB asset worked.
- **Roam limits writes to 1,500 per minute**, and reports it by throwing. Batching makes record writes safe, but a bulk migration that creates pages must pace itself.
- **Roam has no global change feed that I found**, so the adapter polls. That took 9 to 15 ms per pass at 652 pages and 3,217 blocks, which would likely be too heavy at 1 second on a large graph. Recursive pull watches do fire for nested edits. The fix is watches on anchored pages plus a slow scan for new ones. That isn't built.
- **A rename on disk reaches Obsidian as a delete and a create, in either order.** The adapter waits 1.2 seconds before calling text removed, and ignores a delete for a note that has already arrived at a new path. Before that second rule, every disk rename marked the note as removed. A screenshot caught this, not a check, so conformance and the slice now both guard it.
- **Hidden Roam windows poll slowly.** Past about five minutes hidden, a 1-second timer stopped after six ticks. Change events then lag, and the two event checks with short windows failed in 2 of 3 runs in that state. They never failed with the window drawing. Writes read back immediately, and the poll compares counts, so a later pass still reports the change.
- **Sandboxed frames have no storage.** `localStorage` is blocked, which confirms that the index belongs in the plugin.
- **Frames don't see the host's theme.** They follow the system setting unless told otherwise, so `appearance` is forwarded and the canvas follows it.
- **Sandboxed frames block forms.** Without `allow-forms`, submitting does nothing and reports nothing, so surfaces use buttons and key handlers.
- **Roam remounts custom views**, so a surface can lose its place. `canvas.last` returns the canvas last open on this device.

### Real data

[harness/matsulab.mjs](../harness/matsulab.mjs) rebuilds the published MATSUlab records in each plugin's own storage format, and [harness/real-test.mjs](../harness/real-test.mjs) imports them. This is real text and real links, but not a real install: the lab's raw export isn't public, and the grammar is rebuilt from the published node types.

| | Obsidian | Roam |
|---|---|---|
| Nodes | 140 | 141 |
| Relations asserted | 10 | 10 |
| Relations proposed | 4 | 4 |
| Text changed | None | None |
| Second import | Adds nothing | Adds nothing |

Roam has one more node because a link in a real title made a page for a citation key, and that page matches the `@{content}` format. The 4 proposed relations arrive differently and land the same: `tentative` in a vault, and `{Source}` title text in Roam.

Real titles changed the design:

- **Titles carry inline links**, such as `[[@roudot2023utrack3d]]`. Records keep them, and panels show them without brackets.
- **Long titles collide when placed by hand**, so the canvas has Tidy.
- **A canvas in Roam's custom view covered the page**, and going to a page changed what was beneath it, so people couldn't leave. Canvases now live on their own pages. The custom view is only used when no canvas exists yet.
- **Obsidian's status bar floats over the bottom of the right sidebar**, so nothing in a side panel can rely on the bottom edge.
- **Synced vaults make copies of notes, ids included.** On iCloud, a fast delete and rewrite left 98 "Note 2.md" files. The first file keeps the id, a copy gets its own ref, and the import skips and reports it.
- **Grammars can arrive twice.** A test run showed each type three times in the capture menu, most likely iCloud restoring an old record log, though that wasn't proven. Two offline devices would do the same thing, so the same label now means the same type, and the oldest record speaks for it.

### Link badges

[harness/badge-test.mjs](../harness/badge-test.mjs) drives badges with real clicks and keys. Counts change with the graph without a reload, a rename keeps the badge, and the text is never touched. Roam redraws a block when it leaves editing, so a watcher puts badges back.

The core now starts when the plugin loads, because badges need the graph with no panel open. A vault or graph with no records waits for first use, so loading alone never writes anything.

Testing changed one thing: opening the context panel used to take the keyboard away from the note. A side panel now hands it straight back, so a person can keep typing.

### Tidy

[harness/tidy-bench.ts](../harness/tidy-bench.ts) scores each layout on the curves React Flow draws, in a 725 by 800 px frame. "Generated" arguments have shared evidence, which tangles them. Scores are means.

| Argument | Crossings before | Now | ELK | Links behind cards before | Now | ELK |
|---|---:|---:|---:|---:|---:|---:|
| MATSUlab, 12 to 15 cards | 1.8 | 1.6 | 1.6 | 1.2 | 0 | 0 |
| Generated, 10 cards | 1.6 | 0.1 | 0.2 | 6.3 | 0.6 | 0.9 |
| Generated, 20 cards | 9.3 | 0.5 | 1.9 | 28.1 | 2.5 | 5.3 |
| Generated, 30 cards | 32.4 | 2.8 | 7.8 | 68.3 | 5.3 | 10.3 |
| Generated, 140 cards | 1,684 | 467 | 833 | 1,714 | 376 | 519 |

- **The real graph is at its limit.** All of MATSUlab has 2 crossings, down from 3. An exhaustive search over those columns confirms 2 is the minimum while supports stay on the left.
- **Searching harder doesn't help.** Twenty times the search found nothing better at 10 or 20 cards, and about the same at 30.
- **On screen:** [harness/tidy-test.mjs](../harness/tidy-test.mjs) tidies a tangled 20-card canvas in each base and counts from the browser's own paths: 7 crossings down to 0, and 17 links behind cards down to 0, matching the prediction.
- **Fit is the weak spot.** At 30 cards, Tidy fits the 725 px frame at about 37% zoom, the same as ELK, so a canvas that size still opens at 70% and needs panning. Tall fans are the cause: a link can't pass a column cleanly unless it runs nearly level, because each link is one curve with no bend points.
- **Speed:** about 20 ms at 12 cards, 180 ms at 30 and 400 ms at 140, in one run on one machine.
- **The real data is small.** MATSUlab's linked graph is 15 cards and 14 links, so the larger figures come from generated arguments, not from a real lab.

### Tidy modes, credit and finding

Sources for the design are in [reports/modes/sources.md](../reports/modes/sources.md).

- **Real data has no real dates yet.** A real import keeps each text's creation time, but the seeded vault and graph were all made the same day, so Timeline shows one period on them. The unit tests and imported AT records carry real dates.
- **Rankings cross.** On a 20-card argument, Most connected drew 49 crossings, because rank order comes first. Its links fade until hovered.
- **The two-lab test** ran a lab in Obsidian and a lab in Roam, exchanged records, and read each canvas back. Each side saw its own contributor as a circle and the other lab as a square.
- **Testing changed five things:** Roam kept its canvas styling after leaving a canvas page. A walkthrough step finished by itself when the panel was already open. A second walkthrough skipped steps when old nodes existed. Tidy ignored a change of mode on a canvas that was already tidy. And after two labs shared work, Roam started writing titles in Obsidian's format, because the oldest type record won. A space's own types now go first.

### Identity and schema

The reference `@did-plc/lib` accepts the DIDs and signatures made here, including the operation that adds a custodian. `@atproto/lexicon` accepts every record a person can make. The 20 published MATSUlab `science.mira.*` records read in and project back to the same AT URIs, and their relations wait as pending.

[COMPARISON.md](COMPARISON.md) compares all of this with today's plugins.

## Not yet proven

- **Hosted Roam graphs:** no hosted graph was available, so `file.upload` and `file.get`, shared-space behaviour and real teammates' concurrent writes are untested.
- **Roam Depot install:** the bundle ran in the real page, but not through the extension lifecycle.
- **Phones:** neither mobile app was tested.
- **Obsidian Sync:** whether it carries `.jsonl` files by default needs checking.
- **Large graphs:** Roam's polling cost above is extrapolated from a small graph, and the real data here is 140 nodes. Badges rescan a Roam page's links after each change, which hasn't been timed on long pages.
- **Tangled real arguments:** Tidy's larger results come from generated arguments. No real lab canvas above 15 cards has been tried.
- **The walkthrough with people:** it's been driven by scripts, not by a new user. Its 3 minutes is an estimate.
- **Roam canvas pages in the sidebar:** opening a canvas page in Roam's right sidebar shows the page, not the canvas.
- **Right-to-left readers:** the left-to-right layouts aren't mirrored.
- **Real models:** MIRA and hosted AI models have only run against fake servers. Demo replay, sentence split and search-only answers ran for real.
- **Real labs:** the lab tests used two people on one computer, against a reference server.
- **The network:** no DID has been sent to a PLC directory, and no record has reached a PDS. Reference libraries accept the formats, but a real directory hasn't. A repo export as a CAR file isn't built.
- **Keys:** a private key can't be backed up, and only the device that made it can sign. A second device shares the DID but can't change it. The custodian is the way back for lab members, and a PI has no such route yet.
- **MIRA:** the lexicons are drafts from an unfiled RFC, and field names can still change. `derivedFrom` isn't one of `science.mira.relation`'s known predicates.
- **Real installs:** the import reads the older Roam settings layout. Roam's newer settings store, pattern-based relations from `If` specs, and a lab's own grammar are not yet read.

## Still needs a person

- **Obsidian directory listing:** required or not, which decides how telemetry can ship.
- **Schema owners:** adopting decision 1.

## Run it on real hosts

See [testing.md](testing.md).

## Not in this draft

Publishing to a PDS, a person-facing import flow, a custody screen, the node card and grammar surfaces, and sending usage anywhere. Sync and the services around it came later, and [services.md](services.md) describes them. [packages/core/](../packages/core/) is real but holds the graph in memory and hasn't met a large graph. [The adapters](../plugins/) are proofs, not production plugins.
