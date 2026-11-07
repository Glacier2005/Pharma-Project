import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = path.resolve('.test-data');
await mkdir(root, { recursive: true });
const port = Number(process.env.TEST_PG_PORT || 55432);
const pg = new EmbeddedPostgres({
  databaseDir: path.join(root, 'postgres'), user: 'postgres', password: 'local-test-only',
  port, persistent: true, postgresFlags: ['-h', '127.0.0.1', '-c', 'max_connections=200'],
  onLog: () => {}, onError: message => { if (/ERROR|FATAL/.test(String(message))) console.error(message); },
});
function run(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
  });
}
let resultCode = 0;
try {
  try { await readFile(path.join(root, 'postgres', 'PG_VERSION')); } catch { await pg.initialise(); }
  await pg.start();
  const database = `pharma_test_${randomBytes(4).toString('hex')}`;
  await pg.createDatabase(database);
  const url = `postgresql://postgres:local-test-only@127.0.0.1:${port}/${database}?connection_limit=150&pool_timeout=30`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url,
    JWT_SECRET: 'isolated-test-signing-secret', PAYMENT_PROVIDER: 'local', STORAGE_PROVIDER: 'local',
    STORAGE_ROOT: path.join(root, 'storage'), GEMINI_API_KEY: '', NODE_ENV: 'test' };
  await run('scripts/migrate-deploy.cjs', [], env);
  await run('node_modules/jest/bin/jest.js', ['--runInBand', '--testTimeout=30000', ...process.argv.slice(2)], env);
} catch (error) {
  console.error(error.message);
  resultCode = 1;
} finally {
  await pg.stop();
}

process.exit(resultCode);
