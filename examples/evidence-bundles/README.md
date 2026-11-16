# The MATSUlab evidence bundles, re-issued

`reissue.ts` reads each of the four evidence bundles in [DiscourseGraphs/MATSUlab-issue-exchange-analysis](https://github.com/DiscourseGraphs/MATSUlab-issue-exchange-analysis) (CC BY 4.0) as a folder, the way it would sit in a vault, and exports it again as a research crate and as an `.eln` file. Nothing is added by hand. It shows what importing someone else's crate keeps, and what the export adds.

```bash
MATSULAB_REPO=/path/to/MATSUlab-issue-exchange-analysis node examples/evidence-bundles/reissue.ts
```

`MATSULAB_REPO` points at a checkout of that repository. Without it the script looks in `../org-repos/MATSUlab-issue-exchange-analysis`. It needs no network.

It writes to `out/`:

| File | What it is | In git |
|---|---|---|
| `<bundle>.crate.zip` | The crate | No |
| `<bundle>.eln` | The same in the ELN file format | No |
| `<bundle folder>/` | The crate, unpacked | No |
| `summary.json` | For each bundle: units read, files hashed, and entities, hashed files, packed outputs, evidence, studies, protocols and code in the result, beside the same counts for the original | Yes |

[docs/scholarly.md](../../docs/scholarly.md#reading-a-crate) describes how a crate is read and written.

## The bundle as published, and re-issued

| | As published | Re-issued |
|---|---|---|
| Where the argument is | `evidence.jsonld`, which the crate lists only as a file | In `ro-crate-metadata.json`, typed in schema.org and in MIRA |
| Files with a size and hash | None | Every one |
| The raw exports that were held back | Named in `evidence.jsonld` | Named in the crate, as inputs the run used, with no bytes |
| The scripts | Links to the `main` branch | Files on the web, with a note that no commit is on record |
| Who made the evidence | An ORCID iD on the evidence | The same person as `creator`, and whoever imported it as `contributor` |
| A page a person reads first | The bundle's own README, written by hand | A README made from the metadata, with the figure, the method and what each finding rests on |
| RO-Crate version | 1.1 | 1.3 |

## What does not come through

- **The bundle's own README and methods note.** They are treated as packaging. The protocol's description comes through. The longer methods excerpt does not.
- **A version for the code.** The bundles link scripts at `main`, so no commit can be recorded. [`examples/worked-example`](../worked-example/README.md) records the same analysis at a commit.
- **A claim.** Each bundle states what was observed and argues for nothing, so the re-issued crate has evidence and no claim.
