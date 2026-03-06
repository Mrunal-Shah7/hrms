import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomThrottlerGuard } from './common/guards/throttle.guard';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantTasksModule } from './tenant/tenant-tasks.module';
import { PlatformAuthModule } from './platform/platform-auth/platform-auth.module';
import { PlatformDashboardModule } from './platform/dashboard/platform-dashboard.module';
import { PlatformTenantsModule } from './platform/tenants/platform-tenants.module';
import { PlatformBillingModule } from './platform/billing/platform-billing.module';
import { PlatformAdminsModule } from './platform/super-admins/platform-admins.module';
import { PlatformRegistrationsModule } from './platform/registrations/platform-registrations.module';
import { RegistrationModule } from './registration/registration.module';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './rbac/rbac.module';
import { FileStorageModule } from './core/file-storage/file-storage.module';
import { AccountModule } from './account/account.module';
import { TenantDashboardModule } from './dashboard/tenant-dashboard.module';
import { EmployeesModule } from './employees/employees.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { ReportingHierarchyModule } from './reporting-hierarchy/reporting-hierarchy.module';
import { GroupsModule } from './groups/groups.module';
import { ProjectsModule } from './projects/projects.module';
import { DelegationsModule } from './delegations/delegations.module';
import { LeaveModule } from './leave/leave.module';
import { TimeTrackerModule } from './time-tracker/time-tracker.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PerformanceModule } from './performance/performance.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { SubscriptionTierGuard } from './common/guards/subscription-tier.guard';
import { SeatLimitGuard } from './common/guards/seat-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    TenantModule,
    TenantTasksModule,
    PlatformAuthModule,
    PlatformDashboardModule,
    PlatformTenantsModule,
    PlatformBillingModule,
    PlatformAdminsModule,
    PlatformRegistrationsModule,
    RegistrationModule,
    AuthModule,
    FileStorageModule,
    RbacModule,
    AccountModule,
    TenantDashboardModule,
    EmployeesModule,
    DepartmentsModule,
    DesignationsModule,
    ReportingHierarchyModule,
    GroupsModule,
    ProjectsModule,
    DelegationsModule,
    LeaveModule,
    TimeTrackerModule,
    AttendanceModule,
    PerformanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
    SubscriptionTierGuard,
    SeatLimitGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'api/platform/(.*)', method: RequestMethod.ALL },
        { path: 'api/public/(.*)', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
