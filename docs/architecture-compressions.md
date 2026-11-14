# Seven compressions: fewer ideas, carrying more

A working note, 14 November 2026. An analysis and a set of proposals; none of it is built. Counts are from the code on `main` that day. Where a line is my judgement and not a measurement, it says so.

**The question.** Where does this codebase say one idea several times, in ways that make each new type, protocol or tool cost more than the last? And which smaller set of ideas would make each addition cheaper than the last, while the system says more and is easier to hold in the head?

**The answer in one paragraph.** The record log, the fold and the one-writer rule are already the right core. Around that core the same seven ideas are each written out many times: what a type is, what a link is, who can see something, what leaving the device looks like, how an outside thing becomes a unit, how a unit is shown, and how a thing in the world is named. Each has a standard it lines up with almost exactly. Writing each idea once, in the shape of its standard, turns "types × borders" work into "types + borders" work, and it is what lets other people's records add to yours without anyone coordinating.

## What the code says today

| Measure | Count | Where |
|---|---|---|
| Record kinds | 22 | `contract/record.ts` |
| Base unit types, base relation types | 9 and 9 | `BASE_NODE_TYPES`, `BASE_RELATION_TYPES` |
| Calls a panel can make | 163, in 35 namespaces | `contract/surface.ts` |
| Panels | 14 | `packages/surfaces/src` |
| Hand-kept tables with one entry per base type | 5 (AT collection, MIRA class, RO-Crate type, words, templates), plus 26 lexicon files, the SHACL shapes, a copy of those rules in TypeScript, and 49 mapping lines | `atproto.ts`, `mira.ts`, `rocrate.ts`, `grammar.ts`, `lexicons/`, `ontology/`, `shapes.ts` |
| Files that name a base type in code | 45 | grep |
| Vocabularies for "only you, the lab, everyone" | 7 | `AiRoute`, `reach`, `ProfileAudience`, `PaperScope`, `WorkspaceRef`, `Stance`, `Privacy` |
| Ways a unit comes to exist | 12 | `unit.create`, capture in a note, `pdf.cut`, `image.add`, `output.observe`, `evidence.fromOutput`, `candidate.promote`, `zotero.import`, `notebook.import`, `paper.extract` / `importGraph`, `crate.import`, `proposal.accept` |
| Ways something leaves the device, each with its own flow | 13 rows | [what-leaves-the-device.md](what-leaves-the-device.md) |
| Ways one record points at another | 6 | a relation record, a provenance field, a pin, a `target` on a check, retraction or decision, a canvas edge, a membership's two ends |

Adding the Step type, as the process design plans (`docs/process.md`, on the `process-design` branch), would mean touching most of the first seven rows by hand. That is the cost this note is about.

## The seven

Each has the same four parts: the idea, the evidence it is said many times, the one shape, and the standard that shape matches.

### 1. A type is a card, written once

**Said many times.** What a Protocol is lives in the base list, five per-type tables, a lexicon, a SHACL shape, a TypeScript copy of that shape, the mapping file, the facts type, the card's fact rows, the Method section and the run page.

**One shape.** A registry with one entry per base type. The entry holds: its label and abbreviation; its facts, as a schema; the links it may carry and to which types; its PROV class; its names in each outside vocabulary; its gap rules; which facts show on a card and which on a page. Everything in the table above is generated from it or reads it: lexicons, SHACL, the mapping file, the TypeScript types, the AT, MIRA, RO-Crate and JSON-LD writers, the form that edits a unit, the page that shows one.

**Standard.** This is what a Lexicon is in AT Protocol, a shape in SHACL and a class in OWL. Today all three are kept by hand beside each other. The registry is the master; they are printings of it. It also settles the question of units in a lab: inside, a unit is one kind of record with its type as a field, because the type is data the registry explains. A typed name is a printing made at a border.

**What it buys.** A new type is one entry. A new border is one writer that reads entries. M types and N borders cost M + N, where today they cost M × N.

### 2. A link inside a record is the author's; a link between people is a record

**Said many times.** Six mechanisms point one record at another. Four of them (check, retraction, decision, and the reaction and note on a card) are the same act: a person says something about a thing someone else made.

**One shape.** Two forms only.

- **A reference**: `{ uri, cid? }`, the pin that exists today. Used wherever a record's own author points at something: a run's protocol, evidence's output, a protocol's steps. It lives in the record and changes with it.
- **A statement**: a record of its own, by its author, about a referenced target, with a kind. Supports and opposes are statements. So are a check, a reaction, a note on a card, a retraction, an acceptance of a proposal, and a publication receipt. One fold rule covers them: a statement stands if its author signed it; what it does depends on its kind and on who its author is to the target.

**Standard.** A reference is AT Protocol's `strongRef`. A statement is the W3C Web Annotation shape (a body, a target, a motivation) and the nanopublication shape (an assertion with its provenance). It is also AT Protocol's one-writer rule: nobody edits your record; they write their own that points at it.

**What it buys.** This is the main source of growth that does not need coordination. Anyone can say something about anything, from any tool, and the fold adds it up. The three records that two people write today (membership, canvas item, a labmate's addition to a unit) become statements, which is items 5 and 6 of [atproto.md](atproto.md). The `AUTHOR_ONLY` and `REMOVAL_WINS` rule tables shrink to one check.

**Judgement.** Canvas edges stay drawings, not statements. An edge is a view of a relation, and a canvas is tool data.

### 3. One ladder for who can see

**Said many times.** Seven type vocabularies and at least four separate checks (a lab's reach, a model's route, a view's stance, a profile's audience) describe the same three rungs.

**One shape.** `Scope = device | lab(id) | public`, with a canvas as a narrower lens on any rung. One function answers "is this record visible at this scope", and every view, every search, every model call and every export takes a scope as its first argument.

**Standard.** AT Protocol's three places a record can be kept: the device's own log, a Space, the public repository. Rung for rung, as [atproto.md](atproto.md) found.

**What it buys.** "Where is this kept" and "who can read it" become one fact. A reach rule written once is kept by every feature, including ones not yet written. The two gaps found on 14 November (a paper's graph stored on the managed server ignoring reach; an own key routed through the lab's server) are the kind this removes.

### 4. One way out

**Said many times.** Sharing a canvas with a lab, sharing a paper, depositing a crate, sending a notification, asking a model, extracting a paper and publishing to an AT account are seven flows. Each decides for itself what to show first, what to keep afterwards and whether it can be undone. The page that lists what leaves the device is written by hand from reading all of them.

**One shape.** An outbox. Every act that sends something is the same four steps: **plan** (what exactly would go, and what is left out and why), **confirm** (a person's press, with the destination named), **receipt** (a statement, kept on the device: what went, where, its CID there), and **take back** where the destination allows it. A channel is an entry in a registry: its destination, what it sends, whether it can be taken back. `publish.preview`, `publish.send`, `publish.list` and `publish.withdraw`, built on 14 November and waiting in pull request 50, are this shape for one channel.

**Standard.** Raising a record a rung is what AT Protocol calls writing it to another repository or Space. A receipt is a `strongRef` to the copy. COAR Notify's announce is a statement sent to an inbox.

**What it buys.** The "what leaves the device" page is generated, so it cannot drift. A new destination is one channel entry. A person learns one gesture for every kind of sharing.

### 5. One way in

**Said many times.** Twelve calls make a unit. Each decides for itself how to record where the unit came from and what "already here" means.

**One shape.** Capture: an outside thing, named by its identifier, becomes a unit with a reference back to the exact part it came from. The variations are data: the source (a PDF passage, a Zotero annotation, a notebook cell, a line in a note, a crate entity, an agent's proposal), the selector (a quote and page, a cell index, a line), and who or what read it. "Already here" is one test: same source identifier and same selector.

**Standard.** A Web Annotation selector for the part; PROV's `wasDerivedFrom` for the link; a DOI, a Zotero item key, a notebook's source CID or an AT URI for the whole.

**What it buys.** A new source is an adapter of two functions: list what can be captured, and resolve a selector back to its place. Every source then gets "open the passage", "nothing is brought in twice" and review-before-accept without writing them.

### 6. One page for any unit, one view for any question

**Said many times.** Context, the run page, the Method section, the Boundary, and the planned protocol, step and output pages each lay out one unit. Canvas, Overview, paper map, Search, Library and profile each answer "which records, at which scope, drawn how".

**One shape.**

- **A page** is drawn from the type's card (1): its facts as a form, its references out, the statements about it grouped by kind, where it is public, its history. Types add a body where they have one: a process canvas for a protocol, a checklist for a run, the picture for an output.
- **A view** is a query, a scope (3) and a layout. The argument canvas and the process canvas are two layouts over the same engine.

**Standard.** None needed; this is the registry and the ladder showing through. The look follows the base (Obsidian's own controls, spacing and modal), as decided on 14 November.

**What it buys.** The process side becomes mostly registry entries and two layouts. A lab's own type gets a working page the moment it is defined.

**Risk, my judgement.** A page generated from a schema is serviceable and plain. The few pages people live in (a run in progress, a protocol's flow) need hand work on top. Generate the frame and the long tail; craft the three that matter.

### 7. Four names, each with one resolver

**Said many times.** Before 13 November "is this the same paper" was answered in six places; that became one resolver. The same pattern holds for people, versions and records, and each still has several answers.

**One shape.** Exactly four kinds of name, and one function for each that says whether two are the same.

| Names | Answers | Examples |
|---|---|---|
| Who | the same agent | DID, ORCID iD |
| Which record | the same unit | `did#tid`; an AT URI is an address for it, never its name |
| Which bytes | the same version | CID, SWHID, a notebook's source CID |
| Which thing in the world | the same work, material or instrument | DOI, PMID, arXiv id, RRID |

**What it buys.** Every cross-reference feature is a join on one of the four: credit and profiles on who; pins and drift on bytes; "Elsewhere", "Rests on" and the paper map on things in the world. The last is the second source of growth without coordination: two labs that never met are joined the moment both cite one DOI, and so are records from other tools on the network that cite it.

## How the work a person does maps onto all of it

Nine verbs cover what the interface is for. Each is one movement of records, and each has a counterpart in the standards. This table is the mapping the interface, the ontology and the protocols should all be read against.

| A person… | In records | Compression | PROV-O | AT Protocol | Other reference |
|---|---|---|---|---|---|
| **Captures** something read or made | A unit with a reference to its source and selector | 5 | `wasDerivedFrom`, `hadPrimarySource` | create a record | Web Annotation target; Zotero annotation; notebook cell |
| **Types** it | The type field, explained by the registry | 1 | `rdf:type` | a field inside, a collection at the border | SHACL shape; schema.org type in a crate |
| **Arranges** it | Canvas items: tool data, a view | 6 | none: not knowledge | `org.discoursegraphs.canvas*` | JSON Canvas |
| **Argues**: supports, opposes, addresses | A statement between two units | 2 | `wasInfluencedBy`, specialised | a record with two `strongRef`s | MIRA relation; nanopublication assertion |
| **Grounds** evidence in what was done | References: evidence → output → run → protocol, experiment | 2 | `wasGeneratedBy`, `used`, `hadPlan` | `strongRef` fields | RO-Crate `CreateAction`, `HowTo`, `HowToStep`; ISA study and assay |
| **Carries out** a run | A run's step log, entry by entry | 1, 2 | `Activity` with start, end, `wasAssociatedWith` | updates to one record by its one writer | Jupyter execution; a checklist, as in ClickUp's subtasks |
| **Checks** someone's unit | A statement about a pinned version | 2 | `wasAttributedTo` on an assessment | `science.mira.evaluation`-shaped record | Web Annotation, motivation "assessing"; peer review |
| **Shares**: to the lab, to the public, to an archive | The same record written one rung up, with a receipt | 3, 4 | none | another Space or the public repository | COAR Notify; DataCite; Zenodo deposit |
| **Finds** and **reviews** | A query at a scope; gaps as rules over the result | 3, 6, 7 | SPARQL over the export | an AppView's job | SHACL warnings; MCP read tools |

Two things the table shows. First, only three of the nine verbs create knowledge records (capture, argue, check); the rest type, place, link, move or read them. Second, an agent through MCP does the same nine with the same records: its proposals are statements, its permissions are a scope and a list of kinds, and "accept" is a person's statement about the agent's.

## The ontology against the record model

- **PROV-O fits without strain.** Protocol, Experiment, Code and the planned Step are `prov:Plan`; Run is `prov:Activity`; Output and every argument unit is `prov:Entity`; a person, a lab and an agent's key are `prov:Agent`. A version replacing another is `wasRevisionOf`, which the log already records as `prev`.
- **Pins are the one place PROV readers miss.** The ontology's own open note says a plain PROV reader does not see `prov:used` behind a pin. With (2), a reference is declared once as a qualified influence, and every writer emits both the pin and the direct triple.
- **Step has a ready counterpart** in schema.org's `HowToStep`, inside the `HowTo` that crates already write for a protocol. So a step publishes to a crate with no new vocabulary.
- **MIRA disagrees with PROV in one place and DG sides with PROV:** MIRA's Study is DG's Run, and MIRA types Protocol as an activity. The registry (1) is where that translation lives, in one entry each, in place of branches in three writers.

## Where growth comes from

Stated plainly, since "network effects" is easy to claim. These are the mechanisms, and what each needs.

| Mechanism | Grows with | Needs |
|---|---|---|
| Statements about other people's records | pairs of people | 2 |
| Joins on a shared DOI, RRID or CID | pairs of records, across labs and tools | 7 |
| Reuse by pin: a step in many protocols, a protocol in many runs | uses per thing | 1, 2 |
| Types × borders | each new type reaches every border, each new border carries every type | 1 |
| A lab's grammar shared by base, not by name | labs that never agreed on words can still be read together | 1 |
| One record moving up the ladder unchanged | nothing is rewritten to be shared | 3, 4 |

None of these is a feature. Each is a property that appears when an idea is written once.

## What not to compress

- **The fold's reading rules.** Which version stands is subtle and tested by the simulation. Statements simplify who may write; they do not simplify adding up.
- **The canvas engine.** Placing, linking, undo and tidy are craft, and they are already shared.
- **Kinds that never leave the device** (anchors, decisions, receipts, preferences). Name them in one list, as [atproto.md](atproto.md) item 8 says, and leave them plain.
- **A general workflow engine.** A protocol is a flow of steps with pins. It is not a programming language, and it should refuse to become one.

## Order

Each step leaves the software working and makes the next one smaller. This is my proposed order.

1. **Scope** (3). Small, mechanical, removes seven vocabularies, and closes two known reach gaps.
2. **The type registry** (1), with Step as its first new entry, generating lexicons, shapes and mappings. Units in a lab become one kind of record with the type as a field.
3. **Reference and statement** (2), which carries the AT design's record splits and proposals-as-a-collection.
4. **The outbox** (4), by moving the six older ways out onto the shape publishing already has.
5. **The page and the two layouts** (6), which is where the process side gets built.
6. **Capture adapters** (5) and the **four resolvers** (7), each as the next source or join is needed.

## What would show this is wrong

- If the Step type, added through the registry, still needs edits in more than a handful of files, (1) has not worked.
- If a statement kind needs its own fold rule that the others cannot share, (2) is two ideas, not one.
- If any feature needs a fourth rung or a rung that is not a place a record is kept, (3) is wrong and the ladder is not AT's.
- If a generated page is one people avoid, (6) has gone too far.
