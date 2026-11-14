# Feature map

Every feature belongs to one of fourteen areas. Each area is a **topic issue** in GitHub, and each piece of work in it is a **sub-issue** of that topic. This page is the same map in the repository, so it can be read beside the code.

## How work is tracked

- **A topic issue** (label `kind: topic`) stands for an area. Its body lists what is built, partly built and planned. It stays open.
- **A work item** is a sub-issue of one topic. It carries the area's label and one kind: `kind: refactor`, `kind: feature`, `kind: decision`, `kind: test` or `documentation`.
- **A milestone** groups work items that land together: [Refactor](https://github.com/abstractary/discourse-graphs-plugins/milestone/1), [MCP server](https://github.com/abstractary/discourse-graphs-plugins/milestone/2) and [Collaboration](https://github.com/abstractary/discourse-graphs-plugins/milestone/3).
- **New work** starts as a sub-issue of its area. If it fits no area, that is a question about the map, and worth asking before building.
- **When work lands,** its pull request closes the work item, and the topic's list and this page are changed in the same pull request.

## Areas

| Area | Topic | Where it stands | Read |
|---|---|---|---|
| Record log | [#3](https://github.com/abstractary/discourse-graphs-plugins/issues/3) | Built; property-level merge and full validation open | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Labs and sync | [#4](https://github.com/abstractary/discourse-graphs-plugins/issues/4) | Built for one lab | [four-vaults.md](four-vaults.md) |
| Identity and devices | [#5](https://github.com/abstractary/discourse-graphs-plugins/issues/5) | Built | [four-vaults.md](four-vaults.md) |
| Canvas | [#6](https://github.com/abstractary/discourse-graphs-plugins/issues/6) | Built; the component is split, its toolbar still to go | [DESIGN.md](DESIGN.md) |
| Units, relations and grammar | [#7](https://github.com/abstractary/discourse-graphs-plugins/issues/7) | Built; the calls need one naming scheme | [guide/schema.md](guide/schema.md) |
| Reading and papers | [#8](https://github.com/abstractary/discourse-graphs-plugins/issues/8) | Built; page text not kept yet | [guide/README.md](guide/README.md) |
| Method, runs and checks | [#9](https://github.com/abstractary/discourse-graphs-plugins/issues/9) | Built | [guide/schema.md](guide/schema.md) |
| Search | [#10](https://github.com/abstractary/discourse-graphs-plugins/issues/10) | Built by words; by person, time and meaning planned | [semantic-search-plan.md](semantic-search-plan.md) |
| Publishing and the scholarly record | [#11](https://github.com/abstractary/discourse-graphs-plugins/issues/11) | Crates and lookups built; AT Protocol partly | [scholarly.md](scholarly.md) |
| AI and agents | [#12](https://github.com/abstractary/discourse-graphs-plugins/issues/12) | Ask AI and proposals built; MCP server reads, and does not propose yet | [mcp.md](mcp.md) |
| Zotero | [#13](https://github.com/abstractary/discourse-graphs-plugins/issues/13) | Built, read only; highlights and groups tested against a stand-in | [zotero.md](zotero.md) |
| Hosts | [#14](https://github.com/abstractary/discourse-graphs-plugins/issues/14) | Obsidian, the local app and the MCP server current; Roam behind; Logseq planned | [CONTRACT.md](CONTRACT.md) |
| Reference server | [#15](https://github.com/abstractary/discourse-graphs-plugins/issues/15) | A reference, not hardened | [services.md](services.md) |
| Docs, tests and upkeep | [#16](https://github.com/abstractary/discourse-graphs-plugins/issues/16) | In CI; real-app tests run by hand | [testing.md](testing.md) |

## Open work by area

### Record log ([#3](https://github.com/abstractary/discourse-graphs-plugins/issues/3))

- [#33](https://github.com/abstractary/discourse-graphs-plugins/issues/33) Decide: a schema library as the one definition of records and calls · decision · Refactor
- [#39](https://github.com/abstractary/discourse-graphs-plugins/issues/39) Merge by property, so two changes to one card both stand · feature · Collaboration

### Canvas ([#6](https://github.com/abstractary/discourse-graphs-plugins/issues/6))

- [#19](https://github.com/abstractary/discourse-graphs-plugins/issues/19) Split the canvas component, starting with its writer · refactor · Refactor · partly done: the toolbar and canvas menu remain
- [#23](https://github.com/abstractary/discourse-graphs-plugins/issues/23) Shared pieces for the panels, and panels that do not import each other · refactor · Refactor · partly done: tab bars, confirms and class prefixes remain

### Units, relations and grammar ([#7](https://github.com/abstractary/discourse-graphs-plugins/issues/7))

- [#21](https://github.com/abstractary/discourse-graphs-plugins/issues/21) One name for one idea in the calls a panel makes · refactor · Refactor
- [#27](https://github.com/abstractary/discourse-graphs-plugins/issues/27) Retire the old word for Overview and Boundary from the code · refactor · Refactor
- [#28](https://github.com/abstractary/discourse-graphs-plugins/issues/28) Failures that keep their codes, and none that vanish · refactor · Refactor · partly done: panels do not act on the codes yet

### Reading and papers ([#8](https://github.com/abstractary/discourse-graphs-plugins/issues/8))

- [#35](https://github.com/abstractary/discourse-graphs-plugins/issues/35) A paper's text by page, kept beside the paper · feature · MCP server

### Search ([#10](https://github.com/abstractary/discourse-graphs-plugins/issues/10))

- [#38](https://github.com/abstractary/discourse-graphs-plugins/issues/38) Search by person and by time · feature · MCP server

### AI and agents ([#12](https://github.com/abstractary/discourse-graphs-plugins/issues/12))

- [#36](https://github.com/abstractary/discourse-graphs-plugins/issues/36) MCP: the three tools that propose, and one review list · feature · MCP server
- [#37](https://github.com/abstractary/discourse-graphs-plugins/issues/37) Reach asked of every route a model can be on · feature · MCP server
- [#40](https://github.com/abstractary/discourse-graphs-plugins/issues/40) A model on a labmate's computer, through the lab server · feature · Collaboration

### Hosts ([#14](https://github.com/abstractary/discourse-graphs-plugins/issues/14))

- [#26](https://github.com/abstractary/discourse-graphs-plugins/issues/26) Plugins use the seam the contract defines for them · refactor · Refactor · partly done: three callers still take the whole core
- [#32](https://github.com/abstractary/discourse-graphs-plugins/issues/32) Decide: retire the Roam host, or bring it up to date · decision · Refactor
- [#42](https://github.com/abstractary/discourse-graphs-plugins/issues/42) A Logseq host · feature · Collaboration

### Reference server ([#15](https://github.com/abstractary/discourse-graphs-plugins/issues/15))

- [#22](https://github.com/abstractary/discourse-graphs-plugins/issues/22) One table of routes for the client, the server and the docs · refactor · Refactor

### Docs, tests and upkeep ([#16](https://github.com/abstractary/discourse-graphs-plugins/issues/16))

- [#25](https://github.com/abstractary/discourse-graphs-plugins/issues/25) Real-app tests: one set of helpers, and leave the vault as found · test · Refactor
- [#31](https://github.com/abstractary/discourse-graphs-plugins/issues/31) One account of what leaves the device, and a changelog a person can read · documentation · Refactor
- [#41](https://github.com/abstractary/discourse-graphs-plugins/issues/41) Several real Obsidians at once, and a real file-sync tool · test · Collaboration

Areas with no open work item today: Labs and sync, Identity and devices, Method, runs and checks, Publishing and the scholarly record, Zotero. Their topic issues list what is planned.

## What to optimise for, and what to end

The audit of November 2026 named the patterns. In short:

- **Keep:** one feature to a file, shaped `xFeature(context, deps)` and returning its handlers; rules as pure functions in the contract; every outside call behind `packages/sync`; a person's decision before anything from a model or an agent enters the graph; tests that run several people at once.
- **End:** handlers defined in the core's entry file; features wired through variables filled in later; one idea under several names; the same shape declared on both sides of a wire; panels importing each other; tests that sleep; docs that state counts by hand.

The full account, with every finding and what was done about it, is in [audit-2026-11.md](audit-2026-11.md).
