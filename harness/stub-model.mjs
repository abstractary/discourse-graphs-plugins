// A stand-in for a local model server, in the OpenAI-compatible shape Ollama speaks. It answers from the units it is
// sent and cites two of them. For harness/guide-test.mjs and for trying Ask AI by hand, never for real use.
//   node harness/stub-model.mjs
import { createServer } from "node:http";
createServer(async (req, res) => {
  try {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    if (req.method === "OPTIONS") return res.end();
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "qwen3:8b" }, { id: "gpt-oss:20b" }] }));
    let body = ""; for await (const c of req) body += c;
    const found = /Canvas units:\n([\s\S]*)\n\nQuestion:/.exec(JSON.parse(body).messages[1].content);
    const units = found ? JSON.parse(found[1]) : [];
    const pick = units.filter((u) => /claim|CLM/i.test(u.type)).slice(0, 2);
    const words = pick.length < 2 ? ["ready"] : `Two claims on this canvas bear on that. The first: ${pick[0].title.slice(0, 90)}… [${pick[0].id}]. The second: ${pick[1].title.slice(0, 80)}… [${pick[1].id}]. Each rests on a single run, so neither is replicated yet.`.split(/(?<= )/);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const w of words) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); await new Promise((r) => setTimeout(r, 25)); }
    res.end("data: [DONE]\n\n");
  } catch (error) { res.statusCode = 500; res.end(String(error)); }
}).listen(18434, "127.0.0.1", () => console.log("stub on 18434"));
