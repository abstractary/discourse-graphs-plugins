# Strategy: one chain, built end to end

This page argues that vertical integration is the right strategy for a product like Discourse Graphs, says where the integration stops, and sets out how the software is rolled out. It is the reasoning behind [ROADMAP.md](../ROADMAP.md).

It is the view of this repository. It is not a statement by the [Discourse Graphs](https://discoursegraphs.com) project.

## The thesis

A research claim is only as good as the chain behind it: the question it answers, the evidence for and against it, the output the evidence rests on, the run that made the output, the protocol and code the run followed, and the source it was read from.

Today that chain is spread over six kinds of tool. Each kind is good at its own stage. None of them carries the chain across a stage boundary, so the chain breaks every time work moves from one tool to the next.

**The thesis is that the chain itself is the product, and a chain can only be kept whole by one system that holds every link of it.** So Discourse Graphs should be integrated vertically along the chain, from the bench record to the published claim, and should stay modular everywhere a working standard already exists.

## What breaks today

A survey of 238 research tools sorts them into six groups by what they do. Read in the order research happens, the groups are the stages of the chain.

| Stage | Group | Products | What it holds | What it drops at the boundary |
|---|---|---:|---|---|
| Doing | Lab notebooks and LIMS | 25 | A dated, signed record of what was done | Which claim the record is evidence for |
| Thinking | Networked notes apps | 20 | Notes, links and the user's own types | Where a note's content came from |
| Reading | AI research and reading tools | 83 | A paper in, an answer out | The passage, the model and the reader behind the answer |
| Computing | AI scientists and code notebooks | 38 | Code, runs and outputs | Which argument an output bears on |
| Writing | Plugins and open writing tools | 28 | Plain files that chain together | Everything typed: a claim becomes a sentence |
| Publishing | Open publishing and indexes | 44 | Identifiers, deposits, versions, review | The structure inside the paper |

Two findings from the same survey carry the argument:

- **The scarce thing is the join.** Six of the 238 products link claims to evidence with provenance. Every group makes or uses the parts. Almost nobody keeps them joined.
- **The groups do not overlap much.** Products inside a group do the same things, and products in different groups do different things. A researcher's day crosses three or four groups, and the crossing is done by hand: copy, paste, re-type, re-cite.

Each copy loses something that cannot be rebuilt later. A claim pasted from a reading tool into a note no longer knows its passage. A figure pasted from a notebook into a draft no longer knows its run. By the time a claim is published, the reader is asked to trust a chain nobody can inspect.

## What vertical integration means here

**It means owning the record of the chain, end to end.** One system holds the question, the claim, the evidence, the output, the run, the protocol, the code and the source. It holds them with:

- **one identity** for every unit, which never changes when the unit moves from a person's device to a lab to the public record;
- **one log** of signed records, so every change has an author and a time;
- **one schema**, nine fixed bases that a lab can rename and extend but not replace;
- **one rule for links**: link by id, hash what you cite, never copy;
- **one rule for trust**: nothing from a model or an agent enters the graph until a person accepts it, and nothing leaves the device without a click.

**It does not mean owning every tool a researcher uses.** The editor is Obsidian's. The library is Zotero's. Identifiers belong to Crossref, DataCite, ORCID and OpenAlex. Deposits belong to Zenodo. Models belong to whichever provider the lab picks. Public hosting belongs to AT Protocol. Discourse Graphs integrates the chain and rents everything else.

The line between the two is one test:

> **Integrate where no standard carries the link. Adopt the standard where one does.**

A DOI carries a paper's identity between tools well enough, so we adopt it. Nothing carries "this claim rests on this output of this run" between tools, so we build it.

## Why it is sound

### 1. Integration pays where the interface is not good enough

Christensen and Raynor's account of integration and modularity makes a simple prediction. Where the interface between two stages is well specified and good enough, modular specialists win, because each can improve its own part. Where the interface is unspecified and the product is not yet good enough for its users, integrated products win, because only an integrated builder can change both sides of the interface at once.

Provenance across research tools is the second case. There is no agreed way to pass a claim with its evidence from a reading tool to a notes app, or an output with its run from a notebook to an argument. Waiting for six groups of vendors to agree on one is waiting for a long time. An integrated product can simply make the link work, and then publish the format.

### 2. The value sits in assets that only work together

Teece's point about complementary assets applies directly. A claim's value depends on the evidence behind it. Evidence depends on the output, and the output on the run. A tool that holds one of these cannot check or show the others, so it cannot deliver the value even if its own part is excellent. The parts are co-specialised: each is worth far more when the others are present and joined.

That is also why the join is scarce. A specialist has no reason to build it, because most of the benefit lands outside its own stage.

### 3. Every tool boundary is a cost the researcher pays

The transaction-cost view of the firm says to bring an exchange inside when doing it across a boundary is expensive and hard to contract for. For a researcher, each boundary costs re-keying, a lost link, and a later argument about where a number came from. Those costs are small each time and large in total, and no vendor on either side of the boundary is paid to remove them. Bringing the stages into one record removes them at the root.

### 4. The promises that matter are end-to-end promises

Three things researchers need from this kind of tool cannot be delivered by a pipeline of separate products:

- **Privacy.** "Nothing leaves this device unless you press a button" is true only if one system controls every exit. See [what-leaves-the-device.md](what-leaves-the-device.md).
- **Credit.** "Every unit names who made it and who checked it" is true only if one log records both, from the first note to the published record.
- **Integrity.** "This evidence still rests on the file it was made from" is true only if the same system hashed the file, pinned the hash, and checks it again when the claim is read.

A chain of tools can each keep these promises inside its own walls and still break all three at the handoff.

### 5. It is the cheap way to build, not the expensive one

Vertical integration usually means a large company. Here it means the opposite: one small core that every surface shares.

- The graph, identity, labs, papers and publishing live in one core library.
- A host such as Obsidian is an adapter behind one contract. A second host is a second adapter, not a second product.
- A panel is built once and drawn in every host.
- A standard is known by one file. A new format is one new adapter.
- An agent reaches the same core through the MCP server, with the same rules a person has.

So each new stage of the chain reuses the identity, the log, the schema and the review rule that the earlier stages already paid for. The cost of the sixth stage is far lower than the cost of the first. [ARCHITECTURE.md](ARCHITECTURE.md) shows the cuts.

### 6. An integrated chain is what makes an open format worth having

Integration and openness are often set against each other. Here one feeds the other. A published claim that carries its whole chain, in an open format, on an open protocol, is useful to every other tool: an index can cite it, a review community can check it, an assistant can read it. A claim with no chain is one more sentence. Only a system that held the chain from the start can publish it whole.

## Where the integration stops

The six groups are not served the same way. Groups whose products agree closely with each other have taught their users one clear way of working, so that way of working is built into the tool as a designed surface. Groups whose products vary are served through the standards they already share.

| Group | Served by | What is built in | What is adopted |
|---|---|---|---|
| Lab notebooks and LIMS | A designed surface | The notebook's core activities: an entry from a template, pictures as evidence, a table of experiments, sign-off | The `.eln` file format. The notebook stays the record of the bench |
| Networked notes apps | A designed surface | Types, capture, relations and tables, inside the host | The host itself, its files and its commands |
| AI research and reading tools | A designed surface, narrower | A reader, extraction with review, questions over a canvas | Zotero as the library, and any model the lab chooses |
| Open publishing and indexes | Standards | Publishing a claim with its chain | DOIs, RO-Crate, DataCite, Signposting, COAR Notify, AT Protocol |
| AI scientists and code notebooks | Standards and MCP | Runs, outputs and proposals as records | Jupyter files, run crates, and the Model Context Protocol |
| Plugins and open writing tools | Open formats | Nothing | Markdown, CSV, JSON-LD, JSON Canvas, BibTeX and CSL |

Four things are deliberately not built:

- **A lab notebook of record.** Bench records are linked by id and hash. They are never copied in, so the lab's notebook stays the source of truth.
- **An AI scientist.** Agents come in through MCP and can only propose.
- **A relay, a data server or an index of our own**, while existing ones do the job.
- **A reference manager.** Zotero is the library, and it is only read.

[ROADMAP.md](../ROADMAP.md) has the work for each group.

## The risks, and the answers

| Risk | Answer |
|---|---|
| **Breadth beats depth.** Six stages done thinly are worse than one done well. | Stages are built in order of how clearly their users agree on what the stage is. Each ends with a written test, run in the real app, before the next begins. |
| **A worse notebook than a notebook.** Mirroring a group's activities invites comparison with products that do only that. | Only the activities that feed the chain are mirrored. The specialist tool keeps everything else, and its records are linked, not replaced. |
| **Lock-in.** An integrated product can trap its users. | Notes stay legible without the plugin. Every canvas exports as an open crate. The public record sits in the author's own repository on an open protocol. |
| **The host changes its rules.** The product lives inside someone else's app. | Everything a host must do is in one contract with a conformance suite. The same core runs as a local app with no host at all. |
| **A standard moves.** | One file knows each standard. |
| **A small team runs out of road.** | One core, built once. Work that a standard or an open tool already does is never rebuilt. |
| **The map is wrong.** The six groups come from what products say they do, not from interviews with their users. | The rollout below starts with one lab and treats each stage's test as a check on the map. |

## What would change this view

The thesis should be dropped, or narrowed, if any of these turns out to be true:

- An open standard appears that carries claims with their evidence and provenance between tools, and vendors adopt it. Then the join is no longer scarce, and the right move is to be the best client of that standard.
- Lab members and PIs do not, in practice, move between bench record, notes and papers within one piece of work. Then the designed surfaces should be separate tools.
- Researchers will not review what a model proposes. Then extraction and agents cannot feed the chain at the rate the plan assumes.
- Labs will not publish claims below the level of a paper. Then the public end of the chain has no readers, and the product is a lab tool only.

## Rollout

The rollout follows the chain outward from one person: a researcher, then a lab, then the lab's agents, then the public record, then other labs. Each stage adds one kind of trust, and no stage starts until the one before it has passed its test with real work.

| Stage | Who | What they get | The test that ends the stage |
|---|---|---|---|
| **0. Demo** | People inspecting the design | Everything, in a throwaway vault, with demo papers | A newcomer follows the README and extracts a paper without help |
| **1. One researcher** | A lab member working from papers | Notes, types, the reader, extraction with review, Zotero, search, in Obsidian | Their real Zotero library comes in, three papers are extracted and checked, and a question across them returns units with their passages |
| **2. One lab** | A lab member and their PI | Shared canvases, the process side (protocols, runs, outputs), review and sign-off | A member logs one real experiment from a template with an image, the PI marks it checked, and the `.eln` file opens in the lab's notebook |
| **3. The lab's agents** | The same lab, with an assistant of its choice | The MCP server: read, and propose for review | An agent's proposals arrive attributed, a person accepts some and rejects others, and nothing enters the graph any other way |
| **4. The public record** | The lab, publishing | Claims with their chain on AT Protocol, a DOI for a release, pages that resolve | A reader outside the lab follows a published claim to its evidence, its run and its source |
| **5. Between labs** | Other labs, other hosts | Reading what others published, building on it, a second host | A second lab cites and builds on the first lab's published claim from its own vault |

Four rules hold at every stage:

- **Private until published.** Each stage widens who can see a unit only when its author says so.
- **Real work before the next stage.** A stage's test is run by the people it is for, on their own material, not on demo data.
- **No stage needs the next.** A researcher who never joins a lab, a lab that never publishes, and a lab with no agent each have a whole product.
- **Pull, not push.** The software answers when asked. It does not send notices to draw people in.

### How it reaches people

Each stage has an existing place where its users already are, so the product arrives as an addition to a tool they trust rather than as a new place to work:

- **Researchers** through their notes app, as a plugin.
- **Readers** through their Zotero library.
- **Agents** through MCP, which products in every one of the six groups already support.
- **The public record** through open identifiers and AT Protocol, where other research tools already publish.

### What is measured

The plugin sends no usage data today, so progress is judged by the stage tests above. Three counts would say whether the chain is holding, and each can be worked out from a lab's own graph without sending anything anywhere: the share of claims that reach a source, the share of evidence that rests on a pinned output, and the share of units a second person has checked. They are proposed, not built.

## References

- Christensen, C. M. and Raynor, M. E. (2003). *The Innovator's Solution*. Harvard Business School Press. Chapter 5, on integration and modularity.
- Teece, D. J. (1986). Profiting from technological innovation. *Research Policy*, 15(6), 285–305.
- Williamson, O. E. (1985). *The Economic Institutions of Capitalism*. Free Press.
- Coase, R. H. (1937). The nature of the firm. *Economica*, 4(16), 386–405.
