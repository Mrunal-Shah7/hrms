import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting platform seed...');

  const setupSQL = fs.readFileSync(
    path.join(__dirname, 'setup-platform.sql'),
    'utf8'
  );

  // Remove single-line comments and run as one batch (pg supports multiple statements)
  const sqlWithoutComments = setupSQL
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  await prisma.$executeRawUnsafe(sqlWithoutComments);

  console.log('✅ Platform schema and tables created');

  const email = process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'shahmrunal777@gmail.com';
  const password = process.env.DEFAULT_SUPER_ADMIN_PASSWORD || 'pmscrm007';
  const name = process.env.DEFAULT_SUPER_ADMIN_NAME || 'Platform Admin';
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM platform.super_admins WHERE email = $1`,
    email
  );

  if (existing.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO platform.super_admins (id, email, password_hash, name, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, TRUE, NOW())`,
      email,
      passwordHash,
      name
    );
    console.log(`✅ Default super admin created: ${email}`);
  } else {
    console.log(`ℹ️ Super admin already exists: ${email}`);
  }

  console.log('🌱 Platform seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
