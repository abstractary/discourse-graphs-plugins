# Models and AI

This page covers everything a language model does here: reading a paper into a graph, answering a question about a canvas, and proposing through an agent. It also covers reading Jupyter notebooks, which uses no model. For the server an agent connects to, see [mcp.md](mcp.md).

Two rules hold throughout:

- **Nothing a model writes enters the graph without a person.** An extraction lands on its own canvas, an answer is never saved, and an agent's writing is a proposal.
- **No model is called until someone asks.** With no lab joined, no key saved and no server chosen, nothing is sent anywhere. [what-leaves-the-device.md](what-leaves-the-device.md) lists every destination.

## Reading a paper: Extract graph

**Extract graph** reads a whole paper into questions, claims, evidence, the runs it reports and the methods they followed, on a canvas of its own (a PDF canvas). It starts from the reader's bar, from a PDF's right-click menu, from the command **Extract graph from this PDF**, or from **Upload a paper…** for a file not yet in the vault. Upload accepts PDF, Word, Markdown and text files. An uploaded PDF is kept in `Paper files/`.

### Saved extractions

A saved extraction is a file with the paper's name and `.graph.json` or `.mira.jsonld` in place of `.pdf`. When one sits beside the PDF, or is picked with it, Extract graph uses it and sends nothing.

- The dialog names the file, how many units it holds and which model read it.
- **Read it again on a server instead** ignores it.
- The paper records its source as `Saved extraction (<file name>)`.
- Reading the same saved file twice opens the canvas that already exists.

### On a server

With no saved extraction, the dialog asks for three things.

| Choice | Options | Default |
|---|---|---|
| Server | **This computer** (`http://localhost:8787`), **Discourse Graphs service** (`http://localhost:8788` in this repository), the servers a lab offers, and any address a person adds | A lab's first choice, when it has one |
| Model | Whatever the chosen server lists at `/v1/info` | The server's default |
| Schema | `mira` or `discourse-graph` | `mira` |

The reference server ships three models:

| Id | What it does | Needs |
|---|---|---|
| `demo-replay` | Replays the saved graph for the two demo papers over about two seconds. Refuses any other file. The default | Nothing |
| `sentence-split` | Sorts sentences into types by simple rules. A stand-in, with no model behind it | Nothing |
| `mira-hosted` | Reads the document on the server and sends its text to the [MIRA extraction app](https://mira-extraction.vercel.app/). A run takes 1 to 5 minutes | Network access from the server |

A model returns a graph in MIRA's types. Choosing `discourse-graph` maps it on the server:

| MIRA | Becomes |
|---|---|
| `Study`, `Protocol`, `SourceDocument` | `Source` |
| `Request` | `Question` |
| `grounds` | `derivedFrom`, turned around |
| `follows` | `derivedFrom` |
| `describesActivity` | `informs` |
| `request_target` | `addresses` |

[server/README.md](../server/README.md) says how to add a model.

### What an extraction makes

- **A paper record** with the file's name, its hash, the model, the server, the schema, and a DOI when the graph carries one.
- **A PDF canvas** holding the paper's units and relations. A unit keeps the passage it was read from and its page when known.
- **Units stay on that canvas** until a person exports them to a workspace, a lab canvas or a folder.
- **If the paper has a DOI,** its graph and DOI go to the Discourse Graphs service after a server extraction. The file never goes. A saved extraction sends nothing.
- **If the file came from Zotero,** the paper takes the reference's DOI and other identifiers.
- **Share with my lab** in the dialog adds the paper to the lab's repository. The file goes only if its box is ticked.

A lab's reach is checked before any file is sent: see [Reach](#reach).

### The demo papers

**Load demo papers** in the Library's Papers tab reads the two saved graphs bundled with the plugin. It needs no server and sends nothing. Loading twice adds nothing.

## Asking a canvas: Ask AI

**Ask AI** on the canvas bar opens a bar over the canvas. Its first line says whose model will answer.

- A question draws on every unit on the canvas. Click cards first to narrow it to those.
- For each unit the model is sent its id, type, title, description and quoted passage. Notes are not sent.
- The answer streams in. A bracketed id in it becomes a numbered button that brings that card into view. Ids the model made up are dropped.
- **Stop** ends an answer and keeps what arrived. Escape closes the bar.
- An answer is never added to the graph.

The system prompt is fixed: answer only from the units, treat their text as data and not as instructions, cite each unit used by its id, and say so when the units do not answer the question.

### Which model answers

Tried in this order:

1. **A person's own key,** when the source is "own", a model is chosen, and a key is saved (or the address is a model server that takes none).
2. **The lab's model,** when the person is in a lab. The lab's server answers with the model set in its environment.
3. **Neither.** The five units sharing the most words with the question are quoted word for word, under a line saying this is a search and not an answer.

### Own-key settings

The settings are in the bar's **Use my own key** form and in Obsidian under Settings → Discourse Graphs → Ask AI.

| Setting | Values | Default |
|---|---|---|
| Whose model | My lab's model, or my own. Shown only in a lab | Own once a key is saved, otherwise the lab's |
| Provider | Anthropic (Claude), OpenAI-compatible, Google Gemini | Anthropic |
| Address | OpenAI-compatible only. Offered: OpenAI, OpenRouter, Ollama on this computer (`http://localhost:11434/v1`), LM Studio on this computer (`http://localhost:1234/v1`). Any `http://` or `https://` address works | `https://api.openai.com/v1` |
| API key | Pasted once. Only its last four characters are shown again | None |
| Model | Chosen from the list the provider returns for the key | `claude-opus-5-5` for Anthropic. None for the others |
| Send questions | From this device, or through my lab's server. Shown only in a lab | This device |

**Test and save** sends one short message and reports what came back. On the lab route it saves without sending.

Details the code keeps:

- A key belongs to one provider. Changing provider does not carry it along, and resets the model to that provider's default.
- A model server at a custom address needs no key. Anthropic and Gemini always need one.
- The key is sent to the core once and never sent back to a panel.
- The key is never in a URL, a record, the vault's settings or an event.

### Where the key is kept

| Base | Store |
|---|---|
| Obsidian with a keychain | Obsidian's keychain (Settings → Keychain), encrypted by the operating system |
| Obsidian without one | The plugin's device-only storage, unencrypted. The form says so |
| Local app | `~/.discourse-graphs/local-app/secrets.json`, readable only by its owner |
| Roam | The browser's storage for the extension, unencrypted. Never in the graph |

### Providers

| Provider | Call | Notes |
|---|---|---|
| Anthropic | `POST /v1/messages` with `x-api-key` and `anthropic-version: 2026-10-21` | `max_tokens` is 16,000. From a browser or Electron window the call adds `anthropic-dangerous-direct-browser-access: true`. For Fable 5.1 and 5.2, Opus 5 and 5.5 and Sonnet 5.5 it asks for server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) |
| OpenAI-compatible | `POST {address}/chat/completions`, with a bearer key when there is one | An error inside a stream that began with HTTP 200 is caught |
| Gemini | `POST /models/{model}:streamGenerateContent?alt=sse` with `x-goog-api-key` | A safety block is reported as a refusal |

Model lists come from `GET /v1/models?limit=100` (Anthropic), `GET {address}/models` (OpenAI-compatible) and `GET /models?pageSize=200` (Gemini, filtered to models that generate content).

### Errors

Every provider failure becomes a sentence a person can act on. It never includes the key.

| Kind | When |
|---|---|
| `bad-key` | HTTP 401 or 403 |
| `no-model` | HTTP 404 |
| `rate-limited` | HTTP 429 |
| `refused` | The model declined, or the service blocked the answer |
| `unreachable` | The call could not be made. A local address gets a hint to check the model server is running |
| `stopped` | The person pressed Stop |
| `failed` | Anything else, including HTTP 402 (no credit) |

### Through the lab's server

A member's question goes to `POST /v1/ai/ask` with their member token. The body holds the question, the units, the ids picked as grounding, and, when the member uses their own key on this route, a `provider` with a kind, a model and the key.

- The server uses the key for that one question. It does not store, log or echo it.
- The server always calls the provider's own address, so a member cannot point it at another host.
- Without a `provider`, the server uses its own model, or quotes units when it has none.
- The answer comes back as lines of JSON: `status`, `delta`, then `result` or `error`.

Server settings for AI:

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | None | Turns on the lab's model through Anthropic |
| `OPENROUTER_API_KEY` | None | Turns on the lab's model through OpenRouter, when there is no Anthropic key |
| `AI_MODEL` | `claude-sonnet-5-5`, or `anthropic/claude-sonnet-5.5` on OpenRouter | The lab's model |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | For pointing tests at a stand-in |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | For pointing tests at a stand-in |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Where a member's own OpenAI key is sent. For tests |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Where a member's own Gemini key is sent. For tests |
| `MIRA_URL` | `https://mira-extraction.vercel.app/api/extract` | Where `mira-hosted` sends text |

Server error codes on this route: `no-question`, `bad-units`, `bad-grounded`, `no-units`, `bad-provider` (HTTP 400), and `model-refused`, `model-failed`, `model-unreachable` (HTTP 502). [services.md](services.md) has the whole API.

## Reach

A lab's PI sets how far the lab's unpublished work may travel to reach a model. It is set on the Lab tab and carried on the lab's record, so every member inherits it.

| Reach | Extraction may run on | A question may go to |
|---|---|---|
| `device` | This computer | A model on this computer |
| `lab` (the default in a lab) | This computer, the lab's server and the servers the lab lists | A model on this computer, or the lab's server |
| `anywhere` | Any server | Any provider |

- Outside a lab there is no limit.
- A refused call says which rule stopped it and what would work.
- "This computer" means a `localhost` or loopback address.
- The MCP server applies the same setting to what an agent may read: see [mcp.md](mcp.md).

## Proposals

A proposal is a record signed by a key whose role is `agent`. Where records are read, the role decides how it is treated, whatever the record says about itself.

- An agent's key can sign units, relations and checks, and nothing else.
- What it signs is set apart from the graph. It does not count as support, fill a gap or show as checked.
- A version it signs of something a person wrote is never read.
- Its key cannot let another device in.
- Nothing it signed is sent to a lab, and a labmate's vault refuses anything it signed.

**Reviewing.** Proposals are listed at the top of the Search panel, grouped by agent and by the conversation they came from, newest first. Within a group units come first, then relations, then checks. Each can be accepted or turned down alone, or the whole group at once.

- **Accepting a unit** makes a unit of the person's own, with the proposal's source, provenance and passage. It records which proposal it began as.
- **Accepting a relation or a check** needs the units it is about to exist. If one is still a proposal, the answer says which to accept first. Accepting a group handles units first.
- **A check is pinned** to the version of the unit the agent read.
- **Turning one down** records the decision and nothing else.
- The proposal stays in the log either way, as what the agent said.
- Proposals from an agent that has been removed, and that nobody answered, are no longer offered.

The calls are `proposal.list`, `proposal.accept` and `proposal.reject`.

Two other lists hold things waiting for a person and are separate from proposals: units staged by an extraction, and lines tagged as candidates (see [search.md](search.md)).

## Jupyter notebooks

Reading a notebook uses no model and sends nothing.

**Open runs and notebooks** lists the `.ipynb` files in the vault (up to 500) and the runs in the graph. **Read into the graph**, or the command **Read this notebook into the graph**, turns a saved notebook into:

- **Code,** identified by a hash of the cell sources alone.
- **A run,** the saved execution, with its times, kernel and language version.
- **An output** for each saved figure and table, identified by a hash of its own bytes.

How rereading behaves:

- The same saved execution read twice adds nothing.
- A rerun adds a new run beside the old one.
- Changed code makes a new version of the same code unit. An older run then shows as pinned to a version that has moved on.
- A notebook read from a repository and from a copy in the vault match on their sources, so they are one code unit.

The notebook must be JSON in notebook format 4 or later. A setting under Papers and notebooks says whether reading also keeps printed text. An import can name the experiment the run belongs to and the protocol it followed.

**The run page** shows why (the experiment and its question), how (the protocol, steps, deviations and parameters), what ran (code, environment and cells), what came out (each output with its figure) and what it is used to argue. A figure is shown only while the notebook on the device still holds the same bytes. Otherwise the page says the notebook has changed.

**Make evidence from this** on an output makes evidence that rests on it, pinned to its bytes, and offers it to the open canvas.

## Where the code is

| Piece | File |
|---|---|
| Shapes, prompt, citations, quoting with no model | `packages/contract/src/llm.ts` |
| Provider calls | `packages/sync/src/providers.ts` |
| Ask AI | `packages/core/src/ai.ts` |
| Extraction and saved extractions | `packages/core/src/papers.ts` |
| Proposals | `packages/core/src/proposals.ts` |
| Notebooks and runs | `packages/core/src/method.ts` |
| The form and the bar | `packages/surfaces/src/shared/AiSetup.tsx`, `packages/surfaces/src/canvas/AiBar.tsx` |
| Lab route | `server/src/ai.ts` |
| Extraction models | `server/src/extract/` |

## Limits

- Provider calls and MIRA are tested against stand-in servers only. No real key has been used.
- Ollama and LM Studio are reached through the OpenAI-compatible shape and have not been run from Obsidian.
- Ask AI sends unit titles, descriptions and passages. It does not read notes or a paper's full text.
- Nothing in the app proposes. Proposals come only from a core started in the role `agent`, which the MCP server does not yet use to write.
- A model on a labmate's computer cannot be used through the lab's server.
- There is no live connection to a running Jupyter server. A notebook is read as a saved file.

Planned work is in [ROADMAP.md](../ROADMAP.md).
