# Discourse Graphs panels: design

The layout and gestures are the same in every base. The look comes from the base. See [PRODUCT.md](PRODUCT.md) for who this is for.

## Frames

Measured in both apps at 1280 to 1920 px wide windows:

| Composition | Obsidian | Roam |
|---|---|---|
| Side panel | 300 px | 419 to 675 px |
| Beside a sidebar | 701 to 1,341 px | 629 to 1,013 px |
| Full pane | 1,001 to 1,876 px | 1,048 to 1,688 px |

Below 900 px, tool labels drop to icons. Nothing wraps at 300 px.

## Tokens

Adapters read these from the base, so a person's theme carries in: `--dg-font`, `--dg-text-font`, `--dg-size`, `--dg-ink`, `--dg-muted`, `--dg-page`, `--dg-panel`, `--dg-line`, `--dg-accent`, `--dg-radius`.

Node type and relation hues are DG's own, in OKLCH, because they carry meaning: question, claim, evidence, source, and opposes. A node type's own color wins when it has one.

## Cards

240 px wide, so three columns fit a 725 px frame. Height grows with the title. Real titles run 71 characters at the median and 156 at most, and nothing truncates them. A canvas never opens below 70% zoom.

## Gestures

| Gesture | Result |
|---|---|
| Click a card | Selects it, and the context panel follows |
| Double-click, Enter or the open button | Text opens beside the canvas, which stays in view |
| Drag between cards | Offers the relations the grammar allows |
| Drag to empty canvas | Finds or creates the next node, then asks for the relation |
| Select text, then `\` and a letter | Makes a node and leaves a link in place of the text |
| Click a link badge, or Enter on it | Opens the context panel on that node. The page and the caret stay put |
| Hover a link on a canvas | Shows who made it |
| N, T, D, L | Add node, note, draw, tidy again in the same mode |
| Delete | Removes from the canvas, with Undo |
| Click a holon card's open-inside button | Opens that holon's own canvas in the same tab, made from the graph if it has none |
| Click a step in the holon breadcrumb | Goes back up to that holon's canvas |
| Double-click, or zoom far in or out, by choice | Opens or leaves a holon, per the device's choice in settings or the Holon menu. See [HOLONS.md](HOLONS.md) |
| Highlight words in a PDF | A popup offers the unit's title, its type and its canvas. A letter picks the type, as with `\`, and Enter saves |
| Click a lit passage in a PDF | Selects its unit: the context panel follows, and the canvas lights its card |
| U, or the bar under the canvas | Opens the drawer of units not on this canvas yet |
| Click a unit in the drawer | Selects it. Place puts the selection on together, laid out with its links |
| Drag a unit, or the selection, from the drawer | Puts it where it's dropped, with its links |

## Reading PDFs

The reader is DG's own panel, opened beside the canvas, so a highlight lands where it can be seen. Obsidian's PDF viewer stays the default, and every PDF gets "Read in Discourse Graphs" in its menu. Hooking Obsidian's viewer would mean undocumented internals, and Roam and the local app need a reader anyway.

- **Which PDFs.** Every PDF in the vault, papers first, then the rest, newest first. Dropping a PDF on the reader, or adding one, keeps it in "Paper files".
- **A highlight.** The popup starts with the highlighted words as the unit's title, the last type used (Evidence the first time), and the canvas in front. "New canvas…" and "No canvas, the graph only" are there too. Saving says where it went, with Undo.
- **What a unit keeps.** The words, the page and the file, as a W3C text quote. The reader finds the words again by their text, so a passage stays lit at any zoom. The file is a source unit, made the first time anything is read from it, or the paper's own source.
- **Lit passages.** Each unit read from the PDF is lit in its type's hue, extracted ones included. The Units list goes to each one. A passage whose words aren't in the file's text is counted there, not hidden.
- **On the canvas.** A highlight's card goes into a clear spot in view, and flashes once. If the canvas isn't open, it goes in a column beside what's there.
- **From the context panel.** A unit read from a PDF has "Open the passage in the PDF".

pdf.js runs in the panel's own thread, because a panel allows no workers. It's a separate bundle, so the other panels don't carry it.

## The drawer under the canvas

The units not on this canvas yet, in a bar under it that rises into a drawer. It answers "what else belongs here?"

- **Groups.** A group for each other canvas that holds them, then each folder, then units on no canvas or folder. A unit in two places is in both groups.
- **Order.** In each group, the units linked to cards already on this canvas come first, with a count of those links.
- **List or grid.** The grid shows cards as the canvas draws them, narrower. Search and a type filter sit in the bar.
- **Placing.** Click selects, and "Place n together" puts the selection on, laid out with Tidy's Logic mode, in a clear spot. Dragging puts a unit, or the selection, where it's dropped. "Place all" puts a whole group on. Their relations come with them, to each other and to the cards already there, and Undo takes them off.

## Link badges

A badge follows every link to a node: a dot in the node type's hue, then the count of active relations. With no relations yet, the dot stands alone, which still says this is a node and what kind. Hovering names the type and the count, for anyone who can't rely on color.

The badge takes its font, size and color from the text around it, so it follows any theme, and only the dot's hue is DG's. It never edits the text. It shows in Obsidian's Live Preview and Reading view, and on Roam's links, tags and aliases, including in the sidebar. It stays out of Obsidian's Source mode, code, embeds and Roam page titles. "Toggle link badges" turns them off on this device.

## Tidy

Tidy has nine modes, in a menu beside its button. The mode stays with the canvas, so teammates see the same headings and scores. It follows Wurman's LATCH: of the five ways to organize information, Time, Category and Hierarchy are what a canvas can use. Alphabet doesn't help an argument, and Location is hand placement.

| Mode | Answers | Layout |
|---|---|---|
| Logic | What rests on what? | What a card rests on sits to its left, including what it's derived from, whichever way the arrow runs. Opposition sits left with support |
| For and against | What's the case each way? | The same, with what opposes a card on its right |
| Timeline | What came when? | Columns of periods, oldest on the left. Empty periods are dropped, and the next heading says how long the silence was |
| Kinds | What do we have of each? | A labeled column per node type, in the order the argument flows |
| People | Who did what? | A labeled column per contributor, or per lab for shared work |
| Focus | What touches this card? | The selected card in the middle, two steps each way, and everything else set apart |
| Most connected | What's the hub? | Ranked by degree, in three bands |
| Bridges | What holds parts together? | Ranked by betweenness, in three bands |
| Load-bearing | What would bring the most down? | Ranked by PageRank run backward along the logic, in three bands |

The first two modes judge layouts on the curves as they're drawn, in this order:

1. Fewer crossings, and no link running behind a card that isn't its own
2. A fit to this frame at a readable zoom
3. Labels clear of each other and of cards
4. Space filled evenly, with short links

The rest place cards in labeled regions, which network research calls semantic substrates: where a card sits says what it is, and links run across. The ranking modes show each card's score, and their links fade until hovered, because reading a ranking doesn't need them and the rank order can't avoid crossings.

| Rule | Why |
|---|---|
| Each mode lays out fully, rather than staying close to the last one | Studies found crossings matter most, and found little proof that keeping positions helps |
| Hubs sit in the middle of what links to them | Short, level links read fastest |
| Links with a shared end share a corridor through a column | They fan into one point, so separate lanes only waste height |
| A column taller than the frame splits in two | Only nearly level links can pass a column cleanly |
| Separate arguments stay 96 px apart, and loose cards stack on their own | Distance shows what belongs together |
| A note within 48 px of a card moves with it | It reads as being about that card |
| Column gaps run 72 to 128 px, and never narrower than the widest label if one fits | Labels sit between columns |
| Pressing Tidy again moves nothing, and every mode has Undo | A layout people can trust stays put |

Tidy stays left to right in narrow frames, so supports are on the left for everyone. Left to right matches how left-to-right readers place time and cause, and the same studies find the reverse for right-to-left readers, so a right-to-left interface should mirror it. Drawings and hand-made zones stay where they are.

## Attribution

Every card shows who it's credited to, at the top right, and every link shows it on hover. A circle with initials is a person. A square is a lab. The shape carries the meaning, so nothing depends on color.

| Where the work came from | What you see |
|---|---|
| You, or someone in your lab | Their initials in a circle |
| Someone with no lab | Their initials in a circle |
| Another lab | That lab's initials in a square, with its name on hover |

This follows W3C PROV: a unit is attributed to a person, who acts on behalf of a lab. Which of the two you see depends on where you sit.

## Finding a canvas

| | Obsidian | Roam |
|---|---|---|
| Library | Ribbon button, or "Find a canvas" | Left sidebar entry, or "Find a canvas" |
| Its own home | A note named "Canvas - ...", which opens as the canvas | A page named "Canvas/...", which shows the canvas |
| Found by | File list, quick switcher, search, links | All Pages, search, shortcuts, links |
| Commands | Open canvas, New canvas | Open canvas, New canvas |

Renaming the note or page renames the canvas.

## Papers

The upload pop-up asks three things: where it runs, what reads it, and which schema it's read into. Adding a server happens inside the pop-up, so nobody loses their place, and the address is tested before it's saved. The pop-up says what will be kept and where, so nobody has to go looking.

A paper's canvas lays itself out once, then stays where people put it. Staged units look like any other card, and they gain a note or page only when exported. The Export button works on what's selected, or on the whole paper with nothing selected.

## Labs

Everything about a lab sits in the Library's Lab tab: the identifier to share, requests to accept, members, the paper repository and the breadcrumb default.

Patterns taken from MIRA's team design:

- **Shared means visible, not editable.** A reaction or note sits beside a unit and never changes it.
- **Reactions never read as approval.** Interesting, agree and disagree have no totals to chase, nothing notifies, and a card with none shows nothing until it's hovered.
- **Notes stay apart.** They live in their own thread in the context panel, and the card shows a count.
- **Breadcrumbs are a choice.** See decision 27 in [CONTRACT.md](CONTRACT.md).

## Provenance

Opening a unit shows who made it, the paper it came from, the DOI, the model, the passage, and everywhere it lives now: its note or page, its canvases and its folders. Each of those is a link.

## AI mode

Pressing AI opens a bar under the canvas with the keyboard already in it. Clicking cards grounds the answer in those units, and the bar always says what the answer is grounded in. Answers cite units, and clicking a citation goes to its card. With no model connected, it says so and quotes the closest units word for word.

## Link colors

A relation's color comes from its kind, set once in `tokens.css`, and it's the same in every Tidy mode and both bases. The legend reads from the same tokens.

## Walkthrough

It's offered once per device, as a small card, and never starts by itself. "Start walkthrough" runs it again.

- **Real interface, real gestures.** A stencil dims everything except the next thing, and each step waits for the real action. In a study of stencil tutorials, people finished 26% faster with fewer errors and learned as much. Tests of upfront tutorials found they barely changed task success, so this stays short and hands-on.
- **Nobody gets stuck.** Every action has "Do it for me", and × or Esc leaves at any point.
- **Real graph, with a way back.** It makes a note, four nodes and a canvas, and tracks exactly those. At the end, or later with "Remove walkthrough examples", they all come back out.
- **It asks for a name**, because credit is shown everywhere and a base doesn't always know it. "Set my name" changes it later.
