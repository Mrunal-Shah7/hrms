/**
 * Manual test script: provisions a test tenant.
 * Run: npx ts-node scripts/test-provisioning.ts
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantProvisioningService } from '../src/tenant/tenant-provisioning.service';
import * as bcrypt from 'bcrypt';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const provisioner = app.get(TenantProvisioningService);

  const passwordHash = await bcrypt.hash('Admin@123', 12);

  try {
    const result = await provisioner.provision({
      name: 'Acme Corporation',
      slug: 'acme-corp',
      billingEmail: 'billing@acme.com',
      subscriptionTier: 'with_recruitment',
      maxUsers: 50,
      registrationSource: 'super_admin',
      adminName: 'John Doe',
      adminEmail: 'john@acme.com',
      adminPasswordHash: passwordHash,
    });

    console.log('\n✅ Provisioning successful!');
    console.log('Tenant ID:', result.tenantId);
    console.log('Schema:', result.schemaName);
    console.log('Admin User ID:', result.adminUserId);
    console.log('Slug:', result.slug);
    console.log('\nAdmin login credentials:');
    console.log('Email: john@acme.com');
    console.log('Password: Admin@123');
  } catch (error) {
    console.error('❌ Provisioning failed:', (error as Error).message);
  }

  await app.close();
}

main();
