// The two real hosts a test can drive, behind one shape.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const obsidian = () => {
  const OB = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";
  const VAULT = "vault=dg-contract-sandbox";
  const PLUGIN = "app.plugins.plugins['discourse-graphs-demo']";
  // The CLI sometimes prints its answer and then doesn't exit, so an answer counts.
  const ob = (...args) => {
    try {
      return execFileSync(OB, [VAULT, ...args], { encoding: "utf8", timeout: 12000, killSignal: "SIGKILL" }).trim();
    } catch (error) {
      if (error.code === "ETIMEDOUT" && error.stdout?.trim()) return error.stdout.trim();
      throw error;
    }
  };
  const cdp = (method, params) => ob("dev:cdp", `method=${method}`, `params=${JSON.stringify(params)}`);
  // The window sits behind other apps, where the answer to an input event can
  // stall until the next frame. A blocked CLI call also blocks every call after
  // it, so give up on the answer quickly and force a frame to let the event through.
  const send = (method, params) => {
    try {
      return execFileSync(OB, [VAULT, "dev:cdp", `method=${method}`, `params=${JSON.stringify(params)}`], { encoding: "utf8", timeout: 4000, killSignal: "SIGKILL" });
    } catch (error) {
      if (error.code !== "ETIMEDOUT") throw error;
      stalls += 1;
      cdp("Page.captureScreenshot", { format: "jpeg", quality: 1 });
      return "";
    }
  };
  let stalls = 0;
  const prepare = () => {
    ob("dev:debug", "on");
    cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
    ob("eval", "code=(()=>{require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); app.workspace.rightSplit.collapse(); return 'on'})()");
  };
  prepare();
  return {
    name: "obsidian",
    titleOf: (abbreviation, content) => `${abbreviation} - ${content}`,
    slice: async (expression) => {
      const out = ob("eval", `code=(async()=>{const s=${PLUGIN}.slice; const v=await (${expression}); return JSON.stringify(v===undefined?null:v)})()`);
      return JSON.parse(out.replace(/^=> /, ""));
    },
    input: async (method, params) => send(method, params),
    shot: async (path) => ob("dev:screenshot", `path=${path}`),
    // A sandboxed frame runs in its own process, so the chooser has to be caught there.
    chooseFile: async (path, click) => {
      ob("eval", `code=(()=>{const d=require('@electron/remote').getCurrentWebContents().debugger; window.__chooser=null; window.__sessions=[]; window.__onChooser=(e,method,params,sessionId)=>{ if(method==='Target.attachedToTarget'){const id=params.sessionId; window.__sessions.push(id); d.sendCommand('Page.enable',{},id).then(()=>d.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true},id)).catch(()=>{});} if(method==='Page.fileChooserOpened'){window.__chooser=params; d.sendCommand('DOM.setFileInputFiles',{files:[${JSON.stringify(path)}],backendNodeId:params.backendNodeId},sessionId).catch(err=>{window.__chooser={error:String(err)}});}}; d.on('message',window.__onChooser); d.sendCommand('Target.setAutoAttach',{autoAttach:true,flatten:true,waitForDebuggerOnStart:false}); return 'armed'})()`);
      await sleep(600);
      await click();
      await sleep(1500);
      const seen = ob("eval", "code=JSON.stringify(window.__chooser)");
      ob("eval", "code=(()=>{const d=require('@electron/remote').getCurrentWebContents().debugger; for(const id of window.__sessions) d.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false},id).catch(()=>{}); d.sendCommand('Target.setAutoAttach',{autoAttach:false,flatten:true,waitForDebuggerOnStart:false}); d.removeListener('message',window.__onChooser); return 'done'})()");
      return JSON.parse(seen.replace(/^=> /, "") || "null");
    },
    reload: async () => {
      ob("reload");
      await sleep(7000);
      prepare();
    },
    finish: async () => console.log(`input stalls: ${stalls}`),
  };
};

export const roam = async () => {
  const pageOf = async () => (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((item) => item.type === "page");
  let socket;
  let id = 0;
  const pending = new Map();
  const open = async () => {
    socket = new WebSocket((await pageOf()).webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    };
  };
  const send = (method, params = {}) => new Promise((resolve) => { id += 1; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const run = async (expression) => {
    const { result, error } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (error) throw new Error(JSON.stringify(error));
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const inject = async () => {
    await run(readFileSync("dist/roam/extension.js", "utf8"));
  };
  const prepare = async () => {
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Page.startScreencast", { format: "jpeg", quality: 1, everyNthFrame: 120 });
    await inject();
  };
  await open();
  await prepare();
  return {
    name: "roam",
    titleOf: (abbreviation, content) => `[[${abbreviation}]] - ${content}`,
    slice: async (expression) => JSON.parse(await run(`(async()=>{const s=window.dgSlice; const v=await (${expression}); return JSON.stringify(v===undefined?null:v)})()`)),
    input: async (method, params) => send(method, params),
    // A sandboxed frame runs in its own process, so the chooser has to be caught there.
    chooseFile: async (path, click) => {
      const targets = await (await fetch("http://127.0.0.1:9333/json/list")).json();
      const frames = await Promise.all(targets.filter(({ type, url }) => type === "iframe" && url === "about:srcdoc").map(async ({ webSocketDebuggerUrl }) => {
        const frame = new WebSocket(webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { frame.onopen = resolve; frame.onerror = reject; });
        return frame;
      }));
      let seen = null;
      let next = 0;
      for (const frame of frames) {
        frame.onmessage = ({ data }) => {
          const message = JSON.parse(data);
          if (message.method !== "Page.fileChooserOpened") return;
          seen = message.params;
          frame.send(JSON.stringify({ id: 900, method: "DOM.setFileInputFiles", params: { files: [path], backendNodeId: seen.backendNodeId } }));
        };
        for (const [method, params] of [["Page.enable", {}], ["Page.setInterceptFileChooserDialog", { enabled: true }]]) {
          next += 1;
          frame.send(JSON.stringify({ id: next, method, params }));
        }
      }
      await sleep(300);
      await click();
      await sleep(1500);
      for (const frame of frames) {
        frame.send(JSON.stringify({ id: 901, method: "Page.setInterceptFileChooserDialog", params: { enabled: false } }));
        await sleep(50);
        frame.close();
      }
      return seen;
    },
    shot: async (path) => {
      const { result } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(result.data, "base64"));
    },
    reload: async () => {
      await send("Page.reload");
      await sleep(9000);
      socket.close();
      await open();
      await prepare();
    },
    finish: async () => socket.close(),
  };
};

