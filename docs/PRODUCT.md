# Product

Who the plugin is for, what it is for, and the principles its interface keeps. [DESIGN.md](DESIGN.md) turns these into rules for each surface.

## Who it is for

Researchers who already think in a notes tool such as Obsidian. They are reading and writing, and a panel sits beside their notes. They work alone or in a lab.

Three people show up most:

- **A lab member** who reads papers, runs experiments and writes notes, and wants a claim to carry its evidence with it.
- **A PI** who wants to see what a lab's claims rest on, what has been checked, and what is still open.
- **A reader** with a library of papers, who wants to argue across them.

## What it is for

A discourse graph of questions, claims and evidence, kept in a person's own notes, with the record of how each result was made.

- **One set of panels, opened inside each base,** so people in different bases share a mental model of units, relations and canvases.
- **Local first.** The graph lives in the vault. Sync, models, registries and repositories are used only when a person asks.
- **The canvas is tuned for building an argument:** 10 to 30 cards, with every title readable at normal zoom. A paper's extraction arrives as a canvas people can read straight away.
- **Labs share canvases and papers.** Everything shared stays a choice: what goes to the lab, whether the file goes with it, and whether anyone sees that you read it.
- **People decide.** Anything from a model, an agent or a teammate arrives as a proposal or a reading aid. It enters the graph when a person accepts it.

## Personality

The panels take each base's look: its fonts, colors and corners, including the person's theme. The product stays recognizable through layout, interaction and unit type colors, not through a brand skin.

There is one style: calm and dense. Controls stay out of the way, and color carries meaning only.

## Voice

Plain words for researchers. Short sentences. No jargon in the interface, and one word per thing, from [information-architecture.md](information-architecture.md). A message says what happened and what a person can do next. A disabled control says why.

## What it is not

- A web app embedded in a notes tool, with its own brand fighting the base.
- A whiteboard toy, where decoration competes with the argument.
- A dashboard, with metrics and cards for their own sake.
- A lab notebook. It links to the record of an experiment and never replaces it.

## Principles

- **The same structure and the same gestures in every base.** Only the skin changes.
- **Fit the frame people use.** 630 to 900 px beside a sidebar is the common canvas frame, and 300 to 680 px is the side panel.
- **Research titles are long.** Text wraps and stays readable. Nothing truncates a claim on a card.
- **Color means something:** unit type, relation kind or state. It is never the only signal.
- **Nothing irreversible without a way back.** Every canvas edit has Undo, removed notes go to the trash, and records are never deleted.
- **Nothing leaves without a click.** With no lab, no model and no server chosen, nothing is sent anywhere.
- **A gap shows as a gap.** Missing support, drift and unchecked work are shown, and never block.
- **Link by id, pin what you cite, never copy.** A lab notebook entry, a paper and a dataset stay where they are and are pointed at.
- **Credit is always shown.** Every unit, link and sticky says who made it.
