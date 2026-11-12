# Worked example: a lab result and a paper, end to end

Two real chains recorded in the process ontology. `build.ts` reads the real files and hashes them:

```
node examples/worked-example/build.ts
```

`MATSULAB_REPO` points at a checkout of the MATSUlab repository.

## 1. The MATSUlab issue-exchange analysis

**Source:** [DiscourseGraphs/MATSUlab-issue-exchange-analysis](https://github.com/DiscourseGraphs/MATSUlab-issue-exchange-analysis) at commit `08493f6`, CC BY 4.0. The analysis and evidence bundles are by Matt Akamatsu with Claude (Anthropic), reviewed by Joel Chan.

**The chain:**
- One **Question**, paraphrased from the repository README.
- Two **Studies**, the lab's `@analysis` pages: issue claiming, and researcher onboarding.
- Four **Protocols**, one for each evidence bundle.
- Four **Runs**. Each follows its protocol, pinned by CID, and runs the bundle's scripts as **Code**, each pinned by the hash of its file.
- **Outputs:** every figure and data file in the bundles, each identified by the hash of its own bytes.
- **Evidence:** the four published MIRA evidence records (`test/fixtures/matsulab-records`). Each rests on its outputs and its run.
- **Claims:** the bundles' four observation statements.

**The notebook.** `notebooks/evd1_evd7_analysis.ipynb` is imported the way a lab member would import it:
- It becomes one Code unit, one Run and 9 Outputs.
- Its EVD 7 figure has the same bytes, and so the same CID, as the bundle's `fig7_student_timelines.png`. One figure is produced by two runs. This is the case content hashes exist for.

## 2. A paper

**Source:** Lu et al. 2016, *Dysregulation of innate and adaptive serum mediators precedes systemic lupus erythematosus classification…*, J Autoimmun 74:182–193, DOI 10.1016/j.jaut.2016.06.001. The record comes from the MIRA extraction already in `demo/papers`.

**How the extraction maps:**
- The paper's "Study" becomes a **Run** that the **Source** reports (`describesActivity`).
- Its `grounds` and `follows` links become provenance fields.
- Its supports, addresses and asks-about links stay argument records.

`npm run seed:example` writes it into `examples/worked-example/vault`, which the local app (`local/README.md`) and Obsidian can both open.

## What it shows

**Claims.**
- Every one of the 12 claims rests on a single run (`summary.json`).
- None has replicated support, drift or stale outputs.

**Shapes.**
- `ontology/validate.py` finds no violations.
- It gives one warning: the paper's reported run belongs to no designed study.

**Placeholders.**
- **Author DIDs:** `did:web:records.example`, `did:web:reader.example`.
- **Lab DID:** `did:web:lab.records.example`.
- **Lab key:** `example-key-not-real`.

Attribution to real people is by name and ORCID iD.

| File | |
|---|---|
| `records.json` | 250 dg-contract records: 77 units, 26 relations, 3 canvases (97 items), 29 snapshots. Each canvas names its holon. The EVD 7 canvas sits inside the question's canvas |
| `graph.jsonld` | The PROV-O JSON-LD view (`toProcessJsonLd`) |
| `summary.json` | Support flags for each claim, and the shared-bytes check |
