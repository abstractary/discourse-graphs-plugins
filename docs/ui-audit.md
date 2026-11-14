# Interface audit: Obsidian

12 November 2026. A read of the Obsidian plugin's current and planned interface for redundant controls, places where a person loses their flow, and breaks with Obsidian's conventions. One pass was made by reading the code with no knowledge of the design intent, and one by driving the real app.

Each finding says what was done. "Fixed" means changed in this pass and checked in real Obsidian. "Open" means not changed, with the reason.

## Findings, most harmful first

| # | Finding | Why it hurts | Status |
|---|---|---|---|
| 1 | **"Upload a paper" and "Read a PDF" were separate flows for one object.** Upload extracted units but didn't keep the file. Reading kept the file but couldn't extract | An uploaded paper couldn't be read or highlighted, and a read PDF couldn't be extracted | **Fixed,** on your instruction of 12 November. **Extract graph** is on the reader's bar, on a PDF's own menu and in the upload dialog. A picked PDF is kept in "Paper files". A saved extraction beside the file is used with no server. "Upload a paper" keeps its name, since it is now only the way in for a file that isn't in the vault yet |
| 2 | **Seven names for opening a PDF,** and with a reader open, "Read a PDF" showed the current file instead of the list | The same action looks like several. A person can't get back to the chooser | **Fixed.** Two verbs: "Read a PDF…" always opens the list, and "Read this PDF" opens the file in front. The file menu keeps "Read in Discourse Graphs", because that menu needs the product's name |
| 3 | **The capture key was fixed to `\`** and never fired on layouts that type it with AltGr | German, French and other layouts couldn't use it. It also couldn't be turned off | **Fixed.** It is a setting: any one key, or empty for off. AltGr now counts. The command stays and takes any hotkey |
| 4 | **"Link a unit…" opened a finder where Enter opened the unit** | The menu item's own promise needed Alt+Enter | **Fixed.** Opened from that menu, Enter links and Alt+Enter opens, and the footer says so |
| 5 | **⌘-click means "put on canvas" in the finder and "pick several" in the search panel** | One gesture, two meanings | **Open.** The fix is ⌘-click as multi-select everywhere and ⌘↵ for put. It changes a tested gesture, so it is listed, not done |
| 6 | **Six search boxes with three engines.** The search panel, the finder, Add node, the units drawer, Relate in Context, and the Library each filter differently | A unit found by its note text in one box isn't found in another. Sort sits among the filters, and scope sits apart from the query | **Open.** Needs one query row (query, scope beneath it, filters, sort set apart with the count) and `search.query` behind the drawer and Relate |
| 7 | **Ask AI was a mode with no keyboard exit and a dead end with no lab** | Escape did nothing in its box. With no lab it only said "AI comes with a lab" | **Fixed.** Escape and a close button close it. Stop ends an answer in progress and keeps what arrived. With no model it offers "Use my own key" and still answers by quoting units. Picked units are cleared when the canvas changes |
| 8 | **Pop-ups aren't Obsidian modals.** Escape is heard on the parent window, so it stops working once the upload form has focus | Keyboard users get stuck. Closing mid-extraction loses the result | **Fixed 13 Nov.** Every dialog but the quick finder is an Obsidian `Modal`, and the panel passes Escape out of its frame. Closing mid-extraction still loses the result |
| 9 | **"Search units" hands the keyboard back to the note** | The search box's own focus never takes effect, so a person must click before typing | **Open.** I tried giving the panel the keyboard and the search suite's typing stopped landing, so I put the old behaviour back. It needs a careful look at focus between Obsidian and a sandboxed frame |
| 10 | **The PDF page box jumped on every keystroke** and couldn't be cleared | Typing "12" went to page 1, then 12 | **Fixed.** It goes on Enter or when left. Escape puts the number back |
| 11 | **Canvas actions are invisible to Obsidian's commands and hotkeys.** Add node, Tidy, Ask AI and Export exist only inside the frame, with fixed keys | They can't be rebound or found in the command palette | **Fixed 13 Nov.** Add a unit, Tidy, Fit, what cards show, Ask AI, Export, Undo and Redo are commands, offered while a canvas is in front |
| 12 | **Three names for one thing:** "Open unit search", "Search units", "Unit search" | Small, but it reads as three features | **Fixed** for search: "Search units" everywhere. "Add to canvas" against "Put on {canvas}", and node against unit against card, are still mixed |
| 13 | **The settings page was two dropdowns** that appeared late | Most choices could only be changed in passing, inside panels | **Fixed.** See below |
| 14 | **A unit could open as a graph of its own,** three ways: a card button, a double-click and zooming in | It multiplied canvases nobody asked for. A unit is a leaf | **Fixed,** on your direction of 12 November. The button, both gestures, the gesture setting and "Open this note as a holon" are gone. A canvas card inside a canvas still opens |
| 15 | **The canvas picker was a list of titles** | Twenty canvases called "Tension map" look the same | **Fixed.** Each canvas is drawn as its real layout, with its title and whether it came from a PDF or is a workspace, in the Library and in the canvas-name menu |

## Found by using it: three papers, one session (12 November)

Three reservoir computing papers were read in through Extract graph, then used the way a scientist would: read at the passage, searched across, argued on one canvas. `harness/science-test.mjs` repeats the session. These are the faults it turned up, most harmful first.

| # | Finding | Why it matters | Status |
|---|---|---|---|
| 16 | **A relation made in Context wasn't drawn on the canvas** that held both units | The panel said "Supported by 5" and the canvas showed no links. The main way to relate two papers' claims looked broken | **Fixed.** Stated away from a canvas, a relation is drawn on each of your canvases that holds both units |
| 17 | **An import took any type of the same name,** whatever it meant. A vault with a "Protocol" type made as a kind of source turned every extracted protocol into a source | Method chains, run pages and gap checks all went quiet or wrong for that paper | **Fixed.** A type matches on its name and its meaning. Otherwise the import makes MIRA's own |
| 18 | **Evidence read from a paper was flagged "nothing behind it",** and its run "belongs to no study" and "nothing says how it was done" | Three false warnings on every extracted result. The evidence had a passage, a run and up to eight methods | **Fixed.** A paper's passage counts as its source. Every method a run followed is read. A run a paper reports isn't asked for a study |
| 19 | **On a canvas of units from several papers, nothing said which paper a card came from.** Every card carried the importer's initials | The one thing a synthesis needs to see | **Fixed.** A paper tag on cards, search results and related units. A Papers arrangement. See the guide, "Working across papers" |
| 20 | **A unit put on a canvas from search could land on another card** | Its size wasn't measured yet when its spot was chosen. A question sat hidden under a claim | **Fixed.** It waits for the drawn size, and a spot counts only if it is clear |
| 21 | **A claim that rests on other claims showed no Method at all** | "A claim nothing supports yet" beside five supporting claims from three papers | **Fixed.** "Rests on" follows the claims down to evidence, runs and papers |
| 22 | **A paper's units said "Made by" the person who imported them,** and its runs showed the import date as when they ran | Carroll's claim read as Dana Lee's, made today | **Fixed.** "Read from a paper by" its authors. Runs from a paper say "reported" and name the paper |
| 23 | **A run's page listed one claim several times,** once for each piece of evidence that carried it there | A list of six that was really four | **Fixed** |
| 24 | **Every canvas carried "Not part of the holarchy yet. Make it a holon's canvas"** | Jargon on every paper, against your direction on holons | **Fixed.** The line is gone. The same choice is in the Boundary menu |
| 25 | **After Extract graph in the reader, the canvas opened over the reader** | The paper and its graph belong side by side | **Fixed.** A canvas opened while a reader is open goes beside it. Run pages reuse one tab |
| 26 | **A paper's canvas opens at 70%, showing a corner of it,** and Fit on a 36-card paper lands near 20% | The first view is neither an overview nor readable. Tidy Logic leaves a tall graph with long method links | **Open.** Method cards (eight per run here) could fold into their run on a paper's canvas |
| 27 | **Search marks small words** such as "of" on their own | Yellow noise in every result | **Open** |
| 28 | **Between two claims the grammar offers only Supports and Opposes** | "Informs" or "explains" is what one paper often does to another | **Open.** It is the grammar's call, so yours |

## Found while adding card facts (13 November)

| # | Finding | What it looked like | State |
|---|---|---|---|
| 29 | **A click on a card opened its PDF** | The source link sat where people click to pick a card up | **Fixed.** A card's links act only once it is selected |
| 30 | **Cards that show more grew over their neighbours** | Two claims overlapped after every fact was switched on. A canvas tidied earlier opened the same way | **Fixed.** The bar says how many cards cover another and offers Tidy. Nothing is moved unasked |
| 31 | **The card's fact labels were cut off** ("Worksp...") | The label column was too narrow for the longest label | **Fixed** |
| 32 | **In Obsidian, PubMed and the paper's own page never answered a lookup** | "Couldn't reach PubMed" on every paper | **Fixed.** Those sites don't let a page read them, so lookups use Obsidian's own request |
| 33 | **The passage link in Context moved below the fold** when the facts were added above it | A test that clicked it missed | **Fixed** by the facts themselves: the source at the head of the panel opens the passage |
| 34 | **A workspace that isn't yours or your lab's has no name** | It reads "Another workspace" | **Open.** Records carry a space's id and not its name |
| 35 | **A registry that doesn't list a paper reads as a failure** | PubMed is listed with the registries that didn't answer under an arXiv preprint, which it was never going to hold | **Open.** Not listed and not reachable should read differently |
| 36 | **The Published work section sits low in the panel**, below Method and Elsewhere | A retraction is flagged on the card and at the head, but its detail needs a scroll | **Open** |
| 37 | **Radio buttons and tick boxes in the Export dialog were stretched across the row**, pushing their labels to the far side and wrapping them | "The whole paper (36)" broke over two lines beside a floating dot | **Fixed** for every panel: only text fields fill their row |

## Found while adding profiles and Zotero (13 November)

| # | Finding | What it looked like | State |
|---|---|---|---|
| 38 | **Notes on a canvas were unsigned** | Nobody could tell whose a sticky note was | **Fixed.** Each shows who wrote it and when |
| 39 | **Initials did nothing** | A credit mark was a picture, not a way to the person | **Fixed.** Hover for a card, click for the profile |
| 40 | **The date on a card had no time** | Two units made the same day couldn't be told apart in order | **Fixed** |
| 41 | **"Holon" was still in menus, tab titles, tooltips and empty states** | "Holons", "Holon boundary", "This canvas isn't a holon's view yet" | **Fixed.** The tab is Overview, the panel is Boundary, and the sentences say question, claim and lab |
| 42 | **A profile's history can be long and has no filter** | 150 lines, newest first, by day | **Open.** A filter by kind of action, or by canvas, would help |
| 43 | **In the profile, a relation reads "Said this supports"** with the two units under it | The sentence and its objects are split across lines | **Open** |
| 44 | **The From Zotero dialog lists a picture as a greyed row** | It can't be brought in | **Open,** until figures have a home |

## Placement, evaluated

**Search criteria.** In the search panel the query is on top, three selects sit under it (type, credit, sort), and scope chips sit under those. Two problems: sort looks like a third filter, and scope is the farthest control from the query it changes. The better order is query, scope directly beneath, then type and credit, with sort at the right end of the count line. The finder is right to have no filters, because it is for a known item. It should hand its whole query to the panel, and today it hands only the words.

**Ways to open a PDF.** There are six: two commands, the file menu, the ribbon menu, the canvas bar's PDF button, and dropping a file on the reader. After this pass they share two verbs and one destination, the reader beside the canvas. Two gaps remain: dropping a PDF on the canvas does nothing, and uploading a paper is still a different flow (finding 1).

**Reading a PDF.** The reader's bar holds the file chooser, page, zoom and the count of units made from the file. A highlight opens a small popup that asks for a type and a canvas. What is still missing: keys for page and zoom, remembering zoom and position for each file across restarts, and a way to close the units list with Escape.

## The settings page

Obsidian → Settings → Discourse Graphs now has six sections. The page is drawn at once and filled in when the plugin's core answers.

| Section | Holds |
|---|---|
| You | Your name. Your lab's status, with "Join or start a lab" |
| Ask AI | Whose model answers. Provider, address, key, model, route, and a Test button. The key field never shows a saved key |
| In your notes | The capture key. Type badges on links. A button that opens Obsidian's hotkeys filtered to this plugin |
| Canvas | What Delete does on a link |
| Papers and notebooks | How PDFs open. Whether notebook import keeps printed text |
| Help and privacy | Start the walkthrough, remove its examples. The on-device usage log, with its size and Clear. A plain statement of what leaves the device |

Still to add, as each feature lands: the folder for dropped PDFs (it is a constant today), default scope and sort for search, meaning search (model, when to index, index size), compute servers for extraction, and tokens for the MCP server.

## How this was checked

- `harness/guide-test.mjs`: 23 checks in real Obsidian covering the picker, the Library scopes, Method, Ask AI, runs and settings.
- `harness/holons-test.mjs`: 12 of 12, rewritten for units as leaves.
- `harness/search-test.mjs`, `pdf-test.mjs`, `slice-test.mjs`: 28, 28 and 35, all passing after the changes.
