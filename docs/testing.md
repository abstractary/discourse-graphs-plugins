# Testing

There are three levels. The first two need nothing but Node, and they're what CI runs.

## Unit tests

```bash
npm test
```

```bash
npm run test:server
```

Core runs against an in-memory host, and sync and papers run against fake services. The server's tests start it on a random port with a temporary data folder, and they never call a real model.

## The ontology

```bash
pip install rdflib pyshacl
```

```bash
npm run validate:ontology
```

This runs `ontology/tests/cases.json` through pyshacl, one wrong graph per rule, then validates the worked example. `test/shapes.test.ts` runs the same cases through the app's own check, and fails if a rule's name, severity or message differs between the SHACL file and the code. CI runs both.

## Boundaries and types

```bash
npm run check-types
```

```bash
npm run check-boundaries
```

## Real apps

These drive real Obsidian and real Roam with real mouse and keyboard input, because a panel inside a sandboxed frame inside another app fails in ways nothing else catches.

Never run them against a vault or graph that holds real work.

### Setup

1. Build with the test hooks in. A release build leaves them out.

   ```bash
   npm run build:test
   ```

2. Make a throwaway Obsidian vault named `dg-contract-sandbox`, copy `dist/obsidian/` into its `.obsidian/plugins/discourse-graphs-demo/`, and enable the plugin.
3. Make a throwaway offline graph in Roam Desktop, and start Roam with its debug port:

   ```bash
   open -a "Roam Research" --args --remote-debugging-port=9333 --remote-allow-origins='*'
   ```

4. Start the servers, for the tests that need them:

   ```bash
   npm run server
   ```

The scripts drive Obsidian through its command line tool, which is in `/Applications/Obsidian.app` on a Mac. They're written for macOS.

### The suites

| Suite | Covers | Run with |
|---|---|---|
| `slice-test.mjs` | The canvas: cards, links, undo, files, themes | `node harness/slice-test.mjs obsidian` |
| `capture-test.mjs` | Making a unit from a selection or page | `node harness/capture-test.mjs obsidian` |
| `badge-test.mjs` | Link badges in the editor | `node harness/badge-test.mjs obsidian` |
| `tidy-test.mjs` | Tidy on a tangled canvas | `node harness/tidy-test.mjs obsidian` |
| `modes-test.mjs` | The nine Tidy arrangements | `node harness/modes-test.mjs obsidian` |
| `walkthrough-test.mjs` | The guided walkthrough, every step | `node harness/walkthrough-test.mjs obsidian` |
| `real-test.mjs` | Published MATSUlab data, after seeding with `harness/matsulab.mjs` | `node harness/real-test.mjs obsidian` |
| `labs-test.mjs` | Two labs, one in each base | `node harness/labs-test.mjs` |
| `holons-test.mjs` | A canvas showing its place and the boundary panel following it, units as leaves, a highlight crossing panels, and the Library as the canvas repository with pictures, after adding the worked example as one more device's log | `node harness/holons-test.mjs` (Obsidian only) |
| `guide-test.mjs` | The canvas picker's pictures and kinds, the Library's scopes, the Method section, Ask AI with a person's own model (the key form, a local model answering with citations, Escape), runs and notebooks, the run page's figures, and the settings page. It also takes the pictures in `docs/guide/media`. The AI answer step needs the stand-in model server (`node harness/stub-model.mjs`, on `localhost:18434`), and the notebook steps need `Notebooks/evd1_evd7_analysis.ipynb` in the sandbox vault; each is skipped without it | `node harness/guide-test.mjs` (Obsidian only) |
| `science-test.mjs` | A scientist's session on three papers: Extract graph from the reader, from a PDF's menu and from the upload dialog with a saved extraction; a unit's passage in the reader; the method chain and run page of a run a paper reports; a canvas of units from all three with paper tags, relations made in Context, "Rests on", "Elsewhere" and the Papers arrangement. It needs the three PDFs and their `.graph.json` files in the sandbox vault under `Paper files/reservoir-computing`, and is skipped without them. Pictures go to `reports/science` | `node harness/science-test.mjs` (Obsidian only) |
| `pdf-test.mjs` | The PDF reader beside the canvas, a real mouse highlight made into a unit, Undo, a dropped PDF, and the units drawer: list, grid, selecting, dragging and placing a group. It takes what it placed back off the example canvas | `node harness/pdf-test.mjs` (Obsidian only) |
| `search-test.mjs` | Unit search in the sidebar by title, note text and PDF passage, with filters; putting a result on the canvas; the quick finder's open, place and link keys; renaming on a card, own units only; Delete on a link, remembered or asked, and a teammate's relation; copy and paste between canvases; and undo and redo of each | `node harness/search-test.mjs` (Obsidian only) |
| `papers-test.mjs` | Upload, export, provenance, labs, reactions, breadcrumbs and AI, across both apps | `node harness/papers-test.mjs` |

Replace `obsidian` with `roam` to run a suite in the other base.

Seeding with `harness/matsulab.mjs` also needs the MATSUlab evidence bundles. Set `MATSULAB_BUNDLES` to their folder in a checkout of `MATSUlab-issue-exchange-analysis`.

The conformance suite runs inside each app. It's the same 37 checks in both, written once in `packages/contract/src/conformance.ts`:

- In Obsidian, call `app.plugins.plugins["discourse-graphs-demo"].slice.runConformance()`.
- In Roam, load the extension with `node harness/cdp.mjs file dist/roam/extension.js`, then call `window.dgHarness.runConformance()`.

Tidy's benchmark needs no app:

```bash
node harness/tidy-bench.ts
```

## What's worth knowing

- A sandboxed frame runs in its own process, so anything aimed at it, like catching a file chooser, has to attach there.
- Obsidian's side panels slide open, so wait before clicking inside one.
- A card outside the visible canvas can be located but not clicked, because the click lands on whatever is there instead. Press Fit first.
- In Roam, wait for saves before reloading, or its "unsaved changes" dialog blocks the reload.
