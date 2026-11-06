# Services API

The plugins work with no server. These services add extraction, labs, a shared paper repository and AI. Everything here is what the reference server in [server/](../server) implements, and another server can implement the same API.

Base URL is configurable. The reference server listens on `http://localhost:8787`.

- Bodies are JSON unless noted. Errors are `{"error":{"code":"...","message":"..."}}` with a matching HTTP status.
- CORS is open (`*`), because Roam runs in a browser origin and Obsidian in `app://obsidian.md`.
- `Authorization: Bearer <token>` carries a lab token where one is needed.
- Streaming responses are `application/x-ndjson`, one JSON object per line.

## Compute

A compute server is anything that answers these. A person can add several in the plugin: a machine on their network, DG's managed service, or their own cloud server.

| Method | Path | Result |
|---|---|---|
| GET | `/v1/info` | `{name, kind: "local"\|"managed"\|"custom", version, demo, ai: {mode: "model"\|"search-only", model?}}` |
| GET | `/v1/models` | `{models: [{id, label, description, default?}]}` |
| GET | `/v1/schemas` | `{schemas: [{id, label, description, default?}]}` |
| POST | `/v1/extract` | NDJSON stream |

`POST /v1/extract` body: `{filename, mediaType, dataBase64?, text?, model, schema}`. Stream lines:

```
{"type":"status","message":"Reading the document"}
{"type":"ping"}
{"type":"result","data":{...}}
{"type":"error","message":"...","code":"..."}
```

`data` is an extraction graph: `{source, models, paper: {title, doi?, authors?}, nodes, edges}`. A node is `{id, type, text, description?, doi?, url?, anchor?}`, and an edge is `{relation, subject, object, anchor?}`. Node types and relations follow the chosen schema. The files in [demo/papers](../demo/papers) are real examples.

Supported documents: `.pdf`, `.docx`, `.md`, `.txt`. A legacy `.doc` returns `{"code":"unsupported-type"}` asking for `.docx`.

## Graph store

Extraction graphs are kept for papers with a DOI. A paper without a DOI is never sent here, and the server refuses one.

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/graphs` | `{doi, graph, schema, model}`. 400 `no-doi` without a DOI. The same DOI and content store once |
| GET | `/v1/graphs` | `{graphs: [{doi, title, schema, model, storedAt, nodes, edges}]}`. `?doi=` narrows it and includes `graph` |

The original file is never stored here.

## Labs

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/labs` | Anyone | `{name, person: {did, name}, labDid?}` returns `{lab: {id, name}, token}`. The creator becomes the lab's admin. `id` reads like `tension-lab-4k2` |
| GET | `/v1/labs/:id` | Anyone | `{id, name}`, so a person can confirm the lab before asking to join |
| POST | `/v1/labs/:id/join` | Anyone | `{person: {did, name}}` returns `{requestId, secret}` |
| GET | `/v1/labs/:id/join/:requestId?secret=` | Requester | `{state: "pending"\|"accepted"\|"declined", token?, tokenKind?}`. The token is only ever returned here, to the holder of `secret` |
| GET | `/v1/labs/:id/members` | Member | `{members: [{did, name, role, tokenKind}]}` |
| GET | `/v1/labs/:id/requests` | Admin | `{requests: [{id, person, at}]}` for pending requests |
| POST | `/v1/labs/:id/requests/:requestId` | Admin | `{decision: "accept"\|"decline", tokenKind?: "personal"\|"team"}` |

Accepting provisions a token. `personal` is unique to that member, and `team` is the lab's shared AI token. Both are member tokens to this API. Tokens are stored hashed.

## Sync

Records are opaque JSON. The server orders them and hands them back. It never reads or merges them, so each member keeps a full local copy and the server is only an index and exchange.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/labs/:id/records` | Member | `{records: [...]}` returns `{stored}`. An identical record is stored once |
| GET | `/v1/labs/:id/records?after=&limit=` | Member | `{records, next, done}`. `after` is the `next` from the last call |

## Lab paper repository

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/labs/:id/papers` | Member | `{paper: {id, title, doi?, filename, model, schema, server, canvas, uploadedBy: {did, name}, extractedBy: {did, name}}, graph, fileBase64?, mediaType?}` |
| GET | `/v1/labs/:id/papers` | Member | `{papers: [...]}`, each with `hasFile`, `uploadedAt` and `breadcrumbs` |
| GET | `/v1/labs/:id/papers/:paperId` | Member | The paper with its `graph` |
| GET | `/v1/labs/:id/papers/:paperId/file` | Member | The original file |
| POST | `/v1/labs/:id/papers/:paperId/breadcrumbs` | Member | `{person: {did, name}}`. A person chose to say they read this. One per person, latest time kept |

## AI

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/ai/ask` | Member | NDJSON stream |

Body: `{question, units: [{id, type, title, description?, anchor?, paper?}], grounded?: [id]}`. `units` is the canvas. `grounded` narrows the answer to the units a person picked. Stream lines:

```
{"type":"status","message":"..."}
{"type":"delta","text":"..."}
{"type":"result","answer":"...","citations":[id],"mode":"model"|"search-only","model":"..."}
{"type":"error","message":"..."}
```

With no model key set on the server, `mode` is `search-only`: the answer is the most relevant units quoted as they stand, and it says so. The server never invents an answer in that mode.
