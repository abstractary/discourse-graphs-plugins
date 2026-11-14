# The process ontology

The process layer of a discourse graph, as dg-contract writes it. Draft 0.2, 12 November 2026. For a plain-language account, see the [user guide](../docs/guide/README.md) and the [schema reference](../docs/guide/schema.md).

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
| `validate.py` | Runs the shapes over an export: `python3 -I ontology/validate.py examples/worked-example/graph.jsonld` (needs `rdflib`, `pyshacl`). With `--self-test` it runs the cases below. It also reports keys the context doesn't define, which JSON-LD would drop silently |
| `tests/cases.json` | One deliberately wrong graph for each rule, with the rule it must break. Run by `validate.py --self-test` and by `test/shapes.test.ts` |

## What changed in 0.2

An audit on 12 November 2026 ran the shapes against deliberately wrong graphs. Most rules fired. These didn't, or weren't there:

| Gap found | Fix |
|---|---|
| A run that ended before it started passed | `run-time-order` |
| A pin whose target had changed passed, though the app flags it as drift | `run-code-drift`, `run-protocol-drift` and `evidence-output-drift`, as SPARQL constraints. The export now writes each protocol's current version CID so drift can be checked in RDF |
| A bare ORCID iD became a relative IRI | The export writes `https://orcid.org/…`, and `run-agents` checks it |
| A run could support a claim, and evidence could support a question | `argument-subject`, `argument-object`, `addresses-subject` |
| A node typed as both a run and a plan was caught only by Python code | `run-not-plan`, in SHACL |
| An output derived from a run passed | `output-derivedFrom-target` |
| Results couldn't say which rule they broke | Every rule is a named shape with its own message |
| A misspelt key vanished from the graph without a word | The validator lists keys the context doesn't define |
| Nothing ran the validator | `npm run validate:ontology`, a CI job, and the same rules in `packages/core/src/shapes.ts`, held together by shared test cases |
| Protocol, Study and Run had almost no fields of their own | `steps`, `materials`, `parameters`; `hypothesis`, `design`, `variables`, `sampleSize`, `preregistration`; `condition`, `deviations` |
| CIDs were accepted at 21 characters | The pattern now asks for the full 59 |

Still open:
- **Pins and PROV.** `dgp:follows`, `dgp:instrument` and `dgp:used` point at a pin, not at the thing itself, so a plain PROV reader doesn't see `prov:used`. Either the export should also write the direct PROV triples, or `dgp:Pin` should be declared a `prov:Influence`.
- **Axioms on `dg_core` terms.** This file says `dg:Evidence` is a `prov:Entity`. That belongs in a separate alignment file, so importing the process layer doesn't change the core.
- **`dgp:steps` is an RDF list.** SHACL can't easily check that each member is a string.

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

## Holons

Earlier drafts borrowed patterns from the W3C Holon Graph Community Group's draft. On 12 November 2026 the direction changed: the layers are finite (everyone, lab, person, canvas), a unit is a leaf, and views narrow by scope. Nothing in the ontology depended on the holon vocabulary, so nothing here changed.
