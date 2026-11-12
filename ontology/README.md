# The process ontology

The process layer of a discourse graph, as dg-contract writes it. Draft, 11 November 2026.

It extends the base schema in [DiscourseGraphs/schemas](https://github.com/DiscourseGraphs/schemas) (`dg_base`, `dg_core`) and leaves it unchanged.

**Logic.** Protocol and Study:
- A **Protocol** is a reusable method.
- A **Study** is one designed investigation. Its default label is "Experiment".

**Execution.** A **Run** is one execution of a study's design.

**Code.** **Code** is a notebook, script or workflow at a version.

**Observation.** An **Output** is one data item a run produced. Evidence rests on outputs, so a claim's support traces back to the runs, protocols and code behind it.

| File | What it holds |
|---|---|
| `dg_process.ttl` | OWL classes and properties, on PROV-O: Protocol, Study and Code are `prov:Plan`; Run is `prov:Activity`; Output is `prov:Entity` |
| `dg_process.shacl.ttl` | SHACL shapes. Violations mean the data is wrong. Warnings mark gaps such as ungrounded evidence, an unsupported claim, a run in no study, or an unpinned code version |
| `dg_process.context.jsonld` | The JSON-LD context for `toProcessJsonLd` in `packages/core/src/jsonld.ts` |
| `mappings.sssom.tsv` | SSSOM mappings to PROV-O, MIRA, schema.org (RO-Crate, Workflow Run RO-Crate 0.6), Bioschemas and OBI/IAO |
| `validate.py` | Runs the shapes over an export: `python3 -I ontology/validate.py examples/worked-example/graph.jsonld` (needs `rdflib`, `pyshacl`) |

## Choices

**Study means the design.**
- DG's Study is the design, in ISA's sense.
- MIRA's `Study` is one activity that produces evidence, which is DG's **Run**.
- A Run therefore publishes to `science.mira.study`. Study, Code and Output publish under `org.discoursegraphs.*` until MIRA has classes for them.

**Protocol is a plan.**
- MIRA types Protocol as an Activity.
- Under PROV-O, the plan a run follows can't be an activity.
- DG treats Protocol as a `prov:Plan`. `dgp:follows` is shorthand for `prov:qualifiedAssociation`/`prov:hadPlan`.

**Two kinds of link.**
- **Arguments** (supports, opposes, addresses, informs) stay signed relation records in the log, because other people dispute them.
- **Provenance links** are fields on the unit, because only the unit's author states them.

**Hashes are identity.**
- An Output is identified by a CIDv1 (raw, SHA-256) over its own bytes.
- Code is identified by a CID over its sources alone.
- Cell IDs, output indexes, labels and SWHIDs are locators only.

**Pins.**
- `dgp:Pin` carries `target` and `cid`.
- A run pins the protocol and code versions it used, so later edits show as drift.

**OBI and IAO.** Their IRIs are annotations, never keys.

## What this borrows from the W3C Holon Graph work

The Holon Graph Community Group's architecture is a draft with a single editor. Its files disagree on several terms. Its namespace isn't settled.

**Borrowed patterns:**
- A view only projects the graph and never writes back.
- Containment doesn't have to be exclusive.
- Shapes act as a holon's boundary.

**Not adopted:** its vocabulary.
