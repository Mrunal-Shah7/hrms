/**
 * Migration: Adds user_preferences table to existing tenant schemas that don't have it.
 * Run: npx ts-node -r tsconfig-paths/register scripts/add-user-preferences-to-tenants.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const USER_PREFERENCES_DDL = `
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_format VARCHAR(20),
  timezone VARCHAR(50),
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  profile_picture_visibility VARCHAR(20) NOT NULL DEFAULT 'everyone',
  new_sign_in_alert BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  try {
    const tenants = await prisma.$queryRawUnsafe<
      Array<{ schema_name: string; name: string }>
    >(
      `SELECT schema_name, name FROM platform.tenants WHERE status = 'active'`
    );

    console.log(`Found ${tenants.length} tenant(s) to migrate.\n`);

    for (const t of tenants) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET search_path TO "${t.schema_name}"`);
          await tx.$executeRawUnsafe(USER_PREFERENCES_DDL.trim());
        });
        console.log(`✓ ${t.name} (${t.schema_name}): user_preferences table ensured`);
      } catch (err) {
        console.error(
          `✗ ${t.name} (${t.schema_name}): ${(err as Error).message}`
        );
      }
    }

    console.log('\nMigration complete.');
  } finally {
    await app.close();
  }
}

main();
