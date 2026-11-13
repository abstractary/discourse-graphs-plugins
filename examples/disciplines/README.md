# One chain, three fields

`build.ts` records one real study each from biology, computer science and sociology as the same chain of units: question, study, protocol, run, code, output, evidence, claim. Each becomes a canvas and an evidence crate.

```bash
node examples/disciplines/build.ts
```

Each folder gets `records.json` (the units), `zenodo.json` (what Zenodo's form would be sent) and, rebuilt on each run and not kept in git, the crate zipped and unpacked. `harness/evidence-test.mjs` puts all three in the sandbox vault.

Every fact comes from the paper's abstract, text, figure captions or code repository, checked on 13 November 2026. Each is one reader's reading, not the authors' own record.

| | Computer science | Biology | Sociology |
|---|---|---|---|
| Paper | Gauthier et al. 2021, *Nature Communications*, [10.1038/s41467-021-25801-2](https://doi.org/10.1038/s41467-021-25801-2) | Akamatsu et al. 2020, *eLife*, [10.7554/eLife.49840](https://doi.org/10.7554/eLife.49840) | Salganik, Dodds and Watts 2006, *Science*, [10.1126/science.1121066](https://doi.org/10.1126/science.1121066) |
| What a run is | A script at a tagged version, with its parameters | Two runs under two protocols: a simulation and a count in live cells | An experiment with people, in two conditions |
| What a rerun needs | The code and nothing else | A cell line and calibration standards, recorded as materials | Participants. It can't be rerun from files |
| Code on record | One file, pinned by a hash of its bytes at tag v1.0 | The repository at its last commit, no file named | None |
| What evidence rests on | A figure and the run that makes it | A figure per method | A passage in the paper, and nothing else |
| What the study says first | The benchmark tasks | The quantity measured | The conditions and the 14,341 participants |

## What the three show together

- **The chain holds in all three.** Nothing had to be bent to fit a field.
- **The fields differ in where the chain stops.** In computer science it reaches bytes. In biology it reaches a figure and a list of materials. In sociology it stops at the paper.
- **A gap shows as a gap.** The sociology run has no outputs and its evidence rests on a passage alone. The crate's README says so, and doesn't imply data that isn't there.
- **Two methods, one claim.** The biology example has a simulation and a measurement that reach the same number by different routes. Each is its own run, and both support one claim.

## Limits

- The sociology paper is not open access, so only its abstract was read. Its figures and data are not described.
- No output here has its bytes in the crate. The figures are cited at the publisher's address, and the data was not deposited as files.
- The biology run's parameters are the one stated in the figure caption. The paper's full parameter tables were not transcribed.
