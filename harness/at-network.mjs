// A real AT Protocol network on this machine, for the scripts that publish: a PLC directory and a PDS
// from `@atproto/dev-env`, with one account. Prints one line of JSON when it is up, then stays until
// it is stopped. Everything lives in memory.
//   DG_DEVENV=<folder with @atproto/dev-env> node harness/at-network.mjs
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.DG_DEVENV) {
  console.error("Set DG_DEVENV to a folder where @atproto/dev-env is installed.");
  process.exit(2);
}
const { TestNetworkNoAppView } = await import(pathToFileURL(createRequire(join(resolve(process.env.DG_DEVENV), "package.json")).resolve("@atproto/dev-env")).href);
const handle = "mira.test";
const password = "proof-only-password";
const network = await TestNetworkNoAppView.create({ dbPostgresSchema: "dg_at_network" });
const account = await (await fetch(`${network.pds.url}/xrpc/com.atproto.server.createAccount`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ handle, email: "mira@example.test", password }) })).json();
console.log(JSON.stringify({ pds: network.pds.url, plc: network.plc.url, did: account.did, handle, password }));
const stop = async () => {
  await network.close().catch(() => undefined);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
