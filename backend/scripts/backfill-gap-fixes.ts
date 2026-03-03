/**
 * Backfill: Post-Sprint 2D Gap Fixes
 * - Fix 2: Add company_email_domain to organization_settings, backfill from admin user's email
 * - Fix 3: Seed notification_settings with 30 notification types
 *
 * Run: npx ts-node -r tsconfig-paths/register scripts/backfill-gap-fixes.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../src/tenant/tenant-seed-data';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  try {
    const tenants = await prisma.$queryRawUnsafe<
      Array<{ id: string; schema_name: string; name: string }>
    >(
      `SELECT id, schema_name, name FROM platform.tenants WHERE status != 'cancelled'`
    );

    console.log(`Found ${tenants.length} non-cancelled tenant(s) to backfill.\n`);

    for (const t of tenants) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET search_path TO "${t.schema_name}"`);

          // Fix 2: Add company_email_domain column if not exists
          await tx.$executeRawUnsafe(
            `ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS company_email_domain VARCHAR(255)`
          );

          // Fix 2: Backfill company_email_domain from first Admin user's email
          const adminRows = await tx.$queryRawUnsafe<
            Array<{ email: string }>
          >(
            `SELECT u.email FROM users u
             JOIN user_roles ur ON u.id = ur.user_id
             JOIN roles r ON ur.role_id = r.id
             WHERE r.name = 'Admin'
             LIMIT 1`
          );

          if (adminRows.length > 0) {
            const email = adminRows[0].email;
            const domain = email.includes('@') ? email.split('@')[1] : null;
            if (domain) {
              await tx.$executeRawUnsafe(
                `UPDATE organization_settings SET company_email_domain = $1`,
                domain
              );
              console.log(`  Company domain: ${domain}`);
            }
          }

          // Fix 3: Seed notification_settings (ON CONFLICT DO NOTHING)
          const values = DEFAULT_NOTIFICATION_SETTINGS.map(
            (s) =>
              `('${s.notificationType.replace(/'/g, "''")}', ${s.inAppEnabled}, ${s.emailEnabled})`
          ).join(',\n');
          await tx.$executeRawUnsafe(
            `INSERT INTO notification_settings (notification_type, in_app_enabled, email_enabled)
             VALUES ${values}
             ON CONFLICT (notification_type) DO NOTHING`
          );
        });

        console.log(`✓ ${t.name} (${t.schema_name}): backfill complete`);
      } catch (err) {
        console.error(
          `✗ ${t.name} (${t.schema_name}): ${(err as Error).message}`
        );
      }
    }

    console.log('\nBackfill complete.');
  } finally {
    await app.close();
  }
}

main();
