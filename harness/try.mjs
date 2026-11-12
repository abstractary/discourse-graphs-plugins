// Scratch driver: node harness/try.mjs '<async body using t>' — for looking around a live sandbox.
import { resolve } from "node:path";
import { q, session, sleep } from "./lib.mjs";
const t = await session({ out: resolve("reports/science"), reload: Boolean(process.env.DG_RELOAD) });
const body = process.argv[2];
const run = new Function("t", "q", "sleep", `return (async () => { ${body} })()`);
try { const out = await run(t, q, sleep); if (out !== undefined) console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1)); } catch (error) { console.log("ERR", error.message); }
process.exit(0);
