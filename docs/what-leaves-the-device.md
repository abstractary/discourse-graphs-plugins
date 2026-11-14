# What leaves the device

This page is the one account of what the software sends off a person's computer. The guide, the README and [scholarly.md](scholarly.md) each give a short summary and link here.

It was written from the code on 14 November 2026, not from the other documents. Every outside call is made in [`packages/sync/src/`](../packages/sync/src/), one file per service. The core in [`packages/core/src/`](../packages/core/src/) decides when a call is made. Where something could not be confirmed from that code, the page says so under [Not confirmed](#not-confirmed).

With no lab joined, no model set up and no server chosen, nothing in this table happens.

## By destination

| Destination | What is sent | When | Never sent | Can it be turned off |
|---|---|---|---|---|
| **Your lab's server: records** | The lab's record, the person records this device holds, memberships, and device records that let a device in or remove one. For each canvas shared with the lab: the canvas, every version of its cards, the units on those cards, the sources those units were read from, relations drawn there, removals of any of these, the paper record of a PDF canvas, reactions, notes and checks on those units, and the lab's types and relation types. Each request carries the lab token | By itself, about every four seconds, once this device has joined a lab. Each round also asks the server for new records | Units with no card on a shared canvas. Anything an agent key signed. Anchors and decisions, which describe one device. Anything at all from a device that hasn't been let in yet | Only by not being in a lab. There is no switch. A unit stops being sent when its card is taken off, except that its removal is sent |
| **Your lab's server: joining and members** | Your name and your id (a DID). To start a lab: its name and its id. To use an invitation: its code | **Join a lab**, **Start a lab**, asking to join, **Make an invitation**, accepting or declining a request, removing a member. Opening the Lab tab asks the server for members, requests, invitations and the lab's papers | Your signing key. Only public device records travel, with the records above | Not applicable: each is a button |
| **Your lab's server: the paper repository** | The paper's title, file name, DOI, the model, schema and server that read it, the canvas id, who extracted and who uploaded it, and the paper's whole graph. The file itself only when you tick it. The canvas is then shared with the lab | Ticking the share option in **Extract graph**, or sharing a paper later. Sharing later sends no file | The file, unless ticked | Yes: don't share the paper |
| **Your lab's server: breadcrumbs** | Your name and id, against a paper in the lab's repository | Closing the canvas of a lab paper someone else uploaded. The default is to ask first | Nothing when the answer is no | Yes: answer no, or set it to never |
| **Your lab's server: questions** | The question, every unit on the canvas (id, type, title, and its source text and anchor where it has them), and the ids of the units you picked. If you use your own key through the lab, also the provider, the model and **the key** | **Ask AI**, when you use the lab's model, or your own key with questions sent through the lab's server | Units on other canvases | Yes: use a model on this computer, or don't ask. Refused when the lab's reach is "this device" |
| **Your lab's server: announcements it holds** | The paper's DOI, the unit's id and the unit's address, as three reads. No token | When the Context panel shows a unit, if this device has a lab link | The unit's words | Only by not being in a lab |
| **A model provider** (Anthropic at `api.anthropic.com`, Google Gemini at `generativelanguage.googleapis.com`, or the OpenAI-compatible address you set) | The question and the units you picked, or every unit on the canvas when none is picked: id, type, title, source text and anchor. The model's name. Your key, in a header | **Ask AI** with your own key, sent straight from this device. **Test and save** sends one short fixed message. Listing a provider's models sends the key and no text | The key in an address. Units on other canvases. The paper's file | Yes: with no key saved nothing is sent. In a lab, the lab's reach refuses this unless the PI sets reach to "anywhere" or the address is on this computer |
| **An extraction server** (the one you pick in the upload dialog) | The paper's file, its name and type, and the model and schema you chose | **Extract graph**, when no saved extraction is used. Opening the dialog asks each server what it is and which models and schemas it has | Anything else in the vault | Yes: use a saved extraction, or the server on this computer. In a lab, a server outside the lab's reach is refused before the file is sent |
| **The Discourse Graphs service: graph store** (the server marked "managed" in the server list) | The paper's DOI, its graph as this device holds it, and the schema and model names | By itself, straight after an extraction on a server, when the paper has a DOI. A failure is ignored | The file. A paper with no DOI. A paper read from a saved extraction or brought in as a graph | No switch was found. The lab's reach is not checked for this call. See the notes |
| **Registries and the paper's page:** `doi.org`, Crossref or DataCite, OpenAlex, PubMed (`pmc.ncbi.nlm.nih.gov` and `eutils.ncbi.nlm.nih.gov`), and the page the DOI leads to | The paper's identifiers, inside the address asked for. The paper's title goes to Crossref only when the paper has no DOI, PMID or OpenAlex id | **Look it up** | Your name, id, a key or an email address. The code sets no such header. Unit text | Yes: don't press it |
| **Zenodo** (`zenodo.org` or `sandbox.zenodo.org`) | The crate's title, description, creators with ORCID iDs and affiliations, date, license, keywords and related identifiers. Then the crate archive. Your Zenodo token with both | **Also start a draft on Zenodo**, in the export dialog | A request to publish. The code has none | Yes: leave the box unticked. Export alone sends nothing |
| **A repository's inbox** (the one the paper's page names) | One notification: your name and id, your lab server's address and its inbox, the unit's id, how it relates to the paper, and the paper's page and DOI | **Send**, after **Announce this unit to the paper's repository** has shown the notification | The unit's words | Yes: don't press Send |
| **Your AT Protocol account's server** (the one your handle names, such as `bsky.social`) | To connect: your handle, to the handle's own domain and, if that says nothing, to `bsky.social`; your account's id to `plc.directory`; then the handle and the app password, once, to your account's server. To publish: each unit and link you wrote on the canvas, as a public record with its id, type, title and its links to other public units | **Connect**, then **Publish** and a second press, in the Publish dialog. **Take back** sends a deletion | The app password is not kept; a session token is, in the base's secret store. Units someone else wrote, canvases, positions, PDFs, notes and anything not on the canvas | Yes: nothing is sent until you connect an account and press Publish. **Disconnect** forgets the session |
| **Zotero on this computer** (`localhost:23119`) | Your search words and the ids of the items asked for | Searching or bringing in from Zotero, or listing its PDFs | Anything to zotero.org. Nothing is written to Zotero: the code only reads | Yes: it is a setting, and Zotero must be open and allow it |

## What sends nothing

- **Your identity.** The DID is computed on the device from your key. It is never registered anywhere.
- **Reading a PDF or a notebook,** capturing, linking, tidying and searching.
- **Exporting or importing a crate.** The archive is saved in the base. Only the Zenodo box sends it.
- **Extract graph with a saved extraction.**
- **Asking with no model connected.** The closest units are quoted on the device.
- **The usage log.** It holds each action's name, whether it worked, an error code, how long it took and when. Nothing in `packages/sync/src/` sends it.

## Notes

**Reach.** A lab's PI sets how far the lab's work may travel: this device, the lab, or anywhere. In a lab the default is the lab. It is checked in two places.

- *Reading a paper.* A server on this computer is always allowed. The lab's own server and the servers the lab lists are allowed unless reach is "this device". Any other server needs "anywhere".
- *Asking a model.* Your own key sent straight to a hosted provider needs "anywhere". A model on this computer is always allowed. The lab's server is allowed unless reach is "this device".

**Two things reach does not cover.**

- With your own key sent through the lab's server, the device sends the question, the units and the key to the lab's server. A comment in the code says the server then calls the provider. The reach check lets this through when reach is "the lab".
- The graph store call after an extraction is not checked against reach at all.

**Model keys.** A key is kept in the base's secret store: Obsidian's keychain where there is one, and with the plugin's device-only values on Obsidian before 1.11.4. It is read only when a call is made. A panel sees only its last four characters. It goes to the provider in a header, or to your lab's server in the request body if you chose that route.

**The server list.** Both default servers, "This computer" and "Discourse Graphs service", are addresses on this computer (`localhost:8787` and `localhost:8788`). A comment says a real install would point the second at the project's own service.

**How requests are made in Obsidian.** Calls to a lab server use the app window's own request. Registries, landing pages, Zotero and Zenodo use Obsidian's request. A model call tries the window first and Obsidian's request if that fails.

**What a destination always learns.** Any request shows the receiver this computer's network address. The registries see which paper was asked about.

## Not confirmed

These were not established from the code that was read.

- **What a server does next.** This page covers what leaves the device. What a lab server, an extraction server or the hosted MIRA app then stores or passes on is their code. One thing was read: the reference server's graph store refuses a request that carries a file.
- **Headers the app adds.** The code sets no identifying header on a lookup. Whether Obsidian's request or the browser adds its own, such as a user agent, was not checked.
- **That every button is the only trigger.** The core sends when it is called. The panels were not traced call by call, apart from the list of announcements, which asks when it is shown.
- **Leaving a lab by choice, and unsharing a canvas.** No call for either was found in `core/labs.ts`. A removed member's device drops its link when the server says so, and then sends nothing more.
- **Removing the "Discourse Graphs service" from the server list.** The call exists. Whether the interface offers it for that entry was not checked. With no such server the graph store call does nothing.
- **The MCP server.** It runs from `local/` and was not read for this page. What an agent does with what it reads is outside this software.
- **Roam.** The Roam plugin wires the same services with the page's own request. It was not read further.
