# Testing

Every test layer, what it covers, and how to run it. The first five need only Node and Python, and CI runs them on every pull request. The real-app suites need Obsidian and run by hand.

## At a glance

| Layer | Command | Size | Needs |
|---|---|---:|---|
| Types | `npm run check-types` | | Node 26 |
| Module boundaries | `npm run check-boundaries` | | Node 26 |
| Route table in step | `npm run check:routes` | 32 routes | Node 26 |
| Dependency matrix | `npm run dsm` | | Node 26 |
| Unit tests | `npm test` | 401 tests | Node 26 |
| Server tests | `npm run test:server` | 121 tests | Node 26 |
| Several people at once | `npm run sim` | 135 expectations | Node 26 |
| Release build | `npm run build` | | Node 26 |
| Process rules | `npm run validate:ontology` | 52 cases | Python 3.12, `rdflib`, `pyshacl` |
| Conformance | Inside each app | 37 checks | Obsidian or Roam |
| Real-app suites | `node harness/<name>-test.mjs` | | Obsidian, macOS |

The sizes are what the commands print today. CI ([.github/workflows/ci.yml](../.github/workflows/ci.yml)) runs every row down to the process rules, on Ubuntu with Node 26 and Python 3.12.

## Unit tests

```bash
npm test
```

```bash
npm run test:server
```

`npm test` runs `test/*.test.ts` with Node's own test runner. No test calls an outside service.

- Core runs against the in-memory host, and sync and papers run against fake services. Everything shared comes from `test/support.ts`. Tests wait on the thing itself and never on the clock.
- `test/conformance.test.ts` runs the conformance suite against the in-memory host, then against deliberately broken hosts to confirm the suite catches them.
- `test/scholarly-sync.test.ts` reads the registries from trimmed copies of their real answers in `test/fixtures/scholarly/`, so no test calls Crossref, DataCite, OpenAlex or PubMed.
- `test/scholarly.test.ts` covers card facts, lookups, crates out and back, and announcements. `test/eln.test.ts` and `test/evidence-crate.test.ts` cover the `.eln` form and evidence bundles, from `test/fixtures/eln/`.
- `test/profile.test.ts` covers the three audiences of a profile.
- `test/zotero.test.ts` and `test/zotero-library.test.ts` read Zotero from hand-written files in its API's shape (`test/fixtures/zotero/`). No test touches a real library.
- `test/mcp.test.ts` runs the MCP tools over a core in memory, then a real MCP client over stdio against a vault on disk.
- `test/shapes.test.ts` runs the ontology's cases through the app's own check.

`npm run test:server` runs `server/test/`. Each test starts the server on a random port with a temporary data folder. Models and MIRA are fake servers.

## Several people at once

```bash
npm run sim
```

`harness/four-vaults.ts` runs four people, each with a vault, around one lab server, all in one process with no outside network. Time, ids and keys are seeded, so a run replays byte for byte. It plays a scripted story and then a seeded random walk, and writes what held and what broke to `reports/four-vaults/`. See [labs-and-sync.md](labs-and-sync.md).

| Flag | Default | Does |
|---|---|---|
| `--seed <n>` | `1` | Picks the random walk |
| `--steps <n>` | `200` | Length of the walk |
| `--strict` | off | Exits with an error if any expectation breaks. `npm run sim` sets it |

## The ontology

```bash
pip install rdflib pyshacl
```

```bash
npm run validate:ontology
```

This runs `ontology/tests/cases.json` through pyshacl, one wrong graph per rule, then validates the worked example. `test/shapes.test.ts` runs the same cases through the app's own check, and fails if a rule's name, severity or message differs between the SHACL file and the code. See [ontology/README.md](../ontology/README.md).

## Boundaries, types and routes

```bash
npm run check-types
```

```bash
npm run check-boundaries
```

```bash
npm run check:routes
```

[ARCHITECTURE.md](ARCHITECTURE.md#what-is-checked) says what each one fails on. `npm run gen:routes` rewrites the generated files when `check:routes` fails.

## The dependency matrix

```bash
npm run dsm
```

Prints two design structure matrices from the imports in the code: the modules, and the files behind the scholarly record (shown in [scholarly.md](scholarly.md)). It fails if a part depends on one listed after it.

## Checking a crate from outside

Export a canvas as a research crate, unzip it, and run the community validator over the folder (needs `uv`):

```bash
uvx --from roc-validator rocrate-validator validate --no-paging -l REQUIRED path/to/unzipped-crate
```

At `-l RECOMMENDED` it also lists what a fuller crate would have, such as an ORCID iD for its author.

## Real apps

These drive real Obsidian with real mouse and keyboard input, because a panel inside a sandboxed frame inside another app fails in ways nothing else catches. A few also drive Roam.

Never run them against a vault or graph that holds real work.

### Setup

1. Build with the test hooks in. A release build leaves them out.

   ```bash
   npm run build:test
   ```

2. Make a throwaway Obsidian vault named `dg-contract-sandbox` in `sandbox/`, copy `dist/obsidian/` into its `.obsidian/plugins/discourse-graphs-demo/`, and enable the plugin.
3. For the suites that take `roam`, make a throwaway offline graph in Roam Desktop, and start Roam with its debug port:

   ```bash
   open -a "Roam Research" --args --remote-debugging-port=9333 --remote-allow-origins='*'
   ```

4. Start the servers, for the suites that need them:

   ```bash
   npm run server
   ```

The scripts drive Obsidian through its command line tool at `/Applications/Obsidian.app/Contents/MacOS/obsidian-cli`, and Roam over the Chrome DevTools Protocol. They are written for macOS.

### Settings

| Variable | Default | Does |
|---|---|---|
| `DG_SANDBOX` | `sandbox/dg-contract-sandbox` | The vault folder the suites read and clean |
| `DG_NO_RELOAD` | unset | Set it to skip reloading the plugin at the start of a suite |
| `DG_SHOTS` | on | `0` runs `guide-test.mjs` without taking pictures |
| `DG_STUB_MODEL` | `http://localhost:18434/v1` | Where `guide-test.mjs` finds the stand-in model |
| `CDP_PORT` | `9333` | Roam's debug port |
| `CDP_TIMEOUT` | `600000` | Milliseconds before a call to Roam gives up |
| `MATSULAB_BUNDLES` | none | Folder of evidence bundles in a checkout of `MATSUlab-issue-exchange-analysis`, for `matsulab.mjs` and `evidence-test.mjs` |

### The suites

| Suite | Covers | Run with |
|---|---|---|
| `slice-test.mjs` | The canvas: cards, links, undo, files, themes | `node harness/slice-test.mjs obsidian` |
| `links-test.mjs` | Relations as link properties on notes: both ways, rename, hand edit, withdrawal | `node harness/links-test.mjs` |
| `capture-test.mjs` | Making a unit from a selection or page | `node harness/capture-test.mjs obsidian` |
| `badge-test.mjs` | Link badges in the editor | `node harness/badge-test.mjs obsidian` |
| `tidy-test.mjs` | Tidy on a tangled canvas | `node harness/tidy-test.mjs obsidian` |
| `modes-test.mjs` | The ten Tidy arrangements | `node harness/modes-test.mjs obsidian` |
| `walkthrough-test.mjs` | The guided walkthrough, every step | `node harness/walkthrough-test.mjs obsidian` |
| `real-test.mjs` | Published MATSUlab data, after seeding with `harness/matsulab.mjs` | `node harness/real-test.mjs obsidian` |
| `labs-test.mjs` | Two labs, one in each base | `node harness/labs-test.mjs` |
| `overview-test.mjs` | A canvas showing its place and the boundary panel following it, units as leaves, a highlight crossing panels, and the Library as the canvas repository with pictures, after adding the worked example as one more device's log | `node harness/overview-test.mjs` (Obsidian only) |
| `guide-test.mjs` | The canvas picker's pictures and kinds, the Library's scopes, the Method section, Ask AI with a person's own model (the key form, a local model answering with citations, Escape), runs and notebooks, the run page's figures, and the settings page. It also takes the pictures in `docs/guide/media`. The AI answer step needs the stand-in model server (`node harness/stub-model.mjs`, on `localhost:18434`), and the notebook steps need `Notebooks/evd1_evd7_analysis.ipynb` in the sandbox vault; each is skipped without it | `node harness/guide-test.mjs` (Obsidian only) |
| `science-test.mjs` | A scientist's session on three papers: Extract graph from the reader, from a PDF's menu and from the upload dialog with a saved extraction; a unit's passage in the reader; the method chain and run page of a run a paper reports; a canvas of units from all three with paper tags, relations made in Context, "Rests on", "Elsewhere" and the Papers arrangement. It needs the three PDFs and their `.graph.json` files in the sandbox vault under `Paper files/reservoir-computing`, and is skipped without them. Pictures go to `reports/science` | `node harness/science-test.mjs` (Obsidian only) |
| `scholarly-test.mjs` | What every card shows: the Cards list, each fact on every card, the same facts at the head of Context, and a click that only selects. A live lookup of one paper, which sends its DOI and title to the open registries. A canvas exported as a research crate and checked, the `.eln` form read back with nothing new, and another tool's run crate read into units. It needs the papers `science-test.mjs` reads. Pictures go to `reports/scholarly` | `node harness/scholarly-test.mjs` (Obsidian only) |
| `evidence-test.mjs` | A MATSUlab evidence bundle read as a folder in the vault: evidence, study, protocol, code and hashed files. The export dialog's output files and Zenodo options, stopping before anything is sent. The crate saved from it: a README, the files, and MIRA in the one graph. The three discipline examples listed and drawn. It needs `node examples/disciplines/build.ts` and the MATSUlab checkout. Pictures go to `reports/evidence` | `node harness/evidence-test.mjs` (Obsidian only) |
| `grammar-test.mjs` | The Types and relations dialog: a type added with a starter template, a relation's allowed pairs. A unit of the new type, whose note starts from the template and carries its type and date. Obsidian's own table of every claim. A schema file saved and read back with nothing new. A canvas removed with its note. It puts the vault back, apart from the table file. Pictures go to `reports/grammar` | `node harness/grammar-test.mjs` (Obsidian only) |
| `gather-test.mjs` | A picture dropped on a canvas: kept under its name, drawn on its card, and said to show something, which makes evidence. A card's relations bringing a unit onto the canvas with its link. A canvas action run as an Obsidian command. A tagged line listed in Search, made a claim, and replaced by a link. A dialog that is Obsidian's own modal and closes on Escape from inside. It puts the vault back. Pictures go to `reports/gather` | `node harness/gather-test.mjs` (Obsidian only) |
| `check-test.mjs` | A run signed from the Context panel with a note. The check mark on its card, and `dg-checked` in its note. The canvas saved as a `.eln` file, with the run as an experiment entry and the sign-off as its comment. The unit reworded, after which the panel and the card say the mark was made on an earlier version. It puts the vault back. Pictures go to `reports/check` | `node harness/check-test.mjs` (Obsidian only) |
| `zotero-real-test.mjs` | Zotero as the PDF library, against the real Zotero app. Zotero answers Obsidian's own request. Its PDFs are listed under In Zotero and named for their references. A PDF is read from Zotero's folder with nothing copied into the vault, and the reader draws it. A highlight from it becomes a unit whose source carries the reference's identifiers, with the mark on its card and the way back in Context. It reads Zotero and writes nothing to it, skips when Zotero isn't answering or the stand-in is in its place, and puts the vault and the setting back. Pictures go to `reports/zotero-real` | `node harness/zotero-real-test.mjs` (Obsidian and Zotero) |
| `four-vaults.ts` | Four people, each with a vault, around one lab server, all in one process with no outside network. A scripted story (a lab forms by invitation, a canvas is shared, people change the same thing apart, someone joins late, the PI sets what everyone inherits, a check, evidence from the lab's Zotero group and from a personal library, a server restart, a stranger, a forged record, a member removed and invited back) and a seeded random walk. Reports what held and what broke to `reports/four-vaults`. It needs neither Obsidian nor Zotero. See [labs-and-sync.md](labs-and-sync.md) | `node harness/four-vaults.ts --seed 1 --steps 200` |
| `lab-real-test.mjs` | The real Obsidian in a lab with simulated labmates, the lab server in a process of its own. Obsidian joins by invitation, receives a shared canvas on its own loop, shows the PI's settings on the Lab tab, sends signed work back, catches up after the plugin restarts, and is removed, after which the lab's work is put away and its notes leave the vault. It skips if the sandbox is already in a lab, and leaves the vault in no lab. Pictures go to `reports/lab-real` | `node harness/lab-real-test.mjs` (Obsidian) |
| `people-test.mjs` | The time on a card, initials that show a card on hover and open a profile on click, the profile's three audiences, a note that says who wrote it, and From Zotero: search, highlights with their types, bringing them onto a canvas, the link back, and nothing new the second time. The Zotero stages need `node harness/stub-zotero.mjs` running, a stand-in on Zotero's own port, so never run it beside a real Zotero. Pictures go to `reports/people` | `node harness/people-test.mjs` (Obsidian only) |
| `pdf-test.mjs` | The PDF reader beside the canvas, a real mouse highlight made into a unit, Undo, a dropped PDF, and the units drawer: list, grid, selecting, dragging and placing a group. It takes what it placed back off the example canvas | `node harness/pdf-test.mjs` (Obsidian only) |
| `search-test.mjs` | Unit search in the sidebar by title, note text and PDF passage, with filters; putting a result on the canvas; the quick finder's open, place and link keys; renaming on a card, own units only; Delete on a link, remembered or asked, and a teammate's relation; copy and paste between canvases; and undo and redo of each | `node harness/search-test.mjs` (Obsidian only) |
| `papers-test.mjs` | Upload, export, provenance, labs, reactions, breadcrumbs and AI, across both apps | `node harness/papers-test.mjs` |
| `papermap-test.mjs` | The paper map and the type colors. It only reads and looks, and leaves nothing. Pictures go to `reports/papermap` | `node harness/papermap-test.mjs` (Obsidian only) |
| `sidebar-test.mjs` | The canvas sidebar: Library, Search units and Units, floating and pinned. It leaves the "People test" canvas and puts the pin setting back. Pictures go to `reports/sidebar` | `node harness/sidebar-test.mjs` (Obsidian only) |

Where a row shows `obsidian`, replace it with `roam` to run that suite in Roam.

Every suite but `labs-test.mjs` and `papers-test.mjs`, which need Roam running beside Obsidian, takes its checks, waiting, mouse and keyboard from `harness/lib.mjs`. A suite says what it makes as it makes it, with `cleanup`, `makeUnit` or `makeCanvas`, and takes it back in a `finally`, so a run that stops part-way cleans up too. The comment at the top of each suite says what it still leaves. Core marks a removed unit or canvas as removed and keeps its record, so the records folder grows with every run. `python3 -I scripts/clear-sandbox.py <vault>` lists test leftovers in a sandbox vault, and removes them with `--apply`.

### Helpers

| Script | Does |
|---|---|
| `harness/lib.mjs` | A session with a real Obsidian: calls, checks, waiting, mouse, keys, pictures, cleanup |
| `harness/hosts.mjs` | The two real apps behind one shape, for the suites that take `obsidian` or `roam` |
| `harness/cdp.mjs` | Roam over its debug port: `eval '<expression>'`, `file <path>`, `shot <out.png>`, `reload` |
| `harness/matsulab.mjs` | Rebuilds the published MATSUlab records in each plugin's own storage format, for `real-test.mjs` |
| `harness/stub-model.mjs` | A stand-in model server in the OpenAI-compatible shape, on `localhost:18434` |
| `harness/stub-zotero.mjs` | A stand-in for Zotero's local API on port 23119, Zotero's own. Stop Zotero first |
| `harness/tidy-bench.ts` | Scores Tidy on the lines as drawn, against ELK's layered layout. Needs no app |
| `harness/tidy-sheet.ts`, `harness/modes-sheet.ts` | Draw layouts and every Tidy arrangement as SVG, to look at by eye |

### Conformance

The conformance suite runs inside each app. It is the same 37 checks in both, written once in `packages/contract/src/conformance.ts`. See [CONTRACT.md](CONTRACT.md#conformance).

- In Obsidian, call `app.plugins.plugins["discourse-graphs-demo"].slice.runConformance()` in the developer console.
- In Roam, load the extension with `node harness/cdp.mjs file dist/roam/extension.js`, then call `window.dgHarness.runConformance()`.

Both need a build with the test hooks in.

## What's worth knowing

- A sandboxed frame runs in its own process, so anything aimed at it, like catching a file chooser, has to attach there.
- Obsidian's side panels slide open, so wait before clicking inside one.
- A card outside the visible canvas can be located but not clicked, because the click lands on whatever is there instead. Press Fit first.
- A hidden Obsidian window stops drawing, so keep it visible while a suite runs.
- `obsidian-cli` sometimes prints its answer and doesn't exit. A stale one blocks later calls, so stop it before a run.
- In Roam, wait for saves before reloading, or its "unsaved changes" dialog blocks the reload.
- A suite that doesn't open a session with `lib.mjs` runs against whatever build is already loaded.
- A vault in a synced folder, such as iCloud, can gain "Note 2.md" copies when files are deleted and rewritten quickly.

## Limits

- The real-app suites run on macOS only, in Obsidian 1.15, and are not in CI.
- The suites that take `roam` have run only in an offline graph in Roam Desktop.
- `search-test.mjs` has one check that fails on some runs and passes on others: linking a found unit at the cursor. It fails most often on the first run after another suite.
- `scholarly-test.mjs` makes a live lookup, which sends one paper's DOI and title to the open registries.
- `zotero-real-test.mjs` reads a real Zotero and writes nothing to it. Highlights and group libraries are tested only against the stand-in.
- MIRA and hosted models are tested only against fake servers.
