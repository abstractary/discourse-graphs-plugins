# LLM infrastructure, the MCP server and the integrations around them

12 November 2026. Sections 1 and 6.1 describe what is built and tested. Everything else is a design to argue with before code exists. Facts about outside systems were checked on 12 November 2026 against their own documentation; the links are at the end.

## Summary

- **Built:** a person can use their own model key from the Ask AI bar. Three wire formats cover Anthropic, any OpenAI-compatible address (OpenAI, OpenRouter, Ollama, LM Studio) and Gemini. The call goes from the device, or through the lab's server, as the person chooses.
- **Built:** a saved Jupyter notebook is read into Code, a Run and Outputs. A run has a page, and an output can be cited as evidence pinned to its bytes.
- **Proposed:** one tool surface, used by the in-app assistant and by outside agents through an MCP server. The server reads the record log and writes proposals to it. It never accepts its own proposals.
- **Proposed:** the MCP server runs beside the base, not inside it. The record log is the seam, so the Obsidian plugin opens no port.
- **Proposed:** adapters are written to each product group's shared standard, and they join on open identifiers. Zotero comes first.
- **Needs you:** eight decisions, listed in section 8.

## 1. What is built: a person's own model key

### 1.1 The path of a question

1. **Ask AI** opens a bar over the canvas. Its first line says whose model will answer.
2. With no model, the line reads "No model · quoting units" and offers **Use my own key**. A question still works: it finds the closest units and quotes them word for word.
3. **Use my own key** opens a form in the bar: provider, address (for the OpenAI-compatible provider), key, model and, in a lab, the route.
4. **Test and save** stores the settings, sends one short test message, and reports what the provider said.
5. A question then streams its answer into the bar. Each unit the answer cites is a numbered button that brings the card into view.

The same settings are in Obsidian's Settings → Discourse Graphs → Ask AI.

### 1.2 Where the pieces live

| Piece | File | What it does |
|---|---|---|
| Shapes, prompt, citations, no-model search | `packages/contract/src/llm.ts` | No network. `Llm` and `SecretStore` are interfaces the core is handed |
| Provider calls | `packages/sync/src/providers.ts` | Three streaming adapters and three model lists. Takes a `fetch`, so tests pass a fake one |
| The feature | `packages/core/src/ai.ts` | Decides which of the three answers a question: own key, lab, or quoted units |
| The form | `packages/surfaces/src/shared/AiSetup.tsx` | Used by the bar. A settings surface can reuse it |
| The bar | `packages/surfaces/src/canvas/AiBar.tsx` | Status line, setup, answer, Stop, Escape and a close button |
| Lab route | `server/src/ai.ts` | Accepts a member's `provider` for one question |

### 1.3 Where the key is kept

| Base | Store | Notes |
|---|---|---|
| Obsidian 1.11.4 or later | `app.secretStorage`, shown under Settings → Keychain | Encrypted by the operating system since 1.11.5. Shared across plugins by design. Whether it syncs between devices is not documented, so the guide says it stays on the device |
| Obsidian before 1.11.4 | The plugin's device-only values | Unencrypted. The form says so in plain words |
| Local app | `~/.discourse-graphs/local-app/secrets.json`, mode 600 | Outside the vault. The call is made in Node, so the page never holds the key |
| Roam | The browser's storage for the extension | Unencrypted, never in the graph. The form says so |

Rules the code keeps, each with a test:
- The key is sent to the core once and never sent back. A panel sees only whether a key exists and its last four characters.
- The key is never in a URL, a record, the vault's own settings store or an event.
- A key belongs to one provider. Changing provider doesn't carry it along.
- An error from a provider is rewritten into a sentence and never includes the key.

### 1.4 Routes

| Route | Who makes the call | When to choose it |
|---|---|---|
| Device (default) | The plugin, straight to the provider | Always available. Nothing passes through Discourse Graphs |
| Lab server | The lab's server, with the key sent for that one question | A lab that wants one place where model calls leave from. The server keeps nothing and uses the provider's own address, so a member can't point it at another host |

A model server on the same computer needs no key, and the form says that nothing leaves the device.

### 1.5 Provider facts the code relies on

| Provider | Call | Notes |
|---|---|---|
| Anthropic | `POST /v1/messages`, `x-api-key`, `anthropic-version: 2026-10-21` | A call from a browser or Electron window needs `anthropic-dangerous-direct-browser-access: true`. I checked the preflight from `app://obsidian.md`. Sampling settings are an error on this version, so none are sent. Refusals arrive as `stop_reason: "refusal"` |
| OpenAI-compatible | `POST {address}/chat/completions`, bearer key if there is one | The widest shape: OpenAI, OpenRouter, Ollama and LM Studio all speak it. OpenRouter sends comment lines and can report an error inside a stream that began with HTTP 200 |
| Gemini | `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`, `x-goog-api-key` | A safety block arrives as `promptFeedback.blockReason` or a `finishReason` |

Two choices worth knowing:
- **Model names are read from the provider**, not hard-coded, because they change. The Anthropic default is `claude-opus-5-5`. The other two have no default and take the first model the key can use.
- **Refusal fallback:** for the Claude models that support it, the request asks Anthropic to rerun a declined question on another of its models in the same call (`fallbacks: "default"`, a beta). It is sent only to the models documented to accept it. If you would rather a refusal simply stop, this is one line to remove.

### 1.6 Not done yet

- **A real key has not been used.** Every provider call was tested against fakes and a stand-in local server. The first real run needs your key in your Obsidian, typed by you.
- **Obsidian's policy needs a README line.** Plugins must disclose network use. The README now says which services are called and why.
- **Ollama from Obsidian** should work without configuration, because Ollama allows `app://` origins by default. I read that in its source and did not run it.

## 2. The LLM layer, beyond one question

### 2.1 Principles

1. **The graph is the product and the model is a reader.** A model's output is a proposal with its provenance. It becomes part of the graph when a person accepts it.
2. **One tool surface.** The assistant inside the app and an agent outside it use the same read and propose tools (section 3.5). Then there is one thing to secure, test and document.
3. **Answers cite units.** Any sentence a model writes about the graph carries the ids it rests on, and the interface drops ids the graph doesn't hold.
4. **Unit text is data.** It is passed as structured JSON, never spliced into instructions. The system prompt says so. This lowers the risk from text in a paper that tries to instruct the model. It doesn't remove it.
5. **Nothing is silently cut.** If a canvas is too large to send, the person is told and offered a narrower question, not a truncated one.
6. **The person chooses where text goes,** and the interface states it in a sentence before the first call.

### 2.2 Jobs, and what each sends

| Job | Release | Sends | Returns | Checked by |
|---|---|---|---|---|
| Ask about a canvas | Built | The canvas's units, or the picked ones | Prose with unit ids | Citation filter |
| Extract with review (feature 7) | 1 | A paper's text or PDF | Candidate units and relations with quote anchors | Each quote is found again in the source text before a person sees it |
| Read a chain (analysis direction) | 2 | A claim's method chain and its flags | What the support rests on, in plain words | Flags come from graph math, not the model |
| Find what's missing | 2 | Shape problems for a scope | A ranked list with reasons | Problems come from the shapes |
| Meaning search | Planned (`semantic-search-plan.md`) | Unit text to an embedding model | Vectors, kept on the device | — |

### 2.3 What to build next in this layer

- **Tool use in place of a unit dump.** Today the whole canvas is serialised into the prompt. Past a few hundred units that is slow and costly. Give the model the read tools and let it fetch what it needs.
- **Prompt caching.** A canvas's units are a stable prefix across questions. Anthropic's cache makes repeat questions cheaper and faster.
- **Token counting before a call,** so the bar can say "this canvas is too large for this model" before spending anything.
- **Provenance on everything a model makes.** `facts.provenance` already has `method` (`aiGenerated` or `aiAssisted`), `agent` and `reviewedBy`. The agent string should be `provider/model, prompt version`, so a later reader can weigh it.
- **A scored benchmark.** Feature 12's open dataset, with a scorer, lets any extractor be measured against reviewed claim–evidence pairs. It is also the fair way to choose a default model.

## 3. The MCP server

### 3.1 Purpose

Let an agent a person already uses (Claude, ChatGPT, Claude Code, Cursor and others) read their discourse graph and propose additions to it. On the market map this is the largest reach gain measured: 91 of 236 products within two hops, in all eight groups.

It is not a way to edit the graph. An agent proposes and a person decides.

### 3.2 Where it runs

| Option | For | Against |
|---|---|---|
| **A. Beside the base, over the record log (recommended)** | The Obsidian plugin opens no port. Works with Obsidian closed. One server for every base. The local app already does exactly this: it folds the vault's record log and writes its own device log | A second process to install |
| B. Inside the Obsidian plugin | Nothing extra to install | A listening port in a notes app. Desktop only. Roam can't do it at all. Obsidian's directory may object |
| C. A hosted server | Reaches web clients | Research text on a server before review, against the private-until-published default |

With A, the plugin and the server never talk to each other. The server writes proposal records to `discourse-graph/records/<its-device>.jsonl`. The plugin already watches that folder, so proposals appear in the review queue with no new channel.

Two transports from one program:
- **stdio** for desktop clients. It is the safest local transport: no port, and no browser can reach it.
- **Streamable HTTP on 127.0.0.1** for clients that need a URL. It validates `Origin`, checks a token, and serves protected-resource metadata. These are requirements of the current specification, not extras.

Packaging: an npm package with `mcpName` set, and an `.mcpb` bundle for one-click install in desktop clients. The vault path is a `user_config` field.

### 3.3 The specification it targets

The current revision is **2026-07-28**, a stateless redesign. It changes what a new server should assume:
- There is no `initialize` handshake and no session id. Every request carries its protocol version and the client's capabilities.
- A server implements `server/discover`, which also carries its `instructions`.
- Sampling, roots and logging are deprecated. So the server never asks the client's model to do work for it. Anything that needs a model uses the person's own key (section 1).
- Elicitation is a result, not a server request: a tool returns `input_required`, and the client calls again with the answer.
- Long work uses the tasks extension.
- List and read results carry a cache lifetime and scope.

The TypeScript SDK for this revision is `@modelcontextprotocol/server` 2.x. The older `@modelcontextprotocol/sdk` 1.x is in maintenance.

### 3.4 Identity and attribution

- **An agent has its own identity, tied to a person.** The server holds a signing key of its own, as the local app does. Its records are signed by that key and name the person it acts for.
- **Provenance says what made it:** `method: "aiGenerated"`, with `agent` naming the client and, when the client reports it, the model.
- **The fold already treats an untrusted author's relation as proposed.** In the Context panel it shows as "Proposed" with Accept and Reject. Units arrive staged, as extracted units do. So no new review path is needed.
- **Open:** how an agent's key relates to the person's `did:plc`. A delegation record signed by the person is the clean form, and it needs the custody design that is still open in `CONTRACT.md`.

### 3.5 Tools

Names use the allowed characters and a `dg.` prefix. Every read tool is annotated read-only and closed-world. Every tool has an output schema, and returns the same content as text for older clients.

**Read**

| Tool | Returns |
|---|---|
| `dg.search_units` | Units matching words, by type, scope and credit. The same ranking as the search panel |
| `dg.get_unit` | A unit: its text, type, credit, identifiers, relations with their state, method chain and gaps |
| `dg.evidence_for` | For a claim: each supporting and opposing chain, and the replication and drift flags |
| `dg.contested_claims` | Claims with both support and opposition, or with pending relations |
| `dg.gaps` | Broken rules for a scope, by rule name and severity, from the process shapes |
| `dg.list_canvases` | Canvases by scope (everyone, lab, mine) and kind (from a PDF, workspace) |
| `dg.get_canvas` | A canvas's cards and links, compact |
| `dg.sources_for` | The papers and passages behind a unit |
| `dg.get_run` | A run as the run page shows it |
| `dg.resolve_identifier` | The units that carry a DOI, ORCID iD, RRID, SWHID, CID or a locator such as a Zotero key |
| `dg.schema` | Node types, relation types, the process classes and the rule list |

**Propose**

| Tool | Writes | Server-side check |
|---|---|---|
| `dg.propose_unit` | A staged unit of a given type | The type exists. A near-duplicate title is returned for the agent to reuse |
| `dg.propose_relation` | A pending relation | The pair fits the grammar and the argument rules |
| `dg.propose_evidence_from_passage` | Staged evidence with a quote anchor and a source | The exact words are found in the source's text, or the call fails |
| `dg.propose_run` | A staged Run with its code and outputs, by CID | Each CID is well formed. Bytes are never accepted in a call |
| `dg.propose_canvas` | A staged canvas arranging existing units | Every unit exists and is in scope |

Proposal tools take an idempotency key, so a retried call doesn't write twice. They are annotated as not destructive.

**Left out on purpose:** accept, reject, delete, edit, raw file reads, anything that executes code, and anything that returns a key.

### 3.6 Resources and prompts

- **Resources:** `dg://unit/{id}`, `dg://canvas/{id}`, `dg://schema/ontology` (the Turtle file) and `dg://schema/shapes`. Tools return resource links, so a client can show or attach a unit without another call.
- **Prompts:** "Read this paper", "Find what's missing on this canvas" and "Check this claim's support". These are the skills in `agent-skills-and-hooks.md`, in the form MCP clients show to people.
- **Elicitation, form mode only:** choosing the target canvas, or confirming that a proposal goes to the lab's scope and not only the person's. Never a secret.

### 3.7 Scope and safety

| Risk | Control |
|---|---|
| An agent reads more than it should | A scope is set when the server starts: the person's own units, or those plus the lab's. Other labs' unpublished units are never served |
| Text in a paper instructs the agent | Unit text is returned as structured data and labelled as quoted material. The server's instructions tell the client to treat it as data. This lowers the risk; the client's own defences still matter |
| An agent fills the graph | Proposals are rate limited, and shown grouped by agent with one "reject all from this session" |
| A fabricated quote | Rejected at the tool, because the words must be found in the source |
| A web page calls the local server | stdio by default. For HTTP: loopback only, `Origin` checked, a token required |
| Someone else's token is replayed | The server accepts only tokens issued for it and never passes a token on |
| Nobody can tell what an agent did | Every call is written to the on-device usage log with the tool name and ids, never content |

### 3.8 What must be investigated before building

1. **The record log as a multi-writer seam.** The local app proves one extra writer. Confirm the plugin picks up a third device log while open, and time it on a large vault.
2. **Unknown kinds.** `records.ts` rejects record kinds it doesn't know. If proposals need a new kind, older plugins would drop them. Either reuse existing kinds only (the plan above does) or make unknown kinds opaque first.
3. **Text access.** Note text and PDF passages are read by the base, not stored in records. A server beside the base must read Markdown and PDF text itself. Decide whether it reads the vault's files directly or only serves what records hold.
4. **Scope by default.** Own units only, or own plus lab. This is a privacy decision (section 8).
5. **Agent identity and delegation,** as in 3.4.
6. **Client behaviour.** Which of the ten named clients implement the 2026-07-28 revision, output schemas, resource links and elicitation today. Test the top three before fixing the tool shapes.
7. **Tool count and naming.** Sixteen tools is within what clients handle well, but test whether models pick the right one, and merge where they don't.
8. **Result size.** Decide page sizes and what "compact" means for a canvas of 300 cards.
9. **Duplicate detection** for proposed units: title similarity now, meaning search later.
10. **Quote matching** across PDF text extraction differences: hyphenation, ligatures and line breaks. The reader's own matcher (`pdf/quote.ts`) is the place to start.
11. **The review queue at volume.** Fifty proposals from one session need grouping, bulk decisions and a diff. Design it before the tools ship.
12. **Registry listing.** Entries can be hidden but their metadata is never removed. Listing is outward-facing and needs your go-ahead.
13. **Obsidian directory rules** on companion processes, if the plugin is ever listed there.
14. **A conformance suite** for the server, in the manner of the host contract's: fixtures any implementation can run.

## 4. Integrations, by product group

The market map groups 238 products into eight. It calls the integrations that matter "rails" and ranks them by how many products each brings within two hops. The word "keystone" appears only in the product graph's own centrality analysis, where the MCP server ranks seventh of the product's parts and Zotero import thirty-second. Both are used below: rails say what to connect to, and keystones say which parts of DG the connection leans on.

| Group (products) | Its job | Shared standard to target | Rail and reach | Identifiers to join on | What DG does |
|---|---|---|---|---|---|
| AI workspaces (59) | Agents read and propose | MCP | Claude, ChatGPT; +44 products | — | The server in section 3 |
| Literature search (45) | Resolve works and citations | DOI, OpenAlex, Crossref, PubMed | +40 | DOI, OpenAlex id, PMID, arXiv id | Resolve a Source's metadata, authors and retraction status. `resolve_identifier` lets an agent join |
| Notebooks and AI science (26) | Code, runs, outputs | nbformat 4.5, Workflow Run RO-Crate | Jupyter, GitHub; +20 | CID, SWHID, commit | Section 6 |
| Publishing and review (26) | Announce, request and receive reviews | COAR Notify, DataCite, FAIR Signposting | Zenodo, ORCID; +16 | DOI, ORCID, ROR | Release 2: announce a published claim to a preprint's venue |
| Lab notebooks (24) | Experiment records | `.eln` archives (RO-Crate) | eLabFTW, RSpace, protocols.io; +8 | Record id as a locator, protocols.io DOI | A Run's `seeAlso` links the entry. A Protocol's `sameAs` holds the protocols.io DOI |
| Reference managers (22) | Items, attachments, annotations | CSL-JSON with DOI, citekeys | Zotero, named by 39 products; +34 alone | DOI. Zotero key and citekey as locators | Section 5 |
| Obsidian plugins (20) | Notes in a vault | Markdown with frontmatter | Exists | — | The host |
| Local-first notes (16) | Notes and blocks | Markdown files | Logseq: +2, later | — | The host contract |

### 4.1 Identifiers

The rule from the adapter plan: join on open identifiers, and treat a product's own ids as locators.

| Identifier | Identifies | On which unit | Identity or locator | In the code today |
|---|---|---|---|---|
| DOI | A work, dataset or protocol | Source, Protocol `sameAs`, Evidence anchor | Identity | Yes: `facts.doi`, `sameAs`, `anchor.source` |
| OpenAlex id | A work | Source | Identity | Yes: `facts.openalex` |
| PMID, PMCID, arXiv id | A work | Source | Identity | No |
| ORCID iD | A person | Person, a Run's `agents` | Identity | Yes. The export now writes it as `https://orcid.org/…`; a bare iD was a silent error |
| ROR | A lab or institution | Lab | Identity | No |
| RRID | A reagent, organism or tool | Protocol `materials`, a Run's `used` | Identity | Fields exist. No resolver |
| SWHID | Archived code | Code | Identity | Field only |
| CID | Bytes | Output, Code sources, every pin | Identity | Yes, throughout |
| AT URI and DID | A published unit and its author | Every unit | Identity | Computed on the device, never registered |
| Zotero item key | An item in one library | Source, Evidence | Locator | No |
| Better BibTeX citekey | An item, by a person's naming | Source | Locator | No |
| Lab notebook record id | An entry | Run `seeAlso` | Locator | Yes |
| Web Annotation text quote | A passage | Evidence `anchor` | Locator within a source | Yes, in the reader |

To add: one `facts.identifiers` map for the identifiers with no field yet (PMID, arXiv, ROR, Zotero key, citekey), each marked identity or locator. That is one schema change in place of five.

## 5. Zotero

### 5.1 What it is for

A lab member's papers and highlights are already in Zotero. One action should turn a Zotero annotation into Evidence, with its Source, without retyping.

### 5.2 Facts that shape the design

- **Zotero 10 has a local API** at `http://localhost:23119/api/`, switched on in Settings → Advanced. Reads need no key.
- **Zotero 10 drops browser-like requests.** Any request with an `Origin` header or a browser user agent is silently ignored unless it sends `Zotero-Allowed-Request`. A call from Obsidian's window would hang. So the call goes through Obsidian's `requestUrl` or a Node process, with that header.
- **Annotations are child items of an attachment.** They carry the text, a comment, a colour, a page label and a position.
- **Better BibTeX** adds citekeys and its own JSON-RPC. Zotero's schema now has a native citation key field too.
- **The web API** needs a key and works where Zotero isn't running. It syncs by library version.
- **A community MCP server for Zotero is widely used.** DG should not duplicate it.

### 5.3 Design

| Zotero | Discourse Graphs | Identity |
|---|---|---|
| Item with a DOI | Source | The DOI. The item key is kept as a locator |
| Item with no DOI | Source, marked local | The item key, until a DOI is found |
| PDF attachment | The Source's file, by its CID | The bytes |
| Highlight annotation | Evidence candidate, with `anchor` holding the exact words and page | — |
| Annotation comment | A note on the candidate, never its title | — |
| Tag | Nothing by default. An optional mapping to node type, as existing Zotero plugins do with colours | — |

- **Pull-only.** A person opens "From Zotero" and picks an item or a collection. Nothing arrives by itself, in keeping with the rule against push.
- **Candidates, not units.** They land staged, like extracted units, and become units on export or placement.
- **Re-import is idempotent.** An annotation's key and version make a fingerprint, as a notebook run has one.
- **A link back:** `zotero://select/library/items/KEY` on the Source, and `zotero://open-pdf/…?annotation=KEY` on evidence. These forms come from Zotero's forums, not its documentation, so they need a check in a real Zotero.
- **Agents:** DG's `resolve_identifier` plus the existing Zotero MCP server lets an agent join the two by DOI with no DG-specific Zotero tool.

### 5.4 To investigate

- Whether Zotero's own highlight positions can open the same passage in DG's reader, or only the quoted text can.
- Group libraries: the local API's group support is limited.
- Whether to read through Better BibTeX when it is installed, for citekeys.
- The colour-to-type mapping people expect from the Zotero Integration plugin, which has 600,000 downloads to DG's 13,000.

## 6. Jupyter

### 6.1 What is built

- **Reading a notebook.** "Read this notebook into the graph" on an `.ipynb` file, or **Runs and notebooks**, makes:
  - **Code**, identified by a hash of the cell sources alone;
  - **a Run**, the saved execution, with its times, kernel and language version;
  - **an Output** for each saved figure and table, identified by a hash of its own bytes.
- **Reading it again.** The same execution writes nothing. A rerun adds a new Run. Changed code makes a new version of the same Code unit, and the older run then shows as pinned to a version that has moved on.
- **The run page.** Why (the experiment and its question), how (the protocol, its steps, deviations and parameters), what ran (code, environment and the notebook's cells), what came out (each output, with its figure) and what it is used to argue.
- **Figures are shown only while their bytes match.** The page reads the notebook on the device, hashes each saved output, and shows it as this run's output only if the hash is the recorded one. Otherwise it says the notebook has changed.
- **Evidence from an output.** "Make evidence from this" makes Evidence that rests on the output, pinned to its bytes, and offers it to the open canvas.
- **The same notebook from two places is one piece of code.** A notebook read from a repository and from a copy in the vault match on their sources.

### 6.2 Principles for going further

1. **The notebook stays in Jupyter.** DG records what ran and what it made. It never executes code and never edits a notebook.
2. **Capture at save, not at keystroke.** A run is a saved execution. Watching a live kernel would record half-finished work as results.
3. **Identity is bytes.** Cell ids, output positions and labels are locators. They help a person find the cell, and they can all change.
4. **A rerun is a new fact,** not an edit to the old one. Two runs that make the same bytes are a replication, and the graph should say so.
5. **A scientist decides what an output shows.** Import makes outputs. Only a person, or an agent's proposal a person accepts, makes evidence.
6. **Nothing is copied that can be linked.** Records hold hashes and locators, never figure bytes.

### 6.3 The live server connection (specified, not built)

**What it adds:** notebooks that aren't in the vault, and seeing a rerun without importing by hand.

- **Connect:** a base URL and a token, kept in the same secret store as a model key. The token is sent as an `Authorization` header.
- **List and read:** `GET /api/contents/{path}` lists folders and returns a notebook's JSON. That JSON goes through the same importer as a file.
- **Know when something was saved:** subscribe to the server's event stream for contents-service save events, and mark the notebook "saved since last read". Reading stays the person's action.
- **Locators:** the server's URL and path go in the Code's `seeAlso`. The Code's identity stays its source hash.
- **Not used:** the kernel channels. DG doesn't execute, and it doesn't watch execution.
- **Real-time collaboration:** where the collaboration extension is on, the saved file is still what DG reads. The shared document is not a run.

**To investigate:** how Electron's window handles the server's cross-origin and XSRF rules (the call may need `requestUrl`); JupyterHub's per-user URLs and tokens; and what the events stream sends for a save on current versions.

### 6.4 The JupyterLab extension (specified, not built)

**What it adds:** citing a result at the moment it is seen, without leaving the notebook.

A right-side panel, "Discourse Graphs", with three parts:

1. **This notebook in the graph.** Whether its code is known, how many runs are recorded, and whether the open notebook matches the last one read ("2 cells changed since the run of 3 November").
2. **The active cell's outputs.** For each figure or table: whether it is already an Output, which evidence cites it, and whether that evidence still matches these bytes. One button: **Send to graph**.
3. **Claims this notebook bears on.** The claims its outputs are evidence for, with their flags. This is the part that changes behaviour: a scientist sees "single run" beside the figure they are about to rerun.

How it talks:
- It reads the active cell's outputs through JupyterLab's notebook tracker and hashes them in the page, with the same rule as the importer.
- It talks to DG's local server on 127.0.0.1 (the same program as the MCP server's HTTP side), with a token. It writes proposals only.
- With no local server running, the panel says so and offers to export a bundle.

**Send to graph** asks one question: what does this show? The answer is the evidence's title. The run, code and output are recorded behind it. That one sentence is the scientist's contribution, and it can't be automated honestly.

### 6.5 Parameters, protocols and other formats

- **papermill:** a cell tagged `parameters` and the injected values map to a Protocol's declared `parameters` and a Run's `parameterValues`. The importer reads papermill's timings today and not yet its parameters.
- **A notebook as a protocol's implementation:** a Protocol's `implementedBy` points at Code. Then a run of that notebook follows that protocol by default.
- **Other encodings of the same job:** Jupytext pairs, marimo's `.py` files and Quarto's `.qmd`. Each needs a reader that yields the same three things (sources, a saved execution, outputs). marimo and Quarto don't store outputs in the source file, so their runs come from an executed export.
- **Workflow Run RO-Crate** is the exchange format for a run. Export first: it is how a run reaches Zenodo and other tools.

### 6.6 Open questions on the experience

- Should reading a notebook offer to tie the run to an experiment and a protocol at that moment, or leave it to the Method section afterwards? Today it is afterwards.
- Should a rerun that changes a cited figure tell the evidence's author? The page shows it. A notice would be a push, which the analysis direction rules out.
- How should a notebook with dozens of figures be handled: all as outputs (today), or only labelled cells?

## 7. How this was checked

| Check | Result |
|---|---|
| Unit tests, including 12 for the model path and 4 for runs and notebooks | 271 pass |
| Server tests, including a member's own key through the lab route | 84 pass |
| Real Obsidian: the key form, a local model answering with citations, Escape, runs, the run page with figures, settings | 23 of 23 in `harness/guide-test.mjs` |
| A real provider with a real key | Not run |

## 8. Decisions that are yours

1. **Refusal fallback on Claude models:** keep it (default) or let a refusal stop.
2. **MCP scope by default:** own units only, or own plus the lab's.
3. **Where the MCP server runs:** beside the base over the record log (recommended), or inside the plugin.
4. **MCP in release 1:** the adapter plan proposed pulling read-and-propose forward. Not yet decided.
5. **Registry listing,** when there is something to list. It can't be fully withdrawn.
6. **Zotero first, or the open indexes first.** Reach is close (+34 for Zotero alone, +40 for the indexes). Zotero is where the first users' papers already are.
7. **Jupyter next step:** the live server, the JupyterLab panel, or RO-Crate export.
8. **One `facts.identifiers` map** for the identifiers that have no field yet.

## Sources

- MCP specification 2026-07-28 and its changelog, authorization, tools, elicitation, deprecations, tasks extension, registry and security pages: `modelcontextprotocol.io`.
- Zotero local API, Zotero 10 for developers, and Web API v3: `zotero.org/support/dev`. Better BibTeX JSON-RPC: `retorque.re/zotero-better-bibtex`.
- Jupyter Server API and events, nbformat, JupyterLab extension points, papermill and nbclient: their own documentation and repositories.
- OpenAI, Gemini, OpenRouter and Ollama API references. Cross-origin behaviour was probed with preflight requests from `app://obsidian.md`.
- Obsidian's secret storage guide, changelogs for 1.11.4 and 1.11.5, and developer policies: `docs.obsidian.md`.
- Market reach numbers: `discourse-graphs-market-map/docs/portability-and-cluster-adapters.md`.
