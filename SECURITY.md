# Security

This is a demo. Don't run its server on a network you don't trust, and don't use it for sensitive work.

## Reporting a problem

Please report it privately through [GitHub's security advisories](https://github.com/abstractary/discourse-graphs-plugins/security/advisories/new), not in a public issue.

## What's protected

- Panels run in sandboxed frames with a content security policy that blocks the network, so a panel can only reach the plugin through its own port.
- The server binds to `127.0.0.1` unless told otherwise.
- Lab tokens are stored hashed on the server, and join tokens are encrypted until they're collected.
- Extraction files aren't logged, and the Discourse Graphs service never receives one.

## What isn't

- Lab tokens sit unencrypted in plugin storage.
- The server has no rate limits, and it runs over plain HTTP unless you put TLS in front of it.
- A lab member can claim any name on a breadcrumb or upload, because the server trusts the name it's sent.
- The Roam plugin shares a page with everything else running in Roam.
