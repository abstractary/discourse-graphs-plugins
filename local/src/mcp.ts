// The MCP server: an agent's way to read a vault.
//   node local/src/mcp.ts --vault <folder> [--widen] [--model-here] [--name "Agent name"]
// It speaks MCP on stdio, so a desktop client starts it and no port is opened. It reads every
// device's record log in the vault, as the local app does, and runs the core in the role `agent`:
// its key is one more device of the vault's person, with less it may do. This first version only
// reads. Nothing here shares, exports, publishes or fetches.
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DgRecord } from "@dg/contract/records.ts";
import type { SurfaceMessage, SurfacePort } from "@dg/contract/surface.ts";
import { createCore } from "@dg/core/index.ts";
import { readTools, type Call } from "./mcp-tools.ts";
import { openVault } from "./vault.ts";

const { values } = parseArgs({
  options: {
    vault: { type: "string" },
    keys: { type: "string" },
    name: { type: "string", default: "An agent" },
    // The person let this agent read what their lab shares, not only their own work.
    widen: { type: "boolean", default: false },
    // The person said the agent's model runs on this computer.
    "model-here": { type: "boolean", default: false },
  },
});
// Standard output carries the protocol. Everything said to a person goes to standard error.
const say = (line: string): void => void process.stderr.write(`${line}\n`);
if (!values.vault) {
  say("Usage: node local/src/mcp.ts --vault <folder> [--widen] [--model-here] [--name \"Agent name\"]");
  process.exit(1);
}

/**
 * An agent acts for the vault's person, so it starts as them: the person whose vault this is, as
 * the base that made it wrote them down. The local app on this computer is not that person.
 */
const owner = (records: DgRecord[]): { id: string; name: string } | undefined => {
  const people = records.filter((record): record is Extract<DgRecord, { kind: "person" }> => record.kind === "person" && Boolean(record.did) && Boolean(record.hostId));
  const first = people.filter((person) => !person.hostId!.startsWith("local-") && !person.hostId!.startsWith("agent-")).sort((a, b) => a.at.localeCompare(b.at))[0] ?? people.sort((a, b) => a.at.localeCompare(b.at))[0];
  return first ? { id: first.hostId!, name: first.name } : undefined;
};

let known = false;
const opened = openVault({
  vault: values.vault,
  keys: values.keys ?? join(homedir(), ".discourse-graphs", "mcp"),
  as: "agent",
  person: (records) => {
    const found = owner(records);
    known = Boolean(found);
    return found;
  },
});
if (!known) {
  say(`Nobody has used ${opened.path} yet. Open it in Obsidian with the Discourse Graphs plugin, or in the local app, and then start this again.`);
  opened.stop();
  process.exit(1);
}

const core = await createCore({ host: opened.host, keys: opened.keys, role: "agent", agentName: values.name });

// The tools ask the core what a panel would, over the same kind of port.
const waiting = new Map<string, (message: SurfaceMessage) => void>();
let deliver: (message: SurfaceMessage) => void = () => {};
const port: SurfacePort = {
  send: (message) => void ("id" in message ? waiting.get(message.id)?.(message) : undefined),
  onMessage: (handler) => {
    deliver = handler;
    return () => {};
  },
};
core.connectSurface({ port });
let asked = 0;
const call: Call = (method, params) =>
  new Promise((resolve, reject) => {
    asked += 1;
    const id = `mcp-${asked}`;
    waiting.set(id, (message) => {
      waiting.delete(id);
      const answer = message as { ok: boolean; result?: unknown; error?: { message: string } };
      if (answer.ok) resolve(answer.result as never);
      else reject(new Error(answer.error?.message ?? "The core refused."));
    });
    deliver({ id, method, params } as SurfaceMessage);
  });

const tools = readTools({ core, call, widen: values.widen, modelHere: values["model-here"] });
const server = new Server({ name: "discourse-graphs", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, title, description, inputSchema, outputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    outputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((item) => item.name === request.params.name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `No tool ${request.params.name}. There are: ${tools.map((item) => item.name).join(", ")}.` }] };
  try {
    const result = await tool.run((request.params.arguments ?? {}) as Record<string, unknown>);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
});

await server.connect(new StdioServerTransport());
say(`Discourse Graphs MCP server reading ${opened.path} as ${core.personName()}. ${values.widen ? "Lab work included where the lab's reach allows." : "Own work only."}`);

const close = (): void => {
  opened.stop();
  core.stop();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
process.stdin.on("close", close);
