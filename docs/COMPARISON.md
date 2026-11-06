# New plugins compared with today's

Compared on 6 Nov 2026 against `discourse-graph` at `0042842e` (Roam 0.24.0, Obsidian source) and the published Obsidian 1.8.0.

**The new plugins aren't a replacement yet.** They cover 42% of today's capabilities, and 60% of what's on by default in both plugins. They also do a good deal today's plugins don't, like paper extraction and lab repositories. The code is far smaller and much more shared, but much of that gap is features not built yet.

## Feature completeness

Each row of [capabilities.csv](../reports/comparison/capabilities.csv) is scored from code. A full match counts as 1 and a partial match as 0.5. Rows aren't equal in size: one row covers all of tldraw's stock shapes.

| Area | Capabilities | Roam on | Obsidian on | Ours full | Ours part | Coverage |
|---|---:|---:|---:|---:|---:|---:|
| Relations | 9 | 8 | 7 | 6 | 2 | 78% |
| Node creation | 13 | 11 | 11 | 6 | 2 | 54% |
| Context and browsing | 9 | 6 | 5 | 4 | 1 | 50% |
| Recognition and inline UI | 5 | 3 | 5 | 1 | 3 | 50% |
| Canvas | 24 | 22 | 21 | 10 | 3 | 48% |
| Collaboration and identity | 4 | 2 | 0 | 0 | 3 | 38% |
| Telemetry, help and AI | 5 | 4 | 2 | 0 | 3 | 30% |
| Import, export and sharing | 7 | 3 | 0 | 0 | 4 | 29% |
| Grammar and settings | 11 | 8 | 8 | 2 | 0 | 18% |
| Queries and views | 8 | 7 | 1 | 0 | 0 | 0% |
| **All** | **95** | **74** | **60** | **29** | **21** | **42%** |

| Scope | Capabilities | Coverage |
|---|---:|---:|
| On by default in both plugins | 50 | 60% |
| On by default in either plugin | 84 | 43% |
| Only in Obsidian | 7 | 36% |
| Behind a flag everywhere it exists | 11 | 32% |
| Only in Roam | 28 | 5% |

### The gaps that matter most

- **The editor is over half done.** Capture works from selected text, the hotkey and the command palette, and link badges show in both bases. There are still no candidate tags and no live recognition of hand-written titles.
- **The grammar can't be edited.** Types and relations exist as records, but no screen changes them.
- **Roam's query layer is missing.** Query builder, saved queries, table, chart and Kanban views, and every export format. Roam spends about 10,100 lines here, and Obsidian has almost none of it.
- **The canvas is a focused subset.** It has cards, relations, notes and a pen. It has no shapes, media, copy and paste, PNG or SVG export, or full undo.
- **Sharing is lab-sized.** Shared canvases, papers, reactions and notes sync through a reference server. Publishing to a PDS and public groups aren't built.

### What ours has that neither plugin does

- The same panels and gestures in both bases, from one bundle
- Canvases that move between bases as records (test harness only)
- Tidy, and starting the next card by dropping a connection on empty canvas
- Changing a node's type from its card
- A dry-run import of today's plugin data that edits no text (test harness only)
- Panels that can't reach the network, which the frame's content security policy enforces, and one module that can
- A global id on every unit, which survives retyping and sits in the text itself
- Records that validate against AT Protocol lexicons, in the shared `science.mira.*` schema
- Identity with no account: a did:plc computed on the device
- Lab attribution with PI custody, using PLC's own rotation key ranking
- Reading published `science.mira.*` records back in (test harness only)
- Paper upload with a choice of compute server, model and schema
- A canvas for each paper, with units that only become notes or pages when exported
- A lab paper repository with who uploaded, who extracted, and opt-in breadcrumbs
- Reactions and notes on shared units
- AI mode, grounded in the units you pick
- Full provenance on every unit from a paper

## Codebase efficiency

| Measure | Roam today | Obsidian today | Ours, both bases |
|---|---:|---:|---:|
| Code lines, no tests or comments | 64,125 | 35,730 | 12,123 |
| Source files | 283 | 156 | 57 |
| Runtime dependencies | 47 | 11 | 6 |
| Shipped code | Not measured | 6.5 MB, unminified | 1.3 MB minified |
| Download | Not measured | 22.8 MB, with a 16.3 MB source map | 0.40 MB gzipped |
| Shared across bases | About 4% | About 4% | 79% |
| Files in runtime import cycles | 84 | 9 | 0 |
| Files over 500 lines | 31 (11%) | 15 (10%) | 6 (11%) |
| `any` per 1,000 lines | 0.3 | 0.1 | 0.2 |
| `eslint-disable` per 1,000 lines | 1.2 | 1.0 | 0.2 |
| Test cases | 603 | 170 | 153 unit, 82 server, 219 or 220 per real app, and 124 across both |
| Test code against product code | 21% | 10% | 56% |

The reference server adds 1,615 lines, and each plugin's test hooks sit in `testing.ts`. Both are left out above, and a release build leaves the hooks out too. Bundle sizes aren't like for like: the published Obsidian build isn't minified, and it carries tldraw.

### Where the difference comes from

- **Duplication:** 50 Roam and Obsidian file pairs share code, 7 of them by more than half. 22 features were built twice, a median of 12 days apart. In ours a feature has one home, and each adapter holds only base-specific work: 574 lines for Obsidian and 721 for Roam.
- **Engine:** tldraw needs a large arrow layer on both sides. Three Obsidian files make up 4,278 of its 11,540 canvas lines, apparently mostly tldraw arrow code. React Flow gives us cards and edges directly, at the cost of tldraw's drawing tools.
- **Canvas slice:** today's two canvases take about 28,500 lines. Ours takes 2,517 and covers 48% of the capabilities, about 1,300 lines of it a layout engine neither of today's has. Those lines also include cloud sync, which ours lacks, so this isn't a clean ratio.

### Honest limits

- **Size will grow.** Ours has built the easier part. Queries aren't in it, and sync is a first pass with a reference server.
- **A fair projection:** building each area once, at today's larger size, comes to about 71,000 lines against 109,000 now. That's about 35% less from sharing alone, and it's more realistic than the 95% gap in the table.
- **Ours is worse on file size.** About one file in nine passes 500 lines, and the canvas `App.tsx` and core's `index.ts` are each over 1,000. They need splitting.
- **Type discipline is already good in today's code.** `any` use is low on both sides, so this isn't a win for ours.
- **Runtime wasn't compared.** Load time, memory and large-graph speed weren't measured, and Roam's bundle wasn't built. Running today's plugins would have reached their servers, so this stuck to static measures. Ours still has unproven costs: a 1-second poll in Roam, and the whole graph held in memory.

## How this was measured

- **Features:** two code-only inventories of `apps/roam/src` and `apps/obsidian/src`, merged into 95 capabilities. The serious claims above were spot-checked against the code.
- **Scoring:** a judgment call, row by row, and it's open to challenge in the CSV. Run `python3 -I scripts/compare.py` to rescore, and `python3 -I scripts/measure.py` to recount this repository's code.
- **Code:** comment-free, non-test lines. Shared packages are counted without generated database types.
- **Cycles, near copies and built-twice features:** from an earlier compiler-based analysis. Ours used a regex import graph, which is simpler but enough at this size.
