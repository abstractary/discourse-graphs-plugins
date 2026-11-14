import type { AddressInfo } from 'node:net';
import { aiRoutes } from './ai.ts';
import { computeRoutes } from './compute.ts';
import type { Config } from './config.ts';
import { loadDemoPapers } from './extract/demo-replay.ts';
import { graphRoutes } from './graphs.ts';
import { createHttpServer } from './http.ts';
import { labRoutes } from './labs.ts';
import { notifyRoutes } from './notify.ts';
import { paperRoutes } from './papers.ts';
import { signpostingRoutes } from './signposting.ts';
import { createStore } from './store.ts';
import { syncRoutes } from './sync.ts';

export type RunningServer = {
  port: number;
  demoPapers: number;
  close: () => Promise<void>;
};

export async function startServer(config: Config): Promise<RunningServer> {
  const store = createStore(config.dataDir);
  const demoPapers = loadDemoPapers(config.demoPapersDir);
  const server = createHttpServer(
    [
      ...computeRoutes(config, demoPapers),
      ...graphRoutes(store),
      ...labRoutes(store),
      ...syncRoutes(store),
      ...paperRoutes(store),
      ...aiRoutes(config, store),
      ...signpostingRoutes(config, store),
      ...notifyRoutes(config, store),
    ],
    config.maxBodyBytes,
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    demoPapers: demoPapers.length,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
