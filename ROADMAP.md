# Roadmap

What is planned, in what order, and how the software connects to each of the six groups of research tools. [docs/features.md](docs/features.md) says what is built today, area by area. [docs/strategy.md](docs/strategy.md) gives the reasoning.

Nothing here is a promise of a date. Work is tracked as [issues](https://github.com/abstractary/discourse-graphs-plugins/issues) under the feature areas, and an item moves from this page to the feature map when it lands.

## The shape of the plan

One chain runs through everything: a question, a claim, the evidence for and against it, the output the evidence rests on, the run that made the output, the protocol and code the run followed, and the source it was read from. The roadmap extends that chain outward from one person:

| Stage | For | Adds | State |
|---|---|---|---|
| 1. One researcher | A lab member working from papers | Notes, types, reading, extraction with review, Zotero, search | Built in Obsidian. Search by meaning and dropping a PDF on a canvas are open |
| 2. One lab | A lab member and their PI | Shared canvases, the process side, review and sign-off | Sharing and sign-off built. Writing a protocol step by step and carrying out a run are open |
| 3. The lab's agents | A lab with an assistant | An MCP server that reads and proposes | Reading built. Proposing is open |
| 4. The public record | A lab that publishes | Claims with their chain on AT Protocol, DOIs, pages that resolve | Crates, lookups and a Zenodo draft built. Publishing is open |
| 5. Between labs | Other labs and other hosts | Reading and building on published work, a second host | Open |

A stage does not wait for the one after it. Each is a whole product for the people it serves.

## Now

In progress or next in line.

| Item | Area | Tracking |
|---|---|---|
| MCP: the three tools that propose, and one list for review | AI and agents | [#36](https://github.com/abstractary/discourse-graphs-plugins/issues/36) |
| Reach rules asked of every route a model can be on | AI and agents | [#37](https://github.com/abstractary/discourse-graphs-plugins/issues/37) |
| A paper's text by page, kept beside the paper | Reading and papers | [#35](https://github.com/abstractary/discourse-graphs-plugins/issues/35) |
| Search by person and by time | Search | [#38](https://github.com/abstractary/discourse-graphs-plugins/issues/38) |
| Publish a canvas's units to your own AT Protocol account | Publishing | [#50](https://github.com/abstractary/discourse-graphs-plugins/pull/50) |
| Shared pieces for the panels: list rows and class prefixes | Canvas | [#23](https://github.com/abstractary/discourse-graphs-plugins/issues/23) |
| Real-app tests: one set of helpers, and a vault left as found | Docs, tests and upkeep | [#25](https://github.com/abstractary/discourse-graphs-plugins/issues/25), [#46](https://github.com/abstractary/discourse-graphs-plugins/pull/46) |

## Next

Designed, not started.

### The process side

The argument side answers "what do we think, and why". The process side answers "what was done to find out".

- **Step as a unit.** A step is reusable, linkable and publishable, with its duration, parameters, materials and cautions.
- **A protocol's flow.** Steps pinned by id and hash, with the arrows between them and a condition on a branch.
- **A page over the canvas** for a protocol, a step, an experiment, a run and an output, with a breadcrumb.
- **Carrying out a run.** Tick, skip or fail each step, note what was different, fill in the values a step asks for, and drop a file on the step that made it.
- **Notebook cells as steps.** A Jupyter notebook's cells grouped under a protocol's steps.
- **Review marks.** A run's flow coloured by how each step went, and new gaps on a claim: "deviated at a step" and "a step changed since".

### AT Protocol through the whole system

The software's own parts already match AT Protocol's closely: a unit's id is a DID and a record key, a device's log is close to a repository, and the three audiences (only you, the lab, everyone) match the device, a shared space and the public repository. The work is to make the match exact, so that moving a record outward changes where it is kept and never what it is.

In order:

1. Tests that hold the rules: an id survives retyping, joining a lab and publishing.
2. One encoding and one hash for every record.
3. A signing key of its own for each person, and a recovery key made at setup.
4. One writer per record: memberships, canvas items and shared facts split by author. Proposals become their own collection.
5. Lexicons as the one definition of everything that crosses a wire.
6. One log per member on the lab server.
7. Export a person's repository, and publish a release as one commit.
8. Read what other tools publish, indexed by DOI.

### Search by meaning

Find units by what they mean, beside search by words. Embeddings are made on the device or by a provider the person chose, under the same reach rules as any other model call.

### Collaboration

| Item | Tracking |
|---|---|
| Merge by property, so two changes to one card both stand | [#39](https://github.com/abstractary/discourse-graphs-plugins/issues/39) |
| A model on a labmate's computer, through the lab server | [#40](https://github.com/abstractary/discourse-graphs-plugins/issues/40) |
| Several real Obsidians at once, with a real file-sync tool | [#41](https://github.com/abstractary/discourse-graphs-plugins/issues/41) |
| Workspaces shared by people who are not one lab | Not yet filed |
| Ask a named person to check something, and a list of what is waiting for you | Not yet filed |

## Later

- **A Logseq host** ([#42](https://github.com/abstractary/discourse-graphs-plugins/issues/42)), behind the same host contract as Obsidian.
- **A Roam exporter**, so a Roam graph's discourse nodes and relations can be brought in.
- **Analysis on request**: a side panel that answers a question about structure, gaps, credit or themes and highlights the units it means. It runs only when asked.
- **Reading the wider record**: "Elsewhere" and "Rests on" reaching past the lab to what other labs have published.
- **A hardened server.** The server in this repository is a reference for the API. Hosting one needs TLS, rate limits and a way to revoke a token.

## The six groups

A survey of 238 research tools sorts them into six groups by what they do. The software connects to each group in one of three ways:

- **A designed surface.** Where a group's products agree closely, their users share one way of working. The core activities of that way of working are built into the tool.
- **Standards at the edge.** Where a group's products vary, the group is served through the formats and protocols it already shares, with one adapter file for each.
- **MCP.** One server that any assistant can use, under the same rules a person works under.

| Group | Products | How it connects |
|---|---:|---|
| Lab notebooks and LIMS | 25 | A designed surface |
| Networked notes apps | 20 | A designed surface, as the host |
| AI research and reading tools | 83 | A designed surface, narrower |
| Open publishing and indexes | 44 | Standards |
| AI scientists and code notebooks | 38 | Standards and MCP |
| Plugins and open writing tools | 28 | Open formats |

The groups are listed in the order they are served: the groups whose products agree most come first.

### 1. Lab notebooks and LIMS

**What their users expect.** A dated record of what was done, started from a template, holding pictures and files, checked by someone, and not quietly changed afterwards.

**How it connects.** The notebook's core activities are mirrored inside the tool, and the lab's own notebook stays the record of the bench. Bench records are linked by id and cited by hash. They are never copied in.

| Their expectation | Built | Planned |
|---|---|---|
| An entry per experiment, from a template | Protocol, Experiment, Run, Code and Output types. Templates with starter headings for each | Protocols written step by step, and a run carried out as a checklist |
| Pictures in the record | A dropped or pasted picture is an output pinned by its hash. "Say what it shows" makes evidence that rests on it | Outputs attached to the step that made them |
| A list of all experiments | A table for each type | The same table in the local app |
| Results do not change silently | A run says "changed" or "missing" when its protocol, code or output drifts | The same mark on every card that cites a file |
| Someone signs off | Checked or needs work, with how it was checked, pinned to the version checked | Ask a named person, and a list of what is waiting for you |
| It moves to another notebook | `.eln` export and import | Opened in a running eLabFTW and RSpace as part of the tests |
| Materials have identifiers | Materials as text | A picker for RRIDs and catalogue numbers |

**Done when** a lab member logs one real experiment from a template with an image, the PI marks it checked, and the `.eln` file opens in the lab's notebook with the run, files and protocol intact.

### 2. Networked notes apps

**What their users expect.** Write first and structure later. Types are the user's own. A table of everything of one type. Files they own and can read without the tool.

**How it connects.** This group is the host. The tool runs inside the notes app as a plugin, behind one [host contract](docs/CONTRACT.md), and uses the host's own files, commands and dialogs.

| Their expectation | Built | Planned |
|---|---|---|
| I define and edit my types | The Types and relations dialog. Schema export and import | A relation type made from the canvas. A colour for each type in the dialog |
| Capture in the flow of writing | A unit from selected text. Candidate tags, promoted from Search | The candidate tag styled in the editor |
| A table of everything of one type | Obsidian Bases, one file for each type | |
| Grow an argument from one card | A selected card lists its relations and brings in what is not on the canvas | Take a related unit off the canvas from the same list |
| It behaves like the host | Canvas actions are Obsidian commands. Dialogs are Obsidian modals | The quick finder as a native modal |
| My files stay legible without the plugin | Units exported as notes, with relations as link properties | |
| A second notes app | Obsidian | Logseq. A Roam exporter |

**Done when**, in a fresh vault, a person adds a type, tags a line in a daily note, promotes it, links it from its card and sees it in a table, using only commands and the host's own dialogs.

### 3. AI research and reading tools

**What their users expect.** Give it the paper and ask. A library of PDFs that is already there.

**How it connects.** A narrower designed surface: a reader, extraction that a person reviews, and questions answered from a canvas. The library is Zotero's and the model is the lab's choice. What this tool adds is the one thing the group lacks: every answer keeps its passage, its model and its reader.

| Their expectation | Built | Planned |
|---|---|---|
| My library is already there | Zotero as the PDF library, read only: references, highlights and a link back to the page | Group libraries and highlights checked against a real library that has them |
| Drop a PDF anywhere | The reader, Extract graph and saved extractions | A PDF dropped on a canvas |
| Find by meaning | Search by words | Search by meaning, by person and by time |
| Tell me if a paper is retracted | A lookup for each paper, on request | A lookup for a whole canvas, and a mark on the card |
| My AI tool can use this | Ask AI with your own key. The MCP server reads | The MCP server proposes |

**Done when** a reader's real Zotero library comes in, three papers are extracted and checked, and a question across them returns units with their passages.

### 4. Open publishing and indexes

**What their users expect.** Identifiers, deposits, versions and review.

**How it connects.** Through the standards the group already runs on. Nothing here has a surface of its own beyond a button and a result.

| Standard | Built | Planned |
|---|---|---|
| DOIs and open indexes | Lookups in Crossref, DataCite, OpenAlex and PubMed | |
| RO-Crate | Export and import of a canvas with its files, schema and README | |
| DataCite and Zenodo | DataCite metadata. A Zenodo draft with a reserved DOI | A real deposit, run in Zenodo's sandbox as part of the tests |
| Signposting | Typed links on every stored graph | Unit pages that resolve from outside |
| COAR Notify | An inbox, and announcements sent on request | Review and endorsement by open review communities |
| AT Protocol | Lexicons, ids that map to AT addresses | Publishing a release to the author's own repository |

**Done when** a reader outside the lab follows a published claim to its evidence, its run and its source.

### 5. AI scientists and code notebooks

**What their users expect.** Code runs, and an agent proposes.

**How it connects.** Through files and through MCP. A notebook is read as it is. An agent works through the same core a panel does and can only propose: a person accepts or rejects everything it writes.

| Their expectation | Built | Planned |
|---|---|---|
| A notebook is evidence | A Jupyter notebook becomes Code, a Run and Outputs, each pinned by hash. Run crates are read | Cells as steps. Outputs drawn as the notebook drew them |
| An agent can read my graph | The MCP server's read tools. An agent has its own key, so its work is attributed | |
| An agent can add to my graph | Proposals as records that wait for a decision | The MCP tools that propose, and one review list |
| The model runs where I say | A lab can limit which servers and providers are reached | A model on a labmate's computer |

**Done when** an agent's proposals arrive attributed, a person accepts some and rejects others, and nothing enters the graph any other way.

### 6. Plugins and open writing tools

**What their users expect.** Plain files that chain together.

**How it connects.** Through open formats only. There is no surface.

| Format | Built | Planned |
|---|---|---|
| JSON Canvas | Canvases are JSON Canvas files with added fields | |
| JSON-LD | Every unit and relation | |
| Markdown | Units exported as notes | A whole canvas as one Markdown document |
| CSV | | A table for each type |
| BibTeX and CSL | | Citekeys on sources |

**Done when** a draft written in a plain-text tool cites a claim by its key, and the claim's chain can be followed from the citation.

## Rules that hold for every group

Work for one group must not bend these.

1. **One chain**, on nine fixed bases. A lab may rename types and add types on a base. It may not add a base.
2. **Link by id, hash what you cite, never copy.**
3. **Nothing leaves without a click.**
4. **A gap shows as a gap.** A run with no outputs looks like one.
5. **One file knows each standard.**
6. **One word for each thing**, from [docs/information-architecture.md](docs/information-architecture.md).

A feature that needs a new base, a copy of someone else's record, or a send in the background is a sign to redesign it.

## Open questions

| Question | Tracking |
|---|---|
| Retire the Roam host, or bring it up to date | [#32](https://github.com/abstractary/discourse-graphs-plugins/issues/32) |
| A schema library as the one definition of records and calls | [#33](https://github.com/abstractary/discourse-graphs-plugins/issues/33) |
| Whether a lab may add a base, not only types on a base | Not yet filed |
| Who hosts a lab's data server once records are on AT Protocol | Not yet filed |
| Whether units inside a lab keep one collection and take a MIRA type only on publishing | Not yet filed |
| A listing in Obsidian's community plugin directory | Not yet filed |

## Not planned

- A lab notebook of record, sample tracking, inventory or instrument control.
- An AI scientist. Agents come in through MCP.
- A relay, data server or index of our own while existing ones do the job.
- Dashboards built for their own sake, and notices sent to draw people back in.
