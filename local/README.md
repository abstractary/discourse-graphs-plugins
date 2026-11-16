# The local app and the MCP server

Two programs that open a vault's record log from outside Obsidian. The local app shows the same panels in your browser. The MCP server lets an agent read the same vault. Both use [`src/vault.ts`](src/vault.ts), which makes a folder on disk into a base for the core.

## The local app

```bash
npm run build:local
```

```bash
npm run seed:example
```

```bash
npm run local -- --vault examples/worked-example/vault --name "Your name"
```

Then open http://localhost:8796. The second command is optional: it writes the worked example into `examples/worked-example/vault` as one device's log. `node local/src/seed.ts <folder>` writes it somewhere else.

| Flag | Default | Does |
|---|---|---|
| `--vault <folder>` | required | The vault to open. It can be an Obsidian vault |
| `--port <n>` | `8796` | Port to listen on |
| `--name "<name>"` | none | The name this app writes as. Given again with another name, it renames |
| `--keys <folder>` | `~/.discourse-graphs/local-app` | Where this app keeps its device id, settings, signing keys and model keys |

### The layout

The app lays out the plugin's panels the way they sit in Obsidian:

| Position | Panel |
|---|---|
| Left | The Library, whose Canvases tab lists every canvas |
| Middle | A canvas, or the Overview, with the PDF reader beside it when it's open |
| Right | Boundary, the context panel, and unit search |

- **Reading PDFs.** The PDF button opens the reader beside the canvas. It lists every PDF in the vault, papers first, and a dropped PDF is kept in `Paper files/`.
- **Finding units.** The Search tab searches titles, note text and PDF passages, with filters. ⌘K or Ctrl+K, or the search button, opens the quick finder.
- **Canvases inside canvases.** A canvas card opens into its own canvas in place, and the breadcrumb goes back up.

The [user guide](../docs/guide/README.md) describes each panel. The local app has no editor, no capture key and no table per type: those belong to a base.

### With Obsidian

Point `--vault` at an Obsidian vault that has the Discourse Graphs plugin. The app treats it as one more device on the same vault.

- **What it reads.** Every device's log in `discourse-graph/records/*.jsonl`, the same files the plugin reads. It watches the folder, so an edit in Obsidian shows up within a moment. A line a sync tool cut short or joined is skipped, never repaired.
- **What it writes.** Its own log, `discourse-graph/records/local-<id>.jsonl`, which the plugin reads like any other device's. Records are only ever appended.
- **The mirror.** Each canvas goes to `discourse-graph/canvases/<title>.canvas` as JSON Canvas, which Obsidian's Canvas opens. A nested canvas becomes a file node, so Obsidian shows it inside its parent. The mirror is rewritten from the log 300 ms after a change and never read back, so edit canvases in Discourse Graphs, not in the mirror. Characters a file name can't hold become spaces, and a name is cut at 120 characters.

### Identity

The app signs as its own device.

- Its key pair, device id and settings live outside the vault, in the `--keys` folder, in files only you can read. A tool that syncs the vault doesn't carry them to another computer.
- A model key you add for Ask AI is kept in `secrets.json` in the same folder. The call to the provider is made by this program, in Node, so the page never holds the key.

### Network

The server listens on `127.0.0.1` only and answers 403 to a request whose `Origin` is not its own address.

| Path | Does |
|---|---|
| `GET /` | The page, `dist/local.html`. 503 until `npm run build:local` has run |
| `GET /events?tab=<id>` | Server-sent events for one browser tab |
| `POST /rpc` | One Surface API call, `{tab, id, method, params}` |
| `GET /about` | `{vault, device, records, canvases}` |

The page's content security policy lets it connect only to its own origin. The app is started with no services, so it sends nothing anywhere: sync, lookups and publishing are off. Ask AI with your own key is the one call out, and only when you ask.

## The MCP server

```bash
npm run mcp -- --vault <folder>
```

It speaks the Model Context Protocol on stdio, so a desktop client starts it and no port is opened. Standard output carries the protocol, and everything said to a person goes to standard error. It only reads: nothing here shares, exports, publishes or fetches. [docs/mcp.md](../docs/mcp.md) has the design.

| Flag | Default | Does |
|---|---|---|
| `--vault <folder>` | required | The vault to read. Someone must have used it in Obsidian or the local app first |
| `--name "<name>"` | `An agent` | What the agent is called in the record of what it did |
| `--widen` | off | Lets the agent read what the person's lab shares, not only their own work, as far as the lab's reach allows |
| `--model-here` | off | Says the agent's model runs on this computer. A lab that keeps its work off outside models then lets a widened agent read it |
| `--keys <folder>` | `~/.discourse-graphs/mcp` | Where the agent's own key lives |

The server runs the core in the role `agent`: its key is one more device of the vault's person, with less it may do. It acts as the person whose vault this is, the first person a base recorded there.

| Tool | Reads |
|---|---|
| `dg_search` | Units by words, with filters, paged |
| `dg_unit` | One unit: its text, passage, relations, what the lab's rules say is missing, and the published work it stands for |
| `dg_argument` | What bears on a claim or question, as a tree up to 6 steps deep, with counts of support, opposition and what is unchecked |
| `dg_canvas` | A canvas and what is on it |
| `dg_paper` | A read paper and its units |
| `dg_grammar` | The types and relations in use |

Every tool is marked read-only and closed-world.

An example client entry:

```json
{
  "mcpServers": {
    "discourse-graphs": {
      "command": "node",
      "args": ["/path/to/discourse-graphs-plugins/local/src/mcp.ts", "--vault", "/path/to/vault"]
    }
  }
}
```

## Limits

- The local app has no sync, lookups or publishing.
- The MCP server does not propose or write. See [ROADMAP.md](../ROADMAP.md).
- Both read the vault's files directly, so they need a vault on this computer's disk.
