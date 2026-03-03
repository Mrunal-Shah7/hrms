import { Module } from '@nestjs/common';
import { TenantTasksService } from './tenant-tasks.service';
import { PlatformTenantsModule } from '../platform/tenants/platform-tenants.module';

@Module({
  imports: [PlatformTenantsModule],
  providers: [TenantTasksService],
})
export class TenantTasksModule {}
