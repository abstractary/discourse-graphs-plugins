# Security

This project is a demo. Use a throwaway vault, and do not run its server on a network you do not trust.

## Reporting a problem

Report it privately through [GitHub's security advisories](https://github.com/abstractary/discourse-graphs-plugins/security/advisories/new). Please do not open a public issue.

Say what you did, what happened, and which base and version you used. There is one version line, so a fix lands on `main`.

## In scope

- The plugins in `plugins/`, and the packages in `packages/` they are built from.
- The local app and the MCP server in `local/`.
- The reference server in `server/`, within the limits it states below.

Out of scope: Obsidian, Roam, Zotero and the model providers themselves, and anything that needs a person to install a modified build.

## What is protected

**Panels**

- Every panel runs in a frame sandboxed with `allow-scripts` only. Its content security policy is `default-src 'none'`, with inline scripts and styles, `data:` and `blob:` images and `data:` fonts. A panel cannot reach the network and can reach the plugin only through its message port.
- `npm run check-boundaries` fails the build if any module but `packages/sync` calls the network.

**Records and keys**

- Every record is signed by the device that wrote it (ECDSA P-256) and names the key that signed it. A labmate's vault checks each record on arrival and refuses one that does not check.
- A new device shares nothing until a device already trusted lets it in.
- A key with the role `agent` can sign only proposals. A labmate's vault refuses anything it signed.
- The local app and the MCP server keep their keys outside the vault, in `~/.discourse-graphs/`, in folders and files readable only by their owner.

**Model keys**

- A model key is kept in Obsidian's keychain where there is one, and in a file readable only by its owner in the local app.
- A panel is told only whether a key exists and its last four characters.
- A key is sent in a header, never in a URL, and never appears in a record, an event or an error message.
- On the lab route the server uses a member's key for one question and does not store, log or echo it. It calls only the provider's own address.

**Agents**

- The MCP server opens no port. It speaks on stdio.
- Its tools only read. None shares, exports, publishes or fetches an address.
- It reads the person's own work unless started with `--widen`, and a lab's work only as far as the lab's reach allows.
- Text it returns is marked as quoted material, to be treated as data.

**Local app**

- It listens on `127.0.0.1` only and refuses calls from any other origin.

**Reference server**

- It binds to `127.0.0.1` unless `HOST` says otherwise.
- Lab tokens and invitation codes are stored as hashes. A join token waits encrypted until the person who asked collects it.
- A removed member's tokens stop working at once, and only their hashes are kept.
- A request body over 40 MB is refused.
- An uploaded file is not logged. The Discourse Graphs service receives a paper's graph and DOI, never its file.

## What is not protected

- **The reference server is a reference for the API, not something to host.** It has no TLS and no rate limits, it answers any origin, and the only way to revoke a token is to remove its member. It keeps everything in JSON files in one folder.
- **The server takes a person's identifier and name at their word.** Signatures are checked by each member's vault, not by the server.
- **A lab token sits unencrypted** in the plugin's device-only storage.
- **Without a keychain, a model key is unencrypted** in the plugin's device-only storage in Obsidian, and in the extension's browser storage in Roam. The settings form says so.
- **The Roam plugin shares a page** with everything else running in Roam.
- **Marking text as quoted lowers the risk that a paper instructs an agent. It does not remove it.** The server relies on having no tool that sends anything outward.
- **The MCP server keeps no log** of which tools an agent called.

[docs/what-leaves-the-device.md](docs/what-leaves-the-device.md) lists every destination data can be sent to, and when.
