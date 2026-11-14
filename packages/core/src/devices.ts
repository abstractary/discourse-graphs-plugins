import { revise } from "@dg/contract/records.ts";
import type { DeviceView } from "@dg/contract/surface.ts";
import type { Context, Handlers } from "./context.ts";
import type { KeyStore } from "./identity.ts";
import { signingKeyOf, trustedKeys, vouchFor } from "./signing.ts";

/**
 * A person's devices. The key their DID was made with stays on the device that
 * made it. Every other device, and every agent, has a key of its own and signs
 * with that once a device already trusted has vouched for it.
 */
export const deviceFeature = (
  context: Context,
  {
    did,
    deviceKey,
    signing,
    keys,
  }: {
    /** This person's DID. */
    did: () => string;
    /** This device's own key as a `did:key`, or null on the device the DID was made on. */
    deviceKey: string | null;
    /** The pair this device signs with, once it has one. */
    signing: () => CryptoKeyPair | null;
    keys: KeyStore;
  },
) => {
  const person = () => context.documents("person").find((item) => item.did === did());

  /** The key this device signs with, as others name it. */
  const myKey = async (): Promise<string | null> => {
    if (deviceKey) return deviceKey;
    const me = person();
    return me ? signingKeyOf(me) : null;
  };
  /** Whether labmates will take what this device signs: it is the first device, or one of this person's trusted devices vouched for it. */
  const trusted = async (): Promise<boolean> => {
    if (!deviceKey) return true;
    const me = person();
    return me ? (await trustedKeys(me, context.documents("device"))).includes(deviceKey) : false;
  };
  const list = async (): Promise<DeviceView[]> => {
    const me = person();
    const keysOf = me ? await trustedKeys(me, context.documents("device")) : [];
    const mine = context.documents("device").filter((device) => device.by.id === did());
    return [
      { id: "first", name: "The device you started on", role: "device", here: !deviceKey, state: "trusted", fingerprint: (keysOf[0] ?? "").slice(-8) },
      ...mine.map((device): DeviceView => ({
        id: device.id,
        name: device.name,
        role: device.role,
        here: device.key === deviceKey,
        state: device.removed ? "removed" : keysOf.includes(device.key) ? "trusted" : "waiting",
        fingerprint: device.key.slice(-8),
        at: device.at,
      })),
    ];
  };

  const handlers: Pick<Handlers, "device.list" | "device.approve" | "device.remove"> = {
    "device.list": list,
    "device.approve": async ({ id }) => {
      const device = context.documents("device").find((item) => item.id === id && item.by.id === did());
      if (!device || device.removed) throw new Error("That device isn't asking any more.");
      const by = await myKey();
      const pair = signing();
      if (!pair || !by || !(await trusted())) throw new Error("Approve it from a device that is already trusted, such as the one you started on.");
      const vouch = await vouchFor({ did: did(), key: device.key, by, pair, keys });
      await context.put([revise({ record: device, changes: { vouch }, by: context.me() })]);
      return list();
    },
    "device.remove": async ({ id }) => {
      const device = context.documents("device").find((item) => item.id === id && item.by.id === did());
      if (!device) return list();
      if (!(await trusted())) throw new Error("Remove it from a device that is already trusted.");
      await context.put([revise({ record: device, changes: { removed: true }, by: context.me() })]);
      return list();
    },
  };
  return { handlers, trusted, myKey };
};
