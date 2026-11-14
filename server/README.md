# DG reference server

This is the reference server for the Discourse Graphs services API described in [docs/services.md](../docs/services.md). It covers extraction, the graph store, labs, sync, the lab paper repository and AI.

It is a demo reference server. It is not hardened for production. It has no rate limits and no TLS, and the only way to revoke a token is to remove its member. Everything sits in JSON files in one folder, and a person's `did` is taken at their word. Run it on a machine you trust.

## Run it

You need Node 26. There is no build step.

```sh
cd server
npm install
node src/main.ts
```

Then try `curl http://127.0.0.1:8787/v1/info`.

Tests start their own server on a random port with a temp data folder. They never call MIRA or a real model.

```sh
npm test
```

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. Set `0.0.0.0` to serve your network |
| `DG_DATA` | `server/data` | Folder for the JSON store and files |
| `DG_KIND` | `local` | `kind` in `/v1/info`: `local`, `managed` or `custom` |
| `DG_DEMO_PAPERS` | `demo/papers` | Folder with the demo PDFs and their `.graph.json` files |
| `DG_PUBLIC_URL` | the request's `Host` header | The address people reach the server at, for links in headers and metadata |
| `MIRA_URL` | `https://mira-extraction.vercel.app/api/extract` | Where `mira-hosted` sends text |
| `ANTHROPIC_API_KEY` | none | Turns on AI through the Anthropic Messages API |
| `OPENROUTER_API_KEY` | none | Turns on AI through OpenRouter, if there is no Anthropic key |
| `AI_MODEL` | `claude-sonnet-5-5`, or `anthropic/claude-sonnet-5.5` on OpenRouter | Model for `/v1/ai/ask` |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | For pointing tests at a fake server |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | For pointing tests at a fake server |

With no model key, `/v1/ai/ask` runs in `search-only` mode. It quotes the closest units as they stand and never writes anything of its own.

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

The server keeps a hash of each revoked token on the lab, never the token.

## Models

- `demo-replay` is the default. It replays the saved graph for the two demo papers and refuses anything else. No extraction runs.
- `sentence-split` is a rough stand-in. It sorts sentences by simple rules, with no AI and no network.
- `mira-hosted` reads the document here and sends its text to MIRA. A run takes 1 to 5 minutes.

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
| `request_target` | `addresses` | As the spec asks |
