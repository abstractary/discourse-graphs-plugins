# Reference server

The reference server for the Discourse Graphs services API: extraction, the graph store, landing pages, a notification inbox, labs, sync, the lab paper repository and AI. [docs/services.md](../docs/services.md) describes every route. This page says how to run, configure and extend it.

It shows the API. It is not hardened: it has no rate limits and no TLS, a person's `did` is taken at their word, and the only way to revoke a token is to remove its member. Run it on a machine you trust.

## Run it

You need Node 26. There is no build step.

```sh
cd server
npm install
node src/main.ts
```

Then try `curl http://127.0.0.1:8787/v1/info`.

From the repository root, `npm run server` starts two instances and prefixes each one's log lines with its name:

| Name | Port | `kind` | Data folder |
|---|---|---|---|
| `local` | 8787 | `local` | `server/data/local` |
| `service` | 8788 | `managed` | `server/data/service` |

Stopping one stops both.

## Test it

```sh
npm test
```

Each test starts its own server on a random port with a temporary data folder. They never call MIRA or a real model. From the root, the same suite is `npm run test:server`.

## Settings

All settings are environment variables.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. Set `0.0.0.0` to serve your network |
| `DG_DATA` | `server/data` | Folder for the JSON store and files. Under `npm run server`, the parent of each instance's folder |
| `DG_KIND` | `local` | `kind` in `/v1/info`: `local`, `managed` or `custom`. Any other value stops the server at start |
| `DG_DEMO_PAPERS` | `demo/papers` | Folder with the demo PDFs and their `.graph.json` files |
| `DG_PUBLIC_URL` | `http://` and the request's `Host` header | The address people reach the server at, for links in headers and metadata |
| `MIRA_URL` | `https://mira-extraction.vercel.app/api/extract` | Where `mira-hosted` sends text |
| `ANTHROPIC_API_KEY` | none | Turns on AI through the Anthropic Messages API |
| `OPENROUTER_API_KEY` | none | Turns on AI through OpenRouter, if there is no Anthropic key |
| `AI_MODEL` | `claude-sonnet-5-5`, or `anthropic/claude-sonnet-5.5` on OpenRouter | Model for `/v1/ai/ask` |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | For pointing tests at a fake server |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | For pointing tests at a fake server |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Where a member's own OpenAI key is sent. For pointing tests at a fake server |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | Where a member's own Gemini key is sent. For pointing tests at a fake server |

Fixed in code: a request body may be up to 40 MB, and `demo-replay` takes about 2 seconds.

With no model key, `/v1/ai/ask` runs in `search-only` mode. It quotes the closest units as they stand and never writes anything of its own. A member can still send their own provider and key with a question. The server calls only that provider's own address, uses the key for that one question, and keeps nothing.

## What it stores

Everything sits as JSON files under `DG_DATA`, written to a temporary file and renamed into place. Folders are created readable only by the server's user.

- Lab tokens, invite codes and revoked tokens are stored as SHA-256 hashes, never as sent.
- Records are kept in the order they arrive, one log to a lab. The server checks only that each has `id`, `kind`, `at` and `by.id`.
- The graph store keeps a paper's extraction and DOI, never its file.
- The inbox keeps the newest 500 notifications.

## Invites and removing a member

There are two ways into a lab. A person can ask to join and wait for the admin to accept. Or the admin can make an invite, and whoever holds its code joins at once.

- `POST /v1/labs/:id/invites` makes an invite. It works once and lasts 7 days unless you send `uses` (up to 100) or `days` (up to 90). The code is shown only in this response, and the server keeps only a hash of it.
- `GET /v1/labs/:id/invites` lists the invites that still work. `DELETE /v1/labs/:id/invites/:inviteId` cancels one.
- `POST /v1/labs/:id/invites/accept` takes `{code, person}` with no token and returns a member token. A wrong, expired or used-up code gets the same `bad-invite` answer.

```sh
curl -X POST http://127.0.0.1:8787/v1/labs/tension-lab-4k2/invites \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"uses": 5}'
```

`DELETE /v1/labs/:id/members/:did` removes a member. Percent-encode the did. Every token of theirs stops working, and a request with one gets 403 `removed` so the plugin can say what happened. Their pending join requests are declined. The records and papers they shared stay. An admin cannot remove themself. A removed person can come back with a new invite, and their old tokens stay dead.

## Models

- `demo-replay` is the default. It replays the saved graph for the demo papers and refuses anything else with `not-a-demo-paper`. No extraction runs.
- `sentence-split` is a rough stand-in. It sorts sentences by simple rules, with no AI and no network.
- `mira-hosted` reads the document here and sends its text to MIRA. A run takes 1 to 5 minutes. Failures come back as `mira-failed`, `mira-unreachable` or `mira-timeout`.

Documents can be `.pdf`, `.docx`, `.md` or `.txt`. PDFs are read with `pdfjs-dist`, the server's only dependency.

## Add a model

1. Add a file in `src/extract/` that exports an `ExtractModel` (see `src/extract/model.ts`). Its `run` gets the document and a context, calls `context.emit` for status lines, and returns a graph.
2. Use `readDocumentText` from `src/extract/document.ts` if it needs the text.
3. Throw `ApiError` for anything the person can act on. It becomes an error line in the stream.
4. Add it to the list in `src/extract/models.ts`.

Return the graph with `mira` types. `src/extract/schemas.ts` maps it when someone picks `discourse-graph`.

## The discourse-graph mapping

Types: `Study`, `Protocol` and `SourceDocument` become `Source`. `Request` becomes `Question`.

| MIRA relation | Becomes | Why |
|---|---|---|
| `grounds` | `derivedFrom`, turned around | A Study grounds Evidence, so the Evidence is derived from the Source |
| `follows` | `derivedFrom` | A Study is built on its Protocol |
| `describesActivity` | `informs` | A document only tells us about a Study |
| `request_target` | `addresses` | A request addresses its target |

## Where things are

| File | Holds |
|---|---|
| `src/main.ts`, `src/app.ts` | Start-up, and the routes wired to their handlers |
| `src/routes.gen.ts`, `src/wire.gen.ts` | The route table and wire types, generated from `packages/contract` by `npm run gen:routes`. Don't edit them |
| `src/http.ts` | Routing, CORS, body limits, errors, NDJSON streams |
| `src/auth.ts` | Tokens, roles, and sealing a join token to its requester |
| `src/store.ts` | The JSON store |
| `src/compute.ts`, `src/extract/` | Info, models, schemas and extraction |
| `src/graphs.ts`, `src/signposting.ts` | The graph store and its landing pages |
| `src/notify.ts` | The COAR Notify inbox |
| `src/labs.ts`, `src/sync.ts`, `src/papers.ts` | Labs, record exchange and the lab's papers |
| `src/ai.ts` | Ask AI |
