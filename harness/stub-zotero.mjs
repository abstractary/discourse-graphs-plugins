// Stands in for the Zotero desktop app's local API, for the real-app tests. It answers from the
// hand-written fixtures in test/fixtures/zotero and, like Zotero, ignores a request that looks
// like it came from a web page unless it says it is allowed.
//   node harness/stub-zotero.mjs   (port 23119, Zotero's own; stop Zotero first if it is running)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/zotero/${name}.json`, import.meta.url), "utf8"));
const items = fixture("items");
const server = createServer((req, res) => {
  const browserLike = (req.headers["user-agent"] ?? "").startsWith("Mozilla/") || req.headers.origin !== undefined;
  if (browserLike && !req.headers["zotero-allowed-request"]) return req.socket.destroy();
  const path = new URL(req.url, "http://localhost").pathname.replace(/^\/api/, "");
  const send = (body) => {
    res.writeHead(200, { "content-type": "application/json", "Zotero-Server-ID": "stub", "Zotero-API-Version": "3" });
    res.end(JSON.stringify(body));
  };
  if (path === "/users/0/items") return send([]);
  if (path === "/users/0/items/top") {
    const q = (new URL(req.url, "http://localhost").searchParams.get("q") ?? "").toLowerCase();
    return send(items.filter((item) => JSON.stringify(item.data).toLowerCase().includes(q)));
  }
  if (path === "/users/123456/items/ABCD2345") return send(items[0]);
  if (path === "/users/123456/items/ABCD2345/children") return send(fixture("children"));
  if (path === "/users/123456/items/PDFA0001/children") return send(fixture("annotations"));
  res.writeHead(404);
  res.end("Not found");
});
server.listen(23119, "127.0.0.1", () => console.log("Stand-in Zotero on http://localhost:23119/api"));
