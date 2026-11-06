// Starts both ends of the demo: compute on this computer, and a stand-in for the
// Discourse Graphs service. Both keep their data under server/data.
//   npm run server
import { spawn } from "node:child_process";
import { join } from "node:path";

const INSTANCES = [
  { name: "local", port: 8787, kind: "local" },
  { name: "service", port: 8788, kind: "managed" },
];

const root = join(import.meta.dirname, "..");
const data = process.env.DG_DATA ?? join(root, "server", "data");

const children = INSTANCES.map(({ name, port, kind }) => {
  const child = spawn(process.execPath, [join(root, "server", "src", "main.ts")], {
    env: { ...process.env, PORT: String(port), DG_KIND: kind, DG_DATA: join(data, name) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      for (const line of String(chunk).trimEnd().split("\n")) console.log(`[${name}] ${line}`);
    });
  }
  child.on("exit", (code) => {
    console.log(`[${name}] stopped${code ? ` with code ${code}` : ""}`);
    stop();
  });
  return child;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
