import type { Context, Handlers } from "./context.ts";
import { refuse, value } from "./refuse.ts";


/**
 * What a panel asks of the base around it: open another panel or a dialog,
 * open a link, show a unit's own text, and list or change the model servers.
 * A panel is sandboxed, so each of these goes through the base.
 */
export const shellFeature = (context: Context) => {
  const handlers: Pick<Handlers, "panel.open" | "dialog.open" | "dialog.close" | "server.list" | "server.add" | "server.remove" | "server.check" | "server.options" | "link.open" | "base.reveal"> = {
    "panel.open": async ({ surface }) => {
      value(await context.host.openSurface({ route: { surface }, placement: "side" }));
      return null;
    },
    "dialog.open": async ({ surface, id }) => {
      value(await context.host.openSurface({ route: { surface, ...(id ? { id } : {}) }, placement: "dialog" }));
      return null;
    },
    "dialog.close": async () => {
      value(await context.host.closeDialog());
      return null;
    },
    // A member's own servers, then the ones their lab offers everyone.
    "server.list": async () => {
      const own = context.services ? await context.services.servers() : [];
      const offered = (context.myLab()?.settings?.servers ?? []).filter((server) => !own.some((mine) => mine.url === server.url));
      return [...own, ...offered.map((server) => ({ id: `lab:${server.url}`, name: server.name, url: server.url, kind: "lab" as const }))];
    },
    "server.add": async (server) => {
      if (!context.services) throw refuse("unavailable", "No services are set up here.");
      return context.services.addServer(server);
    },
    "server.remove": async ({ id }) => {
      await context.services?.removeServer(id);
      return null;
    },
    "server.check": async ({ url }) => {
      if (!context.services) throw refuse("unavailable", "No services are set up here.");
      return context.services.check(url);
    },
    "server.options": async ({ url }) => {
      if (!context.services) throw refuse("unavailable", "No services are set up here.");
      const [models, schemas] = await Promise.all([context.services.models(url), context.services.schemas(url)]);
      return { models, schemas };
    },
    "link.open": async ({ url }) => {
      // A panel is sandboxed, so the base opens links for it. Nothing but a web address gets through.
      // A reference library's own links open its desktop app at an item or a passage.
      if (!/^(https?:\/\/|zotero:\/\/(select|open-pdf)\/)[^\s]+$/i.test(url)) throw new Error("That isn't a web address.");
      value(await context.host.openLink({ url }));
      return null;
    },
    "base.reveal": async ({ id, placement }) => {
      const anchor = context.anchorOf(id);
      if (!anchor) throw new Error("This node has no text in this space.");
      value(await context.host.reveal({ ref: anchor.ref, placement }));
      return null;
    } };
  return { handlers };
};
