# Feature map

Every feature belongs to one of fourteen areas. This page says what each area holds today and where to read about it. What is planned is in [ROADMAP.md](../ROADMAP.md).

## Areas

| Area | Topic | What it holds | Read |
|---|---|---|---|
| Record log | [#3](https://github.com/abstractary/discourse-graphs-plugins/issues/3) | Signed records in one log for each device, folded into the graph. Two changes to one card: the later stands | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Labs and sync | [#4](https://github.com/abstractary/discourse-graphs-plugins/issues/4) | Labs, invitations, members, shared canvases, a shelf, sync through a lab server | [labs-and-sync.md](labs-and-sync.md) |
| Identity and devices | [#5](https://github.com/abstractary/discourse-graphs-plugins/issues/5) | A DID for each person, a key for each device, devices let in by a trusted key | [labs-and-sync.md](labs-and-sync.md) |
| Canvas | [#6](https://github.com/abstractary/discourse-graphs-plugins/issues/6) | Cards, links, stickies, drawing, ten Tidy arrangements, sidebar, minimap, undo, commands | [DESIGN.md](DESIGN.md) |
| Units, relations and grammar | [#7](https://github.com/abstractary/discourse-graphs-plugins/issues/7) | Nine fixed kinds, a lab's own types and relations, templates, candidate tags, tables | [guide/schema.md](guide/schema.md) |
| Reading and papers | [#8](https://github.com/abstractary/discourse-graphs-plugins/issues/8) | PDF reader, Extract graph, PDF canvases, paper map. A paper's text by page is not kept | [guide/README.md](guide/README.md) |
| Method, runs and checks | [#9](https://github.com/abstractary/discourse-graphs-plugins/issues/9) | Protocols, experiments, runs, code and outputs; notebook import; pictures as outputs; sign-off | [guide/schema.md](guide/schema.md) |
| Search | [#10](https://github.com/abstractary/discourse-graphs-plugins/issues/10) | By words over titles, passages and notes, with a quick finder | [search.md](search.md) |
| Publishing and the scholarly record | [#11](https://github.com/abstractary/discourse-graphs-plugins/issues/11) | Registry lookups, RO-Crate and `.eln`, a Zenodo draft, Signposting, COAR Notify, AT Protocol lexicons | [scholarly.md](scholarly.md) |
| AI and agents | [#12](https://github.com/abstractary/discourse-graphs-plugins/issues/12) | Ask AI with your own key or a lab's model, proposals a person decides, an MCP server that reads | [mcp.md](mcp.md) |
| Zotero | [#13](https://github.com/abstractary/discourse-graphs-plugins/issues/13) | References, highlights and PDFs, read only | [zotero.md](zotero.md) |
| Hosts | [#14](https://github.com/abstractary/discourse-graphs-plugins/issues/14) | Obsidian, the local app and the MCP server. A Roam adapter that passes conformance without the optional calls | [CONTRACT.md](CONTRACT.md) |
| Reference server | [#15](https://github.com/abstractary/discourse-graphs-plugins/issues/15) | Compute, graph store, labs, exchange, AI, landing pages, inbox. A reference for the API, not for hosting | [services.md](services.md) |
| Docs, tests and upkeep | [#16](https://github.com/abstractary/discourse-graphs-plugins/issues/16) | Unit, server and simulation tests and five checks in CI. Real-app tests run by hand | [testing.md](testing.md) |

## How work is tracked

- **A topic issue** (label `kind: topic`) stands for an area. Its body lists what is built and what is planned. It stays open.
- **A work item** is a sub-issue of one topic. It carries the area's label and one kind: `kind: refactor`, `kind: feature`, `kind: decision`, `kind: test` or `documentation`.
- **A milestone** groups work items that land together: [Refactor](https://github.com/abstractary/discourse-graphs-plugins/milestone/1), [MCP server](https://github.com/abstractary/discourse-graphs-plugins/milestone/2) and [Collaboration](https://github.com/abstractary/discourse-graphs-plugins/milestone/3).
- **New work** starts as a sub-issue of its area. If it fits no area, ask before building.
- **When work lands,** its pull request closes the work item and changes the topic's list, this page and [ROADMAP.md](../ROADMAP.md) together.

Open work is listed in [ROADMAP.md](../ROADMAP.md) and under each [topic issue](https://github.com/abstractary/discourse-graphs-plugins/issues?q=is%3Aissue+label%3A%22kind%3A+topic%22).

## Conventions in the code

- One feature to a file, shaped `xFeature(context, deps)`, returning its handlers.
- Rules are pure functions in `packages/contract`.
- Every outside call goes through `packages/sync`.
- Nothing from a model or an agent enters the graph before a person decides.
- A shape that crosses a wire is declared once, in `packages/contract/src/wire.ts`.
