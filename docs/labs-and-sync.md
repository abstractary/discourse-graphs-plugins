# Labs and sync

This page covers how people work together in a lab: joining and leaving, what a PI sets for everyone, what is shared and what stays on a device, how records are signed and checked, how devices are added, how two versions of one record are merged, and the simulation that checks all of it.

For the server's routes see [services.md](services.md). For every send off the device see [what-leaves-the-device.md](what-leaves-the-device.md). For the lab's shelf of papers see [zotero.md](zotero.md#a-labs-shelf-and-your-own-library).

## The model

- **Every member keeps a full copy.** A vault holds a log of records and reads its graph from that log. Losing the connection costs nothing but freshness.
- **The lab server passes records along.** It stores what members push and hands it to the others. It does not read, merge or check what a record says.
- **Records are immutable versions.** A change is a new version of a record. Each version names the one it replaces (`prev`) and is signed by whoever wrote it.
- **Reading is a pure function.** [`contract/fold.ts`](../packages/contract/src/fold.ts) turns any set of records into one graph. The order they arrive in, and repeats, never change the result. Every rule about which version stands and who may change what lives there, so the plugin, the local app, a labmate's copy and an agent all keep the same rules.
- **Sharing follows the canvas.** What a person puts on a canvas shared with the lab travels. Everything else stays on their device.

| Part | Where |
|---|---|
| Which version stands, who may change what | [`contract/fold.ts`](../packages/contract/src/fold.ts) |
| What is shared, what is taken in, joining, invitations, settings | [`core/labs.ts`](../packages/core/src/labs.ts) |
| Signing and checking signatures, trusted keys | [`core/signing.ts`](../packages/core/src/signing.ts), [`core/identity.ts`](../packages/core/src/identity.ts) |
| Devices | [`core/devices.ts`](../packages/core/src/devices.ts) |
| The exchange loop | [`sync/lab-sync.ts`](../packages/sync/src/lab-sync.ts) |
| Reading a device's log off disk | [`contract/log.ts`](../packages/contract/src/log.ts) |
| The server's side | [`server/src/labs.ts`](../server/src/labs.ts), [`server/src/auth.ts`](../server/src/auth.ts), [`server/src/sync.ts`](../server/src/sync.ts) |

## Starting and joining a lab

**Starting.** **Start a lab** makes the lab's record on the device, with the person as its custodian, and registers it with the server under its name and id. The person who starts a lab is its PI. On the server their token has the role `admin`.

**Joining with an invitation.** The PI presses **Make an invitation** on the Lab tab and gets one line:

```text
<server>/join/<lab id>#<code>
```

The other person pastes it into **Join a lab** and is in at once.

| Invitation | Default | Most |
|---|---|---|
| Uses | 1 | 100 |
| Days it lasts | 7 | 90 |

- Only the PI can make one, list them or revoke one.
- A wrong, used-up, revoked or expired line is refused, and the person is told to ask for a new one.
- The server keeps a hash of the code, not the code.

**Joining by asking.** A person can instead ask to join with the lab's identifier. The PI sees the request on the Lab tab and accepts or declines it. The asking device checks back, and once accepted it pulls the lab's records and joins.

**Order does not matter.** A person can be accepted before the PI's device has sent the lab's own record. They are joined when that record arrives.

**Tokens.** Joining gives the device a member token. The server keeps only its hash. The device keeps the link to the lab, with its token, in storage that does not travel with the vault. Every request to the lab carries the token as `Authorization: Bearer`.

## What the PI sets

The lab's record carries settings that every member inherits after their next exchange. Only the PI can change them. A member who tries is told so.

| Setting | What it is |
|---|---|
| The lab's shelf | One Zotero group. Its items have the same address for every member |
| Servers | Model servers the lab offers, each with a name and an address. They appear in each member's own list of servers |
| First choice | Which of those a member's reading and questions go to first. A member can choose otherwise |
| Reach | How far the lab's work may travel to be read by a model: `device`, `lab` or `anywhere`. In a lab the default is `lab` |

**Reach** is checked in two places.

| | `device` | `lab` (default) | `anywhere` |
|---|---|---|---|
| Reading a paper on this computer | Allowed | Allowed | Allowed |
| Reading a paper on the lab's server or one the lab lists | Refused | Allowed | Allowed |
| Reading a paper on any other server | Refused | Refused | Allowed |
| Asking a model on this computer | Allowed | Allowed | Allowed |
| Asking through the lab's server | Refused | Allowed | Allowed |
| Asking a hosted provider with your own key, sent from this device | Refused | Refused | Allowed |

A refusal happens before anything is sent, and says why. Two sends are not covered by reach: see [what-leaves-the-device.md](what-leaves-the-device.md#notes).

**The lab's types.** A lab has one grammar, its PI's. When a member joins, each of their types that the lab also has gives way to the lab's and is read as the lab's from then on. Only the PI changes the lab's types and relation types. A member can add types of their own beside them.

## What is shared

A canvas is shared with the lab by **sharing** it, or by sharing a paper, which shares its canvas. Each exchange sends:

| Sent | Notes |
|---|---|
| The lab's record | With its settings |
| Person records this device holds | A person's record proves their signing key |
| Memberships, in every version | So a removal is seen to follow what it ended |
| Device records that let a device in or remove one | A device still waiting to be let in is not sent |
| The lab's types and relation types | |
| Each shared canvas | Including one its owner removed |
| Every version of each card on a shared canvas | Not only the one that stands, so each device can tell a change made after a removal from one made apart from it |
| The units on those cards | |
| The source each of those units was read from | Even when the source has no card |
| Relations drawn on a shared canvas | |
| Withdrawals of shared units and relations | |
| The paper record of a shared paper canvas | |
| Reactions, notes and checks on shared units | |

**What stays on the device**

- A unit with no card on a shared canvas.
- A relation between two shared units that is not drawn on a shared canvas.
- Anchors and decisions, which describe one device.
- Anything an agent's key signed. What a person accepted from an agent is a record of their own, and travels like any other.
- Everything, from a device that has not been let in yet.

**Taking a card off.** The removal is sent, so labmates stop seeing the card. After that the unit's later versions stay with its author. The one exception: if the author removes the unit itself, that removal is sent, so nobody keeps a unit that no longer exists.

**A member's relation on someone else's canvas** is drawn on the lab's shared canvases too, so it reaches everyone.

## The exchange

[`startLabSync`](../packages/sync/src/lab-sync.ts) runs one round when it starts and then one every four seconds, on a device that holds a member token.

1. **Prepare.** The device checks that labmates will take what it signs. If not, it sends nothing this round. Anything of the person's own that is about to be shared and has no signature is signed.
2. **Push.** Every shareable version not yet sent goes to the server in one request. The server keeps each distinct record once, by a hash of its content, and gives it the next sequence number. It refuses a request in which any item lacks `id`, `kind`, `at` or `by`.
3. **Pull.** The device asks for records after its cursor, 100 at a time by default and 1,000 at most, until the server says there are no more.
4. **Clock.** Every answer carries the server's time.

A failed round is retried on the next tick. Rounds never overlap. The cursor and the list of what was sent are kept in memory, so after a restart a device pushes and pulls everything again. Both sides ignore what they already hold.

There is no switch that pauses the exchange. It stops when the device is no longer in a lab.

## Taking records in

Every arriving batch goes through three checks in [`core/labs.ts`](../packages/core/src/labs.ts) before it reaches the log.

1. **Shape.** Anything that is not a well-formed record is dropped and counted.
2. **Signature.** [`checkSignatures`](../packages/core/src/signing.ts) sorts the rest:

   | The record | What happens |
   |---|---|
   | Its writer's keys are known, and it carries a signature from one of them | Kept |
   | Its writer's keys are known, and it does not | Refused and counted |
   | It names the key that signed it (`sigBy`), and that key is not one of the writer's or the signature fails | Refused |
   | It was signed by an agent's key | Refused. What an agent proposed never arrives from a lab |
   | It is a device asking to be let in, signed with its own key | Kept. It says only that someone asked |
   | Its writer is a lab member whose own record has not arrived | Held, up to 5,000 records, and checked with the next batch |
   | Its writer is nobody the lab has a key for | Kept. They cannot be checked, and cannot pass for a labmate either |

3. **Standing.** The fold then decides whether each kept version may stand. See the next section.

The Lab tab says how many records were refused and whose they were, so someone can tell that person to update their app. An app that does not sign still receives everything. Once it is updated, its next change carries its earlier work, signed.

A kind of record or a field this app has never heard of is kept in the log untouched and is not misread.

## Which version stands

All of these rules are in [`contract/fold.ts`](../packages/contract/src/fold.ts).

**One version replaces another.** A version that names another as its `prev` beats it. Only versions made apart, neither replacing the other, go to a tie-break.

**The tie-break**, in order:

1. For a card on a canvas, an edit beats a removal made apart from it. Taking a card off removes only what its remover had seen, so nobody's move or rewording is lost to a race. Whoever removed it can remove it again.
2. For a membership or a device, a removal beats an edit made apart from it. Access is never kept by a race.
3. The later edit time.
4. The higher count of edits.
5. The editor's id, then a signed version over an unsigned one, then the record's content. So every device picks the same winner.

**Who may change what**

| Record | Who may write a version that stands |
|---|---|
| Any record | An id carries its author's DID, so a record cannot be made under someone else's name |
| A lab, a type, a relation type, a person, a check, a device | Its author only |
| A unit | Its author. A labmate may add facts to it, such as where its PDF is. Their version stands only if it keeps the title, does not remove the unit, and replaces a version that stands |
| A membership | Its member. The lab's custodian may end it. Once the custodian has ended it, the member cannot bring it back: coming back is a new membership |
| Anything signed by an agent's key | Only a unit, a relation, a check or a device record, and only as something new or a change to what that agent proposed. It is read as a proposal, apart from the graph, until a person accepts it |

A version by anyone else is kept in the log and never read.

**Merging is by whole record.** Two people who change different things on one card, such as its place and its size, while apart, keep only one change.

**A card whose unit is gone is not shown**, nor are its lines. This covers one person removing a unit while another moves its card.

## Signing and devices

**A person's key.** A person's DID is a `did:plc`, computed on the device as the hash of its first signed operation. That operation names the signing key (P-256). So a person's own record is enough to check their signature. Nothing is looked up or registered anywhere.

**What is signed.** Each version is signed over its canonical JSON, without the signature itself. When a device key signs, the record names that key in `sigBy`, and the name is part of what is signed.

**A key per device.** The key a DID was made with stays on the device that made it. Every other device has a signing key of its own, written as a `did:key`.

1. A new device writes a device record asking to be let in, signed with its own key. Until it is let in it sends nothing to the lab.
2. On a device already trusted, the person approves it. That device signs the new key (a vouch).
3. Labmates follow the chain of vouches from the person's first key. A key at the end of an unbroken chain may sign as that person.
4. A lost device is removed from a trusted device. What it signed before stays as it was taken in.

Approving takes a deliberate press on a trusted device. Someone who can only write into the vault's files can ask, and cannot approve.

**Agents.** An agent's key is a device record with the role `agent`. It is let in and removed the same way. It cannot vouch for another device, nothing it signs is sent to a lab, and everything it signs is read as a proposal. See [mcp.md](mcp.md).

**The Lab tab** lists this person's devices with their state (trusted, waiting or removed) and the last eight characters of each key.

## Clocks

Every exchange carries the server's time. A device more than two seconds off stamps its records with the difference added. Smaller differences are left alone.

- The correction is kept across restarts.
- A device never stamps earlier than its own last stamp, so a clock set back cannot reorder its own work.
- A new version is never stamped before the one it replaces.
- The Lab tab says when this computer's clock is off and by how much.

A device whose clock goes wrong and that has not exchanged since stamps wrong until it does.

## Removing a member

Only the PI can remove a member.

1. The server stops serving their token.
2. Their membership ends in the lab's records, so every member's copy agrees on who is in.
3. Their own device finds out the next time it asks the server anything, and the Lab tab tells them.
4. On their device, what the lab's other members shared is put away: out of the graph, and its notes moved to the base's trash. Their own work stays, and their own grammar comes back.
5. Their device sends nothing more to the lab.

A new invitation lets them back in, and what was put away returns.

What was sent cannot be unsent. The records are still in the removed member's log.

## Device logs on disk

In Obsidian a vault's records are in `discourse-graph/records/`, one `.jsonl` file per device, one record per line. A device only ever appends to its own file. The device's id is kept on the device, not in the plugin's data file, so two devices sharing a vault never write to one log.

Between a person's devices these files are carried by whatever syncs the vault. [`contract/log.ts`](../packages/contract/src/log.ts) is the one reader, used by Obsidian and the local app. It never repairs or rewrites a log.

| In the file | What the reader does |
|---|---|
| A last line with no newline after it | Leaves it for the next read. It may still be mid-write |
| A line cut short, two records run together, a merge marker | Skips and counts it |
| A repeated stretch | Reads it. Reading a record twice changes nothing |
| Windows line endings, a byte-order mark | Reads past them |
| A file that was replaced, shortened or joined with another | Reads it again from the top |

## Shelves, breadcrumbs and the paper repository

- **The lab's paper repository** is on the lab server. Sharing a paper sends its title, file name, DOI, the model, schema and server that read it, who extracted and uploaded it, and its graph. The file goes only when ticked. A member gets a file with **Get the file**.
- **Shelves.** Which shelf a paper is on, and who can open its PDF, is described in [zotero.md](zotero.md#a-labs-shelf-and-your-own-library).
- **Breadcrumbs.** Closing the canvas of a lab paper someone else uploaded can leave the person's name against it. The choice is ask, always or never. The default is to ask.

## The simulation

`harness/four-vaults.ts` runs several people in one process and checks what they end up with.

```bash
npm run sim
```

```bash
node harness/four-vaults.ts --seed 7 --steps 400
```

| Flag | Default | Meaning |
|---|---|---|
| `--seed` | `1` | The seed for the random walk, and for time, ids, keys and signatures |
| `--steps` | `200` | How many steps the walk takes |
| `--strict` | off | Exit with a failure if any expectation breaks. `npm run sim` sets it, and CI runs that |

It prints one line per expectation and writes `reports/four-vaults/report.md` and `report.json`, which are not kept in git.

### What runs

| Part | What it is |
|---|---|
| Each vault | The real core on the in-memory base, the real services client and the real sync loop |
| The lab server | The reference server from `server/`, on a port of its own, restarted mid-run |
| The door | Each vault's network goes through one door. It lets through the lab server, answers for that person's own stand-in Zotero, refuses everything else, and records everything sent |
| The cast | Mira, the PI, on two computers. Tomas, a member who reads from Zotero. Ines, who joins late and for a while runs an older app. Kofi, in another lab on the same server. An agent that reads Mira's vault and proposes |
| Time and chance | One clock and one seeded source of chance for the whole run |

Nothing leaves the process. The code is in [`harness/vaults/world.ts`](../harness/vaults/world.ts) and [`harness/four-vaults.ts`](../harness/four-vaults.ts).

### What it checks

| Area | The question |
|---|---|
| Convergence | After everyone has exchanged, do they see the same canvas? |
| Privacy | Did anything private leave its device, or reach someone it should not? |
| Intent | Did the outcome match what the people meant? |
| Liveness | Does syncing finish, and then go quiet? |
| Membership | Does everyone agree who is in the lab? |
| Integrity | Is what a vault holds whole and honest? |

### The stages

1. A lab forms, and a member joins with an invitation.
2. Private work stays on its own device.
3. The PI shares a canvas, and a member gets it whole.
4. A member adds to the PI's canvas.
5. Two people change the same thing while apart.
6. A member joins late. What the PI sets, every member inherits. The PI opens her vault on a second computer, with the log carried between them through the file faults listed above. An agent reads her vault and proposes.
7. A member checks the PI's claim.
8. A member brings evidence from a paper in Zotero. The lab's shelf and a person's own.
9. A member is offline for a while, and the server restarts. An older app and a newer one share the lab.
10. A stranger, and a member who misbehaves.
11. The PI takes the canvas back.
12. A random walk by three people. The PI removes a member, and invites them back.
13. The same records read the same in any order, with repeats.
14. The same seed leaves every vault with the same records, byte for byte, signatures included.

### Other tests

| What | Where | Run |
|---|---|---|
| What a vault chooses to send | `test/lab-share.test.ts` | `npm test` |
| The exchange loop, the fold, versions, identity and the log reader | `test/sync.test.ts`, `test/records.test.ts`, `test/versions.test.ts`, `test/identity.test.ts`, `test/log.test.ts` | `npm test` |
| The server's lab, token, invitation and sync routes | `server/` | `npm run test:server` |
| A real Obsidian in a lab run by simulated people, with the server in its own process | `harness/lab-real-test.mjs` | See [testing.md](testing.md) |

## Limits

- **One lab per device.** A device holds one link to one lab.
- **The reference server is not hardened.** It has no TLS and no rate limits. See [services.md](services.md).
- **Not run:** several real Obsidians in one lab at once, and a real file-sync tool carrying the logs. The file faults are applied to the text in the simulation.
- **The door refuses a request.** It does not drop, repeat or reorder one.
- **A writer nobody in the lab has a key for cannot be checked.**
- **A lab is only as current as its oldest app,** for what that app writes: unsigned records are refused.
- **Leaving a lab by choice and unsharing a canvas** have no button. A removed canvas is sent as removed.
- **A log only grows.** Nothing compacts it.
- **Roam and Logseq** have not been run in a lab with this harness.

## Not built

Merging by property, a labmate's computer taking model work through the lab server, more than one lab per person, and AT Protocol's permissioned spaces as the lab's transport are not built. See [ROADMAP.md](../ROADMAP.md).
