# Schema reference

Every record kind, unit type, field, link and rule. For a first read, start with the [guide](README.md#the-schema-in-five-minutes). This page matches version 0.2 of the process ontology in [`ontology/`](../../ontology/README.md) and record format version 2.

## Where the schema is written down

| Form | File | Used for |
|---|---|---|
| TypeScript types | `packages/contract/src/record.ts` | What the plugins read and write |
| OWL | `ontology/dg_process.ttl` | The classes and properties, built on W3C PROV-O |
| SHACL | `ontology/dg_process.shacl.ttl` | The rules, one named shape each |
| The same rules in the app | `packages/core/src/shapes.ts` | Gaps shown in the Method section, on a run's page and in the Boundary panel |
| JSON-LD context | `ontology/dg_process.context.jsonld` | Reading an export as linked data |
| Mappings | `ontology/mappings.sssom.tsv` | Alignment to PROV-O, MIRA, schema.org, Bioschemas |
| AT Protocol lexicons | `lexicons/` | The published form of each record |

The SHACL file and the in-app check hold the same rules under the same names. A shared set of deliberately wrong graphs (`ontology/tests/cases.json`, one per rule) is run through both, so they cannot drift apart.

## Records

The graph is a log of records. Each record is one JSON object. Nothing is edited in place: a change is a new version of a record, appended.

### What every record carries

| Field | Holds |
|---|---|
| `v` | The format version, `2` |
| `id` | The record's id |
| `kind` | One of the kinds below |
| `space` | The vault or graph that first wrote it |
| `at` | When it was first written. Never changes |
| `by` | Who wrote it: `{id, name}`. The id is a DID |
| `lab` | The lab's DID, when its author is in one |
| `sig`, `sigBy` | The signature of the device that wrote this version, and which key signed |
| `acceptedFrom` | The proposal a record began as, when a person accepted one |
| `ext` | Room for a tool's own fields |

Document records also carry `rev` (the edit count), `editedAt`, `editedBy`, and `prev` (the version this one replaces). A version beats every version it replaces. Versions made apart, neither having seen the other, go to a tie-break.

### Kinds

| Kind | What it is |
|---|---|
| `node` | A unit: title, type, source, provenance links and facts |
| `node-type` | A type in the grammar: label, base, abbreviation, title format, candidate tag, color, template |
| `relation-type` | A relation in the grammar: label, complement, base, and the pairs of types it may join |
| `relation` | An argument between two units. `proposed` marks one waiting for a decision |
| `decision` | An acceptance or rejection of a proposed relation |
| `retraction` | A withdrawal of a relation by its author, with an optional reason |
| `evaluation` | A check or sign-off on one version of a unit: method, term and note |
| `canvas` | A canvas: title, Tidy mode, the paper it holds, the lab it is shared with, what it is the canvas of, what it was forked from |
| `canvas-item` | One card, sticky, link, nested canvas or stroke on a canvas. One record each, so two people editing different items never overwrite each other |
| `release` | A canvas pinned at a moment: each item's revision and each card's unit by content hash |
| `paper` | A paper that was read: title, authors, DOI and other identifiers, file hash, model, schema and server. The file itself is never in a record |
| `anchor` | Ties a unit to its note in one vault |
| `snapshot` | A unit's text, for readers in other workspaces |
| `folder`, `folder-item` | A Library folder, and one unit filed in it |
| `reaction` | One person's reaction to a unit: interesting, agree or disagree |
| `unit-note` | A note on a unit, kept apart from the unit's own text |
| `person` | A person's name, ORCID iD and DID |
| `lab` | A lab: name, DID, PI, and what the PI sets for everyone |
| `membership` | A person's choice to work in a lab |
| `device` | One more key that may sign as a person, vouched for by a device already trusted. Its role is `device` or `agent` |

### A canvas's items

A canvas follows [JSON Canvas](https://jsoncanvas.org/) 1.0: `text`, `file`, `link` and `group` nodes, and edges. A card is a `text` node whose `dg.node` field names its unit, so the file still reads as a plain canvas. A heading that Tidy draws is a `group` marked `guide`. A link's `dg` field names its relation. A nested canvas is a `file` node with `dg.canvas`. A freehand stroke is a `stroke` item, which JSON Canvas does not have. Obsidian's own Canvas keeps the `dg` fields through a save.

## Units of argument

| Unit | Base | Class | Fields of its own |
|---|---|---|---|
| Question | `question` | `dg:Question` | None |
| Claim | `claim` | `dg:Claim` | None |
| Evidence | `evidence` | `dg:Evidence` | `anchor`: the exact words, page and figure in its source, and any comment the reader wrote beside the passage |
| Source | `source` | `dg:Source` | `doi`, `authors`, `published`, `venue`, `openalex`, `identifiers`, `standing` |

Every unit also has:

| Field | Holds |
|---|---|
| `title` | The content alone, with no type prefix, so it reads the same in every base |
| `type` | Its type in the grammar. Absent until someone types it |
| `source` | For a unit read from a paper: the paper, the passage word for word, and the model's wording once a person has reworded it |
| `provenance` | How it was made: `authored`, `aiAssisted`, `aiGenerated` or `imported`, by what agent, and who reviewed it |
| `creators` | For a unit that arrived from elsewhere: who first made it |
| `identifiers` | Identifiers, each a scheme and a value. The schemes are `doi`, `pmid`, `pmcid`, `arxiv`, `openalex`, `orcid`, `ror`, `swhid`, `isbn`, `rrid`, `citekey`, `zotero`, `at`, `cid` and `url` |
| `removed` | Taken back by its author. The record stays, so nothing else loses its history |

## Units of process

In PROV-O's terms a protocol, an experiment and code are **plans**, a run is an **activity**, and an output is an **entity**. A plan and an activity can never be the same thing, which is why a notebook file becomes three units and not one.

### Protocol: how something is done

| Field | Holds |
|---|---|
| `steps` | The method's steps as short names, in order. The full text stays in the protocol's note |
| `parameters` | What it declares: name, type, unit, default |
| `materials` | Reagents, instruments and software it calls for, as RRIDs where they have one |
| `version` | As the lab writes it |
| `sameAs` | The same protocol elsewhere, such as a protocols.io DOI |
| `implementedBy` (link) | Code that carries it out. A wet-lab protocol may have none |

### Experiment (base `study`): what one investigation compares

| Field | Holds |
|---|---|
| `question` (link) | The question it investigates |
| `protocols` (link) | The protocols its design uses |
| `hypothesis` | What the design expects to see, in a sentence |
| `design` | experimental, observational, computational, replication or review |
| `conditions` | The arms or factor levels it compares |
| `variables` | What is varied, measured and held fixed: name, role (independent, dependent or controlled), unit |
| `sampleSize` | The planned sample size |
| `preregistration` | Where the design was registered before it ran |

### Run: what happened on one occasion

| Field | Holds |
|---|---|
| `partOf` (link) | Its experiment |
| `follows` (pin) | The protocol version it followed |
| `instrument` (pins) | The code versions it ran |
| `used` (pins) | Samples, materials and data it took in |
| `status` | planned, running, completed or failed. A failed run can still be evidence |
| `startedAt`, `endedAt` | When |
| `agents` | Who carried it out, as DIDs or ORCID iDs |
| `condition` | Which of its experiment's conditions it carried out |
| `parameterValues` | The values the protocol's parameters took |
| `deviations` | Where it departed from the protocol it pins, a sentence each |
| `environment` | Kernel, language and package versions |
| `seeAlso` | The lab notebook entry, linked and never copied |
| `fingerprint` | So the same execution read twice stays one run |

### Code and Output

| Unit | Field | Holds |
|---|---|---|
| Code | `sourceCid` | A hash of the sources alone, outputs stripped. Its identity |
| | `repo`, `commit`, `path`, `language`, `swhid`, `license` | Where it lives |
| Output | `cid` | A hash of its own bytes. Its identity |
| | `generatedBy` (link) | The run that produced it. Exactly one |
| | `derivedFrom` (pins) | Outputs it was made from |
| | `outputKind` | dataset, file, figure, table, text or image |
| | `mediaType`, `size`, `caption`, `uri` | What it is |
| | `locator` | Where it sat: path, commit, cell, output index, label. Never identity |

## Links

**Provenance links** are fields on a unit. Only its author states them.

| Link | From | To |
|---|---|---|
| `question` | Experiment | Question |
| `protocols` | Experiment | Protocol |
| `implementedBy` | Protocol | Code |
| `partOf` | Run | Experiment |
| `follows` | Run | Protocol, pinned |
| `instrument` | Run | Code, pinned |
| `used` | Run | Anything, pinned |
| `generatedBy` | Output | Run |
| `derivedFrom` | Output | Output, pinned |
| `observationBase` | Evidence | Output, pinned |
| `isGroundedIn` | Evidence | Run |
| `sourceDocument` | Evidence | Source |
| `describesActivity` | Source | Run |

**Arguments** are their own signed records.

| Relation | Complement | From | To |
|---|---|---|---|
| Supports | Supported by | Evidence or Claim | Claim |
| Opposes | Opposed by | Evidence or Claim | Claim |
| Addresses | Addressed by | Claim | Question |
| Informs | Informed by | Evidence | Question |
| Derived from | Has derivation | Evidence | Source |

An argument is in one of four states:

| State | Means |
|---|---|
| Proposed | Asserted by someone else, or suggested by a tool, and waiting for a decision |
| Active | Stated by its author, or accepted |
| Rejected | Turned down by the person it was proposed to |
| Withdrawn | Taken back by its author |

**A pin** is `{uri, cid}`. The `uri` names the target. The `cid` is the version the author used. When the target's current hash differs, that is drift.

## The grammar

A lab's grammar is its set of types and relations.

- **Nine bases:** question, claim, evidence, source, protocol, study, run, code, output. Every type sits on one base. The base, not the label, is what other tools read. A lab can add types on a base and cannot add a base.
- **Nine relation bases:** supports, opposes, addresses, informs, derivedFrom, grounds, follows, describesActivity, requestTarget. A relation type sits on one, has a label and a complement, and lists the pairs of types it may join.
- **A type's title format** has exactly one `{content}`, such as `CLM - {content}`. A Source defaults to `@{content}`. The format is local presentation, so vaults can differ.
- **A type's template** fills `{title}`, `{date}`, `{author}` and `{type}`.
- **Removed** types and relations stay on the units and links that have them, and are no longer offered.
- **In a lab,** the PI's grammar is the lab's. A member's own type of the same name and meaning gives way to the lab's when they join.

A new vault starts with Question (QUE), Claim (CLM), Evidence (EVD), Source (SRC) and the five relations above. Protocol (PRO), Experiment (EXP), Run (RUN), Code (COD) and Output (OUT) are added when first needed. Reading a MIRA extraction adds Request (REQ), a question by base.

## Rules

Forty-eight rules, each with its own name. **Violation** means the data is wrong and a writer should refuse it. **Warning** is a gap for a person to look at. **Info** is worth knowing and often fine.

| Rule | Severity | Says |
|---|---|---|
| `unit-title` | Violation | A unit needs exactly one title. |
| `unit-attributed` | Violation | A unit needs the person or lab it is attributed to. |
| `pin-target` | Violation | A pin names exactly one target. |
| `pin-cid` | Violation | A pin's version is a CIDv1 in base32 (SHA-256). |
| `protocol-implementedBy` | Violation | A protocol is implemented by code. |
| `protocol-versionCid` | Violation | A protocol's version is a CID. |
| `study-question` | Violation | A study investigates at most one question, and it is a Question. |
| `study-protocols` | Violation | A study's protocols are Protocols. |
| `study-design` | Violation | A study's design is experimental, observational, computational, replication or review. |
| `study-sampleSize` | Violation | A planned sample size is a whole number. |
| `study-no-question` | Warning | A study with no question: what is it investigating? |
| `study-no-protocol` | Info | A study that names no protocol. |
| `run-partOf` | Violation | A run is part of at most one study, and it is a Study. |
| `run-follows` | Violation | A run follows at most one protocol version. |
| `run-follows-target` | Violation | What a run follows is a Protocol. |
| `run-instrument-target` | Violation | What a run executes is Code. |
| `run-status` | Violation | A run's status is planned, running, completed or failed. |
| `run-started` | Violation | A run's start is one date and time. |
| `run-ended` | Violation | A run's end is one date and time. |
| `run-time-order` | Violation | A run ended before it started. |
| `run-agents` | Violation | Who carried out a run is a DID or an ORCID iD written as https://orcid.org/… |
| `run-condition` | Violation | A run carries out one condition. |
| `run-no-study` | Warning | A run that belongs to no study. |
| `run-not-plan` | Violation | A run is also typed as a plan or an output. A notebook is Code, its execution is a Run. |
| `run-no-method` | Info | A run with no protocol and no code: nothing says how it was done. |
| `run-code-unpinned` | Warning | A run's code isn't pinned to a version, so drift can't be checked. |
| `run-code-drift` | Warning | The code changed after this run: its sources no longer match the pinned version. |
| `run-protocol-drift` | Warning | The protocol was edited after this run followed it. |
| `run-condition-unknown` | Warning | A run names a condition its study doesn't list. |
| `code-sourceCid` | Violation | Code is identified by one CID over its sources. |
| `output-cid` | Violation | An output is identified by one CID over its own bytes. |
| `output-generatedBy` | Violation | An output is generated by exactly one Run. |
| `output-byteSize` | Violation | An output's size is a whole number of bytes. |
| `output-kind` | Violation | An output's kind is dataset, file, figure, table, text or image. |
| `output-derivedFrom-target` | Violation | An output is derived from other Outputs. |
| `evidence-isGroundedIn` | Violation | Evidence is grounded in at most one Run. |
| `evidence-sourceDocument` | Violation | Evidence has at most one source document, and it is a Source. |
| `evidence-observationBase-target` | Violation | Evidence rests on Outputs. |
| `evidence-informs` | Violation | Evidence informs Questions. |
| `evidence-ungrounded` | Warning | Evidence with nothing behind it: no output, run or source. |
| `evidence-output-unpinned` | Warning | Evidence cites an output without pinning its bytes. |
| `evidence-output-drift` | Warning | An output changed after this evidence cited it: its bytes no longer match the pin. |
| `claim-addresses` | Violation | A claim addresses Questions. |
| `claim-unsupported` | Warning | A claim nothing supports yet. |
| `argument-object` | Violation | Only a Claim can be supported or opposed. |
| `argument-subject` | Violation | Only Evidence or a Claim can support or oppose. |
| `addresses-subject` | Violation | Only a Claim addresses a question. Evidence informs one. |
| `source-describesActivity` | Violation | A source describes Runs. |

### Checks on a claim's support

Four checks are computed from a claim's chains of evidence and are not single-unit rules. They are in `claimSupport` in `packages/core/src/process.ts`.

| Check | True when |
|---|---|
| Single run | All supporting evidence rests on one run |
| Replicated | Two or more runs of the same protocol support it |
| One method | Several pieces of evidence support it, and all used one protocol |
| Failed runs | Any run in its chains has the status failed |

### Sign-off methods

An evaluation records how a unit was checked: `expertJudgment` (read it and agree), `sourceRead` (read the source), `quoteChecked` (checked the quote against the source), `dataReanalyzed` (reanalysed the data) or `replicated` (repeated it). It pins the version of the unit that was checked.

## Checking a graph yourself

```bash
pip install rdflib pyshacl
```

```bash
npm run validate:ontology
```

That runs the wrong-on-purpose cases, then the worked example. To check your own export:

```bash
python3 -I ontology/validate.py path/to/graph.jsonld
```

The validator also reports any key in the export that the context does not define. JSON-LD drops such keys without a word, so a misspelt field would otherwise vanish.

## How it maps to other vocabularies

| Here | PROV-O | MIRA | schema.org |
|---|---|---|---|
| Protocol | Plan | Protocol (typed there as an activity) | HowTo |
| Experiment | Plan | No design-level class | None |
| Run | Activity | Study | CreateAction |
| Code | Plan | None | SoftwareSourceCode |
| Output | Entity | None | MediaObject |
| `generatedBy` | wasGeneratedBy | None | inverse of result |
| `follows` | qualifiedAssociation / hadPlan | follows | None |
| `observationBase` | wasDerivedFrom | observationBase | None |

The one place the names collide: MIRA's **Study** is one activity that produces evidence, which here is a **Run**. A run is published as `science.mira.study`.
