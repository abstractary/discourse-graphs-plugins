# The process side: protocols, steps, experiments, runs and outputs

A design, not yet built. Written on 14 November 2026 from the product owner's answers that day and from the code as it stands. Mock screens are in [mocks/process-and-sign-in.html](mocks/process-and-sign-in.html).

The argument side answers "what do we think, and why". The process side answers "what was done to find out". They meet at one link: evidence rests on an output, an output was made by a run, a run followed a protocol and belongs to an experiment.

## What was decided

| Question | Answer (14 November 2026) |
|---|---|
| Whose happy path first | All four: a bench scientist planning, a computational scientist after the fact, a reader of a paper's methods, a PI reviewing a claim |
| What a step is | A unit of its own: reusable, linkable, publishable |
| A reused step that changes | The protocol keeps the version it was written with and says the step has changed, with a way to update. The same rule a run follows for its protocol |
| Where a process unit opens | A page that pops up over the canvas, as a task does in ClickUp |
| What the page holds | A **process canvas**: a sister to the argument canvas, with rounder nodes |
| Borrowed from ClickUp | Subtasks as steps: steps listed as rows under the protocol, each opening as its own page in the same pop-up. Not the activity column, the board or timeline, or custom fields |
| During a run | Check off steps live, note a deviation at a step, fill in the values a step asks for, attach an output to the step that made it, and see a Jupyter notebook's outputs |
| Log in with Bluesky | Design only for now, with dummy steps and screens to ground it |

This changes one earlier decision. On 12 November a unit became a leaf that never opens as a graph of its own. That still holds for questions, claims, evidence and sources. A protocol, an experiment and a run now open as a page with a process canvas inside.

## What exists today

- **Five process types** on five of the nine bases: Protocol, Experiment (base `study`), Run, Code, Output.
- **Facts on each**, in `UnitFacts`: a protocol's version, parameters, materials and its steps as a list of short names; an experiment's hypothesis, design, conditions and variables; a run's status, times, condition, parameter values, deviations (one list for the whole run), environment and fingerprint; an output's CID, media type and locator.
- **Pins.** A run names its protocol and code by id and by CID, and says "changed" or "missing" when they drift. Evidence pins its output the same way.
- **Reading.** A run page beside the canvas, a Method section in Context, and gaps on a claim: single run, single method, drift, stale output, failed runs.
- **Coming in.** A Jupyter notebook becomes Code, a Run and Outputs. Extract graph reads protocols and runs out of a paper.
- **Missing.** No way to write a protocol step by step, no steps as things, no flow, no way to carry out a run, no per-step record, nothing that opens over the canvas.

## The four happy paths

**1. Planning at the bench.** Mira opens her lab canvas, adds an Experiment under a question, and writes its hypothesis and conditions. She clicks it and the page opens over the canvas. She adds a Protocol to the experiment and builds its flow: a step, then a step, a branch for the two conditions. Two steps come from the lab's existing steps, found by typing their names. She presses **Start a run**, picks a condition, and the page becomes a checklist of the same steps. At each step she ticks it, types the volume she actually used, and at step four writes "incubated 40 min, not 30". She drops the gel photo on the imaging step. She ends the run. On the canvas she drags from the photo's output to a new evidence card.

**2. Computational, after the fact.** Tomas imports a notebook. Today that gives Code, a Run and Outputs. New: the run's page shows the notebook's cells as its steps, in order, each with the outputs it made, drawn as the notebook drew them. If the notebook's headings match a protocol's steps, the cells are grouped under those steps; if not, they stay one flat list and he can drag a cell group onto a step. He marks one output as what shows the result and makes evidence from it.

**3. Reading a paper's methods.** Dana extracts a paper. Its protocols arrive with steps where the methods section lists them. Clicking a protocol card on the PDF canvas opens the page: the flow as the paper told it, each step leading back to its passage in the PDF. A PDF canvas stays as read, so the flow is read-only until she presses **Build on it**.

**4. A PI reviewing a claim.** From a claim, Context already lists what it rests on. **Open the run** now opens the run's page over the canvas: the protocol's flow with each step coloured by how this run went (done, deviated, skipped, failed), the deviations in place, the values used beside the values the protocol asked for, and the outputs on the steps that made them. A step that has changed since the run says so.

## Necessary features

In build order. Each line stands alone.

1. **Step as a type.** A tenth base, `step`, with label "Step" and abbreviation "STP". Its facts: what to do (the title), duration, the parameters it asks for, materials, and a caution.
2. **A protocol's flow.** The protocol holds its flow: steps pinned by id and CID, and the arrows between them, each with an optional condition ("if cloudy"). The old list of step names is read as a straight flow with no pins.
3. **The page over the canvas.** One pop-up shell, used by Protocol, Step, Experiment, Run and Output. A breadcrumb (experiment › protocol › step), the title, the type's facts, then the body. Escape or a click outside closes it. Opening a row inside it swaps the page in place and the breadcrumb grows.
4. **The process canvas.** Inside a protocol's page: the flow as nodes. Add a step, drag to connect, drop an existing step in from a finder, reorder, branch. Below it, the same steps as rows (ClickUp's subtasks): order, title, duration, and a mark when the step has changed since it was pinned.
5. **An experiment's page.** Hypothesis, design, conditions and variables as facts; its protocols; its runs as rows with status, condition, date and who.
6. **Carrying out a run.** **Start a run** from a protocol or an experiment. The run pins the protocol and every step. Its page is the same flow in run mode: tick, skip or fail a step; say what was different; fill in the values the step asks for; drop a file on a step. A run can be paused and picked up on another device.
7. **Outputs on steps.** A dropped file becomes an Output pinned by its bytes, made by this run at this step. A notebook's outputs show on the run page as the notebook drew them.
8. **Notebook cells as steps.** A notebook run's cells group under protocol steps by heading, or by hand.
9. **Review marks.** A run's flow coloured by outcome; a claim's gaps gain "deviated at a step" and "a step changed since".
10. **From a paper.** Extraction fills a protocol's flow when the methods give steps, each with its passage.

Left out on purpose: a board or timeline of runs, an activity column, assigning steps to people, scheduling, inventory, instrument control.

## Information architecture

| Thing | What it is | Where it lives | Opens as |
|---|---|---|---|
| Experiment | A design: what is varied and what is expected | A card on an argument canvas, under a question | Page: facts, protocols, runs |
| Protocol | A plan: a flow of steps | A card on an argument canvas, or a row on an experiment's page | Page: process canvas, then steps as rows |
| Step | One thing to do | A node on a process canvas and a row beneath it. Never a card on an argument canvas unless a person puts it there | Page: what to do, parameters, materials, the protocols that use it |
| Run | One carrying-out of a protocol | A card on an argument canvas, or a row on an experiment's page | Page: the protocol's flow in run mode, then outputs |
| Output | What a run made | A card, or a thumbnail on the step that made it | Page: the file or picture, its CID, the evidence that rests on it |
| Code | What a run executed | As today | As today, in the page shell |

**Words.** "Experiment" stays the label for base `study`. "Process canvas" is the node view inside a page; "canvas" alone stays the argument canvas. "Step" is never "task" or "subtask". "Start a run", "End the run". A step's state in a run is one of: to do, done, skipped, failed. "Deviation" is what was done differently, in the person's words.

**Two canvases, one grammar of looks.** The argument canvas keeps square-cornered cards. Process nodes are rounder, a pill for a step and a soft rectangle for a protocol or run, so a glance tells which side you are on. Colours stay by type, from the measured palette. Arrows on a process canvas mean "then" and carry no relation label unless they branch.

**Where the two sides touch.** Evidence → output is drawn on the argument canvas, as today. Everything beneath an output (run, step, protocol, experiment) is reached by opening pages, not by more cards, so an argument canvas does not fill with process.

## Interaction

- **Open.** A single click on a card still only selects it, as decided for cards. The page opens on Enter, on double-click, or on the card's open button. On a process canvas a single click on a node opens that step's page, because there a node has nothing else to do.
- **Build a flow.** **Add step** appends after the selected node. Typing in the add box searches existing steps first; Enter with no match makes a new one. Dragging from a node's edge to another draws "then"; a second arrow out of a node asks for the condition on each.
- **Reuse.** A reused step shows how many protocols use it. Editing it asks: change it everywhere it is not pinned, or make a copy for this protocol. Protocols that pinned the old version show "Step changed" with **See what changed** and **Update**.
- **Run mode.** The flow is the same picture with a tick box on each node and the current step enlarged. Space ticks the current step and moves on. A value field shows the protocol's default in grey; typing replaces it. **Something different?** opens one line for the deviation. A file dropped anywhere on the page lands on the current step.
- **Rows mirror nodes.** Selecting a row lights its node and the reverse. Reordering rows rewires a straight flow; it is refused, with a reason, where the flow branches.
- **Nothing is lost on close.** Every tick and value is a record as it is made. Closing the page mid-run leaves the run "running", and the card says so.

## Software architecture

**Records.**

- A new base `step` in `BASE_NODE_TYPES`; `ensureProcessTypes` adds the Step type. Step facts: `duration`, `parameters`, `materials`, `caution`.
- `UnitFacts.flow` on a protocol: `{ steps: Pin[]; then: { from: DgId; to: DgId; when?: string }[] }`. The flow lives on the protocol, not as relation records, because the same step has different neighbours in different protocols, and so that one author writes it (the AT Protocol design's "one writer per record").
- `UnitFacts.stepLog` on a run: one entry per step, `{ step: Pin; state; at; values?; deviation?; outputs?: DgId[] }`. The run's writer is the person carrying it out. A run by two people is two runs of one experiment.
- An output gains `step?: DgId` beside its run.
- Positions on a process canvas are a canvas record tied to the protocol through `whole`, with a new `kind: "process"`. Order and branching never depend on positions.

**Core.** One feature, `processFeature`, taking over from the method handlers: `protocol.get`, `protocol.setFlow`, `step.create`, `step.get`, `step.uses`, `experiment.get`, `run.start`, `run.mark`, `run.end`, `run.get`, `output.attach`. `planNotebookImport` learns to group cells by heading. `evidenceChain` and `claimSupport` read `stepLog` for the two new gaps. Refusals carry kinds: a PDF canvas's protocol is `read-only`; a pinned step that is missing is `not-found`.

**Panels.** A new `page` surface with placement `dialog`, which the base already draws over everything. Inside it, `process/Canvas.tsx` reuses the argument canvas's flow engine, writer, undo and add box, with its own node components and a much smaller toolbar. The run page that exists today moves into the page shell. Rows and nodes share one selection store.

**Agents.** The MCP read tools gain `dg_protocol` (a flow with its steps) and `dg_run` (a run with its step log). An agent proposing a protocol proposes steps and a flow, which a person accepts as a whole.

**Tests.** Unit: flow validation (no cycles unless marked a loop, every arrow's ends are in the flow), pin drift on a step, a run resumed on a second device, a notebook grouped by headings. Simulation: two labmates edit one shared step while a third runs a protocol that pinned it. Real app: build a three-step flow with the mouse, run it, drop a file, make evidence.

## AT Protocol

The mapping in [atproto.md](atproto.md) extends as follows.

| DG | AT collection | Note |
|---|---|---|
| Step | `org.discoursegraphs.step` | MIRA has no step. On publishing, a protocol's `science.mira.protocol` record also carries its steps as plain text in order, so a reader with only MIRA sees the whole method |
| Protocol flow | A field of the protocol record | Pins are `com.atproto.repo.strongRef` (URI and CID), which is what a pin already is |
| Run's step log | A field of the run's `science.mira.study` record, under a DG extension key | Entries are small; outputs are referenced, never embedded |
| Process canvas | `org.discoursegraphs.canvas`, kind `process` | Tool data, never MIRA |

Publishing a run publishes the protocol and step versions it pinned in the same commit, so a public run never points at something private. Nothing here needs a new rule; it needs items 7 to 11 of the AT design done first, because a flow full of pins is exactly where three encodings and two-writer records would hurt.

## Log in with Bluesky (design only)

**What it would do, in order of commitment.** (1) Your identity here is your Bluesky account's DID and handle, replacing the DID this device made. (2) Later, publishing a released canvas to your own repo. Step 1 alone publishes nothing.

**The flow.**

1. **Welcome**: "Use a name on this device" or "Log in with Bluesky". Both lead to the same app; the second can be done later from the Library.
2. **Handle**: one field, `you.bsky.social` or your own domain. Under it: "Discourse Graphs will know who you are. It will not post, follow or read your feed."
3. **Hand-off**: the browser opens your account's own sign-in page. Discourse Graphs never sees the password.
4. **Consent**, on the account's page: what is asked for. For identity alone, the smallest scope there is. Publishing asks later, by collection name.
5. **Return**: a Discourse Graphs web page says "Signed in as @you. Return to Obsidian", and hands back to the app.
6. **Confirm in the app**: the handle and DID, and one choice when this device already has work: "Sign this work as @you from now on" or "Keep them apart". Work already shared with a lab cannot be moved, and the screen says so.
7. **Signed in**: your initials show the handle; Library → You shows the account, the device key vouched by it, and **Sign out**.

**What it needs before it can be real.**

- A domain DG controls, hosting the client metadata file and the return page (an `obsidian://` address cannot be the return).
- The key root fixed first: today a device signs with a key no Bluesky host can hold, so the account's DID must vouch for the device key, not replace it.
- A recovery path, so a lost laptop does not lose a lab.
- A decision on existing work when someone signs in late (decision 2 in the AT design).

**Dummy build, for grounding.** The mock shows all seven screens. If wanted in the app, the same screens can be wired behind a "preview" switch against a pretend account, changing no identity and contacting nothing.

## Decisions for the product owner

1. **Step as a tenth base type.** I'd say yes; the alternative, a step as a labelled Protocol, blurs every gap rule.
2. **One writer per run.** Two people at one bench make two runs. I'd say yes for now.
3. **Single click on an argument card stays select-only,** and the page opens on double-click or the open button. I'd say yes, to keep the 13 November card rule.
4. **Publishing steps under DG's namespace** with the plain-text copy inside the MIRA protocol. Or ask MIRA for a step class in the RFC.
5. **Loops.** Allow "repeat N times" on a step and refuse free cycles. I'd say yes.
6. **The dummy Bluesky screens:** mock only, or also behind a preview switch in the app.
