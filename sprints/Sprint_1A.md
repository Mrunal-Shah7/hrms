# Sprint 1A — Project Scaffolding & Database Setup

## Goal
Initialize the entire project from an empty directory: scaffold the Next.js frontend, the NestJS backend, define the full Prisma schema (platform + all ~65 tenant tables), connect to the local PostgreSQL database, run the initial migration on the platform schema, and seed a default super admin. By the end of this sub-sprint, both servers should start cleanly and the database should have the platform schema with seeded data.

---

## 1. Top-Level Directory Structure

Create the following from the root of an empty directory called `hrms-platform/`:

```
hrms-platform/
├── frontend/                     # Next.js app
├── backend/                      # NestJS app
├── packages/
│   └── shared/                   # Shared TypeScript types, constants, validation schemas
├── .gitignore
└── README.md
```

There is NO monorepo tooling (no Turborepo, no Nx, no pnpm workspaces). `frontend/` and `backend/` are standalone apps, each with their own `package.json`. The `packages/shared/` folder will hold common TypeScript types/interfaces and constants shared between frontend and backend (copy or symlink approach — keep it simple for now).

---

## 2. Backend Setup (`backend/`)

### 2.1 Initialize NestJS

```bash
cd hrms-platform
npx @nestjs/cli new backend --strict --skip-git --package-manager npm
```

Use **npm** as the package manager. TypeScript strict mode enabled. The NestJS CLI generates the standard structure. After scaffolding:

### 2.2 Install Dependencies

```bash
cd backend
npm install @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt
npm install @prisma/client bcrypt class-validator class-transformer uuid
npm install @nestjs/swagger swagger-ui-express
npm install nodemailer
npm install exceljs pdfkit json2csv
npm install @nestjs/platform-socket.io @nestjs/websockets socket.io
npm install -D prisma @types/bcrypt @types/passport-jwt @types/uuid @types/nodemailer
```

### 2.3 Backend Directory Structure

Reorganize `backend/src/` to match:

```
backend/src/
├── common/
│   ├── guards/                   # PlatformAuthGuard, TenantAuthGuard, PermissionGuard
│   ├── decorators/               # @RequirePermission(), @CurrentUser(), @TenantContext()
│   ├── pipes/                    # Validation pipes
│   ├── interceptors/             # AuditInterceptor, ResponseInterceptor
│   ├── filters/                  # GlobalExceptionFilter
│   └── middleware/               # TenantMiddleware
├── core/                         # Shared services (built in Sprint 1G, create empty modules now)
│   ├── email/
│   ├── file-storage/
│   ├── notification/
│   ├── export/
│   └── audit/
├── platform/                     # Super Admin modules (built in later sprints, create empty dirs)
│   ├── platform-auth/
│   ├── tenants/
│   ├── billing/
│   └── super-admins/
├── registration/                 # Self-service registration
├── auth/                         # Tenant-level auth
├── rbac/                         # Roles, permissions
├── tenant/                       # Tenant context, middleware
├── employees/
├── leave/
├── time-tracker/
├── attendance/
├── performance/
├── files/
├── compensation/
├── recruitment/
├── onboarding/
├── offboarding/
├── reports/
├── dashboard/
├── settings/
├── prisma/                       # PrismaService, prisma module
│   └── prisma.service.ts
├── app.module.ts
└── main.ts
```

For directories that will be built in later sprints (employees, leave, etc.), just create the empty folders for now — no module files yet.

### 2.4 Create PrismaService

Create `backend/src/prisma/prisma.service.ts`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Set the PostgreSQL search_path for tenant-scoped queries.
   * This is called by TenantMiddleware on every tenant-level request.
   */
  async setSchema(schemaName: string): Promise<void> {
    await this.$executeRawUnsafe(`SET search_path TO "${schemaName}"`);
  }

  /**
   * Set search_path back to the platform schema.
   */
  async setPlatformSchema(): Promise<void> {
    await this.$executeRawUnsafe(`SET search_path TO "platform"`);
  }
}
```

Create `backend/src/prisma/prisma.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### 2.5 Environment File

Create `backend/.env`:

```env
# Database
DATABASE_URL="postgresql://postgres:pmscrm007@localhost:5432/hrms?schema=public"

# JWT
JWT_ACCESS_SECRET=hrms-access-secret-change-in-production
JWT_REFRESH_SECRET=hrms-refresh-secret-change-in-production
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Platform JWT (separate secrets for super admin)
PLATFORM_JWT_ACCESS_SECRET=platform-access-secret-change-in-production
PLATFORM_JWT_REFRESH_SECRET=platform-refresh-secret-change-in-production

# SMTP / Email (Platform-level — used before any tenant exists)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=shahmrunal777@gmail.com
MAIL_PASSWORD=uvgm gdvk ipop yxks
MAIL_FROM=shahmrunal777@gmail.com
MAIL_SECURE=false

# File Storage
FILE_STORAGE_PROVIDER=postgres

# App
PORT=3001
FRONTEND_URL=http://localhost:3000
PLATFORM_DOMAIN=localhost:3000

# Default Super Admin (used by seed script)
DEFAULT_SUPER_ADMIN_EMAIL=admin@hrms-platform.com
DEFAULT_SUPER_ADMIN_PASSWORD=SuperAdmin@123
DEFAULT_SUPER_ADMIN_NAME=Platform Admin
```

Create `backend/.env.example` with the same structure but placeholder values.

### 2.6 Configure app.module.ts

Update `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
  ],
})
export class AppModule {}
```

### 2.7 Configure main.ts

Update `backend/src/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableCors({
    origin: configService.get('FRONTEND_URL'),
    credentials: true,
  });

  const port = configService.get('PORT') || 3001;
  await app.listen(port);
  console.log(`🚀 Backend running on http://localhost:${port}`);
}
bootstrap();
```

---

## 3. Prisma Schema — FULL DATABASE

### 3.1 Important: Multi-Tenancy Approach with Prisma

Prisma does NOT natively support runtime schema switching. Our approach:

1. **The Prisma schema defines ALL tables as if they are in a single schema.** Prisma migrations will be used to create tables in the `platform` schema initially.
2. **For tenant schemas**, we will use raw SQL to create new PostgreSQL schemas and replicate the tenant table structure via raw SQL migrations (not Prisma migrate). The tenant provisioning pipeline (Sprint 1B) will handle this.
3. **At runtime**, `PrismaService.setSchema(schemaName)` switches the `search_path` before executing queries for that request.
4. **The Prisma schema below defines TWO conceptual groups** clearly marked with comments: Platform tables (prefixed `Platform_`) and Tenant tables (no prefix). The `Platform_` prefix is a Prisma model name convention ONLY — the actual PostgreSQL table names use `@@map()` to map to clean names.

### 3.2 Initialize Prisma

```bash
cd backend
npx prisma init
```

This creates `backend/prisma/schema.prisma`. Replace its entire contents with the schema below.

### 3.3 Full Prisma Schema

Replace `backend/prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================================
// PLATFORM SCHEMA TABLES
// These live in the "platform" PostgreSQL schema.
// Model names are prefixed with "Platform" for clarity in code.
// @@map() directs them to their actual table names.
// ============================================================================

model PlatformTenant {
  id                String   @id @default(uuid()) @db.Uuid
  name              String   @db.VarChar(255)
  slug              String   @unique @db.VarChar(100)
  customDomain      String?  @map("custom_domain") @db.VarChar(255)
  schemaName        String   @unique @map("schema_name") @db.VarChar(100)
  subscriptionTier  String   @map("subscription_tier") @db.VarChar(50) // 'standard' | 'with_recruitment'
  maxUsers          Int      @map("max_users")
  currentUserCount  Int      @default(0) @map("current_user_count")
  billingEmail      String   @map("billing_email") @db.VarChar(255)
  status            String   @default("active") @db.VarChar(20) // 'active' | 'suspended' | 'cancelled' | 'trial'
  registrationSource String  @map("registration_source") @db.VarChar(50) // 'self_service' | 'super_admin'
  trialEndsAt       DateTime? @map("trial_ends_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  billingRecords       PlatformBillingRecord[]
  registrationRequests PlatformRegistrationRequest[]

  @@map("tenants")
}

model PlatformSuperAdmin {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique @db.VarChar(255)
  passwordHash String   @map("password_hash") @db.VarChar(255)
  name         String   @db.VarChar(255)
  isActive     Boolean  @default(true) @map("is_active")
  lastLoginAt  DateTime? @map("last_login_at")
  createdAt    DateTime @default(now()) @map("created_at")

  sessions PlatformSuperAdminSession[]

  @@map("super_admins")
}

model PlatformSuperAdminSession {
  id              String   @id @default(uuid()) @db.Uuid
  superAdminId    String   @map("super_admin_id") @db.Uuid
  refreshTokenHash String  @map("refresh_token_hash") @db.VarChar(255)
  deviceInfo      Json     @map("device_info") // { browser, os, ip, location }
  expiresAt       DateTime @map("expires_at")
  createdAt       DateTime @default(now()) @map("created_at")

  superAdmin PlatformSuperAdmin @relation(fields: [superAdminId], references: [id], onDelete: Cascade)

  @@map("super_admin_sessions")
}

model PlatformBillingRecord {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @map("tenant_id") @db.Uuid
  periodStart DateTime @map("period_start") @db.Date
  periodEnd   DateTime @map("period_end") @db.Date
  userCount   Int      @map("user_count")
  perUserRate Decimal  @map("per_user_rate") @db.Decimal(10, 2)
  tier        String   @db.VarChar(50)
  totalAmount Decimal  @map("total_amount") @db.Decimal(10, 2)
  status      String   @db.VarChar(20) // 'pending' | 'paid' | 'overdue'
  createdAt   DateTime @default(now()) @map("created_at")

  tenant PlatformTenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@map("billing_records")
}

model PlatformRegistrationRequest {
  id                     String   @id @default(uuid()) @db.Uuid
  organizationName       String   @map("organization_name") @db.VarChar(255)
  slug                   String   @unique @db.VarChar(100)
  adminName              String   @map("admin_name") @db.VarChar(255)
  adminEmail             String   @map("admin_email") @db.VarChar(255)
  adminPasswordHash      String   @map("admin_password_hash") @db.VarChar(255)
  subscriptionTier       String   @map("subscription_tier") @db.VarChar(50)
  maxUsers               Int      @default(10) @map("max_users")
  emailVerificationToken String   @map("email_verification_token") @db.VarChar(255)
  emailVerified          Boolean  @default(false) @map("email_verified")
  status                 String   @default("pending") @db.VarChar(20) // 'pending' | 'verified' | 'provisioned' | 'failed'
  tenantId               String?  @map("tenant_id") @db.Uuid
  createdAt              DateTime @default(now()) @map("created_at")
  verifiedAt             DateTime? @map("verified_at")
  provisionedAt          DateTime? @map("provisioned_at")

  tenant PlatformTenant? @relation(fields: [tenantId], references: [id])

  @@map("registration_requests")
}

// ============================================================================
// TENANT SCHEMA TABLES
// These tables are created in EACH tenant's PostgreSQL schema.
// At runtime, Prisma queries target the correct schema via SET search_path.
// Prisma migrations only run on the default schema — tenant schemas are
// provisioned via raw SQL that replicates this structure.
// ============================================================================

// --- CORE: Users & Auth ---

model User {
  id                String   @id @default(uuid()) @db.Uuid
  employeeId        String?  @unique @map("employee_id") @db.VarChar(50)
  email             String   @unique @db.VarChar(255)
  passwordHash      String   @map("password_hash") @db.VarChar(255)
  firstName         String   @map("first_name") @db.VarChar(100)
  lastName          String   @map("last_name") @db.VarChar(100)
  displayName       String?  @map("display_name") @db.VarChar(100)
  phone             String?  @db.VarChar(20)
  photoUrl          String?  @map("photo_url") @db.Text
  emailDomainType   String   @default("company") @map("email_domain_type") @db.VarChar(20) // 'company' | 'external'
  status            String   @default("active") @db.VarChar(20) // 'active' | 'inactive' | 'archived'
  mustResetPassword Boolean  @default(true) @map("must_reset_password")
  lastLoginAt       DateTime? @map("last_login_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  passwordResetOtps  PasswordResetOtp[]
  userSessions       UserSession[]
  userRoles          UserRole[]
  employeeProfile    EmployeeProfile?
  notifications      Notification[]
  auditLogs          AuditLog[]
  fileStorage        FileStorage[]
  leaveBalances      LeaveBalance[]
  leaveRequests      LeaveRequest[]
  leaveReviews       LeaveRequest[]    @relation("LeaveReviewer")
  timeLogs           TimeLog[]
  goals              Goal[]            @relation("GoalAssignee")
  goalsCreated       Goal[]            @relation("GoalCreator")
  goalProgress       GoalProgressHistory[]
  performanceReviews PerformanceReview[] @relation("ReviewSubject")
  reviewsGiven       PerformanceReview[] @relation("ReviewReviewer")
  fileRecords        FileRecord[]
  fileShares         FileShare[]
  employeeSalaries   EmployeeSalary[]
  payslips           Payslip[]
  appraisalSubject   AppraisalRecord[] @relation("AppraisalSubject")
  appraisalReviewer  AppraisalRecord[] @relation("AppraisalReviewer")

  @@map("users")
}

model PasswordResetOtp {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  otpHash   String   @map("otp_hash") @db.VarChar(255)
  expiresAt DateTime @map("expires_at")
  used      Boolean  @default(false)
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("password_reset_otps")
}

model UserSession {
  id              String   @id @default(uuid()) @db.Uuid
  userId          String   @map("user_id") @db.Uuid
  refreshTokenHash String  @map("refresh_token_hash") @db.VarChar(255)
  deviceInfo      Json     @map("device_info") // { browser, os, ip, location }
  expiresAt       DateTime @map("expires_at")
  createdAt       DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_sessions")
}

// --- CORE: RBAC ---

model Permission {
  id          String   @id @default(uuid()) @db.Uuid
  module      String   @db.VarChar(100) // e.g., 'employee_management', 'leave', 'recruitment'
  action      String   @db.VarChar(100) // e.g., 'view', 'create', 'edit', 'delete', 'approve', 'export'
  resource    String   @db.VarChar(100) // e.g., 'employees', 'leave_requests', 'goals'
  description String?  @db.Text
  createdAt   DateTime @default(now()) @map("created_at")

  rolePermissions RolePermission[]

  @@unique([module, action, resource])
  @@map("permissions")
}

model Role {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(100)
  description String?  @db.Text
  isSystemRole Boolean @default(false) @map("is_system_role")
  isCustom    Boolean  @default(false) @map("is_custom")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  rolePermissions RolePermission[]
  userRoles       UserRole[]

  @@map("roles")
}

model RolePermission {
  id           String @id @default(uuid()) @db.Uuid
  roleId       String @map("role_id") @db.Uuid
  permissionId String @map("permission_id") @db.Uuid

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@map("role_permissions")
}

model UserRole {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  roleId     String   @map("role_id") @db.Uuid
  assignedBy String?  @map("assigned_by") @db.Uuid
  assignedAt DateTime @default(now()) @map("assigned_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([userId, roleId])
  @@map("user_roles")
}

// --- SHARED SERVICES ---

model FileStorage {
  id           String   @id @default(uuid()) @db.Uuid
  fileName     String   @map("file_name") @db.VarChar(255)
  originalName String   @map("original_name") @db.VarChar(255)
  mimeType     String   @map("mime_type") @db.VarChar(100)
  fileSize     BigInt   @map("file_size")
  data         Bytes?   // BYTEA — nullable for future S3 migration
  uploadedBy   String   @map("uploaded_by") @db.Uuid
  context      String?  @db.VarChar(100) // e.g., 'profile_photo', 'resume', 'document'
  contextId    String?  @map("context_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")

  uploader User @relation(fields: [uploadedBy], references: [id])

  @@map("file_storage")
}

model EmailConfig {
  id        String   @id @default(uuid()) @db.Uuid
  provider  String   @db.VarChar(20) // 'sendgrid' | 'aws_ses' | 'smtp'
  config    Json     // encrypted JSONB
  fromEmail String   @map("from_email") @db.VarChar(255)
  fromName  String   @map("from_name") @db.VarChar(255)
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("email_config")
}

model Notification {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  type      String   @db.VarChar(100)
  title     String   @db.VarChar(255)
  message   String   @db.Text
  data      Json?    // additional context
  isRead    Boolean  @default(false) @map("is_read")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("notifications")
}

model NotificationSetting {
  id               String  @id @default(uuid()) @db.Uuid
  notificationType String  @unique @map("notification_type") @db.VarChar(100)
  emailEnabled     Boolean @default(true) @map("email_enabled")
  inAppEnabled     Boolean @default(true) @map("in_app_enabled")

  @@map("notification_settings")
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String?  @map("user_id") @db.Uuid
  action     String   @db.VarChar(50) // 'create' | 'update' | 'delete'
  module     String   @db.VarChar(100)
  entityType String   @map("entity_type") @db.VarChar(100)
  entityId   String   @map("entity_id") @db.Uuid
  oldValue   Json?    @map("old_value")
  newValue   Json?    @map("new_value")
  ipAddress  String?  @map("ip_address") @db.VarChar(45)
  userAgent  String?  @map("user_agent") @db.Text
  createdAt  DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id])

  @@map("audit_logs")
}

model OrganizationSettings {
  id                    String @id @default(uuid()) @db.Uuid
  orgName               String @map("org_name") @db.VarChar(255)
  customDomain          String? @map("custom_domain") @db.VarChar(255)
  defaultTimezone       String @default("UTC") @map("default_timezone") @db.VarChar(50)
  dateFormat            String @default("DD-MMM-YYYY") @map("date_format") @db.VarChar(20)
  financialYearStartMonth Int  @default(1) @map("financial_year_start_month") // 1=Jan (configurable, not India-hardcoded)
  defaultCurrency       String @default("USD") @map("default_currency") @db.VarChar(10) // configurable

  @@map("organization_settings")
}

// --- EMPLOYEE MANAGEMENT ---

model Department {
  id              String   @id @default(uuid()) @db.Uuid
  name            String   @db.VarChar(255)
  code            String   @unique @db.VarChar(50)
  mailAlias       String?  @map("mail_alias") @db.VarChar(255)
  headId          String?  @map("head_id") @db.Uuid
  parentId        String?  @map("parent_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  parent    Department?  @relation("DepartmentHierarchy", fields: [parentId], references: [id])
  children  Department[] @relation("DepartmentHierarchy")
  employees EmployeeProfile[]

  @@map("departments")
}

model Designation {
  id             String   @id @default(uuid()) @db.Uuid
  name           String   @db.VarChar(255)
  code           String   @unique @db.VarChar(50)
  hierarchyLevel Int      @default(0) @map("hierarchy_level")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  employees EmployeeProfile[]

  @@map("designations")
}

model EmployeeProfile {
  id                  String   @id @default(uuid()) @db.Uuid
  userId              String   @unique @map("user_id") @db.Uuid
  departmentId        String?  @map("department_id") @db.Uuid
  designationId       String?  @map("designation_id") @db.Uuid
  reportsTo           String?  @map("reports_to") @db.Uuid
  employmentType      String   @map("employment_type") @db.VarChar(20) // 'permanent' | 'contract' | 'intern' | 'freelance'
  dateOfJoining       DateTime @map("date_of_joining") @db.Date
  dateOfBirth         DateTime? @map("date_of_birth") @db.Date
  gender              String?  @db.VarChar(20)
  maritalStatus       String?  @map("marital_status") @db.VarChar(20)
  bloodGroup          String?  @map("blood_group") @db.VarChar(10)
  emergencyContactName  String? @map("emergency_contact_name") @db.VarChar(255)
  emergencyContactPhone String? @map("emergency_contact_phone") @db.VarChar(20)
  emergencyContactRelation String? @map("emergency_contact_relation") @db.VarChar(50)
  presentAddress      Json?    @map("present_address")
  permanentAddress    Json?    @map("permanent_address")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  department  Department?  @relation(fields: [departmentId], references: [id])
  designation Designation? @relation(fields: [designationId], references: [id])

  @@map("employee_profiles")
}

model ReportingHierarchy {
  id              String @id @default(uuid()) @db.Uuid
  designationId   String @map("designation_id") @db.Uuid
  reportsToDesignationId String? @map("reports_to_designation_id") @db.Uuid
  level           Int    @default(0)

  @@unique([designationId])
  @@map("reporting_hierarchy")
}

model Group {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @db.VarChar(255)
  description String?  @db.Text
  createdBy   String   @map("created_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  members GroupMember[]

  @@map("groups")
}

model GroupMember {
  id       String   @id @default(uuid()) @db.Uuid
  groupId  String   @map("group_id") @db.Uuid
  userId   String   @map("user_id") @db.Uuid
  addedAt  DateTime @default(now()) @map("added_at")

  group Group @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, userId])
  @@map("group_members")
}

model Project {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(255)
  description String?   @db.Text
  managerId   String    @map("manager_id") @db.Uuid
  budget      Decimal?  @db.Decimal(12, 2)
  startDate   DateTime? @map("start_date") @db.Date
  endDate     DateTime? @map("end_date") @db.Date
  status      String    @default("active") @db.VarChar(20) // 'active' | 'completed' | 'on_hold'
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  members ProjectMember[]
  tasks   ProjectTask[]

  @@map("projects")
}

model ProjectMember {
  id        String   @id @default(uuid()) @db.Uuid
  projectId String   @map("project_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  role      String?  @db.VarChar(50) // 'member' | 'lead' etc.
  addedAt   DateTime @default(now()) @map("added_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@map("project_members")
}

model ProjectTask {
  id          String    @id @default(uuid()) @db.Uuid
  projectId   String    @map("project_id") @db.Uuid
  title       String    @db.VarChar(255)
  description String?   @db.Text
  assigneeId  String?   @map("assignee_id") @db.Uuid
  status      String    @default("todo") @db.VarChar(20) // 'todo' | 'in_progress' | 'done'
  priority    String    @default("medium") @db.VarChar(20) // 'low' | 'medium' | 'high' | 'urgent'
  dueDate     DateTime? @map("due_date") @db.Date
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("project_tasks")
}

model Delegation {
  id          String    @id @default(uuid()) @db.Uuid
  delegatorId String    @map("delegator_id") @db.Uuid
  delegateeId String    @map("delegatee_id") @db.Uuid
  type        String    @db.VarChar(100)
  description String?   @db.Text
  startDate   DateTime  @map("start_date") @db.Date
  endDate     DateTime? @map("end_date") @db.Date
  status      String    @default("active") @db.VarChar(20) // 'active' | 'completed' | 'cancelled'
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@map("delegations")
}

// --- LEAVE MANAGEMENT ---

model LeaveType {
  id                 String   @id @default(uuid()) @db.Uuid
  name               String   @db.VarChar(100)
  code               String   @unique @db.VarChar(20)
  color              String?  @db.VarChar(7) // hex color
  icon               String?  @db.VarChar(50)
  isPaid             Boolean  @default(true) @map("is_paid")
  maxConsecutiveDays Int?     @map("max_consecutive_days")
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  policies LeavePolicy[]
  balances LeaveBalance[]
  requests LeaveRequest[]

  @@map("leave_types")
}

model LeavePolicy {
  id               String   @id @default(uuid()) @db.Uuid
  leaveTypeId      String   @map("leave_type_id") @db.Uuid
  designationId    String?  @map("designation_id") @db.Uuid
  departmentId     String?  @map("department_id") @db.Uuid
  employmentType   String?  @map("employment_type") @db.VarChar(20)
  annualAllocation Float    @map("annual_allocation")
  carryForward     Boolean  @default(false) @map("carry_forward")
  maxCarryForward  Float?   @map("max_carry_forward")
  accrualType      String   @default("annual") @map("accrual_type") @db.VarChar(20) // 'annual' | 'monthly' | 'quarterly'
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  leaveType LeaveType @relation(fields: [leaveTypeId], references: [id], onDelete: Cascade)

  @@map("leave_policies")
}

model LeaveBalance {
  id             String @id @default(uuid()) @db.Uuid
  userId         String @map("user_id") @db.Uuid
  leaveTypeId    String @map("leave_type_id") @db.Uuid
  year           Int
  totalAllocated Float  @default(0) @map("total_allocated")
  carriedForward Float  @default(0) @map("carried_forward")
  used           Float  @default(0)
  // available = total_allocated + carried_forward - used (computed in application layer)

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  leaveType LeaveType @relation(fields: [leaveTypeId], references: [id], onDelete: Cascade)

  @@unique([userId, leaveTypeId, year])
  @@map("leave_balances")
}

model LeaveRequest {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  leaveTypeId  String   @map("leave_type_id") @db.Uuid
  startDate    DateTime @map("start_date") @db.Date
  endDate      DateTime @map("end_date") @db.Date
  durationType String   @default("full_day") @map("duration_type") @db.VarChar(20) // 'full_day' | 'first_half' | 'second_half'
  totalDays    Float    @map("total_days") // supports 0.5
  reason       String?  @db.Text
  status       String   @default("pending") @db.VarChar(20) // 'pending' | 'approved' | 'rejected' | 'cancelled'
  reviewedBy   String?  @map("reviewed_by") @db.Uuid
  reviewComment String? @map("review_comment") @db.Text
  reviewedAt   DateTime? @map("reviewed_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  leaveType LeaveType @relation(fields: [leaveTypeId], references: [id])
  reviewer  User?     @relation("LeaveReviewer", fields: [reviewedBy], references: [id])

  @@map("leave_requests")
}

model Holiday {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(255)
  date      DateTime @db.Date
  isOptional Boolean @default(false) @map("is_optional")
  year      Int
  createdAt DateTime @default(now()) @map("created_at")

  @@map("holidays")
}

// --- TIME TRACKER ---

model TimeTrackerConfig {
  id           String   @id @default(uuid()) @db.Uuid
  name         String   @db.VarChar(100)
  provider     String   @db.VarChar(50) // 'essl' | 'hubstaff' | 'custom_api' | 'mock'
  config       Json     // provider-specific configuration
  isActive     Boolean  @default(true) @map("is_active")
  syncFrequency String  @default("hourly") @map("sync_frequency") @db.VarChar(20) // 'hourly' | 'daily' | 'manual'
  lastSyncAt   DateTime? @map("last_sync_at")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("time_tracker_config")
}

model TimeLog {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  punchType  String   @map("punch_type") @db.VarChar(10) // 'in' | 'out'
  punchTime  DateTime @map("punch_time")
  source     String   @db.VarChar(50) // adapter name
  rawData    Json?    @map("raw_data")
  createdAt  DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("time_logs")
}

model DailyTimeSummary {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @map("user_id") @db.Uuid
  date           DateTime @db.Date
  firstPunchIn   DateTime? @map("first_punch_in")
  lastPunchOut   DateTime? @map("last_punch_out")
  totalHours     Float    @default(0) @map("total_hours")
  effectiveHours Float    @default(0) @map("effective_hours")
  overtimeHours  Float    @default(0) @map("overtime_hours")
  status         String   @default("present") @db.VarChar(20) // 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday' | 'weekend'
  isLate         Boolean  @default(false) @map("is_late")
  isEarlyDeparture Boolean @default(false) @map("is_early_departure")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([userId, date])
  @@map("daily_time_summary")
}

// --- ATTENDANCE ---

model WorkSchedule {
  id                  String   @id @default(uuid()) @db.Uuid
  name                String   @db.VarChar(100)
  startTime           String   @map("start_time") @db.VarChar(5) // "09:00"
  endTime             String   @map("end_time") @db.VarChar(5) // "18:00"
  workingDays         Json     @map("working_days") // e.g., ["mon","tue","wed","thu","fri"]
  gracePeriodMinutes  Int      @default(0) @map("grace_period_minutes")
  minHoursFullDay     Float    @default(8) @map("min_hours_full_day")
  minHoursHalfDay     Float    @default(4) @map("min_hours_half_day")
  overtimeThresholdHours Float @default(9) @map("overtime_threshold_hours")
  isDefault           Boolean  @default(false) @map("is_default")
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@map("work_schedule")
}

model AttendanceRegularization {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  date        DateTime @db.Date
  reason      String   @db.Text
  punchIn     String?  @map("punch_in") @db.VarChar(5)
  punchOut    String?  @map("punch_out") @db.VarChar(5)
  status      String   @default("pending") @db.VarChar(20) // 'pending' | 'approved' | 'rejected'
  reviewedBy  String?  @map("reviewed_by") @db.Uuid
  reviewedAt  DateTime? @map("reviewed_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("attendance_regularizations")
}

// --- PERFORMANCE ---

model Goal {
  id              String   @id @default(uuid()) @db.Uuid
  title           String   @db.VarChar(255)
  description     String?  @db.Text
  assignedToId    String   @map("assigned_to_id") @db.Uuid
  assignedToType  String   @default("user") @map("assigned_to_type") @db.VarChar(20) // 'user' | 'group' | 'project'
  createdById     String   @map("created_by_id") @db.Uuid
  priority        String   @default("medium") @db.VarChar(20) // 'low' | 'medium' | 'high' | 'critical'
  status          String   @default("not_started") @db.VarChar(20) // 'not_started' | 'in_progress' | 'completed' | 'cancelled'
  progress        Int      @default(0) // 0-100
  startDate       DateTime? @map("start_date") @db.Date
  dueDate         DateTime? @map("due_date") @db.Date
  completedAt     DateTime? @map("completed_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  assignee   User @relation("GoalAssignee", fields: [assignedToId], references: [id])
  creator    User @relation("GoalCreator", fields: [createdById], references: [id])
  progressHistory GoalProgressHistory[]

  @@map("goals")
}

model GoalProgressHistory {
  id        String   @id @default(uuid()) @db.Uuid
  goalId    String   @map("goal_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  oldProgress Int    @map("old_progress")
  newProgress Int    @map("new_progress")
  note      String?  @db.Text
  createdAt DateTime @default(now()) @map("created_at")

  goal Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id])

  @@map("goal_progress_history")
}

model PerformanceReviewCycle {
  id          String    @id @default(uuid()) @db.Uuid
  name        String    @db.VarChar(255)
  type        String    @db.VarChar(20) // 'quarterly' | 'annual' | 'custom'
  startDate   DateTime  @map("start_date") @db.Date
  endDate     DateTime  @map("end_date") @db.Date
  status      String    @default("draft") @db.VarChar(20) // 'draft' | 'active' | 'completed'
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  reviews PerformanceReview[]

  @@map("performance_review_cycles")
}

model PerformanceReview {
  id          String   @id @default(uuid()) @db.Uuid
  cycleId     String   @map("cycle_id") @db.Uuid
  subjectId   String   @map("subject_id") @db.Uuid
  reviewerId  String   @map("reviewer_id") @db.Uuid
  rating      Int?     // 1-5
  comments    String?  @db.Text
  strengths   String?  @db.Text
  improvements String? @db.Text
  status      String   @default("pending") @db.VarChar(20) // 'pending' | 'submitted' | 'acknowledged'
  submittedAt DateTime? @map("submitted_at")
  acknowledgedAt DateTime? @map("acknowledged_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  cycle    PerformanceReviewCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)
  subject  User @relation("ReviewSubject", fields: [subjectId], references: [id])
  reviewer User @relation("ReviewReviewer", fields: [reviewerId], references: [id])

  @@map("performance_reviews")
}

// --- FILES ---

model FileRecord {
  id         String   @id @default(uuid()) @db.Uuid
  name       String   @db.VarChar(255)
  mimeType   String   @map("mime_type") @db.VarChar(100)
  fileSize   BigInt   @map("file_size")
  storageId  String   @map("storage_id") @db.Uuid // FK to file_storage
  folderId   String?  @map("folder_id") @db.Uuid
  scope      String   @default("personal") @db.VarChar(20) // 'personal' | 'team' | 'organization'
  ownerId    String   @map("owner_id") @db.Uuid
  departmentId String? @map("department_id") @db.Uuid // for team scope
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  owner  User        @relation(fields: [ownerId], references: [id])
  folder FileFolder? @relation(fields: [folderId], references: [id])
  shares FileShare[]

  @@map("file_records")
}

model FileFolder {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(255)
  parentId  String?  @map("parent_id") @db.Uuid
  scope     String   @default("personal") @db.VarChar(20)
  ownerId   String   @map("owner_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  parent   FileFolder?  @relation("FolderHierarchy", fields: [parentId], references: [id])
  children FileFolder[] @relation("FolderHierarchy")
  files    FileRecord[]

  @@map("file_folders")
}

model FileShare {
  id           String   @id @default(uuid()) @db.Uuid
  fileRecordId String   @map("file_record_id") @db.Uuid
  sharedWithId String   @map("shared_with_id") @db.Uuid
  permission   String   @default("view") @db.VarChar(20) // 'view' | 'edit'
  createdAt    DateTime @default(now()) @map("created_at")

  fileRecord FileRecord @relation(fields: [fileRecordId], references: [id], onDelete: Cascade)
  sharedWith User       @relation(fields: [sharedWithId], references: [id])

  @@unique([fileRecordId, sharedWithId])
  @@map("file_shares")
}

// --- COMPENSATION ---

model SalaryComponent {
  id         String   @id @default(uuid()) @db.Uuid
  name       String   @db.VarChar(255)
  code       String   @unique @db.VarChar(50)
  type       String   @db.VarChar(20) // 'earning' | 'deduction'
  isDefault  Boolean  @default(false) @map("is_default")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  breakdowns SalaryBreakdown[]

  @@map("salary_components")
}

model EmployeeSalary {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  ctc         Decimal  @db.Decimal(12, 2) // cost to company
  effectiveFrom DateTime @map("effective_from") @db.Date
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  breakdowns SalaryBreakdown[]

  @@map("employee_salaries")
}

model SalaryBreakdown {
  id               String  @id @default(uuid()) @db.Uuid
  employeeSalaryId String  @map("employee_salary_id") @db.Uuid
  componentId      String  @map("component_id") @db.Uuid
  amount           Decimal @db.Decimal(12, 2)

  employeeSalary EmployeeSalary @relation(fields: [employeeSalaryId], references: [id], onDelete: Cascade)
  component      SalaryComponent @relation(fields: [componentId], references: [id])

  @@map("salary_breakdowns")
}

model Payslip {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  month       Int
  year        Int
  grossPay    Decimal  @map("gross_pay") @db.Decimal(12, 2)
  deductions  Decimal  @db.Decimal(12, 2)
  netPay      Decimal  @map("net_pay") @db.Decimal(12, 2)
  breakdown   Json     // full breakdown snapshot
  pdfStorageId String? @map("pdf_storage_id") @db.Uuid
  generatedAt DateTime @default(now()) @map("generated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, month, year])
  @@map("payslips")
}

model AppraisalRecord {
  id            String   @id @default(uuid()) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  reviewerId    String   @map("reviewer_id") @db.Uuid
  effectiveDate DateTime @map("effective_date") @db.Date
  previousCtc   Decimal  @map("previous_ctc") @db.Decimal(12, 2)
  newCtc        Decimal  @map("new_ctc") @db.Decimal(12, 2)
  incrementPercent Float @map("increment_percent")
  comments      String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  subject  User @relation("AppraisalSubject", fields: [userId], references: [id])
  reviewer User @relation("AppraisalReviewer", fields: [reviewerId], references: [id])

  @@map("appraisal_records")
}

// --- RECRUITMENT ---

model JobOpening {
  id              String   @id @default(uuid()) @db.Uuid
  title           String   @db.VarChar(255)
  description     String?  @db.Text
  departmentId    String?  @map("department_id") @db.Uuid
  designationId   String?  @map("designation_id") @db.Uuid
  employmentType  String   @map("employment_type") @db.VarChar(20)
  experience      String?  @db.VarChar(50)
  salaryRange     Json?    @map("salary_range") // { min, max, currency }
  location        String?  @db.VarChar(255)
  openings        Int      @default(1)
  status          String   @default("draft") @db.VarChar(20) // 'draft' | 'published' | 'closed' | 'on_hold'
  publishToken    String?  @unique @map("publish_token") @db.VarChar(100) // for public job page URL
  publishedAt     DateTime? @map("published_at")
  closedAt        DateTime? @map("closed_at")
  createdBy       String   @map("created_by") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  candidates Candidate[]
  interviews Interview[]

  @@map("job_openings")
}

model CandidateStage {
  id          String @id @default(uuid()) @db.Uuid
  name        String @db.VarChar(100)
  orderIndex  Int    @map("order_index")
  color       String? @db.VarChar(7)
  isDefault   Boolean @default(false) @map("is_default")

  candidates Candidate[]
  stageHistory CandidateStageHistory[]

  @@map("candidate_stages")
}

model Candidate {
  id             String   @id @default(uuid()) @db.Uuid
  jobOpeningId   String   @map("job_opening_id") @db.Uuid
  stageId        String   @map("stage_id") @db.Uuid
  firstName      String   @map("first_name") @db.VarChar(100)
  lastName       String   @map("last_name") @db.VarChar(100)
  email          String   @db.VarChar(255)
  phone          String?  @db.VarChar(20)
  resumeStorageId String? @map("resume_storage_id") @db.Uuid
  coverLetter    String?  @map("cover_letter") @db.Text
  source         String?  @db.VarChar(50) // 'direct' | 'referral' | 'job_board' | 'public_page'
  ownerId        String?  @map("owner_id") @db.Uuid // HR person managing
  rating         Int?     // 1-5
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  jobOpening   JobOpening @relation(fields: [jobOpeningId], references: [id], onDelete: Cascade)
  stage        CandidateStage @relation(fields: [stageId], references: [id])
  stageHistory CandidateStageHistory[]
  notes        CandidateNote[]
  interviews   Interview[]
  submissions  AssessmentSubmission[]
  offerLetters OfferLetter[]

  @@map("candidates")
}

model CandidateStageHistory {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String   @map("candidate_id") @db.Uuid
  stageId     String   @map("stage_id") @db.Uuid
  movedBy     String   @map("moved_by") @db.Uuid
  movedAt     DateTime @default(now()) @map("moved_at")
  note        String?  @db.Text

  candidate Candidate      @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  stage     CandidateStage @relation(fields: [stageId], references: [id])

  @@map("candidate_stage_history")
}

model CandidateNote {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String   @map("candidate_id") @db.Uuid
  authorId    String   @map("author_id") @db.Uuid
  content     String   @db.Text
  createdAt   DateTime @default(now()) @map("created_at")

  candidate Candidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@map("candidate_notes")
}

model Interview {
  id            String   @id @default(uuid()) @db.Uuid
  jobOpeningId  String   @map("job_opening_id") @db.Uuid
  candidateId   String   @map("candidate_id") @db.Uuid
  scheduledAt   DateTime @map("scheduled_at")
  durationMinutes Int    @default(60) @map("duration_minutes")
  type          String   @db.VarChar(50) // 'phone' | 'video' | 'in_person' | 'technical' | 'hr'
  location      String?  @db.VarChar(255)
  meetingLink   String?  @map("meeting_link") @db.Text
  status        String   @default("scheduled") @db.VarChar(20) // 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  notes         String?  @db.Text
  createdBy     String   @map("created_by") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  jobOpening JobOpening @relation(fields: [jobOpeningId], references: [id])
  candidate  Candidate  @relation(fields: [candidateId], references: [id], onDelete: Cascade)
  feedback   InterviewFeedback[]

  @@map("interviews")
}

model InterviewFeedback {
  id           String   @id @default(uuid()) @db.Uuid
  interviewId  String   @map("interview_id") @db.Uuid
  interviewerId String  @map("interviewer_id") @db.Uuid
  rating       Int?     // 1-5
  recommendation String? @db.VarChar(20) // 'strong_yes' | 'yes' | 'neutral' | 'no' | 'strong_no'
  comments     String?  @db.Text
  submittedAt  DateTime? @map("submitted_at")
  createdAt    DateTime @default(now()) @map("created_at")

  interview Interview @relation(fields: [interviewId], references: [id], onDelete: Cascade)

  @@map("interview_feedback")
}

model Assessment {
  id          String   @id @default(uuid()) @db.Uuid
  title       String   @db.VarChar(255)
  description String?  @db.Text
  timeLimitMinutes Int? @map("time_limit_minutes")
  createdBy   String   @map("created_by") @db.Uuid
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  questions   AssessmentQuestion[]
  submissions AssessmentSubmission[]

  @@map("assessments")
}

model AssessmentQuestion {
  id           String @id @default(uuid()) @db.Uuid
  assessmentId String @map("assessment_id") @db.Uuid
  type         String @db.VarChar(20) // 'mcq' | 'subjective'
  question     String @db.Text
  options      Json?  // for MCQ: ["option1", "option2", ...]
  correctAnswer String? @map("correct_answer") @db.Text
  points       Int    @default(1)
  orderIndex   Int    @map("order_index")

  assessment Assessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@map("assessment_questions")
}

model AssessmentSubmission {
  id           String   @id @default(uuid()) @db.Uuid
  assessmentId String   @map("assessment_id") @db.Uuid
  candidateId  String   @map("candidate_id") @db.Uuid
  answers      Json     // { questionId: answer }
  score        Int?
  status       String   @default("pending") @db.VarChar(20) // 'pending' | 'submitted' | 'evaluated'
  submittedAt  DateTime? @map("submitted_at")
  evaluatedBy  String?  @map("evaluated_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")

  assessment Assessment @relation(fields: [assessmentId], references: [id])
  candidate  Candidate  @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@map("assessment_submissions")
}

model Referral {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String?  @map("candidate_id") @db.Uuid
  jobOpeningId String? @map("job_opening_id") @db.Uuid
  referredById String  @map("referred_by_id") @db.Uuid
  candidateName String @map("candidate_name") @db.VarChar(255)
  candidateEmail String @map("candidate_email") @db.VarChar(255)
  candidatePhone String? @map("candidate_phone") @db.VarChar(20)
  notes       String?  @db.Text
  status      String   @default("submitted") @db.VarChar(20) // 'submitted' | 'reviewed' | 'converted'
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("referrals")
}

model OfferLetter {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String   @map("candidate_id") @db.Uuid
  designation String   @db.VarChar(255)
  ctcOffered  Decimal  @map("ctc_offered") @db.Decimal(12, 2)
  joiningDate DateTime @map("joining_date") @db.Date
  content     String   @db.Text // HTML or template content
  pdfStorageId String? @map("pdf_storage_id") @db.Uuid
  status      String   @default("draft") @db.VarChar(20) // 'draft' | 'sent' | 'accepted' | 'rejected'
  sentAt      DateTime? @map("sent_at")
  respondedAt DateTime? @map("responded_at")
  createdAt   DateTime @default(now()) @map("created_at")

  candidate Candidate @relation(fields: [candidateId], references: [id], onDelete: Cascade)

  @@map("offer_letters")
}

model RecruitmentEmailCampaign {
  id          String   @id @default(uuid()) @db.Uuid
  subject     String   @db.VarChar(255)
  body        String   @db.Text
  candidateIds Json    @map("candidate_ids") // UUID array
  sentBy      String   @map("sent_by") @db.Uuid
  sentAt      DateTime @default(now()) @map("sent_at")
  status      String   @default("sent") @db.VarChar(20) // 'draft' | 'sent'
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("recruitment_email_campaigns")
}

// --- ONBOARDING ---

model OnboardingTemplate {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(255)
  isDefault Boolean  @default(false) @map("is_default")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  checklistItems OnboardingChecklistItem[]
  records        OnboardingRecord[]

  @@map("onboarding_templates")
}

model OnboardingChecklistItem {
  id          String  @id @default(uuid()) @db.Uuid
  templateId  String  @map("template_id") @db.Uuid
  title       String  @db.VarChar(255)
  description String? @db.Text
  isRequired  Boolean @default(true) @map("is_required")
  orderIndex  Int     @map("order_index")

  template  OnboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  progress  OnboardingChecklistProgress[]

  @@map("onboarding_checklist_items")
}

model OnboardingRecord {
  id              String   @id @default(uuid()) @db.Uuid
  templateId      String   @map("template_id") @db.Uuid
  candidateName   String   @map("candidate_name") @db.VarChar(255)
  candidateEmail  String   @map("candidate_email") @db.VarChar(255)
  candidatePhone  String?  @map("candidate_phone") @db.VarChar(20)
  departmentId    String?  @map("department_id") @db.Uuid
  designationId   String?  @map("designation_id") @db.Uuid
  source          String?  @db.VarChar(50) // 'recruitment' | 'manual'
  candidateId     String?  @map("candidate_id") @db.Uuid // FK to recruitment candidate if applicable
  personalDetails Json?    @map("personal_details") // additional info (education, experience, etc.)
  sensitiveFields Json?    @map("sensitive_fields") // PAN, Aadhaar, UAN — stored encrypted, masked in UI
  status          String   @default("pending") @db.VarChar(20) // 'pending' | 'in_progress' | 'completed' | 'converted'
  convertedUserId String?  @map("converted_user_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  template       OnboardingTemplate @relation(fields: [templateId], references: [id])
  checklistProgress OnboardingChecklistProgress[]

  @@map("onboarding_records")
}

model OnboardingChecklistProgress {
  id              String   @id @default(uuid()) @db.Uuid
  onboardingId    String   @map("onboarding_id") @db.Uuid
  checklistItemId String   @map("checklist_item_id") @db.Uuid
  isCompleted     Boolean  @default(false) @map("is_completed")
  completedBy     String?  @map("completed_by") @db.Uuid
  completedAt     DateTime? @map("completed_at")
  notes           String?  @db.Text

  onboardingRecord OnboardingRecord       @relation(fields: [onboardingId], references: [id], onDelete: Cascade)
  checklistItem    OnboardingChecklistItem @relation(fields: [checklistItemId], references: [id])

  @@unique([onboardingId, checklistItemId])
  @@map("onboarding_checklist_progress")
}

// --- OFFBOARDING ---

model OffboardingTemplate {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @db.VarChar(255)
  isDefault Boolean  @default(false) @map("is_default")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  preferences     OffboardingTemplatePreference[]
  clearances      OffboardingClearance[]
  exitInterviews  OffboardingExitInterviewTemplate[]
  requiredDocs    OffboardingRequiredDocument[]
  workflowTriggers OffboardingWorkflowTrigger[]
  records         OffboardingRecord[]

  @@map("offboarding_templates")
}

model OffboardingTemplatePreference {
  id              String @id @default(uuid()) @db.Uuid
  templateId      String @map("template_id") @db.Uuid
  noticePeriodDays Int   @default(30) @map("notice_period_days")
  approvalChain   Json   @map("approval_chain") // array of role/user IDs

  template OffboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("offboarding_template_preferences")
}

model OffboardingClearance {
  id          String @id @default(uuid()) @db.Uuid
  templateId  String @map("template_id") @db.Uuid
  name        String @db.VarChar(255) // e.g., "IT Clearance", "HR Clearance"
  assignedTo  String @map("assigned_to") @db.VarChar(100) // role or department
  orderIndex  Int    @map("order_index")
  fields      Json?  // custom form fields

  template OffboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("offboarding_clearances")
}

model OffboardingExitInterviewTemplate {
  id         String @id @default(uuid()) @db.Uuid
  templateId String @map("template_id") @db.Uuid

  template  OffboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  questions ExitInterviewQuestion[]

  @@map("offboarding_exit_interview_templates")
}

model ExitInterviewQuestion {
  id                   String @id @default(uuid()) @db.Uuid
  exitInterviewTemplateId String @map("exit_interview_template_id") @db.Uuid
  question             String @db.Text
  type                 String @db.VarChar(20) // 'text' | 'rating' | 'mcq'
  options              Json?  // for mcq
  orderIndex           Int    @map("order_index")

  exitInterviewTemplate OffboardingExitInterviewTemplate @relation(fields: [exitInterviewTemplateId], references: [id], onDelete: Cascade)

  @@map("exit_interview_questions")
}

model OffboardingRequiredDocument {
  id         String @id @default(uuid()) @db.Uuid
  templateId String @map("template_id") @db.Uuid
  name       String @db.VarChar(255)
  isRequired Boolean @default(true) @map("is_required")

  template OffboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("offboarding_required_documents")
}

model OffboardingWorkflowTrigger {
  id          String @id @default(uuid()) @db.Uuid
  templateId  String @map("template_id") @db.Uuid
  event       String @db.VarChar(100) // e.g., 'resignation_approved', 'clearance_complete'
  action      String @db.VarChar(100) // e.g., 'send_email', 'notify_hr'
  config      Json?  // action-specific config

  template OffboardingTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("offboarding_workflow_triggers")
}

model OffboardingRecord {
  id                String   @id @default(uuid()) @db.Uuid
  userId            String   @map("user_id") @db.Uuid
  templateId        String   @map("template_id") @db.Uuid
  type              String   @db.VarChar(20) // 'resignation' | 'termination'
  reason            String?  @db.Text
  lastWorkingDate   DateTime? @map("last_working_date") @db.Date
  status            String   @default("initiated") @db.VarChar(20) // 'initiated' | 'approved' | 'in_progress' | 'completed' | 'rejected'
  currentStep       String   @default("preferences") @map("current_step") @db.VarChar(20)
  approvedBy        String?  @map("approved_by") @db.Uuid
  approvedAt        DateTime? @map("approved_at")
  completedAt       DateTime? @map("completed_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  template           OffboardingTemplate @relation(fields: [templateId], references: [id])
  clearanceProgress  OffboardingClearanceProgress[]
  exitInterviewResponses ExitInterviewResponse[]
  documents          OffboardingDocument[]

  @@map("offboarding_records")
}

model OffboardingClearanceProgress {
  id              String   @id @default(uuid()) @db.Uuid
  offboardingId   String   @map("offboarding_id") @db.Uuid
  clearanceName   String   @map("clearance_name") @db.VarChar(255)
  status          String   @default("pending") @db.VarChar(20) // 'pending' | 'cleared' | 'blocked'
  clearedBy       String?  @map("cleared_by") @db.Uuid
  clearedAt       DateTime? @map("cleared_at")
  notes           String?  @db.Text

  offboardingRecord OffboardingRecord @relation(fields: [offboardingId], references: [id], onDelete: Cascade)

  @@map("offboarding_clearance_progress")
}

model ExitInterviewResponse {
  id            String @id @default(uuid()) @db.Uuid
  offboardingId String @map("offboarding_id") @db.Uuid
  questionId    String @map("question_id") @db.Uuid
  response      String @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  offboardingRecord OffboardingRecord @relation(fields: [offboardingId], references: [id], onDelete: Cascade)

  @@map("exit_interview_responses")
}

model OffboardingDocument {
  id            String   @id @default(uuid()) @db.Uuid
  offboardingId String   @map("offboarding_id") @db.Uuid
  name          String   @db.VarChar(255)
  storageId     String   @map("storage_id") @db.Uuid
  uploadedBy    String   @map("uploaded_by") @db.Uuid
  createdAt     DateTime @default(now()) @map("created_at")

  offboardingRecord OffboardingRecord @relation(fields: [offboardingId], references: [id], onDelete: Cascade)

  @@map("offboarding_documents")
}

model DataRetentionConfig {
  id                String @id @default(uuid()) @db.Uuid
  retentionDays     Int    @default(365) @map("retention_days")
  autoDeleteEnabled Boolean @default(false) @map("auto_delete_enabled")

  @@map("data_retention_config")
}
```

---

## 4. Platform Schema Setup & Migration Strategy

### 4.1 Important: Prisma Limitations with Multi-Schema

Prisma migrations will create all tables in the **default schema** (public). We need a two-step approach:

1. **For the `platform` schema:** After Prisma migration runs on `public`, we use a raw SQL script to create a `platform` PostgreSQL schema and move/create only the platform tables there.
2. **For tenant schemas:** Sprint 1B will handle dynamically creating tenant schemas. For now, just ensure the platform tables exist.

### 4.2 Create the Migration Setup Script

Create `backend/prisma/setup-platform.sql`:

```sql
-- Create the platform schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS platform;

-- Create platform tables in the platform schema
CREATE TABLE IF NOT EXISTS platform.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    custom_domain VARCHAR(255),
    schema_name VARCHAR(100) UNIQUE NOT NULL,
    subscription_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
    max_users INT NOT NULL DEFAULT 10,
    current_user_count INT NOT NULL DEFAULT 0,
    billing_email VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    registration_source VARCHAR(50) NOT NULL DEFAULT 'super_admin',
    trial_ends_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.super_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.super_admin_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id UUID NOT NULL REFERENCES platform.super_admins(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info JSONB NOT NULL DEFAULT '{}',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.billing_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    user_count INT NOT NULL,
    per_user_rate DECIMAL(10,2) NOT NULL,
    tier VARCHAR(50) NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform.registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    admin_name VARCHAR(255) NOT NULL,
    admin_email VARCHAR(255) NOT NULL,
    admin_password_hash VARCHAR(255) NOT NULL,
    subscription_tier VARCHAR(50) NOT NULL DEFAULT 'standard',
    max_users INT NOT NULL DEFAULT 10,
    email_verification_token VARCHAR(255) NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    tenant_id UUID REFERENCES platform.tenants(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMP,
    provisioned_at TIMESTAMP
);
```

### 4.3 Create Seed Script

Create `backend/prisma/seed.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting platform seed...');

  // Create platform schema and tables via raw SQL
  const setupSQL = require('fs').readFileSync(
    require('path').join(__dirname, 'setup-platform.sql'),
    'utf8'
  );

  // Execute each statement separately
  const statements = setupSQL
    .split(';')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement + ';');
  }

  console.log('✅ Platform schema and tables created');

  // Seed default super admin
  const email = process.env.DEFAULT_SUPER_ADMIN_EMAIL || 'admin@hrms-platform.com';
  const password = process.env.DEFAULT_SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
  const name = process.env.DEFAULT_SUPER_ADMIN_NAME || 'Platform Admin';
  const passwordHash = await bcrypt.hash(password, 12);

  // Check if super admin already exists
  const existing = await prisma.$queryRawUnsafe<any[]>(
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
```

Add to `backend/package.json`:

```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

Install `ts-node` if not present:

```bash
npm install -D ts-node
```

### 4.4 Run Migration + Seed

```bash
cd backend

# Generate Prisma client
npx prisma generate

# Create the initial migration (this creates all tables in the public schema)
npx prisma migrate dev --name init

# Run the seed (creates platform schema + default super admin)
npx prisma db seed
```

---

## 5. Frontend Setup (`frontend/`)

### 5.1 Initialize Next.js

```bash
cd hrms-platform
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --turbopack
```

When prompted: Use App Router = Yes, Use `src/` directory = Yes.

### 5.2 Install Dependencies

```bash
cd frontend
npm install @tanstack/react-query zustand react-hook-form @hookform/resolvers zod
npm install axios socket.io-client
npm install lucide-react class-variance-authority clsx tailwind-merge
npm install next-themes
npm install -D @types/node
```

### 5.3 Initialize shadcn/ui

```bash
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Slate
- CSS variables: Yes

Then install commonly needed components:

```bash
npx shadcn@latest add button card input label select dialog sheet dropdown-menu table tabs badge avatar separator tooltip toast sonner command popover calendar checkbox radio-group switch textarea scroll-area skeleton alert alert-dialog form navigation-menu pagination progress
```

### 5.4 Configure Brand Theme

Update `frontend/src/app/globals.css` — replace the `:root` CSS variables with brand colors:

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222 47% 11%;
    --card: 0 0% 100%;
    --card-foreground: 222 47% 11%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 47% 11%;
    --primary: 227 97% 16%;        /* #011552 */
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96%;
    --secondary-foreground: 222 47% 11%;
    --muted: 210 40% 96%;
    --muted-foreground: 215 16% 47%;
    --accent: 210 40% 96%;
    --accent-foreground: 222 47% 11%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 210 40% 98%;
    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 227 97% 16%;           /* #011552 */
    --radius: 0.5rem;
  }

  .dark {
    --background: 222 47% 11%;
    --foreground: 210 40% 98%;
    --card: 222 47% 11%;
    --card-foreground: 210 40% 98%;
    --popover: 222 47% 11%;
    --popover-foreground: 210 40% 98%;
    --primary: 227 70% 50%;
    --primary-foreground: 210 40% 98%;
    --secondary: 217 33% 17%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217 33% 17%;
    --muted-foreground: 215 20% 65%;
    --accent: 217 33% 17%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62% 30%;
    --destructive-foreground: 210 40% 98%;
    --border: 217 33% 17%;
    --input: 217 33% 17%;
    --ring: 224 64% 33%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans antialiased;
  }
}
```

Update `frontend/tailwind.config.ts` to include the Inter font:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          DEFAULT: "#011552",
          50: "#E8EAF6",
          100: "#C5CAE9",
          200: "#9FA8DA",
          300: "#7986CB",
          400: "#5C6BC0",
          500: "#011552",
          600: "#011247",
          700: "#010F3C",
          800: "#010C31",
          900: "#000926",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
```

Add Inter font to `frontend/src/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "HRMS Platform",
  description: "Human Resource Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
```

### 5.5 Frontend Directory Structure

Create the following directory structure inside `frontend/src/`:

```
frontend/src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   │   └── page.tsx              # Tenant login (placeholder)
│   │   ├── forgot-password/
│   │   │   └── page.tsx              # Placeholder
│   │   └── reset-password/
│   │       └── page.tsx              # Placeholder
│   ├── (public)/
│   │   ├── register/
│   │   │   └── page.tsx              # Placeholder
│   │   └── careers/
│   │       └── [slug]/
│   │           └── [token]/
│   │               └── page.tsx      # Placeholder
│   ├── (platform)/
│   │   ├── platform/
│   │   │   ├── login/
│   │   │   │   └── page.tsx          # Platform login (placeholder)
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx          # Placeholder
│   │   │   ├── tenants/
│   │   │   │   └── page.tsx          # Placeholder
│   │   │   ├── billing/
│   │   │   │   └── page.tsx          # Placeholder
│   │   │   ├── admins/
│   │   │   │   └── page.tsx          # Placeholder
│   │   │   └── registrations/
│   │   │       └── page.tsx          # Placeholder
│   │   └── layout.tsx                # Platform layout (placeholder)
│   ├── (tenant)/
│   │   ├── dashboard/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── employees/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── leave/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── attendance/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── time-tracker/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── performance/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── files/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── compensation/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── recruitment/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── onboarding/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── offboarding/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── reports/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── settings/
│   │   │   └── page.tsx              # Placeholder
│   │   ├── account/
│   │   │   └── page.tsx              # Placeholder
│   │   └── layout.tsx                # Tenant layout (placeholder)
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Landing — redirect to /login
│   └── globals.css
├── components/
│   ├── ui/                           # shadcn components (auto-generated)
│   ├── layout/                       # Shell, sidebar, header (Sprint 1H)
│   ├── shared/                       # DataTable, ExportMenu, etc. (Sprint 1H)
│   └── modules/                      # Module-specific (later sprints)
├── hooks/                            # Custom hooks
├── lib/
│   └── utils.ts                      # shadcn utility (auto-generated)
├── services/                         # API client functions
│   └── api.ts                        # Axios instance (placeholder)
├── stores/                           # Zustand stores
│   └── auth.store.ts                 # Auth store (placeholder)
└── types/                            # TypeScript types
    └── index.ts                      # Shared types (placeholder)
```

Every placeholder page should contain a minimal component:

```typescript
// Example: frontend/src/app/(tenant)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <h1 className="text-2xl font-semibold text-brand">Dashboard — Coming Soon</h1>
    </div>
  );
}
```

### 5.6 Create API Client Placeholder

Create `frontend/src/services/api.ts`:

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach auth token
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401, refresh token (will be built in Sprint 1E)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // TODO: Implement refresh token logic in Sprint 1E
    return Promise.reject(error);
  }
);

export default api;
```

### 5.7 Frontend Environment File

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_PLATFORM_DOMAIN=localhost:3000
```

---

## 6. Shared Types Package

Create `packages/shared/index.ts`:

```typescript
// ============================================================================
// Shared types, constants, and enums used by both frontend and backend
// ============================================================================

// --- Enums ---

export const TenantStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
  TRIAL: 'trial',
} as const;

export const SubscriptionTier = {
  STANDARD: 'standard',
  WITH_RECRUITMENT: 'with_recruitment',
} as const;

export const UserStatus = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  ARCHIVED: 'archived',
} as const;

export const EmploymentType = {
  PERMANENT: 'permanent',
  CONTRACT: 'contract',
  INTERN: 'intern',
  FREELANCE: 'freelance',
} as const;

export const LeaveRequestStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export const RegistrationSource = {
  SELF_SERVICE: 'self_service',
  SUPER_ADMIN: 'super_admin',
} as const;

export const RegistrationStatus = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  PROVISIONED: 'provisioned',
  FAILED: 'failed',
} as const;

export const BillingStatus = {
  PENDING: 'pending',
  PAID: 'paid',
  OVERDUE: 'overdue',
} as const;

export const EmailDomainType = {
  COMPANY: 'company',
  EXTERNAL: 'external',
} as const;

// --- API Response Types ---

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any[];
  };
}

// --- Pagination ---

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}
```

Create `packages/shared/package.json`:

```json
{
  "name": "@hrms/shared",
  "version": "1.0.0",
  "main": "index.ts",
  "types": "index.ts"
}
```

---

## 7. Root-Level Files

### 7.1 `.gitignore`

Create `hrms-platform/.gitignore`:

```
node_modules/
dist/
.env
.env.local
.next/
*.log
.DS_Store
```

### 7.2 `README.md`

Create `hrms-platform/README.md`:

```markdown
# HRMS Platform

Multi-tenant Human Resource Management System.

## Structure

- `frontend/` — Next.js (TypeScript, Tailwind, shadcn/ui)
- `backend/` — NestJS (TypeScript, Prisma, PostgreSQL)
- `packages/shared/` — Shared types and constants

## Setup

### Prerequisites
- Node.js 18+
- PostgreSQL 15+

### Backend
\`\`\`bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run start:dev
\`\`\`
Server runs at http://localhost:3001

### Frontend
\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`
App runs at http://localhost:3000
```

---

## 8. Verification & Acceptance Criteria

After completing all steps, verify:

- [ ] **Backend starts without errors:** `cd backend && npm run start:dev` → console shows `🚀 Backend running on http://localhost:3001`
- [ ] **Frontend starts without errors:** `cd frontend && npm run dev` → opens at http://localhost:3000
- [ ] **PostgreSQL connection works:** Prisma can connect and run queries
- [ ] **Platform schema exists:** Run `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'platform';` → returns 1 row
- [ ] **Platform tables exist:** Run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'platform';` → returns 5 tables (tenants, super_admins, super_admin_sessions, billing_records, registration_requests)
- [ ] **Default super admin seeded:** Run `SELECT email, name FROM platform.super_admins;` → returns `admin@hrms-platform.com`
- [ ] **Prisma client generated:** `node_modules/.prisma/client` exists in backend
- [ ] **All Prisma models compile:** `npx prisma validate` passes with no errors
- [ ] **Tenant tables exist in public schema:** The Prisma migration created all ~65 tables in the `public` schema (these serve as the template for tenant provisioning later)
- [ ] **shadcn/ui components installed:** `frontend/src/components/ui/` contains button, card, input, etc.
- [ ] **Brand theme applied:** Primary color `#011552` and Inter font visible when visiting frontend
- [ ] **All placeholder pages render:** Visiting `/login`, `/platform/login`, `/dashboard`, etc. shows "Coming Soon" text without errors
- [ ] **API client configured:** `frontend/src/services/api.ts` exists with Axios instance pointing to `http://localhost:3001/api`
- [ ] **Environment files present:** `backend/.env` and `frontend/.env.local` exist with correct values

---

*Sprint 1A Complete. Next: Sprint 1B — Multi-Tenancy Engine*
