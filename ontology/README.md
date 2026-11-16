# The process ontology

The process layer of a discourse graph: protocols, studies, runs, code and outputs, as OWL, SHACL and a JSON-LD context. Version 0.2, a draft. For a plain-language account, see the [user guide](../docs/guide/README.md) and the [schema reference](../docs/guide/schema.md).

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
| `validate.py` | Runs the shapes over an export (needs `rdflib`, `pyshacl`). With no path it checks `examples/worked-example/graph.jsonld`. With `--self-test` it runs the cases. It also reports keys the context doesn't define |
| `tests/cases.json` | One deliberately wrong graph for each rule, with the rule it must break. Run by `validate.py --self-test` and by `test/shapes.test.ts` |

## The rules

Every rule is a named shape with its own message, so a result says which rule it broke. `tests/cases.json` holds 52 wrong graphs across 36 rules. A violation means the data is wrong. A warning marks a gap.

| Rule | Catches |
|---|---|
| `run-time-order` | A run that ended before it started |
| `run-code-drift`, `run-protocol-drift`, `evidence-output-drift` | A pin whose target has changed since it was pinned. These are SPARQL constraints. The export writes each protocol's current version CID so drift can be checked in RDF |
| `run-agents` | An agent that isn't a full IRI. The export writes a bare ORCID iD as `https://orcid.org/…` |
| `argument-subject`, `argument-object`, `addresses-subject` | A relation between the wrong kinds, such as a run supporting a claim or evidence supporting a question |
| `run-not-plan` | A node typed as both a run and a plan |
| `output-derivedFrom-target` | An output derived from something that isn't an output |
| `run-no-study` (warning) | A run in no study |

Those are examples. The full list is the `dgs:` shapes in `dg_process.shacl.ttl`. Other warnings mark ungrounded evidence, an unsupported claim and an unpinned code version.

A CID must be the full 59 characters. The validator also lists keys the JSON-LD context doesn't define, which JSON-LD would otherwise drop without a word.

### Rules in two places, tested as one

The app can't run a SHACL engine cheaply, so each rule has a twin in `packages/core/src/shapes.ts` with the same name, severity and message. `tests/cases.json` holds them together: `validate.py --self-test` runs every case through pyshacl, and `test/shapes.test.ts` runs the same cases through the app's check and fails if a name, severity or message differs.

```bash
pip install rdflib pyshacl
```

```bash
npm run validate:ontology
```

That runs the self-test and then validates `examples/worked-example/graph.jsonld`. CI runs it on Python 3.12. To check another export:

```bash
python3 -I ontology/validate.py path/to/graph.jsonld
```

## Fields

| Class | Fields of its own |
|---|---|
| Protocol | `steps`, `materials`, `parameters` |
| Study | `hypothesis`, `design`, `variables`, `sampleSize`, `preregistration` |
| Run | `condition`, `deviations`, the parameter values it took, its agents and its environment |

A protocol declares. A study chooses. A run records. A deviation is a fact about the run and never an edit to the protocol.

## How it is modelled

**Study means the design.**
- DG's Study is the design, in ISA's sense.
- MIRA's `Study` is one activity that produces evidence, which is DG's **Run**.
- A Run therefore maps to `science.mira.study`. Study, Code and Output map to `org.discoursegraphs.*`.

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

## Limits

- **Pins and PROV.** `dgp:follows`, `dgp:instrument` and `dgp:used` point at a pin, not at the thing itself, so a plain PROV reader doesn't see `prov:used`.
- **Axioms on `dg_core` terms.** This file says `dg:Evidence` is a `prov:Entity`, so importing the process layer adds to the core.
- **`dgp:steps` is an RDF list.** SHACL doesn't check that each member is a string.
- **MIRA.** Study, Code and Output have no MIRA classes, so they publish under `org.discoursegraphs.*`.
