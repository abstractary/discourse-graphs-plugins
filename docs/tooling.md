# Tooling for what cuts across the code

Research done on 13 November 2026 into open-source projects that would make the shared concerns of this codebase sturdier: contracts, interfaces, validation, testing and project upkeep. Nothing here has been adopted. It is a list to decide from.

## Where we stand

These are hand-made today: the check that a record is well formed, the types for the two hundred or so calls between the core and its panels (types only, nothing checked as it runs), the server's API (described in Markdown, with a client and a server kept in step by hand), signing, canonical JSON, the module-boundary script, the dependency matrix, the conformance suite, the real-app harness, the changelog. There is no CI.

## What to adopt first

Ordered by what each gives for the work it takes.

| # | What | Replaces | Cost |
|---|---|---|---|
| 1 | **A CI workflow** on GitHub Actions: install, types, tests, boundary script, with CodeQL, secret scanning and OSSF Scorecard, which are free for public repos | Running checks by hand | Setup only. Real-Obsidian tests need a headless display |
| 2 | **[Knip](https://knip.dev)** for unused files and exports, and **Obsidian's own ESLint plugin**, which its review of community plugins is built on | Finding dead code by eye, and finding review failures after submitting | Some false alarms until configured. ESLint for the Obsidian package only |
| 3 | **[fast-check](https://fast-check.dev)** for generated test cases that shrink to the smallest failure: record validation, canonical JSON, the fold, and the simulation's walk as model-based commands | Hand-picked cases and our own seeded walk | One dev dependency and a learning curve |
| 4 | **[API Extractor](https://api-extractor.com)** to keep a committed report of everything `contract` exports | Reviewing interface changes by eye | Fiddly with several entry points |
| 5 | **[Zod 4](https://zod.dev)** as the one place a record or a call is defined, giving the TypeScript type, the check at run time and JSON Schema. That JSON Schema then feeds an OpenAPI file for the server and the tool descriptions an MCP server needs. Start with the record kinds, then the calls between core and panels | `validateRecord`, unchecked panel calls, hand-synced API docs | The first runtime dependency in `contract`, and porting about twenty kinds and two hundred calls |

No single tool gives all of TypeScript types, runtime checks, JSON Schema, AT Protocol lexicons, OpenAPI and MCP schemas. The chain above gets all but lexicons. For those, keep the lexicon files by hand and test that sample records pass both.

## Patterns to borrow, with no dependency

- **Reading older records forward**, as [tldraw](https://tldraw.dev/docs/persistence) does: a numbered step per record kind, applied on reading. Signed records can't be rewritten, so the step runs when a record is read and never changes the log.
- **The AT Protocol's rules for changing a schema:** only add optional fields, and take a new name for anything that breaks.
- **The official test cases for canonical JSON** (RFC 8785), run against our own implementation.
- **A chain of delegation**, as in UCAN, which is what device keys now are.
- **Numbered proposals in the repository** with a status line, as the MCP project does, for decisions that outlast a conversation.
- **A plain result type** for errors a person can act on, and a size check on each bundle from the build's own report.

## What not to adopt

| What | Why not |
|---|---|
| Turborepo, Nx, moon | The repository is too small to need a task runner |
| Effect | It is a whole way of writing the program, not a library |
| tRPC, ts-rest | A poor fit for calls over a message port to a sandboxed panel. oRPC fits, and would mean moving two hundred calls |
| UCAN libraries, Keyhive | The specification is still a release candidate, and Keyhive is research code |
| OpenTelemetry, error-reporting services, feature-flag services | Each needs a server, and reporting errors anywhere is a privacy decision first |
| TypeSpec | A second language for one maintainer |
| Spec-driven kits for coding agents | Thin evidence that they help, and some that they cost |

## Decisions for the product owner

1. Whether `contract` may take a runtime dependency. Today it has almost none, on purpose.
2. Whether the lexicon files or the TypeScript definitions are the master copy for records that map to the AT Protocol.
3. Whether to move the calls between core and panels to oRPC, or keep our own dispatcher and attach a schema to each call.
4. Whether errors are ever reported anywhere off the device.
5. Whether a device key should be a passkey, held by the operating system.
6. Whether `contract` is published as a package, which brings version promises with it.
7. Whether to publish the model as LinkML or SHACL for the research-data community.
