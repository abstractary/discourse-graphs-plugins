# The local app

The holon views and the canvas repository, over a vault's record log, in your browser. See `docs/HOLONS.md` for what the views show.

```
npm run build:local
npm run seed:example          # optional: the worked example as a vault
npm run local -- --vault examples/worked-example/vault --name "Your name"
```

Then open http://localhost:8796.

## The layout

The app lays out the plugin's panels the way they sit in Obsidian:

| Position | Panel |
|---|---|
| Left | The Library, whose Canvases tab is the repository |
| Middle | A canvas, or the holon explorer, with the PDF reader beside it when it's open |
| Right | The holon's boundary, the context panel, and unit search |

**Reading PDFs.** The PDF button opens the reader beside the canvas. It lists every PDF in the vault, papers first, and a dropped PDF is kept in `Paper files/`. See "Reading PDFs" in `docs/DESIGN.md`.

**Finding units.** The Search tab searches titles, note text and PDF passages, with filters. ⌘K or Ctrl+K, or the search button, opens the quick finder. See "Search" in `docs/DESIGN.md`.

**Opening holons.** A holon card opens into its own canvas in place, and the breadcrumb goes back up. See `docs/HOLONS.md`.

**In Obsidian.** The same panels are in the Obsidian plugin. The local app is for working beside Obsidian, or without it.

## With Obsidian

Point `--vault` at an Obsidian vault that has the Discourse Graphs plugin. The app treats it as one more device on the same vault.

**What it reads.** Every device's log in `discourse-graph/records/*.jsonl`, the same files the plugin reads. It watches them, so an edit in Obsidian shows up within a moment.

**What it writes.** Its own log, `discourse-graph/records/local-<id>.jsonl`, which the plugin reads like any other device's. Records are only ever appended.

**The mirror.** Each canvas goes to `discourse-graph/canvases/<title>.canvas` as JSON Canvas, which Obsidian's Canvas opens.
- A nested canvas becomes a file node, so Obsidian shows it inside its parent.
- The mirror is written from the log and never read back, so edit canvases in DG, not in the mirror.

**An agent can read the same vault.** `npm run mcp -- --vault <folder>` starts the MCP server on stdio. It only reads, and only the vault owner's own work until they pass `--widen`. See [docs/mcp.md](../docs/mcp.md).

**Its own files.** Its device id and settings are kept outside the vault, beside its keys in `~/.discourse-graphs/local-app/`, so a tool that syncs the vault doesn't carry them to another computer.

## Identity

The app signs as its own person.
- Its key pair lives outside the vault, in `~/.discourse-graphs/local-app/`, readable only by you. `--keys` sets another folder.
- The vault may sync elsewhere; the private key never goes with it.

## Network

The server listens on 127.0.0.1 only and refuses calls from other origins.

It sends nothing anywhere. Publishing, sync and AI stay off unless a base's core is given services.
