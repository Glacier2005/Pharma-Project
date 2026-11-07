import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  try {
    const sqlPath = path.join(__dirname, 'prisma', 'migrations', '20240816000000_phase2', 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log("Executing migration SQL...");
    const statements = sql.split(';').filter(stmt => stmt.trim() !== '');
    
    for (const stmt of statements) {
      if (stmt.trim().length > 0) {
        console.log("Executing:", stmt.substring(0, 50) + "...");
        try {
          await prisma.$executeRawUnsafe(stmt);
        } catch (e: any) {
          if (e.message && (e.message.includes('already exists') || e.message.includes('42701') || e.message.includes('duplicate'))) {
            console.log("Ignoring already exists error.");
          } else {
            throw e;
          }
        }
      }
    }
    console.log("Migration executed successfully.");
  } catch (e) {
    console.error("Migration failed:", e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
