# Discourse Graphs panels: design

The layout and gestures are the same in every base. The look comes from the base. See [PRODUCT.md](PRODUCT.md) for who this is for.

## Frames

Measured in both apps at 1280 to 1920 px wide windows:

| Composition | Obsidian | Roam |
|---|---|---|
| Side panel | 300 px | 419 to 675 px |
| Beside a sidebar | 701 to 1,341 px | 629 to 1,013 px |
| Full pane | 1,001 to 1,876 px | 1,048 to 1,688 px |

Bars measure their own width rather than the window's, so a canvas in a narrow split behaves like one in a narrow window. Nothing wraps at 300 px. See "The canvas bar".

## Visual weight

Taken from current practice in Apple's toolbar guidance, Linear's refreshes, Figma UI3, Material 3, Fluent and Obsidian's own UI, all checked 12 Nov 2026:

- **Quiet chrome, color for meaning.** Toolbar buttons are plain until pressed: muted icons, labels a step under full ink, and full ink on hover. Color is kept for node types, relations, the accent on what's selected or on, and found words.
- **Spacing over rules.** Groups are told apart by space, not by lines. Hairlines that remain sit at 80% of the base's line color.
- **One emphasis ladder.** Plain for tools, a 12% accent tint for a tool that's on, and a filled accent only where a flow completes, such as Save or Place. Nothing in a toolbar is filled.
- **Sizes.** Controls 28 px high with 16 px icons. Icon strokes are 1.55, close to Obsidian's own. Text is 400–450 weight, with 600 for names and found words.
- **Elevation only for what floats.** Popovers and the floating status get a soft two-layer shadow, mixed from black, so dark themes don't glow.
- **Focus** is a 2 px accent ring on `:focus-visible`.

## Tokens

Adapters read these from the base, so a person's theme carries in: `--dg-font`, `--dg-text-font`, `--dg-size`, `--dg-ink`, `--dg-muted`, `--dg-page`, `--dg-panel`, `--dg-line`, `--dg-accent`, `--dg-radius`.

Node type and relation hues are DG's own, in OKLCH, because they carry meaning: question, claim, evidence, source, and opposes. A node type's own color wins when it has one.

## Cards

240 px wide, so three columns fit a 725 px frame. Height grows with the title. Real titles run 71 characters at the median and 156 at most, and nothing truncates them. A canvas never opens below 70% zoom.

## Gestures

| Gesture | Result |
|---|---|
| Click a card | Selects it, and the context panel follows |
| Double-click, Enter or the open button | Text opens beside the canvas, which stays in view. On the title of a person's own unit, a double-click edits it instead |
| Drag between cards | Offers the relations the grammar allows |
| Drag to empty canvas | Finds or creates the next node, then asks for the relation |
| Select text, then `\` and a letter | Makes a node and leaves a link in place of the text |
| Click a link badge, or Enter on it | Opens the context panel on that node. The page and the caret stay put |
| Hover a link on a canvas | Shows who made it |
| N, T, D, L | Add node, note, draw, tidy again in the same mode |
| Delete | Removes from the canvas, with Undo. On a link, it asks first |
| Click a holon card's open-inside button | Opens that holon's own canvas in the same tab, made from the graph if it has none |
| Click a step in the holon breadcrumb | Goes back up to that holon's canvas |
| Double-click, or zoom far in or out, by choice | Opens or leaves a holon, per the device's choice in settings or the Holon menu. See [HOLONS.md](HOLONS.md) |
| Highlight words in a PDF | A popup offers the unit's title, its type and its canvas. A letter picks the type, as with `\`, and Enter saves |
| Click a lit passage in a PDF | Selects its unit: the context panel follows, and the canvas lights its card |
| U, or the bar under the canvas | Opens the drawer of units not on this canvas yet |
| Click a unit in the drawer | Selects it. Place puts the selection on together, laid out with its links |
| Drag a unit, or the selection, from the drawer | Puts it where it's dropped, with its links |
| Double-click a card's title, or F2 | Edits the title in place, for a person's own units. Enter keeps it, Escape leaves it |
| Delete on a link | Asks: only off this canvas, or withdraw the relation. "Remember my choice" makes it the default |
| Copy, cut and paste | Cards go to another canvas with their links, at the pointer. A unit already there is lit instead of doubled |
| Undo and redo (⌘Z, ⇧⌘Z, or Ctrl+Y) | Steps back and forward through every edit made in this canvas tab |
| "Find a unit" | The quick finder: Enter opens, ⌘ or Ctrl+Enter puts it on the open canvas, Alt+Enter links it at the cursor |

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

## The canvas bar

Three parts, as current toolbars are built:

- **Leading:** the canvas name. Its menu holds whole-canvas commands: other canvases, New canvas, Upload a paper, the Library and Export.
- **Center:** the tools that make and arrange: Add node, Note and Draw, then Tidy, whose label names its mode ("Tidy Logic") and whose arrow chooses another.
- **Trailing:** the last step, Undo and Redo, then Ask AI and the panels (Search, Context, PDF).

It's one tab stop, and the arrow keys move along it. Tooltips give the name and its key ("Add node · N").

As room runs out, the bar steps down four levels, measured on itself (`canvas/fit.ts`), and steps back up when there's room again:

1. Every label.
2. Only the words no icon can stand for: Tidy and its mode, Ask AI, Context.
3. Icons only. The last step floats under the bar instead of squeezing it.
4. Note, Draw, Ask AI and PDF fold into a More menu, with their keys shown.

The PDF reader's bar uses the same levels.

## Search

Two ways in, one search underneath.

- **The search panel** sits in the right sidebar and stays while a person works. Results show the type, the title with the words marked, who it's credited to, a second line when the words were in the note or the PDF passage, and the canvases that hold it.
- **Filters.** Type, person or lab, and sort (best match, last edited, newest, title). Each filter shows how many results it would keep. Chips choose what's searched: titles, notes, passages.
- **A result.** Clicking opens its preview: the start of its note, its relations, and Open, Insert link, Put on the open canvas and Context. ⌘ or Ctrl-click picks several, and any can be dragged onto a canvas.
- **The quick finder** opens high over the base, like its own switcher, from the "Find a unit" command or ⌘K in the local app. It closes after one action, or hands its search to the panel.
- **The Add node box** on the canvas uses the same search, so it finds a unit by the words in its note too.
- **Found words** are marked the same way everywhere a search shows results: the search panel, the finder, Add node, the drawer and the PDF chooser. A translucent highlighter sits behind the text's own color, at 600 weight, so a match isn't told by color alone. The row a person is on marks more strongly. In forced-colors mode, the system's Mark colors take over.
- **Meaning** is planned, not built: [semantic-search-plan.md](semantic-search-plan.md).

## Finding the panels in Obsidian

- **One ribbon icon**, as Obsidian asks of plugins. It opens a menu of everything, under three headings:
  - Canvases: Open canvas, Library, Holons, New canvas.
  - Panels: Search units, Context, Holon boundary.
  - Find and read: Find a unit, Read a PDF, Upload a paper.
  - Settings closes the menu.
- **Every panel's ⋯ menu** lists the same entries under "Discourse Graphs", without the panel already open.
- **Commands** cover every entry, each with an icon, and none has a default key.
- **Right-click in a note:** Create node from selection (when text is selected), and Link a unit.
- **Right-click a PDF:** Read in Discourse Graphs.

## Editing on the canvas

- **Titles.** A person renames their own unit on its card, and its note is renamed with it. A teammate's unit says who can rename it.
- **Links.** Delete asks whether the link is only coming off this canvas or the relation is being withdrawn. Only its author can withdraw a relation, so for anyone else that choice is shown and disabled, with the reason. After a remembered answer, the status line offers "Ask next time". Obsidian's settings have the same choice.
- **Copy and paste.** The clipboard carries the cards as they are, so they paste onto another canvas, in another tab, with their layout and their links. The same copy pastes into a note as the titles.
- **Undo.** Every edit in a canvas tab can be undone and redone: moves, sizes, notes, types, titles, links, placing, pasting, tidying, and units put here from search or a PDF. The status line names the last step for a few seconds.

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
