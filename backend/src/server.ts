import { buildApp } from './app';
import { connectDB } from './db';
import { config } from './config';

async function main(): Promise<void> {
  await connectDB();
  console.log(`[db] connected to ${config.mongoUri.replace(/\/\/.*@/, '//***@')}`);

  const app = buildApp();
  app.listen(config.port, () => {
    console.log(`[http] clinic backend listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error('[boot] failed to start:', err);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});