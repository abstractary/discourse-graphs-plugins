# Architecture

Discourse Graphs runs inside two very different tools. Roam is a hosted graph of blocks. Obsidian is a folder of Markdown files. This project keeps what people see and what the graph means in one place, and keeps each base's own habits in a thin adapter.

## The shape

```mermaid
flowchart TB
  subgraph base["Inside Roam or Obsidian"]
    subgraph frames["Sandboxed frames: no network, no base API"]
      surfaces["@dg/surfaces<br/>canvas, context panel, Library, upload, welcome"]
    end
    native["@dg/native<br/>capture menu, link badges, walkthrough, dialogs"]
    core["@dg/core<br/>the graph, identity, papers, units, labs"]
    adapter["plugins/obsidian or plugins/roam<br/>one Host contract, two adapters"]
    sync["@dg/sync<br/>the only module that touches the network"]
  end
  layout["@dg/layout<br/>Tidy modes, pure functions"]
  contract["@dg/contract<br/>records, Host, Surface API, Services"]
  server["server/<br/>compute, graph store, labs, exchange, AI"]

  surfaces -- "Surface API over a MessagePort" --> core
  surfaces --> layout
  native --> core
  core -- "Host contract" --> adapter
  core -- "Services" --> sync
  sync -- "HTTP" --> server
  contract -.- core
  contract -.- surfaces
  contract -.- sync
  contract -.- adapter
```

Three seams hold it together, and each one is a file you can read:

| Seam | File | What crosses it |
|---|---|---|
| Surface API | [`packages/contract/src/surface.ts`](../packages/contract/src/surface.ts) | Everything a panel can ask for, as typed messages |
| Host contract | [`packages/contract/src/host.ts`](../packages/contract/src/host.ts) | Everything core needs from a base |
| Services | [`packages/contract/src/services.ts`](../packages/contract/src/services.ts) | Everything core needs from a server |

## Modules

| Module | Job | May depend on |
|---|---|---|
| `@dg/contract` | Record types, folding, the seams, the conformance suite | Nothing |
| `@dg/layout` | Tidy modes, centrality, crossing measures | `@dg/contract` |
| `@dg/core` | The graph, identity, papers, units, labs | `@dg/contract` |
| `@dg/sync` | Compute servers, lab exchange, the HTTP client | `@dg/contract` |
| `@dg/native` | UI drawn in the base's own page | `@dg/contract`, `@dg/core` |
| `@dg/surfaces` | React panels, one bundle, picked by route | `@dg/contract`, `@dg/layout` |
| `plugins/obsidian`, `plugins/roam` | Adapters and wiring | All of the above except `@dg/surfaces`, which arrives as built HTML |
| `server/` | Reference server | Nothing here, on purpose |

`npm run check-boundaries` fails the build if any module reaches past this table. Core can't import React, the frames can't import a base's API, and only `@dg/sync` calls `fetch`.

## Why each cut is where it is

**Core runs in the plugin, not the frame.** Capture and link badges need the graph while no panel is open, and several panels share it.

**Panels are sandboxed frames.** `sandbox="allow-scripts"` with a content security policy that blocks the network. A panel has one way out, the port it's handed, so the same bundle behaves the same in both bases and can't reach the base's API by accident. It also means a panel can't download a file or call a server itself, which is why those live behind the Surface API.

**Core never touches the network.** `Services` is injected, and a test can pass a fake one. Without services, everything local still works.

**The server sees opaque records.** Each lab member keeps a full local copy. The server is an index and an exchange, so losing it costs freshness, not work. Records carry their author and are merged by revision, so no server decides who wins.

**Records, not notes, are the source of truth.** Assertions never change. Documents are revised, and the highest revision wins. Each base stores them where it stores things: a folder of JSONL files in Obsidian, a page of blocks in Roam. A unit becomes a note or page only when someone exports it, so reading a paper doesn't fill a vault with 30 files.

## Following one paper through

1. The upload panel reads the file and calls `paper.extract`.
2. Core asks `@dg/sync` to extract it on the chosen server, passing status lines to the panel as they arrive.
3. Core turns the graph into records: a paper, a canvas, its units and relations. No notes are written.
4. If the paper has a DOI, its graph and DOI go to the Discourse Graphs service. The file doesn't, and without a DOI nothing goes.
5. If the person chose to share, the outputs (and the file, if they say so) go to the lab's repository, and the canvas is marked shared.
6. `@dg/sync` pushes the shared records. A teammate's plugin pulls them, core folds them in, and their panels redraw.

## Testing at each layer

| Layer | How | Where |
|---|---|---|
| Records, core, layout, sync | Unit tests with an in-memory host and fake services | `test/` |
| Server | Unit and route tests with fake model servers | `server/test/` |
| Both adapters | One conformance suite, run inside the real apps | `packages/contract/src/conformance.ts` |
| Whole flows | Real mouse and keyboard in real Roam and Obsidian | `harness/*-test.mjs` |

See [testing.md](testing.md) for how to run them.

## What's unfinished

This is a demo, and these are the known edges:

- The newest record kinds (papers, folders, reactions, notes) have no AT Protocol lexicons yet. They stay in the local format.
- The server trusts the name a member sends with a breadcrumb or an upload.
- Each lab member's token is a bearer token held in plugin storage.
- Roam has no slot for custom sidebar content, so panels are injected into its sidebar.
- `packages/core/src/index.ts` and `packages/surfaces/src/canvas/App.tsx` are each over 1,000 lines, and both should be split the way papers, units and labs already are.
