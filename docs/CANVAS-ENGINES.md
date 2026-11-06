# Canvas engine evaluation

**Recommendation: React Flow, with freehand annotation added by us.** It's the only candidate that passed everything on both real hosts, it has the most active project of the two that fit, and its cards are ordinary HTML. The cost is a smaller whiteboard than tldraw offers, so that trade is the real decision.

This covers the engine only. JSON Canvas stays the format, so the engine can be replaced later.

## What the canvas has to do

From the Roam and Obsidian canvas docs, and from the contract:

- Typed cards with key images, and typed relations drawn between them
- Freehand annotation, text boxes and shapes, which Roam's docs promise
- Dropping pages and links onto the canvas, and exporting to an image
- Running in the sandboxed panel, with no network and no storage
- Reporting changes per item, to fit `canvas-item` records
- An open license at the exact version used

## Screened out without running

Judged on npm data and what each library is for.

| Library | Why not |
|---|---|
| tldraw 5.6 | Production use needs a license key, which is the reason for this evaluation |
| Cytoscape | Built for graph analysis, and draws to a canvas rather than HTML cards |
| Konva, Fabric, Leafer | Drawing libraries, so we'd write the whole editor |
| maxGraph | Still 0.x, so the API can change |
| JointJS | MPL-2.0 rather than a permissive license, with no clear advantage here |
| Rete, Reaflow | Built for visual programming and auto-layout, not free placement |
| BlockSuite | Last release July 2025, with 69 dependencies |
| Plait, LogicFlow | About 7,600 and 48,000 downloads a month, against 59 million for React Flow |

## Finalists, run in the real sandboxed panel

Each engine ran in a `sandbox="allow-scripts"` frame with all network blocked, using real mouse input. Timing used 1,000 cards and 1,500 edges in Obsidian 1.15.0. The display runs at 144 Hz, so 6.9 ms means no dropped frames. "Plain" is a no-library control.

| | React Flow 12.12 | X6 3.1 | Excalidraw 0.18 | Plain |
|---|---|---|---|---|
| License | MIT | MIT | MIT | Ours |
| JavaScript size | 408 KB | 588 KB | 8.3 MB, plus 13 MB of fonts | 8 KB |
| Gzipped | 133 KB | 171 KB | 2.6 MB | 4 KB |
| Mount 1,000 cards | 360 ms | 317 ms | 2.2 s | 83 ms |
| Moving a card, p50 and p95 | 6.9, 7.5 ms | 6.9, 8.2 ms | 2.3, 3.6 s | 13.9, 15.4 ms |
| Zooming, p50 and p95 | 18.4, 42.1 ms | 7.3, 28.8 ms | 13.2, 17 s | 27.9, 29.2 ms |
| Blocked network requests | 0 | 0 | 230 (fonts) | 0 |
| JSON Canvas round trip | Lossless | Lossless | Lossless | Lossless |
| Real drag moves one card | Yes | Yes | Unresolved | Yes |
| Change events name the item | Yes | Yes | Not reached | Yes |
| Real drag creates a relation | Yes | Yes in Obsidian, no in Roam | Yes, with the arrow tool | Yes |
| HTML cards | Yes | Yes, through `foreignObject` | No, only rectangles with text | Yes |
| Freehand and shapes built in | No | No | Yes | No |
| Undo, copy and export built in | No | Yes, as plugins | Yes | No |
| Commits, last 90 days | 100+ | 13 | 79 | |
| Active authors, last 90 days | 13+ | 3 | 16 | |
| Downloads a month | 59 million | 425,000 | 3.6 million | |

React Flow also ran in real Roam, in Roam's own panel slot: mounting 1,000 cards took 222 ms, card moves were 6.9 and 8.2 ms, and zooming was 19.8 and 41.1 ms. The graph's block count stayed at 5, so nothing was written.

## The harder requirements

These are the things no graph library ships, tested on React Flow in both real hosts.

| Requirement | Obsidian | Roam |
|---|---|---|
| Freehand stroke drawn and saved, using `perfect-freehand` (MIT) | Pass | Pass |
| Text dropped from outside the frame arrives | Pass | Pass |
| Backspace deletes a selected card in the sandbox | Pass | Pass |
| PNG export, using `html-to-image` (MIT) | Pass | Pass |
| Card with a type chip and key image | Pass | Pass |

## Why React Flow

- **Cards are plain HTML.** Type chips, key images and text wrapping need no workaround.
- **It's the healthiest fit.** X6 passes on features but has about a quarter of the active authors, and one failure in Roam I didn't resolve.
- **React isn't a conflict.** The panel frame carries its own copy, so it can't clash with Roam's React or BlueprintJS.
- **Excalidraw is the wrong shape.** It's the only one with real whiteboard tools, but discourse cards would be rectangles with text, and it's 20 times the size before fonts. Staying offline would mean embedding 13 MB of fonts or accepting fallback fonts.

Plain shows the format is easy to draw, in 177 lines. It has no selection, resizing, touch handling or accessibility, which is what an engine buys.

## What choosing React Flow costs

- **A smaller whiteboard.** Freehand strokes work, but tldraw's shapes, sticky notes and bound arrows would need building, or dropping. Roam's docs also mention stickers, GIFs and YouTube, which would become image and link cards.
- **The contract needs a stroke item.** JSON Canvas has no freehand type, so strokes would be a DG extension that plain export leaves out.
- **Undo is ours to build.** It's a paid example, not a library feature. Revision records should make it straightforward, but that's untested.
- **Copy and paste, and alignment guides,** also need building.
- **An attribution badge.** React Flow is MIT, so removing the small corner badge is legal, but its maintainers ask for a Pro subscription if you do. Keeping it costs nothing.
- **Migration.** Existing tldraw canvases need converting. Discourse cards and relations map directly, while freehand and shapes need a decision.

## Limits of this evaluation

- **One run per engine per host.** Treat small timing gaps as noise.
- **Timing is programmatic,** using each engine's API rather than a person's hand.
- **Excalidraw's times may overstate its cost.** They use `updateScene` with blocked fonts, not its normal drag path. My synthetic drag also never moved a card, and I didn't find out why. People use it daily, so don't read that as a defect.
- **X6's failed connection in Roam wasn't investigated.** It may be a test artifact.
- **Phones weren't tested.** iOS uses WebKit, where HTML inside SVG has a history of problems, which would affect X6 more than React Flow.
- **The drop test used the browser's test input,** not a real drag from a Roam page or Obsidian link.
- **Whiteboard usage is unknown.** Roam's PostHog data would show how often people use freehand and shapes, which would settle the main trade.

## Reproduce

The test rig and its screenshots were left out of this repository.
