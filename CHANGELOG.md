# Changelog

## Unreleased (13 November 2026)

- A **Cards** list on the canvas switches what every card shows: source and how it was read, authors, workspace, date and time made, identifiers. The Context panel heads with the same rows
- **Look it up** asks Crossref or DataCite, OpenAlex, PubMed and the paper's own page for a paper's identifiers, venue and retractions
- **Research crates:** export a canvas as an RO-Crate 1.3 archive or an `.eln` file, and import crates from here or from other tools
- The server gives each stored graph a FAIR Signposting landing page, and has a COAR Notify inbox. A unit can be announced to a paper's repository, after the person reads what will be sent
- **Profiles:** a person's history for themselves, their lab work for their lab, and counts alone for anyone. Initials show a card on hover and open the profile on click
- **From Zotero:** bring a reference in as a source, with the highlights chosen as units that quote their passages
- Notes on a canvas say who wrote them and when
- Removed the leftover unit-holon code and wording
- `npm run dsm` prints the dependency matrix and fails on a cycle

## 0.1.0 (demo)

The first version shared with the Discourse Graphs team.

- One core, canvas and set of panels running inside Roam and Obsidian
- Upload a paper, choosing the compute server, model and schema
- A canvas for each paper, and export to a workspace, lab canvas or folder
- Labs: join by identifier, shared canvases, a paper repository, reactions, notes and breadcrumbs
- AI mode for asking about a canvas, grounded in the units you pick
- Tidy with nine arrangements, link badges, capture and a guided walkthrough
- A reference server for compute, graph storage, labs and sync
