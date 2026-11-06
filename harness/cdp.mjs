// Evaluates a file or expression in the Roam Desktop page over the debug port.
// Usage: node harness/cdp.mjs eval '<expression>' | file <path> | shot <out.png> | reload
import { readFileSync, writeFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9333";
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === "page");
if (!target) throw new Error("no page target");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    nextId += 1;
    pending.set(nextId, resolve);
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
const evaluate = async (expression) => {
  const { result, error } = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    timeout: Number(process.env.CDP_TIMEOUT ?? 600000),
  });
  if (error) throw new Error(JSON.stringify(error));
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  }
  return result.result.value;
};

const [command, argument] = process.argv.slice(2);
if (command === "eval") {
  console.log(JSON.stringify(await evaluate(argument), null, 1));
} else if (command === "file") {
  console.log(JSON.stringify(await evaluate(readFileSync(argument, "utf8"))));
} else if (command === "shot") {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(argument, Buffer.from(result.data, "base64"));
  console.log(argument);
} else if (command === "reload") {
  await send("Page.reload", { ignoreCache: false });
  console.log("reloaded");
} else {
  throw new Error(`unknown command ${command}`);
}
socket.close();
