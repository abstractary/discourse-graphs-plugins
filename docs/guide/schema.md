# The schema, in full

For a first read, start with the [guide](README.md#the-schema-in-five-minutes). This page is the reference: every type, field, link and rule. It matches version 0.2 of the process ontology in [`ontology/`](../../ontology/README.md), 12 November 2026.

## Where the schema is written down

| Form | File | Used for |
|---|---|---|
| TypeScript types | `packages/contract/src/records.ts` | What the plugins read and write |
| OWL | `ontology/dg_process.ttl` | The classes and properties, built on W3C PROV-O |
| SHACL | `ontology/dg_process.shacl.ttl` | The rules, one named shape each |
| The same rules in the app | `packages/core/src/shapes.ts` | Gaps shown in the Method section and on a run's page |
| JSON-LD context | `ontology/dg_process.context.jsonld` | Reading an export as linked data |
| Mappings | `ontology/mappings.sssom.tsv` | Alignment to PROV-O, MIRA, schema.org, Bioschemas |
| AT Protocol lexicons | `lexicons/` | The published form of each record |

The SHACL file and the in-app check hold the same rules under the same names. A shared set of deliberately wrong graphs (`ontology/tests/cases.json`, one per rule) is run through both, so they can't drift apart.

## Units of argument

| Unit | Class | Fields of its own |
|---|---|---|
| Question | `dg:Question` | — |
| Claim | `dg:Claim` | — |
| Evidence | `dg:Evidence` | `anchor` (the exact words, page and figure in its source) |
| Source | `dg:Source` | `doi`, `openalex` |

Every unit also has a title, an author, a lab if there is one, a time, and `provenance`: how it was made (`authored`, `aiAssisted`, `aiGenerated` or `imported`), by what agent, and who reviewed it.

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

### Experiment (Study): what one investigation compares

| Field | Holds |
|---|---|
| `question` (link) | The question it investigates |
| `protocols` (link) | The protocols its design uses |
| `hypothesis` | What the design expects to see, in a sentence |
| `design` | experimental, observational, computational, replication or review |
| `conditions` | The arms or factor levels it compares |
| `variables` | What is varied, measured and held fixed: name, role, unit |
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
| | `outputKind`, `mediaType`, `size`, `caption` | What it is |
| | `locator` | Where it sat: path, cell, label. Never identity |

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

**Arguments** are their own signed records, with a state: proposed, active, rejected or withdrawn.

| Relation | From | To |
|---|---|---|
| `supports`, `opposes` | Evidence or Claim | Claim |
| `addresses` | Claim | Question |
| `informs` | Evidence | Question |

**A pin** is `{target, cid}`. The `cid` is the version the author used. When the target's current hash differs, that is drift.

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
Four checks on a claim's support are computed from chains and are not single-unit rules: **single run**, **replicated**, **one method** and **failed runs**. They are in `claimSupport` in `packages/core/src/process.ts`.

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

The validator also reports any key in the export that the context doesn't define. JSON-LD drops such keys without a word, so a misspelt field would otherwise vanish.

## How it maps to other vocabularies

| Here | PROV-O | MIRA | schema.org |
|---|---|---|---|
| Protocol | Plan | Protocol (typed there as an activity) | HowTo |
| Experiment | Plan | No design-level class yet | — |
| Run | Activity | Study | CreateAction |
| Code | Plan | — | SoftwareSourceCode |
| Output | Entity | — | MediaObject |
| `generatedBy` | wasGeneratedBy | — | inverse of result |
| `follows` | qualifiedAssociation / hadPlan | follows | — |
| `observationBase` | wasDerivedFrom | observationBase | — |

The one place the names collide: MIRA's **Study** is one activity that produces evidence, which here is a **Run**. A run is published as `science.mira.study`.
