// Scratch driver: profile, hover card and note authors in the sandbox vault. Not a test.
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";
const t = await session({ out: resolve("reports/try") });
const { call, s, at, until, has, shot, click, mouse } = t;
await s("s.test(true)");
const paper = (await call("paper.list")).find((item) => item.filename === "Carroll-2020-edge-of-chaos.pdf");
await s("s.closeAll()");
await s(`s.open(${q(paper.canvas)})`);
await until(async () => ((await at("canvas", "count", ".react-flow__node")) ?? 0) >= 30);
await sleep(1500);
const all = await s(`s.count(".card button.mark")`);
// The first card whose initials are on screen.
let mark = null;
for (const title of Object.values((await call("canvas.open", { id: paper.canvas })).nodes).map((node) => node.title)) {
  const box = await at("canvas", "locate", `[data-dg="credit-${title}"]`).catch(() => null);
  if (box && box.x > 300 && box.x < 1300 && box.y > 200 && box.y < 900) { mark = box; break; }
}
console.log("marks", all);
console.log("mark", JSON.stringify(mark));
await mouse("mouseMoved", mark.x + mark.width / 2, mark.y + mark.height / 2);
console.log("card shows", await until(() => has("canvas", '[data-dg="person-card"]'), 4000), await at("canvas", "text", '[data-dg="person-card"]'));
await shot("hover-card");
await t.clickAt(mark.x + mark.width / 2, mark.y + mark.height / 2);
console.log("profile opens", await until(() => has("profile", '[data-dg="profile"]'), 8000));
await sleep(800);
console.log("name", await at("profile", "text", '[data-dg="profile-name"]'), "| audience:", await at("profile", "text", '[data-dg="profile-audience"]'));
console.log("tabs", await at("profile", "text", ".profile-tabs"), "| written", await at("profile", "text", '[data-dg="profile-written"]'), "read", await at("profile", "text", '[data-dg="profile-read"]'));
await shot("profile-private");
if (await has("profile", '[data-dg="profile-tab-lab"]')) { await click("profile", '[data-dg="profile-tab-lab"]'); await sleep(500); await shot("profile-lab"); console.log("lab:", await at("profile", "text", '[data-dg="profile-audience"]')); }
await click("profile", '[data-dg="profile-tab-public"]');
await sleep(500);
console.log("public:", await at("profile", "text", '[data-dg="profile-audience"]'), "| history shown:", await has("profile", '[data-dg="profile-history"]'));
await shot("profile-public");
process.exit(await t.finish("try"));
