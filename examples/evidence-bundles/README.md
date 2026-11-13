# The MATSUlab evidence bundles, re-issued

`reissue.ts` reads each of the four evidence bundles in [DiscourseGraphs/MATSUlab-issue-exchange-analysis](https://github.com/DiscourseGraphs/MATSUlab-issue-exchange-analysis) (CC BY 4.0) as a folder, the way it would sit in a vault, and exports it again as a research crate. Nothing is added by hand.

```bash
node examples/evidence-bundles/reissue.ts
```

It writes each crate to `out/`, zipped and unpacked, and `out/summary.json`. Only the summary is kept in git.

## What changes

| | The bundle as published | Re-issued |
|---|---|---|
| Where the argument is | `evidence.jsonld`, which the crate lists only as a file | In `ro-crate-metadata.json`, typed in schema.org and in MIRA |
| Files with a size and hash | None | Every one |
| The raw exports that were held back | Named in `evidence.jsonld` | Named in the crate, as inputs the run used, with no bytes |
| The scripts | Links to the `main` branch | Files on the web, with a note that no commit is on record |
| A page a person reads first | The bundle's own README, written by hand | A README made from the metadata, with the figure, the method and what each finding rests on |
| RO-Crate validator, required checks | Pass (1.1) | Pass (1.3) |

## What is lost, and what the bundle itself lacks

- **The first author.** An imported unit is stamped by whoever imported it. Matt Akamatsu's ORCID iD, which the bundle gives for its evidence, is not carried onto the unit.
- **The bundle's own README and methods note.** They are treated as packaging. The protocol's description comes through; the longer methods excerpt does not.
- **A version for the code.** The bundles link scripts at `main`, so no commit can be recorded. The worked example in `examples/worked-example` records the same analysis at a commit.
- **A claim.** Each bundle states what was observed and argues for nothing, so the re-issued crate has evidence and no claim.
