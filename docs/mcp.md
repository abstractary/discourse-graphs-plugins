# The MCP server: design

A design, not yet built. It replaces section 3 of [llm-and-mcp-spec.md](llm-and-mcp-spec.md), which was written before labs had invitations, signed records, device keys and a reach setting. Written 13 November 2026.

It was reached by two sweeps. One went up from what the core can already do. The other came down from what people would ask an agent for. Where they met is the tool set. Where they didn't is a list of changes to the rest of the software, at the end.

## What it is for

A person already works with an agent: Claude, ChatGPT, Claude Code, Cursor. Today that agent can't see their discourse graph. The server lets it read the graph and propose additions.

It is not a way to edit the graph. **An agent proposes and a person decides.** Nothing an agent writes is accepted, shared, published or exported by the agent.

## Sweep one, bottom up: what the core offers

The core answers 161 calls from its panels. Sorted by what they do:

| Kind | Count | What an agent should get |
|---|---|---|
| Reads | 59 | Most of what they return, through six tools. An agent needs the content, not the panel's shape |
| Writes | 80 | Three of them, turned into proposals. The rest never |
| Opens or moves something on screen | 22 | None. An agent doesn't drive the person's screen |

The 80 writes, by what should happen to them:

| Writes | Calls, for example | For an agent |
|---|---|---|
| Add to the argument | `node.create`, `relation.assert`, `pdf.cut`, `evidence.fromOutput`, `candidate.promote` | **Proposals.** This is the whole of what an agent may write |
| Say a unit holds up | `unit.check` | **A proposed check.** An agent's reading can be useful to the person who signs. It is never a sign-off |
| Change someone's words or remove things | `node.rename`, `node.remove`, `relation.withdraw`, `canvas.remove` | Never. These are the author's |
| Decide | `relation.decide`, `device.approve`, `lab.decide`, `lab.remove` | Never. Deciding is what the person is for |
| Arrange | `canvas.write`, `canvas.setLayout`, `units.put` | Not in the first version. An arrangement is a person's reading of the argument |
| Send outward | `canvas.share`, `crate.export`, `crate.deposit`, `notify.send`, `paper.share` | Never. See "No way out" below |
| Settings, labs, devices, grammar | `lab.configure`, `grammar.save…`, `ai.configure`, `prefs.set` | Never |
| Run a model | `paper.extract`, `ai.ask` | Never. The agent is the model. The server never asks one to work for it |

What the sweep showed that the earlier design missed:

- **Proposal is three half-built things.** A relation can be `proposed` and waits for Accept or Reject. A unit read from a paper is `staged` until exported. A line tagged in a note is a candidate until promoted. A check can't be proposed at all. An agent needs one idea of a proposal that covers units, relations and checks.
- **A paper's text isn't in the core.** The reader draws a PDF in its own panel and finds passages there. The core holds the units and their quoted words, and never the pages. An agent asked to read a paper needs the text from somewhere.
- **Everything about who may see what is already in the fold.** Scopes, what a lab shares, what was put away after leaving a lab. A server that reads the graph through the same core inherits all of it and can't get it wrong separately.

## Sweep two, top down: what people would ask for

The first users are a lab member and a PI. The jobs below are theirs, then one for each group on the market map that has a different need.

| Who | They ask the agent | It needs to read | It proposes | Missing today |
|---|---|---|---|---|
| Lab member | "Read this paper and pull out what bears on my question" | The paper's passages. The question and the claims under it | Evidence, each from a quoted passage. Claims. Relations to what is already there | The paper's text |
| Lab member | "What supports this claim, and what cuts against it?" | A claim with its chains of support and opposition, and whether each has been checked | Nothing, or relations it found missing | None |
| Lab member | "What's missing before I show this?" | The gaps on a canvas: evidence with no source, claims with no evidence, runs with no protocol | Nothing | None |
| Lab member | "Does anything in the lab's other canvases bear on this?" | Search across what the lab shares | Relations between canvases | None |
| PI | "Go through what Tomas added this week and tell me what to look at" | Units by a person and a time. Their checks | A check on each, with its reasons, for the PI to accept or not | Search by person and date. Proposed checks |
| PI | "Is this claim ready to go in the paper?" | The claim's whole chain down to runs, code and outputs, with what is unchecked or has changed since it was checked | Nothing | None |
| Reader of the literature (AI reading tools) | "Compare how these three papers measured it" | Protocols and runs across papers | A canvas's worth of relations | None |
| Notebook user (lab notebooks, code notebooks) | "Turn this notebook's results into evidence" | A run and its outputs | Evidence resting on outputs | None |
| Writer (open publishing) | "Draft the methods paragraph from these runs" | Runs, protocols, their parameters | Nothing: the draft is the agent's reply | None |

What this sweep showed:

- **Reading matters more than writing.** Five of nine jobs propose nothing. The read tools are the product.
- **Every job starts from one unit or one canvas and walks outward.** Nobody asks for "all units". So the central read is "this unit, and what is around it, to a depth".
- **Evidence without its passage is worthless.** A proposed piece of evidence must carry the exact words and where they are, and the server must check that the words are really there.
- **The PI's jobs are about people and time,** which no tool in the earlier design could answer.

## Where the sweeps meet: ten tools

The earlier design had sixteen. Current guidance, and our own reading of the jobs, says fewer and larger: a tool for each thing a person would ask, not one for each call the core has.

### Read

| Tool | Answers | Built from |
|---|---|---|
| `dg.search` | Units matching words, a type, a paper, a person, a time, an identifier (DOI, ORCID iD, RRID, a Zotero address), or a scope. The same ranking as the search panel | `search.query`, `node.query`, `profile.view` |
| `dg.unit` | One unit and what is around it, to a depth: its words, type, who made it and when, identifiers, the passage it was read from, its relations with their state, its checks and whether they still hold, its method chain, its gaps, and whose shelf its paper is on | `node.view`, `process.method`, `unit.related` |
| `dg.argument` | For a claim or a question: each chain of support and opposition down to evidence and runs, what is contested, and what is unchecked or has changed since it was checked | `holon.view`, `process.method`, checks |
| `dg.canvas` | The canvases, or one canvas: its units and relations, compact, with its gaps | `canvas.list`, `canvas.open`, `canvas.summaries` |
| `dg.paper` | The papers, or one paper's passages by page, each with an id to quote from. Says whose shelf the paper is on and whether its file can be read here | `paper.list`, `pdf.list`, new text service |
| `dg.grammar` | The lab's types and relations, which pairs each relation may join, and the rules the gaps come from | `grammar.get`, the process shapes |

### Propose

| Tool | Writes | Checked by the server before anything is written |
|---|---|---|
| `dg.propose_units` | Up to twenty units at once. Each names its type and what it rests on: a passage (paper, page, exact words) or existing units | The type is in the grammar. For a passage, the exact words are found on that page, or that unit is refused. A unit close in wording to one that exists is returned for the agent to use |
| `dg.propose_relations` | Up to forty relations between units that exist or were just proposed | Each pair fits the grammar. A relation that already stands is returned, not repeated |
| `dg.propose_check` | A reading of one unit: holds up or needs work, how it was checked, and why. Pinned to the unit as it stood | The unit hasn't changed since the agent read it |

### Follow up

| Tool | Answers |
|---|---|
| `dg.proposals` | What became of what this agent proposed: accepted, turned down or waiting, with the person's note if they left one. So an agent can learn what this person takes |

Every tool says what it returns in a schema. Every result carries each unit's id, its words, and a link that opens it in the app. Results are paged, short by default, and say how to narrow a search that found too much.

**Also offered:** each unit, canvas and page as something a client can attach (`dg://unit/…`, `dg://canvas/…`, `dg://paper/…/page/…`). And four ready instructions a person can pick from their client: read this paper, check this claim's support, find what's missing on this canvas, go through what a labmate added. Those four are the skills in [agent-skills-and-hooks.md](agent-skills-and-hooks.md).

**Left out on purpose:** accept, reject, remove, reword, arrange, share, export, publish, anything that runs code or a model, anything that fetches an address, and anything that returns a key.

## Proposals

One idea, where there are three half-ideas today.

- **A proposal is an ordinary record marked `proposed`,** signed by the agent's own key. Units, relations and checks can all carry it.
- **It lands in the person's own space,** never on a shared canvas, even when what it adds to is shared. A person who accepts it and puts it on a shared canvas has shared it. The agent hasn't.
- **Nothing proposed is read as part of the argument.** It doesn't count as support, doesn't fill a gap, doesn't show on a card as checked. It shows in one place: a review list, grouped by the conversation it came from.
- **The person accepts, changes or turns down,** one at a time or a whole conversation's worth. Accepting makes a new record of the person's own, saying which proposal it came from. The proposal stays in the log as what the agent said.
- **What a model wrote stays marked.** An accepted unit says it began as an agent's proposal, as a unit read from a paper says which model read it. Profiles already count such units apart from what a person wrote.

## Who the agent is

An agent is one more key that may sign for a person, like a second computer, with less it may do.

- Installing the server makes a key for it. It shows on the Lab tab under **Your devices** as an agent waiting to be let in. The person presses **Let it in** on a device they already use. This is the flow that exists for a second computer today.
- Its role is `agent`. The record kind for this already exists. **What an agent's key signs is only ever read as a proposal,** whatever the record says about itself. That rule is not built: see the changes below.
- Removing it is the same press as removing a lost laptop. Its proposals stay as what was said. Nothing new from it is taken.
- A lab's other members check its signature through the person's own, as they would a second computer's. They only ever receive what the person accepted, which is the person's.

## What it may read

- **It reads what its person can read,** through the same fold, so scopes, shared canvases and work put away after leaving a lab all hold without a second set of rules.
- **The lab's reach covers it.** An agent's reading goes to whatever model its client uses. A lab that keeps its work on members' own computers has said that model must be local. So the server serves a lab's shared work only when the lab's reach allows the model on the other end, and serves the person's own work otherwise. The person says, when letting the agent in, whether its model runs on this computer.
- **It starts narrow.** Own work only, until the person widens it for that agent.

## No way out

An agent that reads private notes and unpublished papers, reads text someone else wrote, and can also send something outward, can be told by a paper to leak. The server takes away the third.

- No tool shares, exports, publishes, notifies or fetches.
- A proposal can't land on a shared canvas.
- A link back into the app carries an id and nothing an agent wrote.
- Paper text and unit text come back marked as quoted material, with an instruction to the client to treat it as data. That lowers the risk. It doesn't remove it, which is why the three points above don't rely on it.

## Where it runs

**Beside the base, reading and writing the vault's record log, one server for each vault.** This was the earlier recommendation and today's work strengthens it:

- The local app is already this: a process that folds a vault's log through the same core and writes a log of its own. The server is that process with a different front.
- A vault's log now tolerates another writer, bad lines and all, and each writer has its own key.
- The plugin opens no port, and the server works with the base closed.
- One vault, one server, one key. The current MCP revision has no sessions, so "which vault" can't live in a connection. It lives in which server was started.

Two ways in, from one program: **stdio** for desktop clients, which opens no port at all, and **HTTP on this computer only** for clients that need an address, with the origin checked and a token required.

It targets the **2026-07-28** revision: no handshake, no session, every tool with an output schema, confirmations returned as a result for the client to answer. Sampling is deprecated there, and nothing here uses it.

## Safety, in one table

| Risk | What stops it |
|---|---|
| An agent reads more than it should | It reads through the person's own fold, starts with their own work only, and the lab's reach decides the rest |
| A paper instructs the agent | No tool sends anything outward, and proposals stay private until a person moves them |
| A made-up quote | The words must be found on the page, or the unit is refused |
| An agent fills the graph | Limits on each call and each hour. Proposals are grouped by conversation, with one press to turn a whole group down |
| An agent's record passes for a person's | Its key's role makes everything it signs a proposal, checked where records are read |
| A web page calls the server | stdio by default. Over HTTP: this computer only, origin checked, token required |
| Nobody can tell what an agent did | Every call goes in the usage log on the device: which tool, which ids, never the content |

## What this changes in the rest of the software

The sweeps didn't only produce tools. Each of these is a gap they exposed, and most are worth closing whether or not the server ships.

| # | Change | Why the server needs it | What else it improves |
|---|---|---|---|
| 1 | **One kind of proposal** for units, relations and checks, with one review list | An agent's whole output is proposals | Extraction, tagged lines and a labmate's suggestions could all use the same list, in place of three |
| 2 | **A record says which key signed it** | To hold an agent's key to proposals | Says which device wrote what. Lets one device be removed without doubting the rest |
| 3 | **A key's role is enforced where records are read** | The rule that makes an agent safe | Roles for other limited keys later, such as a notebook's |
| 4 | **Paper text by page, kept beside the paper** once it has been read | "Read this paper" | Search inside papers. Checking a quote without opening the reader |
| 5 | **Search by person and by time** | The PI's jobs | The profile and "what's new" views |
| 6 | **"What has changed since it was checked", as one question** | "Is this ready?" | A PI's dashboard |
| 7 | **Reach asked of every route a model can be on,** not only extraction and Ask AI | An agent's client model is a route too | One place that answers "may this text go there?" |
| 8 | **Review at volume:** grouped by conversation, with accept and turn down for a whole group | Fifty proposals from one sitting | Reviewing a whole extraction |
| 9 | **A unit can open from a link** given an id | Results link back into the app | Sharing a pointer to a unit with a labmate |

## How it will be tested

- **The four-vault simulation gains an agent for each vault.** It already runs four cores, signs every record and reads what crosses the wire. With agents: nothing an agent proposed leaves its vault, every proposal carries the agent's signature, a labmate's vault refuses an agent's record that isn't a proposal, and removing an agent stops it.
- **A protocol check** with the MCP project's own conformance suite, against the server on stdio and on HTTP.
- **Whether a model picks the right tool** is measured, not assumed: the nine jobs above as tasks, scored on whether the right tools were called and how many calls it took. The tool list is changed until the jobs go through cleanly.
- **A paper that tries to instruct the agent** is one of the fixtures.

## Build order

1. Changes 1, 2 and 3: proposals, signing key named, role enforced. Nothing an agent does is safe before these.
2. The six read tools over the local app's host, on stdio. Useful by itself, and no write path yet.
3. Change 4, paper text, then `dg.paper`.
4. The three propose tools, the review list (change 8), and `dg.proposals`.
5. Agents in the simulation, the conformance run and the job tests.
6. HTTP on this computer, packaging for one-press install.

## Positions taken, for the product owner to overturn

1. Ten tools, not sixteen, and not a mirror of the core's calls.
2. Every write is a proposal, and a proposal never lands on a shared canvas.
3. An agent is a device key with the role `agent`, let in and removed like a second computer.
4. An agent reads its person's own work until widened, and the lab's reach governs the rest.
5. The server runs beside the base, one for each vault, stdio first.
6. A proposed check exists, and is never a sign-off.

## Still open

1. Whether an agent may arrange a canvas, as a proposed canvas, in a later version.
2. Whether the person or the PI decides that an agent may read the lab's shared work.
3. Whether paper text may reach a model off this computer for a paper marked as licensed full text.
4. Whether to list the server in the public registry. A listing can be hidden and never fully withdrawn.
5. Whether a review list for agents and the candidates list in Search become one list (change 1 assumes yes).

## Sources

The specification's [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog). Anthropic's [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents). The official project's earlier [read-only server](https://github.com/DiscourseGraphs/discourse-graph-mcp), archived in September 2026. The research summaries in [four-vaults.md](four-vaults.md) and [tooling.md](tooling.md).
