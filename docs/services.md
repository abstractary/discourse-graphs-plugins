# Services API

The plugins work with no server. These services add extraction, labs, a shared paper repository and AI. Everything here is what the reference server in [server/](../server) implements, and another server can implement the same API.

Base URL is configurable. The reference server listens on `http://localhost:8787`.

- Bodies are JSON unless noted. Errors are `{"error":{"code":"...","message":"..."}}` with a matching HTTP status.
- CORS is open (`*`), because Roam runs in a browser origin and Obsidian in `app://obsidian.md`. A browser can read the `Link`, `Location`, `Accept-Post` and `Content-Disposition` response headers.
- `HEAD` works on every `GET` path and answers the same headers with no body.
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

`data` is an extraction graph: `{source, models, paper: {title, doi?, url?, license?, authors?: [{name}]}, nodes, edges}`. A node is `{id, type, text, description?, doi?, url?, anchor?}`, and an edge is `{relation, subject, object, anchor?}`. Node types and relations follow the chosen schema. The files in [demo/papers](../demo/papers) are real examples.

Supported documents: `.pdf`, `.docx`, `.md`, `.txt`. A legacy `.doc` returns `{"code":"unsupported-type"}` asking for `.docx`.

## Graph store

Extraction graphs are kept for papers with a DOI. A paper without a DOI is never sent here, and the server refuses one.

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/graphs` | `{doi, graph, schema, model}`. 400 `no-doi` without a DOI. The same DOI and content store once |
| GET | `/v1/graphs` | `{graphs: [{doi, title, schema, model, storedAt, nodes, edges}]}`. `?doi=` narrows it and includes `graph` |

The original file is never stored here.

## Landing pages and signposting

Every paper in the graph store has a landing page that people can read and machines can follow. It follows the [FAIR Signposting Profile](https://signposting.org/FAIR/), level 1 and level 2. A DOI has a slash in it, and it goes in the path as it is. A percent-encoded slash works too. When a paper has been stored more than once, the pages describe the newest.

| Method | Path | Result |
|---|---|---|
| GET, HEAD | `/works/<doi>` | An HTML page: title, DOI, node and edge counts, schema, model, when stored. 404 `not-found` when no graph is stored for the DOI |
| GET, HEAD | `/works/<doi>/graph.json` | The extraction graph, `application/json` |
| GET, HEAD | `/works/<doi>/ro-crate-metadata.json` | The metadata, `application/ld+json`, as a detached [RO-Crate 1.3](https://w3id.org/ro/crate/1.3) |
| GET, HEAD | `/works/<doi>/linkset.json` | Every link below in one `application/linkset+json` document ([RFC 9264](https://www.rfc-editor.org/rfc/rfc9264)), with one link context for each of the three resources above |

The `Link` header of each response:

| Resource | Links |
|---|---|
| Landing page | `cite-as` to `https://doi.org/<doi>`. `type` to `https://schema.org/Dataset` and `https://schema.org/AboutPage`. `describedby` to the RO-Crate, with `type="application/ld+json"` and `profile="https://w3id.org/ro/crate"`. `item` to the graph, with `type="application/json"`. `linkset`, with `type="application/linkset+json"`. `http://www.w3.org/ns/ldp#inbox` to the inbox below. `license` only when the graph's paper has a license that is a web address. `author` only for authors the graph gives an ORCID for |
| `graph.json` | `collection` to the landing page, and `linkset` |
| `ro-crate-metadata.json` | `describes` to the landing page, and `linkset` |

The server only links to what it serves itself. The DOI in `cite-as` is the paper's. The graph has no identifier of its own, so that DOI resolves to the publisher's page and not to this one.

The RO-Crate has a root `Dataset` whose `@id` is the landing page, a `ScholarlyArticle` for the paper with its authors, a `File` for the graph with `contentSize` and `sha256` of the exact bytes `graph.json` serves, and a `CreateAction` for the extraction, with the model as its `instrument`. When no license came with the graph, `license` says so in words and the server never makes one up.

Links are absolute. Set `DG_PUBLIC_URL` to the address people reach the server at, such as `https://graphs.example.org`. Without it the server uses `http://` and the request's `Host` header.

## Notifications

The server has an inbox for [COAR Notify 1.0.1](https://coar-notify.net/specification/1.0.1/) notifications, which is a [Linked Data Notifications](https://www.w3.org/TR/ldn/) inbox. A review service, a repository or another lab's server posts here to say that it reviewed, endorsed or linked to a paper.

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/notify/inbox` | The notification, as `application/ld+json` or `application/json`. `201` with a `Location` header that names the stored notification, and `{id, location}`. `400` `bad-notification` names the first problem. `415` for another content type. `413` over 256 KB. The same `id` stores once and gets the same `Location` |
| GET | `/v1/notify/inbox` | `{notifications: [...]}`, newest first. With `Accept: application/ld+json`, the LDN listing `{"@context": "http://www.w3.org/ns/ldp", "@id": <inbox>, "contains": [<notification URL>]}`. `?about=` narrows both |
| GET | `/v1/notify/inbox/:key` | One stored notification, as `application/ld+json`, exactly as it was sent |
| OPTIONS | `/v1/notify/inbox` | `Accept-Post: application/ld+json, application/json` |
| GET, HEAD | `/` | `{name, info, inbox}`, with the inbox in the `Link` header |

A summary is `{id, types, about, context?, from, actor?, receivedAt, notification}`. `about` is the `object.id`, or both ends of a relationship. `context` is `context.id`, `from` is `origin.id`, and `actor` is the actor's name, or its id when it has no name. `notification` is the whole notification.

`?about=<iri>` matches `about`, `context`, or an `ietf:cite-as` on the object or the context. A DOI matches however it is spelled: `https://doi.org/10.1/x`, `doi:10.1/x` and `10.1/x` are the same, in any letter case.

What a notification must have:

- `@context`: a list with `https://www.w3.org/ns/activitystreams` and `https://coar-notify.net`. The older `https://purl.org/coar/notify` is accepted.
- `id`: a URI. `urn:uuid:` is the usual choice.
- `type`: one of `Announce`, `Offer`, `Accept`, `Reject`, `TentativeAccept`, `TentativeReject`, `Undo`, `Flag`. It can add one of `coar-notify:EndorsementAction`, `coar-notify:ReviewAction`, `coar-notify:RelationshipAction`, `coar-notify:IngestAction`, `coar-notify:UnprocessableNotification`. An `Offer` must say what it asks for, and a `Flag` must be an `UnprocessableNotification`.
- `origin`: `id` (http or https) and `type`. `inbox` when the sender has one.
- `target`: `id`, `type` and `inbox`.
- `object`: `id`. For a `RelationshipAction`, a `Relationship` with `as:subject`, `as:relationship` and `as:object`.
- `actor`, `context` and `inReplyTo` are optional. When sent, `actor` needs `id` and `type`, `context` needs `id`, and `inReplyTo` is a URI.

To find the inbox, read the `Link` header with `rel="http://www.w3.org/ns/ldp#inbox"` on `/` or on any landing page.

This demo inbox does not check who is sending. Anyone can post, as LDN expects, and the specification leaves trust to each deployment. So the server only checks, keeps and hands back a notification. It never fetches, follows or runs anything in one, and a reader should treat every claim in one as unverified. A real deployment would add an allow-list of origin inboxes it trusts, or signed requests, and would confirm a claim by fetching the review or the link from the sender's own site before showing it as fact. The inbox keeps the newest 500 notifications.

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
| POST | `/v1/labs/:id/invites` | Admin | `{uses?, days?, tokenKind?: "personal"\|"team"}` returns `{invite: {id, code, expiresAt, usesLeft}}`. `uses` is 1 to 100 and defaults to 1. `days` is 1 to 90 and defaults to 7. The code is only ever returned here |
| GET | `/v1/labs/:id/invites` | Admin | `{invites: [{id, createdAt, expiresAt, usesLeft, by}]}` for invites that still work. `by` is the did of the admin who made it. Never the code |
| DELETE | `/v1/labs/:id/invites/:inviteId` | Admin | `{id}`. 404 `no-invite` when there is none |
| POST | `/v1/labs/:id/invites/accept` | Anyone | `{code, person: {did, name}}` returns `{lab: {id, name}, token, tokenKind, role: "member"}`. 403 `bad-invite` for a wrong, expired or used-up code |
| DELETE | `/v1/labs/:id/members/:did` | Admin | `{removed: did}`. The did is percent-encoded. 409 `cannot-remove-self`, 404 `no-member` |

Accepting provisions a token. `personal` is unique to that member, and `team` is the lab's shared AI token. Both are member tokens to this API. Tokens are stored hashed.

An invite skips the request and the wait. Whoever holds the code joins at once and gets a fresh token, also when they are a member already. Each join takes one use. Invite codes are stored hashed.

Removing a member deletes every token of theirs and declines their pending join requests. From then on, any request with one of those tokens gets 403 `removed` with the message "You were removed from this lab. Ask its PI if that was a mistake." Any other unknown token still gets 403 `wrong-token`. What the person shared stays in the lab. A removed person can join again with a new invite, and their old tokens stay revoked.

## Sync

Records are opaque JSON. The server orders them and hands them back. It never reads or merges them, so each member keeps a full local copy and the server is only an index and exchange.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/v1/labs/:id/records` | Member | `{records: [...]}` returns `{stored, now}`. An identical record is stored once |
| GET | `/v1/labs/:id/records?after=&limit=` | Member | `{records, next, done, now}`. `after` is the `next` from the last call |

`now` is the server's time as an ISO string, such as `2026-11-13T09:30:00.000Z`. A client can compare it with its own clock and correct for the difference.

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
