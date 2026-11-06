import { startServer } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

try {
  const { port, demoPapers, close } = await startServer(config);
  console.log(`DG reference server listening on http://${config.host}:${port}`);
  console.log(`Data folder: ${config.dataDir}`);
  if (demoPapers === 0) {
    console.warn(`No demo papers found in ${config.demoPapersDir}. demo-replay will refuse every file. Set DG_DEMO_PAPERS to fix this.`);
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void close().then(() => process.exit(0));
    });
  }
} catch (error) {
  const inUse = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
  console.error(inUse ? `Port ${config.port} is in use. Stop the other process, or set PORT.` : 'The server could not start.');
  if (!inUse) console.error(error);
  process.exit(1);
}
