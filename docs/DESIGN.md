# Design

How the canvas and panels look and behave: the frames they fit, the visual rules, the gestures, and the rules each surface keeps. [PRODUCT.md](PRODUCT.md) says who this is for. The [user guide](guide/README.md) walks through every control. [color.md](color.md) has the palette.

The layout and gestures are the same in every base. The look comes from the base.

## Frames

Panels are sized for the frames people use, measured in windows 1280 to 1920 px wide:

| Composition | Obsidian | Roam |
|---|---|---|
| Side panel | 300 px | 419 to 675 px |
| Beside a sidebar | 701 to 1,341 px | 629 to 1,013 px |
| Full pane | 1,001 to 1,876 px | 1,048 to 1,688 px |

Bars measure their own width, not the window's, so a canvas in a narrow split behaves like one in a narrow window. Nothing wraps at 300 px.

## Visual weight

- **Quiet chrome, color for meaning.** Toolbar buttons are plain until pressed: muted icons, labels a step under full ink, and full ink on hover. Color is kept for unit types, relations, the accent on what is selected or on, and found words.
- **Spacing over rules.** Groups are told apart by space, not by lines. Hairlines that remain sit at 80% of the base's line color.
- **One emphasis ladder.** Plain for tools, a 12% accent tint for a tool that is on, and a filled accent only where a flow completes, such as Save or Place. Nothing in a toolbar is filled.
- **Sizes.** Controls are 28 px high with 16 px icons. Icon strokes are 1.55, close to Obsidian's own. Text is 400 to 450 weight, with 600 for names and found words.
- **Elevation only for what floats.** Popovers and the floating status get a soft two-layer shadow, mixed from black, so dark themes do not glow.
- **Focus** is a 2 px accent ring on `:focus-visible`.
- **Disable with a reason in a toolbar. Hide in a context menu.** A control a person cannot use where they are says why, such as Sticky on a PDF canvas.

## Tokens

Adapters read these from the base, so a person's theme carries in: `--dg-font`, `--dg-text-font`, `--dg-size`, `--dg-ink`, `--dg-muted`, `--dg-page`, `--dg-panel`, `--dg-line`, `--dg-accent`, `--dg-radius`.

Unit type and relation hues are this project's own, in OKLCH, because they carry meaning. A type's own color wins when a lab has set one. All of them are in `packages/surfaces/src/shared/tokens.css`.

## Cards

- 240 px wide, so three columns fit a 725 px frame.
- Height grows with the title. Research titles are long, and nothing truncates them.
- A canvas never opens below 70% zoom. A person can zoom out to 20%.
- A type shows as a lettered chip and a full-strength left edge over a light tint.
- A card's facts (source, authors, workspace, date, identifiers) are a quiet label and a value, in the same order and type as in Context.
- A card's links act only once the card is selected, so a click to pick a card up never opens something.
- Cards that grow and cover a neighbor are not moved. The bar says how many and offers Tidy.

## Gestures

| Gesture | Result |
|---|---|
| Click a card | Selects it, and Context follows |
| Double-click a card, Enter, or the open button | Opens its text beside the canvas, which stays in view. A unit is a leaf and never opens as a graph of its own |
| Double-click a card's title, or F2 | Edits the title in place, for a person's own units. Enter keeps it, Escape leaves it |
| Drag between cards | Offers the relations the grammar allows |
| Drag to empty canvas | Finds or creates the next unit, then asks for the relation |
| Select text in a note, then `\` and a letter | Makes a unit and leaves a link in place of the text |
| Click a link badge, or Enter on it | Opens Context on that unit. The page and the caret stay put |
| Hover a link on a canvas | Shows who made it |
| N, T, D, L, U | Add unit, sticky, draw, tidy again in the same mode, units to place |
| Delete | Removes from the canvas, with Undo. On a link, it asks: only off this canvas, or withdraw the relation. "Remember my choice" makes it the default |
| Click a step in the line under the bar | Goes to the canvas of that workspace, question or claim |
| Click someone's initials | Opens their profile. Hovering shows a small card about them first |
| Highlight words in a PDF | A popup offers the unit's title, its type and its canvas. A letter picks the type, and Enter saves |
| Click a lit passage in a PDF | Selects its unit: Context follows, and the canvas lights its card |
| Click a unit in the Units list | Selects it. Place puts the selection on together, laid out with its links |
| Drag a unit, or the selection, from the Units list | Puts it where it is dropped, with its links |
| Copy, cut and paste | Cards go to another canvas with their links, at the pointer. A unit already there is lit instead of doubled |
| Undo and redo (⌘Z, ⇧⌘Z, or Ctrl+Y) | Steps back and forward through every edit made in this canvas tab |
| "Find a unit" | The quick finder: Enter opens, ⌘ or Ctrl+Enter puts it on the open canvas, Alt+Enter links it at the cursor |

## The canvas bar

Three parts:

- **Leading:** the sidebar icon and the canvas's name. The name's menu holds whole-canvas commands: other canvases, New canvas, Upload a paper, From Zotero, the Library, Export, Types and relations, and Remove this canvas.
- **Center:** the tools that make and arrange: Add unit, Sticky and Draw, then Tidy, whose label names its mode ("Tidy Logic") and whose arrow chooses another, then Cards.
- **Trailing:** the last step, Undo and Redo, then Ask AI and the panels (Search units, Context, PDF).

It is one tab stop, and the arrow keys move along it. Tooltips give the name and its key ("Add unit · N").

As room runs out, the bar steps down four levels, measured on itself (`packages/surfaces/src/shared/fit.ts`), and steps back up when there is room again:

1. Every label.
2. Only the words no icon can stand for: Tidy and its mode, Ask AI, Context.
3. Icons only. The last step floats under the bar instead of squeezing it.
4. Sticky, Draw, Ask AI and PDF fold into a More menu, with their keys shown.

The PDF reader's bar uses the same levels.

## Three fixed places

The canvas sidebar is on the left, the work is in the middle, and the panels about the selected unit are on the right. The sidebar floats over the canvas and goes when the canvas is clicked, unless pinned. Each panel says at its head which object it is about. [information-architecture.md](information-architecture.md) lists the frames.

## Units to place

The sidebar's Units tab lists the units not on this canvas yet. It answers "what else belongs here?"

- **Groups.** A group for each other canvas that holds them, then each folder, then units on no canvas or folder. A unit in two places is in both groups.
- **Order.** In each group, the units linked to cards already on this canvas come first, with a count of those links.
- **List or grid.** The grid shows cards as the canvas draws them, narrower. Search and a type filter sit above.
- **Placing.** Click selects, and "Place n together" puts the selection on, laid out with Tidy's Logic mode, in a clear spot. Dragging puts a unit, or the selection, where it is dropped. "Place all" puts a whole group on. Their relations come with them, to each other and to the cards already there, and Undo takes them off.

## Editing on the canvas

- **Titles.** A person renames their own unit on its card, and its note is renamed with it. A teammate's unit says who can rename it.
- **Links.** Delete asks whether the link is only coming off this canvas or the relation is being withdrawn. Only its author can withdraw a relation, so for anyone else that choice is shown and disabled, with the reason. After a remembered answer, the status line offers "Ask next time". Obsidian's settings have the same choice.
- **Copy and paste.** The clipboard carries the cards as they are, so they paste onto another canvas, in another tab, with their layout and their links. The same copy pastes into a note as the titles.
- **Undo.** Every edit in a canvas tab can be undone and redone: moves, sizes, stickies, types, titles, links, placing, pasting, tidying, and units put here from search or a PDF. The status line names the last step for a few seconds. Each step is a new edit teammates see, not a rewind.
- **Arrivals.** A unit put on a canvas from elsewhere lands in a clear spot in view and flashes once. If the canvas is not open, it goes in a column beside what is there.

## Tidy

Tidy has ten modes, in a menu beside its button. The mode stays with the canvas, so teammates see the same headings and scores. Of the five ways to organize information (location, alphabet, time, category, hierarchy), a canvas can use time, category and hierarchy. Location is hand placement.

| Mode | Answers | Layout |
|---|---|---|
| Logic | What rests on what? | What a card rests on sits to its left, including what it is derived from, whichever way the arrow runs. Opposition sits left with support |
| For and against | What is the case each way? | The same, with what opposes a card on its right |
| Timeline | What came when? | Columns of periods, oldest on the left. Empty periods are dropped, and the next heading says how long the silence was |
| Kinds | What do we have of each? | A labeled column per unit type, in the order the argument flows |
| People | Who did what? | A labeled column per contributor, or per lab for shared work |
| Papers | What came from where? | A labeled column per paper, and one for what was written here |
| Focus | What touches this card? | The selected card in the middle, two steps each way, and everything else set apart |
| Most connected | What is the hub? | Ranked by degree, in three bands |
| Bridges | What holds parts together? | Ranked by betweenness, in three bands |
| Load-bearing | What would bring the most down? | Ranked by PageRank run backward along the logic, in three bands |

Logic and For and against judge layouts on the curves as they are drawn, in this order:

1. Fewer crossings, and no link running behind a card that is not its own
2. A fit to this frame at a readable zoom
3. Labels clear of each other and of cards
4. Space filled evenly, with short links

The rest place cards in labeled regions: where a card sits says what it is, and links run across. The ranking modes show each card's score, and their links fade until hovered, because reading a ranking does not need them and the rank order cannot avoid crossings.

| Rule | Why |
|---|---|
| Each mode lays out fully, not staying close to the last one | Crossings matter most to reading a graph |
| Hubs sit in the middle of what links to them | Short, level links read fastest |
| Links with a shared end share a corridor through a column | They fan into one point, so separate lanes only waste height |
| A column taller than the frame splits in two | Only nearly level links can pass a column cleanly |
| Separate arguments stay 96 px apart, and loose cards stack on their own | Distance shows what belongs together |
| A sticky within 48 px of a card moves with it | It reads as being about that card |
| Column gaps run 72 to 128 px, and never narrower than the widest label if one fits | Labels sit between columns |
| Pressing Tidy again moves nothing, and every mode has Undo | A layout people can trust stays put |

Tidy stays left to right in narrow frames, so supports are on the left for everyone. A right-to-left interface should mirror it. Drawings and hand-made groups stay where they are.

`packages/layout` holds the modes as pure functions. Sources for the layout rules are in `reports/modes/sources.md`.

## Attribution

Every card shows who it is credited to, at the top right, and every link shows it on hover. A circle with initials is a person. A square is a lab. The shape carries the meaning, so nothing depends on color.

| Where the work came from | What you see |
|---|---|
| You, or someone in your lab | Their initials in a circle |
| Someone with no lab | Their initials in a circle |
| Another lab | That lab's initials in a square, with its name on hover |

This follows W3C PROV: a unit is attributed to a person, who acts on behalf of a lab. A unit read from a paper names the paper's authors, and says separately who read it in.

## Reading PDFs

The reader is this project's own panel, opened beside the canvas, so a highlight lands where it can be seen. Obsidian's PDF viewer stays the default, and every PDF gets "Read in Discourse Graphs" in its menu.

- **Which PDFs.** Every PDF in the vault, papers first, then the rest, newest first. With Zotero as the library, Zotero's PDFs come first. Dropping a PDF on the reader, or adding one, keeps it in "Paper files".
- **A highlight.** The popup starts with the highlighted words as the unit's title, the last type used (Evidence the first time), and the canvas in front. "New canvas…" and "No canvas, the graph only" are there too. Saving says where it went, with Undo.
- **What a unit keeps.** The words, the page and the file, as a W3C text quote. The reader finds the words again by their text, so a passage stays lit at any zoom. The file is a source unit, made the first time anything is read from it, or the paper's own source.
- **Lit passages.** Each unit read from the PDF is lit in its type's hue, extracted ones included. The Units list goes to each one. A passage whose words are not in the file's text is counted there, not hidden.
- **The page box** goes on Enter or when left. Escape puts the number back.

pdf.js runs in the panel's own thread, because a sandboxed panel allows no workers. It is a separate bundle, so the other panels do not carry it.

## Search

Two ways in, one search underneath.

- **The search panel** stays while a person works. Results show the type, the title with the words marked, who it is credited to, a second line when the words were in the note or the PDF passage, and the canvases that hold it.
- **Filters.** Type, person or lab, and sort (best match, last edited, newest, title). Each filter shows how many results it would keep. Chips choose what is searched: titles, notes, passages.
- **A result.** Clicking opens its preview: the start of its note, its relations, and Open, Insert link, Put on the canvas in front, and Context. ⌘ or Ctrl-click picks several, and any can be dragged onto a canvas.
- **The quick finder** opens high over the base, like its own switcher, from the "Find a unit" command, or ⌘K in the local app. It closes after one action.
- **The Add unit box** on the canvas uses the same search, so it finds a unit by the words in its note too.
- **Found words** are marked the same way everywhere a search shows results: a translucent highlighter behind the text's own color, at 600 weight.

## Finding things in Obsidian

- **One ribbon icon.** It opens a menu of everything, under three headings: Canvases, Panels, and Find and read, with Settings last.
- **Every panel's ⋯ menu** lists the same entries under "Discourse Graphs", without the panel already open.
- **Commands** cover every entry, each with an icon, and none has a default key. Canvas actions are commands too, offered while a canvas is in front.
- **Dialogs are Obsidian's own modals,** so Escape closes them from anywhere inside. The quick finder is the exception: it is its own switcher.
- **Right-click in a note:** Create unit from selection (when text is selected), and Link a unit.
- **Right-click a file:** Read in Discourse Graphs and Extract graph on a PDF, Read into Discourse Graphs on a notebook, Import this research crate on a crate.
- **A canvas** is a note named "Canvas - …", which opens as the canvas. In Roam it is a page named "Canvas/…". Renaming the note or page renames the canvas.
- **The settings page** is drawn at once and filled in when the core answers, so opening Settings never waits.

## Link badges

A badge follows every link to a unit: a dot in the type's hue, then the count of active relations. With no relations yet, the dot stands alone, which still says this is a unit and what kind. Hovering names the type and the count, for anyone who cannot rely on color.

The badge takes its font, size and color from the text around it, so it follows any theme, and only the dot's hue is this project's. It never edits the text. It shows in Obsidian's Live Preview and Reading view, and on Roam's links, tags and aliases, including in the sidebar. It stays out of Obsidian's Source mode, code, embeds and Roam page titles. "Toggle link badges" turns them off on this device.

## Papers

The upload dialog asks three things: where it runs, what reads it, and which schema it is read into. Adding a server happens inside the dialog, so nobody loses their place, and the address is tested before it is saved. The dialog says what will be kept and where.

A PDF canvas lays itself out once, then stays where people put it. A canvas opened while a reader is open goes beside it. Export works on what is selected, or on the whole canvas with nothing selected.

## Labs

Everything about a lab sits in the Library's Lab tab: invitations, requests to accept, members, devices, the shelf of papers, model servers, reach and the breadcrumb default.

- **Shared means visible, not editable.** A reaction or note sits beside a unit and never changes it.
- **Reactions never read as approval.** Interesting, agree and disagree have no totals to chase, nothing notifies, and a card with none shows nothing until it is hovered.
- **Notes stay apart.** They live in their own thread in Context, and the card shows a count.
- **Breadcrumbs are a choice.** A person decides whether closing a lab paper leaves one, each time or as a default.
- **Say who gains access before it happens.** Moving a canvas to a lab names the lab and its members first.

## Provenance

Opening a unit shows who made it, the paper it came from, the DOI, the model, the passage, and everywhere it lives: its note or page, its canvases and its folders. Each of those is a link.

## Ask AI

Pressing Ask AI opens a bar over the canvas with the keyboard already in it. Clicking cards grounds the answer in those units, and the bar always says what the answer is grounded in. Answers cite units, and clicking a citation goes to its card. With no model connected, it says so and quotes the closest units word for word. Escape and a close button close it. Stop keeps what arrived.

## Walkthrough

It is offered once per device, as a small card, and never starts by itself. "Start walkthrough" runs it again.

- **Real interface, real gestures.** A stencil dims everything except the next thing, and each step waits for the real action. It is short and hands-on.
- **Nobody gets stuck.** Every action has "Do it for me", and × or Esc leaves at any point.
- **Real graph, with a way back.** It makes a note, four units and a canvas, and tracks exactly those. At the end, or later with "Remove walkthrough examples", they all come back out.
- **It asks for a name**, because credit is shown everywhere and a base does not always know it. "Set my name" changes it later.

## Limits

- ⌘ or Ctrl-click means "pick several" in the search panel and "put on the canvas" (with Enter) in the finder.
- The search panel, the finder, Add unit, the Units list, Relate in Context and the Library each filter in their own way.
- Search marks short words such as "of" on their own.
- "Search units" does not take the keyboard when it opens in Obsidian's side panel. Click its box first.
- A large PDF canvas opens at 70% zoom, showing a corner of it. Fit on a 36-card paper lands near 20%.
- The reader has no keys for page and zoom, and does not remember zoom and position per file across restarts.
- Tidy at 30 or more cards fits less well, because each link is one curve with no bend points.

## Not built

Search by meaning, and the planned work on these surfaces, are in [ROADMAP.md](../ROADMAP.md) and [search.md](search.md).
