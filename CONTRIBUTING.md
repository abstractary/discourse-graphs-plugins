# Contributing

Thanks for looking. This is a demo for the Discourse Graphs team to inspect, so questions and disagreements are as useful as code.

## Setup

You need Node 26.

```bash
npm install
npm run check-types
npm test
```

[docs/testing.md](docs/testing.md) covers the tests that run inside real Obsidian. Work is tracked as issues under fourteen feature areas: see [docs/features.md](docs/features.md) before starting something new.

## Where things go

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. A few rules do most of the work:

- Panels only talk to core through the Surface API.
- Core only talks to a base through the Host contract, and to a server through Services.
- Only `@dg/sync` touches the network.
- Anything a person sees should look and act the same in both bases, apart from the base's own colors and fonts.

`npm run check-boundaries` enforces the first three.

## Adding something a base has to do

1. Add it to the Host contract in `packages/contract/src/host.ts`.
2. Add a conformance check in `packages/contract/src/conformance.ts`.
3. Build it in both adapters, and run the suite in both real apps.

## Pull requests

Keep them small, and say how you checked the change. If it changes what a person sees, include a screenshot from each base.

Write for researchers: plain words, and no jargon in the interface. [docs/PRODUCT.md](docs/PRODUCT.md) and [docs/DESIGN.md](docs/DESIGN.md) describe the voice and the look.

## Testing against a real vault or graph

Never test in a vault or graph that holds real work. Make a throwaway one.
