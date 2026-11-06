import assert from "node:assert/strict";
import test from "node:test";
import { CHECKS, runConformance, type ConformanceSetup } from "@dg/contract/conformance.ts";
import { ok, type Host, type HostListener } from "@dg/contract/host.ts";
import {
  createMemorySetup,
  createMemoryStore,
} from "@dg/contract/memory-host.ts";
import type { DgRecord } from "@dg/contract/records.ts";

const failuresOf = async (
  setup: () => Promise<ConformanceSetup>,
): Promise<string[]> =>
  (await runConformance({ setup }))
    .filter((result) => !result.pass)
    .map((result) => result.id);

test("the reference host passes every check", async () => {
  const results = await runConformance({
    setup: async () => createMemorySetup(),
  });
  assert.equal(results.length, CHECKS.length);
  assert.deepEqual(
    results.filter((result) => !result.pass),
    [],
  );
});

const broken: {
  name: string;
  expected: string[];
  setup: () => Promise<ConformanceSetup>;
}[] = [
  {
    name: "refs that break on rename, like a file path",
    expected: ["text.ref-survives-rename", "text.ref-survives-outside-rename"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      const moved = new Set<string>();
      return {
        host: {
          ...host,
          renameText: async (args) => {
            moved.add(args.ref);
            return host.renameText(args);
          },
          readText: async (args) =>
            moved.has(args.ref)
              ? { ok: false, error: { code: "not-found", message: "moved" } }
              : host.readText(args),
        },
        driver: {
          ...driver,
          renameOutside: async (args) => {
            moved.add(args.ref);
            await driver.renameOutside(args);
          },
        },
      };
    },
  },
  {
    name: "a rename reported as a removal",
    expected: ["events.rename-is-not-a-removal"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      const listeners = new Set<HostListener>();
      return {
        host: {
          ...host,
          subscribe: (listener) => {
            listeners.add(listener);
            const stop = host.subscribe(listener);
            return () => {
              listeners.delete(listener);
              stop();
            };
          },
        },
        driver: {
          ...driver,
          renameOutside: async (args) => {
            await driver.renameOutside(args);
            for (const listener of listeners) {
              listener({ type: "text-removed", ref: args.ref });
            }
          },
        },
      };
    },
  },
  {
    name: "storage that drops fields it doesn't know",
    expected: ["records.unknown-fields-survive"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        driver,
        host: {
          ...host,
          putRecords: async ({ records }) =>
            host.putRecords({
              records: records.map((record) => {
                const { ext: _ext, ...kept } = record as DgRecord & {
                  addedByALaterVersion?: unknown;
                };
                delete kept.addedByALaterVersion;
                return kept as DgRecord;
              }),
            }),
        },
      };
    },
  },
  {
    name: "writes that aren't idempotent or validated",
    expected: ["records.idempotent", "records.invalid-batch-stores-nothing"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        driver,
        host: {
          ...host,
          putRecords: async ({ records }) => {
            for (const record of records) {
              await driver.writeRecordOutside({ record });
            }
            return ok({ stored: records.length });
          },
        },
      };
    },
  },
  {
    name: "an in-place store where the last write wins regardless of version",
    expected: ["records.stale-write-loses"],
    setup: async () => {
      const store = createMemoryStore();
      const { host, driver } = createMemorySetup(store);
      return {
        driver,
        host: {
          ...host,
          putRecords: async ({ records }) => {
            const ids = new Set(records.map((record) => record.id));
            store.records = store.records.filter((item) => !ids.has(item.id));
            return host.putRecords({ records });
          },
        },
      };
    },
  },
  {
    name: "a cursor that misses later writes",
    expected: ["records.cursor-sees-later-writes"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        driver,
        host: {
          ...host,
          listRecords: async (args) => {
            const page = await host.listRecords(args);
            if (!page.ok || !args.after || !page.value.done) return page;
            return ok({ ...page.value, items: [] });
          },
        },
      };
    },
  },
  {
    name: "storage that forgets on restart",
    expected: ["records.survive-reload", "local.stays-out-of-records"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        host,
        driver: {
          ...driver,
          reload: async () => createMemorySetup().host,
        },
      };
    },
  },
  {
    name: "a host that never reports changes",
    expected: [
      "events.outside-changes",
      "events.record-from-elsewhere",
      "events.own-writes-also-fire",
    ],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return { driver, host: { ...host, subscribe: () => () => {} } };
    },
  },
  {
    name: "listeners that can't be removed",
    expected: ["events.unsubscribe-stops-delivery"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        driver,
        host: {
          ...host,
          subscribe: (listener) => {
            host.subscribe(listener);
            return () => {};
          },
        },
      };
    },
  },
  {
    name: "a host that throws instead of returning an error",
    expected: ["text.missing-is-not-found"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      return {
        driver,
        host: {
          ...host,
          readText: async (args) => {
            const result = await host.readText(args);
            if (!result.ok) throw new Error("boom");
            return result;
          },
        },
      };
    },
  },
  {
    name: "results that aren't plain JSON",
    expected: ["describe.shape"],
    setup: async () => {
      const { host, driver } = createMemorySetup();
      const describe: Host["describe"] = async () => {
        const result = await host.describe();
        return result.ok
          ? ok({ ...result.value, adapterVersion: new Date() as unknown as string })
          : result;
      };
      return { driver, host: { ...host, describe } };
    },
  },
];

for (const { name, expected, setup } of broken) {
  test(`the suite catches ${name}`, async () => {
    const failures = await failuresOf(setup);
    for (const id of expected) {
      assert.ok(failures.includes(id), `${id} should fail, got ${failures}`);
    }
  });
}
