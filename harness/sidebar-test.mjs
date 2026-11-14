// The canvas sidebar in real Obsidian: Library, Search units and Units, floating and pinned.
//   npm run build:test, then: node harness/sidebar-test.mjs. Pictures go to reports/sidebar.
// Leaves nothing: the pin setting goes back to what it was, and the "People test" canvas goes if this run made it.
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";

const t = await session({ out: resolve("reports/sidebar") });
const { s, call, check, until, shot, at, has, click, cleanup, makeCanvas } = t;
try {
  await s("s.test(true)");
  await s("s.closeAll()");
  const pinned = (await call("prefs.get")).sidePinned;
  cleanup("the sidebar's pin setting", () => call("prefs.set", { sidePinned: pinned }));
  await call("prefs.set", { sidePinned: false });
  const board = (await call("canvas.list")).find((canvas) => canvas.title === "People test") ?? (await makeCanvas("People test"));
  await s(`s.open(${q(board.id)})`);
  await until(() => has("canvas", '[data-dg="side-toggle"]'), 8000);
  await sleep(1500);

  check("side.closed-to-begin-with", !(await has("canvas", '[data-dg="side"]')));
  await click("canvas", '[data-dg="side-toggle"]');
  check("side.opens-on-places", await until(() => has("canvas", '[data-dg="side-places"]'), 4000));
  check("side.floats-by-default", (await at("canvas", "count", '.shell[data-side="floating"]')) === 1);
  check("side.says-where-you-are", ((await at("canvas", "text", '[data-dg="side-here"]')) ?? "").includes("People test"), await at("canvas", "text", '[data-dg="side-here"]'));
  check("side.marks-the-open-canvas", ((await at("canvas", "text", '.side-row[aria-current="page"]')) ?? "").startsWith("People test"), await at("canvas", "text", '.side-row[aria-current="page"]'));
  const places = await call("repository.canvases", {});
  check("side.lists-every-canvas", (await at("canvas", "count", ".side-row")) === places.length, `${await at("canvas", "count", ".side-row")} of ${places.length}`);
  await shot("01-places-floating");

  await click("canvas", '[data-dg="side-tab-units"]');
  check("side.units-tab-lists-units-to-place", await until(() => has("canvas", '[data-dg="side"] .drawer-seg'), 5000));
  await shot("02-units");
  await click("canvas", '[data-dg="side-tab-search"]');
  check("side.search-tab-has-the-search", await until(() => has("canvas", '[data-dg="side"] [data-dg="search-panel"]'), 5000));
  await shot("03-search");

  // Floating, it goes when the canvas is clicked.
  const pane = await at("canvas", "locate", ".react-flow__pane");
  await t.clickAt(pane.x + pane.width - 60, pane.y + pane.height - 120);
  check("side.floating-goes-on-a-canvas-click", await until(async () => !(await has("canvas", '[data-dg="side"]')), 4000));
  // It comes back on the tab it was on.
  await click("canvas", '[data-dg="side-toggle"]');
  check("side.remembers-its-tab", await until(() => has("canvas", '[data-dg="side"] [data-dg="search-panel"]'), 4000));

  // Pinned, the canvas makes room and it stays.
  await click("canvas", '[data-dg="side-pin"]');
  check("side.pins", await until(async () => (await at("canvas", "count", '.shell[data-side="pinned"]')) === 1, 4000));
  const pinnedPane = await at("canvas", "locate", ".react-flow__pane");
  const sideBox = await at("canvas", "locate", '[data-dg="side"]');
  check("side.pinned-covers-nothing", pinnedPane.x >= sideBox.x + sideBox.width - 1, `pane at ${Math.round(pinnedPane.x)}, sidebar ends ${Math.round(sideBox.x + sideBox.width)}`);
  await t.clickAt(pinnedPane.x + pinnedPane.width - 60, pinnedPane.y + pinnedPane.height - 120);
  await sleep(600);
  check("side.pinned-stays-on-a-canvas-click", await has("canvas", '[data-dg="side"]'));

  // Going somewhere from the Library tab moves the canvas and the mark together.
  await click("canvas", '[data-dg="side-tab-places"]');
  const other = places.find((canvas) => canvas.id !== board.id && canvas.kind === "canvas" && canvas.workspace.kind === "own");
  if (other) {
    await click("canvas", '[data-dg="side-find"]');
    await t.type(other.title);
    await sleep(500);
    await click("canvas", `.side-row[title=${q(other.title)}]`);
    check("side.going-somewhere-moves-the-mark", await until(async () => ((await at("canvas", "text", '.side-row[aria-current="page"]')) ?? "").startsWith(other.title), 6000), other.title);
    check("side.title-follows", await until(async () => ((await at("canvas", "text", '[data-dg="canvas-menu"]')) ?? "").startsWith(other.title.slice(0, 12)), 6000));
  }
  await sleep(600);
  await shot("04-pinned");
  await call("prefs.set", { sidePinned: false });
} finally {
  await cleanup.run();
}
process.exit(await t.finish("sidebar"));
