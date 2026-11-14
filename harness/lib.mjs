// What the real-app sessions share: checks, waiting, the mouse and the keyboard, and taking back what a run made.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { obsidian, sleep } from "./hosts.mjs";

export { sleep };
export const q = JSON.stringify;
/** The middle of a box, as the two numbers a click takes. */
export const centre = (box) => [box.x + box.width / 2, box.y + box.height / 2];

const KEYS = { Enter: 13, Escape: 27, Delete: 46, F2: 113, Backspace: 8 };

/**
 * The helpers, around a host from hosts.mjs: Obsidian or Roam.
 * `wait` is how `until` waits when a call names no timeout: how long, how often it asks, and whether an error
 * from the question ends the run (`strict`) or counts as "not yet". `settle` is how often `settled` looks.
 */
export const tools = (host, { wait: { timeout: patience = 20000, every = 350, strict = false } = {}, settle = 250 } = {}) => {
  const s = host.slice;
  const results = [];
  const check = (id, pass, detail = "") => {
    results.push({ id, pass: Boolean(pass), detail: String(detail).slice(0, 300) });
    console.log(`${pass ? "PASS" : "FAIL"} ${id}${detail !== "" ? ` - ${String(detail).slice(0, 220)}` : ""}`);
    return Boolean(pass);
  };
  const note = (text) => console.log(`NOTE ${text}`);
  const until = async (work, timeout = patience) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = strict ? await work() : await work().catch(() => null);
      if (value || Date.now() > deadline) return value;
      await sleep(every);
    }
  };

  // ---- The mouse
  const mouse = (type, x, y, buttons = 0, clickCount = 1, modifiers = 0) =>
    host.input("Input.dispatchMouseEvent", { type, x, y, buttons, modifiers, button: type === "mouseMoved" && !buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : clickCount });
  /** A click at a point. A double click is two presses, the second counted as the second. */
  const clickAt = async (x, y, count = 1, modifiers = 0) => {
    await mouse("mouseMoved", x, y);
    for (let n = 1; n <= count; n += 1) {
      await mouse("mousePressed", x, y, 1, n, modifiers);
      await mouse("mouseReleased", x, y, 0, n, modifiers);
    }
  };
  /** A drag between two points with the button held, in eight steps. */
  const drag = async (from, to) => {
    await mouse("mouseMoved", ...from);
    await mouse("mousePressed", ...from, 1);
    for (let step = 1; step <= 8; step += 1) {
      await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * step) / 8, from[1] + ((to[1] - from[1]) * step) / 8, 1);
    }
    await mouse("mouseReleased", ...to);
    await sleep(500);
  };

  // ---- Finding things. A panel is asked by its surface name with `at`, which only Obsidian has, or through
  // one of the plugin's probes by name: "s" is the canvas, "s.ctx" the Context panel, "s.list" the Library,
  // "s.search" and "s.dialog". Both bases have the probes.
  const at = (surface, method, selector) => s(`s.at(${q(surface)}, ${q(method)}, ${q(selector)})`);
  const has = async (surface, selector) => ((await at(surface, "count", selector).catch(() => 0)) ?? 0) > 0;
  /** Where something is once it has stopped moving: a canvas fits itself after a switch. */
  const settled = async (surface, selector, tries = 30) => {
    let last = null;
    for (let i = 0; i < tries; i += 1) {
      const box = await at(surface, "locate", selector).catch(() => null);
      if (box && last && Math.abs(box.x - last.x) < 1 && Math.abs(box.y - last.y) < 1) return box;
      last = box;
      await sleep(settle);
    }
    return last;
  };
  const click = async (surface, selector, { count = 1, modifiers = 0 } = {}) => {
    const box = await settled(surface, selector);
    if (!box) throw new Error(`Couldn't find ${selector} in ${surface}`);
    await clickAt(...centre(box), count, modifiers);
    return box;
  };
  /** Where a probe first finds something, moving or not. `probe` is a probe's name, or a function from a selector to its box. */
  const where = (probe, selector, timeout) => until(() => (typeof probe === "function" ? probe(selector) : s(`${probe}.locate(${q(selector)})`)), timeout);
  /** A click on the first place a probe finds something. It doesn't wait for it to stop moving, as `click` does. */
  const clickIn = async (probe, selector, { timeout, count = 1, modifiers = 0 } = {}) => {
    const box = await where(probe, selector, timeout);
    if (!box) throw new Error(`Couldn't find ${selector}${typeof probe === "string" ? ` in ${probe}` : ""}`);
    await clickAt(...centre(box), count, modifiers);
    return box;
  };
  /** A probe for the base's own page, outside any frame: `clickIn(inPage, selector)`. */
  const inPage = (selector) => s(`(() => { const r = document.querySelector(${q(selector)})?.getBoundingClientRect(); return r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`);

  // ---- The keyboard
  /** Text put in at once, as a paste is. */
  const type = async (text) => host.input("Input.insertText", { text });
  /** Typing key by key, as a person does, into whatever has the keyboard. */
  const typeKeys = async (text) => {
    for (const char of text) {
      await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char, unmodifiedText: char });
      await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: char });
    }
  };
  /** One letter or sign with its physical key named, which is what a shortcut listens for. */
  const typeChar = async (text, code, keyCode) => {
    await host.input("Input.dispatchKeyEvent", { type: "keyDown", key: text, code, text, windowsVirtualKeyCode: keyCode });
    await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: text, code, windowsVirtualKeyCode: keyCode });
  };
  /** A key that isn't text. `code` names the physical key where it differs from the key's name; `commands` runs an editing command, as a base's Edit menu would. */
  const key = async (name, keyCode, modifiers = 0, { code = name, commands } = {}) => {
    await host.input("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code, windowsVirtualKeyCode: keyCode, modifiers, ...(commands ? { commands } : {}) });
    await host.input("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode: keyCode, modifiers });
  };
  /** A key by its name with modifiers held: `press("z", { meta: true })`. */
  const press = (name, { meta = false, shift = false, alt = false, commands } = {}) =>
    key(name, KEYS[name] ?? name.toUpperCase().charCodeAt(0), (alt ? 1 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0), { code: KEYS[name] ? name : `Key${name.toUpperCase()}`, commands });

  const call = (method, params = {}) => s(`s.call(${q(method)}, ${q(params)})`);

  // ---- Taking things back
  const undos = [];
  const undo = async (entry) => {
    if (entry.done) return;
    entry.done = true;
    try {
      await entry.work();
    } catch (error) {
      note(`cleanup: couldn't take back ${entry.what}: ${error}`);
    }
  };
  /**
   * Says how to take back something a run just made or changed. `cleanup.run()` goes in a `finally`, where it
   * takes everything back, last made first, whether the run finished or stopped; one that fails is noted and the
   * rest still go. What `cleanup` returns takes that one thing back early, once, for a run that checks it is gone.
   */
  const cleanup = (what, work) => {
    const entry = { what, work, done: false };
    undos.push(entry);
    return () => undo(entry);
  };
  cleanup.run = async () => {
    for (const entry of [...undos].reverse()) await undo(entry);
  };
  /**
   * Takes back a unit this person made. The relations it is in are withdrawn first; `node.remove` then takes its
   * cards, the lines drawn to them and its note. Core keeps the records, marked as removed.
   */
  const removeUnit = async (id) => {
    const view = await call("node.view", { id });
    for (const { relation, state } of view.context) if (state === "active" || state === "pending") await call("relation.withdraw", { id: relation.id });
    await call("node.remove", { id });
  };
  /** The same for every unit with exactly this title: for one made through the app's own buttons, where no id comes back. */
  const removeTitled = async (title) => {
    for (const unit of await call("node.query", { text: title, limit: 50 })) if (unit.title === title) await removeUnit(unit.id);
  };

  /** A unit made through core, taken back when the run cleans up. */
  const makeUnit = async (params) => {
    const unit = await call("node.create", params);
    cleanup(`the unit "${params.title}"`, () => removeUnit(unit.id));
    return unit;
  };
  /** A canvas made through core, taken back when the run cleans up. Its cards go with it, and the units on them stay. */
  const makeCanvas = async (title) => {
    const canvas = await call("canvas.create", { title });
    cleanup(`the canvas "${title}"`, () => call("canvas.remove", { id: canvas.id }));
    return canvas;
  };

  return { host, s, results, check, note, until, mouse, clickAt, drag, at, has, settled, click, where, clickIn, inPage, type, typeKeys, typeChar, key, press, call, cleanup, removeUnit, removeTitled, makeUnit, makeCanvas };
};

/**
 * A session in real Obsidian on the sandbox vault: the build copied in and the plugin reloaded, then the helpers,
 * pictures and a report in `out`. `shots: false` takes no pictures, and `shotPause` is the wait before each.
 */
export const session = async ({ vault = process.env.DG_SANDBOX ?? "sandbox/dg-contract-sandbox", out, reload = true, shots = true, shotPause = 600, ...options } = {}) => {
  mkdirSync(out, { recursive: true });
  if (reload) for (const file of ["main.js", "manifest.json"]) copyFileSync(`dist/obsidian/${file}`, `${vault}/.obsidian/plugins/discourse-graphs-demo/${file}`);
  const host = obsidian();
  if (reload) await host.reload();
  const t = tools(host, options);
  const shot = async (name) => {
    if (!shots) return;
    await sleep(shotPause);
    await host.shot(`${out}/${name}.png`);
  };
  const finish = async (name) => {
    const failed = t.results.filter((r) => !r.pass);
    writeFileSync(`${out}/${name}.json`, JSON.stringify({ at: new Date().toISOString(), passed: t.results.length - failed.length, total: t.results.length, failed }, null, 2));
    console.log(`${t.results.length - failed.length}/${t.results.length} passed`);
    await host.finish();
    return failed.length;
  };
  return { ...t, shot, finish };
};
