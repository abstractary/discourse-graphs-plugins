// What the real-Obsidian sessions share: checks, waiting, the mouse and the keyboard.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { obsidian, sleep } from "./hosts.mjs";

export { sleep };
export const q = JSON.stringify;

export const session = async ({ vault = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox", out, reload = true } = {}) => {
  mkdirSync(out, { recursive: true });
  if (reload) for (const file of ["main.js", "manifest.json"]) copyFileSync(`dist/obsidian/${file}`, `${vault}/.obsidian/plugins/discourse-graphs-demo/${file}`);
  const host = obsidian();
  if (reload) await host.reload();
  const s = host.slice;
  const results = [];
  const check = (id, pass, detail = "") => {
    results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 300) });
    console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail !== "" ? ` - ${String(detail).slice(0, 220)}` : ""}`);
    return Boolean(pass);
  };
  const note = (text) => console.log(`NOTE ${text}`);
  const until = async (work, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await work().catch(() => null);
      if (value || Date.now() > deadline) return value;
      await sleep(350);
    }
  };
  const shot = async (name) => {
    await sleep(600);
    await host.shot(`${out}/${name}.png`);
  };
  const mouse = (type, x, y, buttons = 0, clickCount = 1, modifiers = 0) =>
    host.input("Input.dispatchMouseEvent", { type, x, y, buttons, modifiers, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount });
  const at = (surface, method, selector) => s(`s.at(${q(surface)}, ${q(method)}, ${q(selector)})`);
  const settled = async (surface, selector, tries = 30) => {
    let last = null;
    for (let i = 0; i < tries; i += 1) {
      const box = await at(surface, "locate", selector).catch(() => null);
      if (box && last && Math.abs(box.x - last.x) < 1 && Math.abs(box.y - last.y) < 1) return box;
      last = box;
      await sleep(250);
    }
    return last;
  };
  const clickAt = async (x, y, count = 1, modifiers = 0) => {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y, 1, count, modifiers);
    await mouse("mouseReleased", x, y, 0, count, modifiers);
  };
  const click = async (surface, selector, { count = 1, modifiers = 0 } = {}) => {
    const box = await settled(surface, selector);
    if (!box) throw new Error(`Couldn't find ${selector} in ${surface}`);
    await clickAt(box.x + box.width / 2, box.y + box.height / 2, count, modifiers);
    return box;
  };
  const has = async (surface, selector) => ((await at(surface, "count", selector).catch(() => 0)) ?? 0) > 0;
  const type = async (text) => host.input("Input.insertText", { text });
  const key = async (name, code, modifiers = 0) => {
    await host.input("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
    await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers });
  };
  const call = (method, params = {}) => s(`s.call(${q(method)}, ${q(params)})`);
  const finish = async (name) => {
    const failed = results.filter((r) => !r.pass);
    writeFileSync(`${out}/${name}.json`, JSON.stringify({ at: new Date().toISOString(), passed: results.length - failed.length, total: results.length, failed }, null, 2));
    console.log(`${results.length - failed.length}/${results.length} passed`);
    await host.finish();
    return failed.length;
  };
  return { host, s, check, note, until, shot, mouse, at, settled, click, clickAt, has, type, key, call, finish, results };
};
