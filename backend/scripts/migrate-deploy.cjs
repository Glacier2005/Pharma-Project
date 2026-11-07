const { PrismaClient } = require('@prisma/client');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
function prismaCommand(args) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Prisma ${args[0]} failed`);
}
async function main() {
  const prisma = new PrismaClient();
  try {
    // Historical migration names sort the payment ALTER before its baseline.
    // Bootstrap only an empty schema, preserving existing migration histories.
    const [{ count }] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`;
    if (count === 0) {
      prismaCommand(['db', 'execute', '--schema', 'prisma/schema.prisma', '--file', 'prisma/migrations/20260816_init_baseline/migration.sql']);
      prismaCommand(['migrate', 'resolve', '--applied', '20260816_init_baseline']);
    }
  } finally { await prisma.$disconnect(); }
  prismaCommand(['migrate', 'deploy']);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
