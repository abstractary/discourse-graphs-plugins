# Four vaults

A simulation of four people working together, each with a vault of their own, and what it found. It was first run on 13 November 2026.

```sh
node harness/four-vaults.ts                      # the scripted story, then a 200-step random walk
node harness/four-vaults.ts --seed 7 --steps 400 # another walk
```

The report goes to `reports/four-vaults/report.md`. Nothing leaves the process: each vault's network goes through one door that lets through the lab server, answers for that person's own stand-in Zotero, and refuses everything else.

## What it is

| Part | What runs |
|---|---|
| Each vault | The real core on the in-memory base, the real services client, the real sync loop |
| The lab server | The reference server from `server/`, on a port of its own, restarted mid-run |
| The door | Records everything each vault sends, so "did private work leave" is read off the wire |
| The cast | Mira, the PI, on two computers. Tomas, a member who reads from Zotero. Ines, a member who joins late and for a while runs an older app. Kofi, in another lab on the same server |
| Time and chance | One clock for the whole run and a seeded source of chance, in place of the real ones. The same seed gives the same records |

The code is in [`harness/vaults/world.ts`](../harness/vaults/world.ts) (the world) and [`harness/four-vaults.ts`](../harness/four-vaults.ts) (the story and the walk). The cast and the story are mine and are easy to change.

It checks six things:

| Area | The question |
|---|---|
| Convergence | After everyone has exchanged, do they see the same canvas? |
| Privacy | Did anything private leave its device, or reach someone it shouldn't? |
| Intent | Did the outcome match what the people meant? |
| Liveness | Does syncing finish, and then go quiet? |
| Membership | Does everyone agree who is in the lab? |
| Integrity | Is what a vault holds whole and honest? |

## What it found, and what was fixed

The first run held 40 of 57 expectations. It now holds 121 of 121. Twelve of the first failures had one of six causes, all in what a vault chooses to send. These are fixed, and held by [`test/lab-share.test.ts`](../test/lab-share.test.ts).

| Fault | Cause | Fix |
|---|---|---|
| A card taken off a shared canvas stayed on everyone else's | Only live cards were sent, so the removal never left | Removed cards of a shared canvas are sent |
| A unit its author removed stayed in labmates' vaults, and a canvas its owner removed stayed in their lists | The same: removed things were filtered out before sending | A removed unit that has had a card on a shared canvas is sent, and so is a removed shared canvas |
| A relation taken back stayed active for labmates | Withdrawals were never sent | Withdrawals of shared relations and units are sent |
| A check never reached the person whose unit was checked | Checks were not among what is shared | Checks on shared units are sent |
| Evidence arrived without the paper it came from | The source unit isn't on the canvas, so it wasn't sent | A shared unit's source goes with it |
| A member's relation on the PI's canvas reached nobody | It was only drawn on canvases the person made, and only drawn relations are shared | It is drawn on the lab's shared canvases too |

Three more came out of the random walk and the test written after it:

| Fault | Fix |
|---|---|
| One person removes a unit while another moves its card. The move wins, so the card came back with no unit behind it | A card whose unit is gone is not shown, nor are its lines |
| Removing a unit left its lines on the canvas, pointing at nothing | The lines are removed with the cards |
| A member accepted before the PI's device had sent the lab's own record got an error | They are joined when the record arrives |

After the fixes, the walk ends with all three members seeing the same canvas on every seed tried (1 to 8, at 400 steps).

One rule was added on the way, and it is mine to confirm: **once a unit's card is taken off a shared canvas, its later versions stay with its author.** The one exception is the author removing the unit, which is sent so nobody keeps a unit that no longer exists.

## The second round: the five that were open

All five open items were then closed, on the product owner's word to do all of them. The simulation now holds 95 of 95 expectations, on every seed tried.

| # | What was wrong | What was built |
|---|---|---|
| 1 | The version with more edits behind it won, whatever the time | Each version names the one it replaces (`prev`). A version beats what it replaces. Only versions made apart are left to a tie-break, and there the later one stands |
| 2 | A slow clock lost | The lab server says what time it is with every exchange. A device more than two seconds off stamps with the difference added. A new version is never stamped before the one it replaces |
| 3 | A member could put words in another's mouth | Every version is signed by whoever wrote it, with the key their DID was made from. A record that names a labmate as its writer and doesn't carry their signature is refused on arrival, and the Lab tab says how many were. Separately, a unit's words and its existence are its author's alone: a labmate's version that rewords or removes it is never read, though they can still add facts to it |
| 4 | The PI couldn't remove a member | The PI removes a member. The server stops serving them, their membership ends in everyone's records, and their own vault tells them. They keep what they had. A new invitation lets them back in |
| 5 | Each vault had its own grammar | A lab has one grammar, its PI's. When a member joins, each of their types that the lab also has gives way to the lab's and is read as the lab's from then on. Only the PI changes the lab's types. A member can add types of their own beside them |

### Setting up a lab, as the simulation now plays it

1. **Mira starts the lab** and is its PI.
2. **She makes an invitation**: one line, good for one person for a week. Tomas pastes it and is in at once. A wrong line is refused, a used one is refused, and a member can't make one.
3. **Ines asks to join** with the lab's identifier instead, and Mira accepts. Both ways still work.
4. **Mira sets what everyone inherits**: the lab's shelf of papers (a Zotero group), the model servers the lab offers, which one is the first choice, and how far a paper's text may travel to be read by a model. She adds a type to the grammar.
5. **Tomas and Ines have all of it** after their next exchange: the settings, the lab's server in their own list of servers, the new type. When Mira changes a setting later, they get the change.
6. **Neither can change it.** A member who tries to change the lab's settings or its types is told only the PI can.

## The third round: what was still not right, and what the simulation couldn't see

The second round ended with seven things not right and five the simulation couldn't find. Each was then taken on. The simulation now holds 121 of 121, and a real Obsidian has been run in a lab with simulated labmates.

### What was not right

| What was wrong | What was built | What is still true |
|---|---|---|
| A second device couldn't sign | Every device has a signing key of its own. A new device asks, in the vault's own log. A device the person already uses lets it in by signing the new key, and labmates check that chain. Until then the new device sends nothing, so nothing of its is refused and lost. A lost device is removed the same way | Letting a device in takes a deliberate press on a trusted device. That is the point: anyone who can only write into the vault's files can ask, and can't approve |
| A unit's author was fixed by its id, not proved | A record whose writer is a labmate must carry a signature from one of that labmate's keys. A record from a labmate whose own record hasn't arrived yet is held until it does, and checked then, where before it was let through | A writer nobody in the lab has a key for can't be checked. They also can't pass for anyone in the lab |
| An older app's unsigned records were refused, silently | They are still refused, which is the safe side. The Lab tab now says whose records were refused and how many, so someone can tell them to update. The older app still receives everything. Once updated, its next change carries its earlier work | A lab is only as current as its oldest app, for what that app writes |
| A labmate's earlier additions to someone else's unit were dropped | A version from before versions named what they replace, with no signature, stands if it keeps the title and existence of the author's version just before it | None found |
| A removed member kept their copy | On their own device, what the lab's other members shared is put away: out of the graph, and its notes moved to the base's trash. Their own work stays, and their own grammar comes back. If they are invited back, it all returns | What was sent can't be unsent. The records are still in their log, and a changed app could read them. Keeping later work from a removed member is what removal does. Keeping earlier work from them would need the work to have been sealed before it was sent |
| The clock was corrected only after an exchange | The correction is kept across restarts. A device never stamps earlier than its own last stamp, so a clock set back can't reorder its own work. The Lab tab says when this computer's clock is off and by how much | A device whose clock goes wrong and that has never exchanged since still stamps wrong until it does |
| No second device in the simulation | Mira's laptop is the fifth vault | |

### What the simulation couldn't see

| Gap | What was done |
|---|---|
| Files on disk: logs copied, merged or half written by a sync tool | One reader for device logs, used by Obsidian and the local app, that skips and counts what isn't a whole record: a half-written last line, two records run together, merge markers, a repeated stretch, other line endings. A log that was replaced or joined is read again from its top. The simulation carries Mira's log between her two computers through each of those faults. Before this, one bad line stopped a vault from loading. Obsidian's device id also moved out of the plugin's data file, which travels with the vault: two devices sharing one id wrote to one log |
| A real base: file watcher, plugin start and stop, what panels draw | `harness/lab-real-test.mjs` puts the real Obsidian in a lab run by simulated people, with the lab server in its own process. It joins by invitation, receives a shared canvas on its own loop, shows the PI's settings on the Lab tab, sends signed work back, catches up after the plugin restarts, and is removed. It found two faults the simulation couldn't: the lab's units stayed as notes in the vault after removal, and joining had replaced the person's grammar for good |
| The same person on two devices | Covered by the fifth vault: both devices change the same card apart, sync files, sync with the lab, and all end the same |
| Two versions of the software in one lab | An older app, by stripping what it sends of the newer fields. A newer app, by sending a kind of record and a field this app has never heard of: both are kept in the log untouched and neither is misread |
| Exact replays | Time, ids, keys and signatures now come from the seed. The same seed leaves every vault with the same records, byte for byte, and the simulation checks that by running a walk twice |

### Still out of reach

- Several real Obsidians at once. One real one among simulated labmates covers the base. It doesn't cover two real file watchers racing.
- A real file-sync tool. The faults are the ones those tools are known to make, applied to the text.
- Logseq, which has no real-app harness for this yet.

## The six decisions, taken

Each was taken toward what is safer, lasts longer, or is the settled practice.

| Decision | Position | Why |
|---|---|---|
| A relation between two shared units that isn't drawn | It stays private | Sharing follows what a person put on a shared canvas. Inferring that a relation should travel because its ends do would send a person's doubts without their say |
| Remove against edit on a canvas | The edit stands | A removal takes away only what its maker had seen. This is the add-wins rule of observed-remove sets, the usual default in the research, and it never loses someone's work to a race. Whoever removed the card can remove it again. For memberships and devices it is the other way round: the removal stands, so access is never kept by a race |
| How a second device signs | A key per device, vouched for by a device already trusted | This is how Signal, Matrix and Keybase link devices, and the shape UCAN and Keyhive delegate by. The alternative, copying one key around, puts the key in files that sync |
| A labmate's computer taking model work | Through the lab server, with the paper's text sealed to the computer that will read it | No model server is opened to a network, no VPN is needed, and the server passes on what it can't read. **Not built.** It needs a sealing key per device and a job queue on the server |
| Default reach | The lab | Unpublished work is confidential unless someone says otherwise, which is what funders and universities ask. A PI widens it once for everyone. Reach now covers questions asked of a model as well as reading papers |
| The MCP: scopes, shared canvases, identity | An agent reads what its person can read. Everything it writes is a proposal that lands in the person's own space, never on a shared canvas. It has an identity of its own | An agent's key is a device key with the role `agent`, let in and removed the same way, so what it wrote can be told apart and cut off. **The role exists in the record. Nothing enforces it yet**, since there is no MCP server |

## Where this stands against current practice

Three research passes were run on 13 November 2026. The short version of each follows; the links are the sources they rest on.

### Sync

Our log of immutable records is the right shape and should stay. Systems that would replace it (Automerge, Loro, Jazz, Zero) bring their own data model and would cost the mapping to AT Protocol records. The least change that makes convergence something we can prove, not just observe:

1. **Each version names what it replaces.** This is how [Automerge](https://automerge.org/blog/2026-august/), [p2panda](https://docs.rs/crate/p2panda/0.7.1) and AT Protocol's [repository](https://atproto.com/specs/repository) order things. It fixes open items 1 and 2.
2. **Sign what a device sends, and have the PI sign the member list.** AT Protocol signs one commit per push, not each record, and verifies against the key in the DID document ([cryptography](https://atproto.com/specs/cryptography)). It fixes 3 and 4.
3. **Watch AT Protocol's permissioned spaces** ([alpha, August 2026](https://atproto.com/blog/atproto-spaces-alpha)) as the later transport for a lab. We already have DIDs, lexicons and CIDs. It has access control, no encryption, and is not yet reviewed.

Not worth adopting now: Keyhive (pre-alpha, tied to Automerge), MLS and UCAN (unfinished for this use), server-authoritative stores (they conflict with private work staying on the device).

The official Discourse Graphs plugin shares through Supabase: a unit is published to a lab space and imported one way, with a warning not to edit imports. There is no merge.

Failure modes others have hit that we should expect: resurrected deletes ([LiveSync's 2026 releases](https://github.com/vrtmrz/obsidian-livesync/releases) are largely about them), a file-sync tool forking a device's log, and a log that only grows.

### Testing

The practice with the best record is the one this simulation follows: run every peer in one process with the network replaced, script the people, add a seeded random walk, check invariants, and replay from the seed. [Dropbox's sync engine](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine) and the [Jepsen work on PowerSync](https://github.com/nurturenature/jepsen-powersync) both found their real faults at this layer. The four layers, with where we are:

| Layer | Finds | State here |
|---|---|---|
| 1. The fold alone, over shuffled and repeated records | Order and repeat sensitivity, resurrection, tie-breaks | One check, in the simulation. [fast-check](https://fast-check.dev) would add generated cases that shrink to the smallest failing one |
| 2. Several cores in one process | Offline work, late joining, remove against edit, restart, leaks at the door | Built: this simulation |
| 3. Vault folders on disk, through the local app | Torn or forked logs, restart recovery | Not built |
| 4. Real Obsidian, several at once | Plugin life cycle, file watcher, what is drawn | Not built. [obsidian-integration-testing](https://github.com/mnaoumov/obsidian-integration-testing) (November 2026) starts isolated copies over the same protocol our harness uses |

Two gaps in layer 2 remain. The core reads the time and makes ids from the system, so a slow clock is simulated by swapping the clock for one action, and a run can't be replayed exactly. Passing a clock and a source of chance into the core would close both. And the door can refuse a request but can't yet drop, repeat or reorder one.

### MCP

The specification's current revision is [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog). It is stateless: no session, and the same tool list for every connection. Sampling is deprecated, so the design shouldn't lean on it. What the research and this simulation say together:

- **About ten tools at the level of a task, not our two hundred methods.** [Anthropic's guidance](https://www.anthropic.com/engineering/writing-tools-for-agents) calls mirroring an API the mistake to avoid. A shortlist: search the graph, get a unit with its relations and checks, get the grammar, read a paper's passages, get a canvas, propose units, propose relations, propose a check, see what became of earlier proposals.
- **Every write is a proposal.** Nothing an agent does is accepted, published, exported or synced by the agent. The review screen is the gate, and it doesn't depend on the client asking the person.
- **One endpoint and one token per vault.** With sessions gone, this is the clean way to keep vaults apart, and it is what lets four agents be simulated against four vaults with this world.
- **No way out.** An agent reads untrusted paper text and private notes. If it could also publish or fetch, a paper could instruct it to leak. A proposal accepted onto a shared canvas is itself a way out, so whether proposals may target shared canvases is a decision.
- **The server says who wrote it.** Open item 3 matters more with agents: a record's author must be set by the vault, never taken from the caller.

The official project's own [MCP server](https://github.com/DiscourseGraphs/discourse-graph-mcp) was eight read-only tools over a static export, and was archived in September 2026.

### How canvas and reference tools sync (second pass)

- **tldraw** keeps one authoritative room per document. Each record has its own clock, changes are patches to single properties, and a patch to a deleted record is dropped, so delete beats edit ([docs](https://tldraw.dev/docs/sync)). **Figma** keeps the last value per property per object, in the order changes reach the server ([post](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)). **Excalidraw** picks the higher version per element and relays encrypted messages ([post](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature)).
- **What that says about ours.** We merge whole records. Two people changing different things on one card, such as its place and its size, keep only one change. Merging per property is the next refinement. Our rule for remove against edit is "the later one", which is neither tldraw's nor Zotero's; it should be chosen on purpose.
- **Obsidian Sync** merges Markdown, merges JSON by key, and has been reported to replace a whole `.canvas` file with no conflict copy ([help](https://obsidian.md/help/sync/troubleshoot)). One writer per log file, as we have, is the safe shape under it.
- **Zotero** syncs each object against a library version and merges per field, asking the person only when the same field changed twice ([docs](https://www.zotero.org/support/dev/web_api/v3/syncing)).

### Zotero groups, and whose shelf a paper is on

A Zotero **group** has an owner, admins and members, and three settings: who can read, who can edit, who can edit files. Its files count against the owner's storage. An item copied from a personal library into a group gets a new key and the two copies drift apart. Within a group every member sees the same key, so `groups/<id>/items/<key>` means the same item on every member's computer. The local API can't say what role a person has in a group.

That gives the model now built:

| Shelf | What it is | Who can open the PDF |
|---|---|---|
| The lab's | The Zotero group the PI chose in the lab's settings. With no Zotero, the lab server's paper repository | Every member, each from their own Zotero, or by getting the file from the lab |
| Yours | Your own Zotero library, or a file in your vault | Only you. Labmates see the reference and its DOI |
| A labmate's | Their own library or vault | Only them. You are told whose copy it is |
| Another group | A Zotero group that isn't the lab's | Whoever is in that group |

- A paper's identity is its DOI or the like. Zotero's key only says where a copy is.
- The PDF chooser lists the lab's shelf first, under its group's name, then the person's own library.
- A unit's facts say which shelf its paper is on. On a card that is said only when labmates can't open it.
- Permissions are Zotero's. We don't copy them and can't read them.
- The same paper in a personal library and in the lab's group is still read as two places for one work. The source keeps the address it was first read from. Not yet handled.

### Running a model on someone else's computer

- **Never open a model server to the network.** Ollama has no sign-in on its local API, and LM Studio's is off by default ([Ollama](https://docs.ollama.com/api/authentication.md)). The safe shape for a small lab is a model bound to its own computer with a small helper beside it that calls out to the lab server and asks for work. No inbound port, no VPN, and the member tokens we already have.
- **Every gateway routes the same way:** an ordered list, the first that answers wins, and a hard limit that is never crossed silently ([LiteLLM](https://docs.litellm.ai/docs/routing), [OpenRouter](https://openrouter.ai/docs/guides/privacy/zdr)). None of the note or reference tools found has settings a lab sets once and members inherit.
- **What is built:** the lab's settings carry the servers it offers, a first choice, and a reach: each member's own computer only, the lab's servers, or anywhere. Members inherit all three. Reading a paper on a server outside the lab's reach is refused with the reason.
- **What is not built:** the helper that lets a labmate's computer take work through the lab server, signed job requests, and a record of which model on which machine produced a result. Reach is enforced for reading papers, not yet for questions asked of a model.

## Decisions still open

1. Whether to build the labmate-computer route for model work now, or after the MCP.
2. Whether merging should go from whole records to single properties, so two people changing different things on one card both keep their change.
3. Whether the AT Protocol's permissioned spaces replace the lab server once they are stable.
4. The tooling questions in [tooling.md](tooling.md).
