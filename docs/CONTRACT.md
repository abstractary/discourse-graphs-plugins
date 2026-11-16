# The contract

What a record is, what a base must offer, what a panel may ask, and how an adapter is checked. Everything here lives in [`packages/contract/`](../packages/contract/), which depends on nothing else in the repository.

## Shape

```
Panels             canvas, context, Library, search, PDF reader, upload and the rest
      |            Surface API: typed messages across the frame boundary
Core               records, grammar, papers, units, labs
      |            Host contract: what a base must provide
Adapters           Obsidian, Roam, the local app, the MCP server
```

A third seam, Services, joins core to a server. [ARCHITECTURE.md](ARCHITECTURE.md) has the whole picture and [services.md](services.md) has that seam.

| Seam | File | Version |
|---|---|---|
| Host contract | [host.ts](../packages/contract/src/host.ts) | `CONTRACT_VERSION = 1`, reported by `describe` |
| Surface API | [surface.ts](../packages/contract/src/surface.ts) | Same in every base |
| What native UI calls on core | [core.ts](../packages/contract/src/core.ts) | `CoreForAdapter` |
| Records | [records.ts](../packages/contract/src/records.ts) | `FORMAT_VERSION = 2`, written on every record as `v` |

Core runs in the plugin, not in the frame, because capture and link badges need the graph while no panel is open.

## Rules

1. **The base owns prose.** Panels can create text, rename it, reveal it and insert links. They can't edit a body. Writing happens in the base.
2. **Panels never see a `HostRef` or the host's name.** They work with unit ids, so they can't depend on a base.
3. **Everything crossing a seam is plain JSON**, so transport can change without rewriting either side.
4. **Host calls never reject.** Failure is a returned value with a code.
5. **Records are never deleted.** They're replaced by a later version, withdrawn or rejected, so history and attribution survive.
6. **Indexes are disposable.** Core can rebuild from records and text at any time.
7. **Events are hints.** A listener re-reads. Teammates, file sync and hand edits all take the same path as the plugin's own writes.

## Records

Every record carries this envelope:

| Field | Meaning |
|---|---|
| `v` | The format version, `2` |
| `id` | The author's DID and a TID, such as `did:plc:ewvi7nxzyoun6zhxrhs64oiz#3lz4qk7mfja2c`. The TID is 53 bits of microseconds and 10 of clock id, and always rises within a process. Nothing in the id depends on the unit's type |
| `kind` | One of the kinds below |
| `space` | The vault or graph that first wrote it |
| `at` | When it was first written. Never changes |
| `by` | `{id, name}` of who wrote it. `by.id` is a DID |
| `lab` | Optional. The lab's DID, so the lab is credited and its custodian keeps a say |
| `sig`, `sigBy` | Optional. The signature of whoever wrote this version, over the record without `sig`, and the signing key as a `did:key` |
| `acceptedFrom` | Optional. The proposal a person's record began as |
| `ext` | Optional. Free extension space |

Unknown fields must be preserved, so an older adapter doesn't damage a newer record.

There are two classes of record.

**Assertions** never change, so merging them is a union. Two people disagreeing is content, not a conflict.

| Kind | Meaning |
|---|---|
| `relation` | Someone asserts that `source` relates to `target` by `type` |
| `retraction` | The author withdraws their own record |
| `decision` | A space accepts or rejects something that arrived from elsewhere |

**Documents** are replaced whole. They add `rev`, `editedAt`, `editedBy` and `prev`, while `by` and `at` keep the original author. `prev` names the version this one replaces, as `rev@editedAt@editedBy`. A version beats every version it replaces. Only versions made apart, neither having seen the other, are left to a tie-break, and every replica breaks the tie the same way.

| Kind | Meaning |
|---|---|
| `node` | A discourse unit: `title` (content only), `type` once someone has typed it, and optionally `source`, `prov`, `facts` and `removed` |
| `anchor` | Ties a node to text in one space |
| `node-type` | A local label pointing at a base type, with an abbreviation, a title format and a starter template |
| `relation-type` | Label, complement, base, and which node types it can connect |
| `canvas` | A named canvas, with its Tidy arrangement and what it is shared with |
| `canvas-item` | One card, edge, note or stroke on a canvas |
| `release` | A canvas pinned at a moment: each item at its revision, each unit by its content hash |
| `snapshot` | A node's full text, for readers in other spaces |
| `person` | Links one person's identities, for display |
| `lab` | A lab: its DID, its custodian and the settings every member inherits |
| `membership` | One person's place in a lab |
| `device` | One signing key of a person, with the role `device` or `agent` |
| `paper` | A read paper: title, DOI and other identifiers, the hash of its file, its canvas |
| `folder`, `folder-item` | A folder of units, and one unit's place in it |
| `reaction` | One person's reaction to a unit on a shared canvas: `interesting`, `agree` or `disagree` |
| `unit-note` | A note beside a unit on a shared canvas |
| `evaluation` | A check or sign-off on a unit, at the version it was made on |

What follows from these:

- **Typing can wait.** `type` is optional, so a node can exist before anyone commits to what it is.
- **Labels are local.** `base` is what interoperates, not the label. A lab's "Hypothesis" is a `node-type` with `base: "claim"`. A lab may rename types and add types on a base. It can't add a base.
- **Relations are records,** never fields on a node. Provenance links are the exception: links only the unit's author states, such as the run an output came from, are fields in `prov`.
- **A relation has one state,** read by `foldRecords`: `active`, `pending`, `rejected` or `withdrawn`. A relation from this space is active. One from the person's lab is active. Anything else, and anything marked `proposed`, is pending until a decision.
- **Some records stay put.** `staysLocal` is true for anchors and decisions, which describe one space, so sync never carries them.

### Base types

| Node bases | `question`, `claim`, `evidence`, `source`, `protocol`, `study`, `run`, `code`, `output` |
|---|---|
| Relation bases | `supports`, `opposes`, `addresses`, `informs`, `derivedFrom`, `grounds`, `follows`, `describesActivity`, `requestTarget` |
| Read as `derivedFrom` | `interpretedAs`, `curatedTo` |

A new space starts with `defaultGrammar`: Question (`QUE`), Claim (`CLM`), Evidence (`EVD`) and Source, and five relation types.

| Relation | Complement | Connects |
|---|---|---|
| Supports | Supported by | Evidence to Claim, Claim to Claim |
| Opposes | Opposed by | Evidence to Claim, Claim to Claim |
| Addresses | Addressed by | Claim to Question |
| Informs | Informed by | Evidence to Question |
| Derived from | Has derivation | Evidence to Source |

[guide/schema.md](guide/schema.md) has every type, field and rule.

### Titles

`node.title` holds the content alone. A type's `titleFormat` is how the base writes it: `CLM - {content}` by default, `@{content}` for a source, and a base can pass its own, as Roam does with `[[CLM]] - {content}`. The only placeholder is `{content}`.

A title written in a type's format makes the text a node of that type. When several formats match, the one that leaves the shortest content stands. A candidate tag only suggests a node.

### Canvases

`buildCanvas` assembles a canvas into plain JSON Canvas 1.0. A discourse node is a text card with a `dg.node` id, so the output still reads as an ordinary canvas. Positions are integers, as that format requires. Freehand strokes are left out, because JSON Canvas has no item for them.

Each card, edge, note and stroke is its own `canvas-item` record, so edits to different items never collide. On a canvas, an edit beats a removal made apart from it.

## Host contract

A base provides these. Arguments and results are plain JSON, apart from the listener passed to `subscribe`.

| Operation | Purpose | Obsidian | Roam |
|---|---|---|---|
| `describe` | Contract version, space, person, appearance and skin (fonts, sizes, colors, radius) | Id stored in the vault, local profile | `graph.name`, `user.uid` |
| `listText`, `readText` | Reach text as Markdown | `cachedRead` plus metadata | Flatten the block tree |
| `searchText` | Find by title or tag | Metadata scan | Query |
| `listBacklinks` | What mentions this | Resolved links | `:block/refs` |
| `createText` | New page or file. Can store a unit's id in the text | Create a file with `dg-id` in its frontmatter | Create a page |
| `renameText` | Rename | `renameFile` | Update the page |
| `pinText` | Make a ref survive renames | Write `dg-id` to frontmatter | Nothing to do: UIDs are stable |
| `removeText` | Remove, through the base's trash where it has one | Trash the file | Delete the page |
| `fileInFolder` | Group text the base's own way | Move the note into a folder | A `Folder/<name>` page of links |
| `saveFile` | Keep a file a person asked for, and say where it went | Write into `Paper files/` | The browser's downloads |
| `listRecords`, `putRecords` | Store records in the base | `discourse-graph/records/<device>.jsonl`, one log to a device | A block tree per device, with batches of up to 200 records in block props |
| `readAsset`, `writeAsset` | Figures, images and PDFs. A document goes where a person would look for it | `readBinary`, `createBinary`. A PDF goes to `Paper files/` | `file.get`, `file.upload`, plus a PDF embed on "Discourse Graphs/PDFs". Block props in offline graphs |
| `listFiles` | Files of given extensions, newest first, for the reader | `getFiles`, by extension | `{{pdf: ...}}` embeds, and PDFs kept in block props |
| `readLocalFile` (optional) | A PDF outside the base, read in place and never copied. Only PDFs | Node's file system | Absent |
| `getFocus` | What's open | Active file | Open page or focused block |
| `reveal` | Open text in the base | `openFile` in a leaf | Main window, or the sidebar when a panel covers it |
| `insertLink` | Link at the last cursor | Edit at the saved cursor | Edit the block |
| `readSelection`, `replaceSelection` | The editor's selection, and swapping it for a link | Editor API | Block text |
| `setLinks` | Show a text's relations as the base's own links, with plain facts beside them. One-way: records stay the source, and a hand edit is put back | Frontmatter properties | Answers `written: false` |
| `openTable` (optional) | A table of every text with one property value, in the base's own table tool | An Obsidian Bases file | Absent |
| `listTagged`, `replaceTagged` (optional) | Lines tagged as candidates, and swapping one for a link once it is a unit | Tag scan | Absent |
| `openSurface`, `closeDialog` | Mount a panel in the main area, the side or a dialog | `ItemView` in a leaf, or a modal | `ui.mainWindow.openComponent`, or injected into the sidebar |
| `openLink` | Open a web address in the person's browser. Core passes only `http` and `https` | `window.open` | `window.open` |
| `getLocal`, `setLocal` | Per-device state that is neither shared nor synced | Obsidian's per-vault local storage, under `discourse-graphs-local:` | Browser storage |
| `subscribe` | Change hints | Vault and workspace events | Polling |

A panel route names one of these surfaces: `canvas`, `canvases`, `overview`, `boundary`, `pdf`, `search`, `find`, `context`, `upload`, `zotero`, `welcome`, `node`, `view`, `grammar`, `run`, `profile`, `papers`, `check`. A placement is `main`, `side` or `dialog`.

### Failures

A host call answers `{ok: true, value}` or `{ok: false, error: {code, message, ref?}}`.

| Code | Meaning |
|---|---|
| `not-found` | The ref or asset isn't there |
| `invalid` | The arguments are wrong, or a batch holds a malformed record |
| `conflict` | A text with that title exists. `ref` names it |
| `no-target` | Nothing to act on, such as no cursor for `insertLink` |
| `read-only` | The base won't allow the write |
| `unavailable` | The base threw, or can't do this now |

Wrap a host in `neverRejects`. Anything the base throws then comes back as `unavailable`. Roam's write limit, for example, arrives as an exception.

### Events

`text-changed`, `text-renamed`, `text-removed`, `records-changed`, `focus-changed` and `appearance-changed`. They can be merged or arrive late, and the host's own writes produce them too.

### Details an adapter must get right

- **Refs** are opaque, and stable once pinned. Refs from `createText` are always pinned. A file path alone isn't enough, because a rename outside the plugin would break it.
- **Titles.** `createText` returns the title actually stored, because hosts restrict characters.
- **Cursors.** `listRecords` always returns a `next` cursor, even on the last page. Reads are at-least-once: repeats are fine, misses are not.
- **Versions.** `listRecords` may return several versions of a document, and `foldRecords` picks the winner. A store that overwrites by id fails the suite, because a stale write could beat a newer one.
- **Writes.** `putRecords` is all or nothing, and writing an identical record again stores nothing.
- **Focus.** A panel click takes focus from the editor, so the adapter remembers the last cursor for `insertLink`.
- **Renames on disk.** A rename outside Obsidian arrives as a delete and a create, in either order. The Obsidian adapter waits 1.2 seconds before calling a text removed, and ignores a delete for a note that has already arrived at a new path.
- **Synced copies.** A sync tool can duplicate a note, id included. The first file keeps the id and a copy gets its own ref.
- **Theme.** A frame can't read the base's CSS, so the adapter passes `appearance` and `skin`, and sends `appearance-changed` when they change.

**What stays in the adapter:** the capture key (`\`, with the same menu everywhere), link badges, commands, menus and settings screens. They call core through `CoreForAdapter`.

## Surface API

[surface.ts](../packages/contract/src/surface.ts) types every call a panel can make, as `SurfaceMethods`: 166 calls in 36 namespaces, such as `unit.*`, `canvas.*`, `relation.*`, `grammar.*`, `paper.*`, `pdf.*`, `search.*`, `lab.*`, `ai.*`, `zotero.*`, `crate.*` and `profile.*`. Core answers them the same way in every base. The table in [ARCHITECTURE.md](ARCHITECTURE.md#inside-the-core) says which file answers which.

A call is a message `{id, method, params}`. The answer is `{id, ok: true, result}` or `{id, ok: false, error: {code, message}}`, with the same codes as the Host contract. Core also sends events, which have no `id`: `graph-changed`, `focus-changed`, `overview-focus-changed`, `highlight`, `prefs-changed`, `appearance-changed`, `place-node`, and a canvas command the base's own command palette asked for. On `graph-changed` a panel re-reads.

Names follow one scheme: `get` reads one, `list` reads many, `show` changes the screen, `accept` and `reject` record a decision, and the subject of a call is `id`.

## Identity and AT Protocol

| Part | Where | What it does |
|---|---|---|
| Ids | [ids.ts](../packages/contract/src/ids.ts) | Makes unit ids and TIDs |
| A person's DID | [core/identity.ts](../packages/core/src/identity.ts) | A `did:plc` computed on the device. In a browser, private keys are created unextractable and kept in IndexedDB (`discourse-graphs-keys`). Nothing is sent |
| Devices | [core/devices.ts](../packages/core/src/devices.ts), [core/signing.ts](../packages/core/src/signing.ts) | Each device signs with its own key. A key counts once a trusted device has vouched for it |
| Labs | [core/labs.ts](../packages/core/src/labs.ts) | A lab has its own DID. The person who sets it up is its custodian. Joining is a choice |
| AT records | [atproto.ts](../packages/contract/src/atproto.ts) | Turns records into AT records with CIDs |
| Lexicons | [lexicons/](../lexicons/) | Nodes, relations and evaluations use `science.mira.*`. Grammar, canvases, labs and people use `org.discoursegraphs.*` |

Records stay in their local log, which is what lets offline devices merge. AT records are a projection of that log, and the tests validate them against the lexicons. A node's collection follows its type, so its AT URI can change while its id and record key never do. Anchors and decisions have no AT form.

[labs-and-sync.md](labs-and-sync.md) covers keys, devices, signing and labs in full.

## Usage log

[usage.ts](../packages/contract/src/usage.ts) wraps the host once, so every base is measured the same way. An entry is `{op, ok, code?, ms, at}`: the operation's name, its outcome and its timing. It never holds arguments, because arguments can hold research content. Entries are kept on the device with `setLocal`. Nothing sends them anywhere. The Obsidian settings page shows the count and clears it.

## Conformance

[conformance.ts](../packages/contract/src/conformance.ts) exports `CHECKS`, 37 checks, and `runConformance`. It uses no test framework, because a real adapter can only be proven inside its live base.

| Group | Checks |
|---|---|
| `describe.*` | Shape, skin, and a space id that survives a rename |
| `text.*` | Create and read, the stored title, a very long title, a duplicate title as `conflict`, remove, refs that survive renames inside and outside the plugin, pinning, a missing ref as `not-found`, paging through everything, search by title and tag, backlinks, and the unit id living in the text |
| `records.*` | Idempotent writes, unknown fields kept, a stale write losing, concurrent writes all kept, an invalid batch storing nothing, a cursor seeing later writes, and surviving a reload |
| `local.*`, `assets.*`, `files.*` | Local state staying out of records, an asset round trip, listing documents |
| `navigation.*` | Reveal, insert a link, reveal not hidden by a panel, open a surface |
| `editor.*` | A selection becoming a link, and no selection reading as null |
| `events.*` | Outside changes, a rename not read as a removal, a record from elsewhere, own writes firing too, and unsubscribe stopping delivery |

Each adapter supplies a `ConformanceSetup`: its host, and a small driver that plays the part of a person or another device by renaming outside the plugin, restarting, or writing as a teammate. Run it against a throwaway vault or graph, since it leaves fixtures behind. [testing.md](testing.md) says how to run it inside each app.

`npm test` runs the suite against the in-memory host in [memory-host.ts](../packages/contract/src/memory-host.ts). It also feeds the suite deliberately broken hosts, to confirm it catches real faults: path-style refs, dropped fields, stale overwrites, lost cursors, forgetting on restart, silent changes and thrown errors.

### Adding something a base has to do

1. Add it to `Host` in `host.ts`. Make it optional if a base may lack it, and say what its absence means.
2. Add a check to `CHECKS` in `conformance.ts`.
3. Build it in the in-memory host and in each adapter, and run the suite inside each real app.

## Coverage of the official plugins

```bash
npm run coverage
```

[scripts/host_coverage.py](../scripts/host_coverage.py) reads a checkout of the official plugins and sorts every host API call in them into a contract area (read, write, navigate, watch, identify, assets, local state), adapter-private work, native UI, or not carried over. It shows that every call has a home in this contract. It doesn't count Roam's DOM observers, which aren't API calls.

## Limits

- **Roam:** the adapter has run only in an offline graph in Roam Desktop, loaded over a debug port. Hosted graphs, `file.upload` and `file.get`, and install through Roam Depot are untested. Offline graphs can't read `local-asset://` files back, so they keep assets in block props. Roam allows 1,500 writes a minute and reports the limit by throwing. Roam has no global change feed, so the adapter polls, and a hidden window polls slowly.
- **Phones:** neither mobile app has been tried. The Obsidian plugin is marked desktop only.
- **Obsidian Sync:** whether it carries `.jsonl` files by default is unchecked.
- **Keys:** a private key can't be backed up, and only the device that made it can sign with it.
- **AT Protocol:** the `science.mira.*` lexicons are drafts and their field names can change. `derivedFrom` isn't one of `science.mira.relation`'s known predicates.
- **The official plugins' data:** import reads the older Roam settings layout. Roam's newer settings store and pattern-based relations are not read.
- **Right-to-left readers:** the left-to-right layouts aren't mirrored.

What is planned is in [ROADMAP.md](../ROADMAP.md).
