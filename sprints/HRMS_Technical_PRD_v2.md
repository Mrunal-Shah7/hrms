# HRMS Platform — Technical Product Requirement Document (PRD)

**Version:** 2.0
**Date:** February 24, 2026
**Purpose:** Single source of truth for building the HRMS platform. Each section is self-contained enough to be decomposed into cursor-ready implementation prompts.

---

## Table of Contents

1. [Product Overview & Goals](#1-product-overview--goals)
2. [Tech Stack & Project Structure](#2-tech-stack--project-structure)
3. [Multi-Tenancy Architecture](#3-multi-tenancy-architecture)
4. [Platform-Level: Super Admin Portal](#4-platform-level-super-admin-portal)
5. [Self-Service Tenant Registration](#5-self-service-tenant-registration)
6. [Global UI Shell & Navigation](#6-global-ui-shell--navigation)
7. [Tenant Authentication & Account Management](#7-tenant-authentication--account-management)
8. [RBAC — Roles, Permissions & Access Control](#8-rbac--roles-permissions--access-control)
9. [Core Shared Services](#9-core-shared-services)
10. [Module: Employee Management](#10-module-employee-management)
11. [Module: Leave Management](#11-module-leave-management)
12. [Module: Time Tracker](#12-module-time-tracker)
13. [Module: Attendance](#13-module-attendance)
14. [Module: Performance & Goals](#14-module-performance--goals)
15. [Module: Files](#15-module-files)
16. [Module: Compensation](#16-module-compensation)
17. [Module: Recruitment](#17-module-recruitment)
18. [Module: Onboarding](#18-module-onboarding)
19. [Module: Offboarding](#19-module-offboarding)
20. [Module: Reports](#20-module-reports)
21. [Module: Dashboard (Home)](#21-module-dashboard-home)
22. [Module: Settings](#22-module-settings)
23. [Notification & Email System](#23-notification--email-system)
24. [Data Import & Export](#24-data-import--export)
25. [Subscription & Licensing](#25-subscription--licensing)
26. [API Design Standards](#26-api-design-standards)
27. [Database Schema Reference](#27-database-schema-reference)
28. [Development Phases & Dependency Map](#28-development-phases--dependency-map)

---

## 1. Product Overview & Goals

### 1.1 What Is This Product

A multi-tenant Human Resource Management System (HRMS) web platform — similar to Zoho People — that organizations purchase on a per-user-per-month subscription to manage their entire HR lifecycle: employee management, leave, attendance, time tracking, performance, compensation, recruitment, onboarding, and offboarding.

### 1.2 Key Product Characteristics

- **Multi-tenant SaaS:** Each organization gets an isolated PostgreSQL schema. Supports cloud-hosted (AWS/Azure) and self-hosted deployments.
- **Dual registration:** Organizations can self-register via a public signup page OR be provisioned by the platform super admin.
- **Role-based access:** RBAC with configurable custom roles. Users can hold multiple roles.
- **Two subscription tiers:** Standard (all modules except Recruitment) and Standard + Recruitment.
- **Responsive web app:** No native mobile apps for v1. English only.
- **Per-user-per-month pricing:** Admins manage seat counts within their subscription.

### 1.3 User Personas

| Persona | Level | Description | Primary Actions |
|---------|-------|-------------|-----------------|
| **Super Admin** | Platform | Platform owner (SaaS provider). Exists outside any tenant in the `platform` schema. | Provision tenants, manage billing, monitor platform health, manage super admin accounts |
| **Organization Admin** | Tenant | Org-level owner who purchased/registered the platform. Has full access. | Configure all settings, manage all modules, create roles/users |
| **HR Admin** | Tenant | Senior HR personnel with broad access. | Manage employees, approve leaves, handle recruitment/onboarding/offboarding, view compensation (re-auth required) |
| **HR Manager** | Tenant | HR personnel with operational access but no settings control. | Similar to HR Admin minus settings and RBAC configuration |
| **Manager / Team Lead** | Tenant | Department or team lead. | View reportees' attendance/leave/goals, assign goals/tasks, manage delegations, view project budgets |
| **Employee (Basic)** | Tenant | Regular employee. | View own data across all modules, apply for leave, update goal progress, submit resignation |
| **Custom Roles** | Tenant | Admin-created roles (CEO, CTO, Finance Manager, etc.) | Permissions determined by admin during role creation |

**Note:** Guest role is explicitly excluded. No unauthenticated access except the public careers job page and the self-service registration page.

### 1.4 Two Entry Points Into the Platform

The platform has two distinct entry points with separate auth flows:

1. **Platform Level** (`/platform/login`) — For super admins who manage the SaaS infrastructure. Authenticates against `platform.super_admins` table. Leads to the Super Admin Portal.
2. **Tenant Level** (`/login`) — For organization users (admin, HR, manager, employee). Authenticates against the tenant's `users` table. Leads to the tenant dashboard.

Additionally, there is a **public registration page** (`/register`) where new organizations can self-signup.

---

## 2. Tech Stack & Project Structure

### 2.1 Technology Choices

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Frontend** | Next.js (TypeScript) | SSR for SEO on public pages, App Router, file-based routing |
| **Backend** | NestJS (TypeScript) | Modular architecture with decorators, guards, pipes; ideal for enterprise apps |
| **Database** | PostgreSQL | Relational integrity, schema-per-tenant support, JSONB for flexible fields |
| **ORM** | Prisma or TypeORM | Type-safe DB access with migration support |
| **Real-time** | WebSockets via NestJS Gateway (Socket.IO) | In-app notifications, live updates |
| **Auth** | JWT (access + refresh tokens) | Stateless auth with session tracking |
| **File Storage** | PostgreSQL BYTEA (v1) with abstraction layer | Swappable to S3/GCS later without code changes |
| **Email** | Abstraction over SendGrid / AWS SES / SMTP | Per-tenant configurable |
| **PDF Generation** | Puppeteer or PDFKit | Payslips, exports, offer letters |
| **Excel** | ExcelJS | Spreadsheet exports |
| **CSV** | json2csv or native | CSV exports/imports |
| **Styling** | Tailwind CSS + shadcn/ui components | Rapid, consistent UI |
| **State Management** | React Query (TanStack Query) for server state, Zustand for client state | Cache management, real-time sync |
| **Form Handling** | React Hook Form + Zod validation | Type-safe forms |

### 2.2 Proposed Project Structure

```
hrms-platform/
├── apps/
│   ├── web/                          # Next.js frontend
│   │   ├── app/
│   │   │   ├── (auth)/               # Tenant login, forgot password, reset password
│   │   │   │   ├── login/
│   │   │   │   ├── forgot-password/
│   │   │   │   └── reset-password/
│   │   │   ├── (public)/             # Unauthenticated pages
│   │   │   │   ├── register/         # Self-service tenant registration
│   │   │   │   └── careers/[slug]/[token]/  # Public job page
│   │   │   ├── (platform)/           # Super Admin portal (separate auth)
│   │   │   │   ├── login/            # Platform login (/platform/login)
│   │   │   │   ├── dashboard/        # Platform dashboard
│   │   │   │   ├── tenants/          # Tenant management (list, create, detail)
│   │   │   │   ├── billing/          # Billing records
│   │   │   │   └── admins/           # Super admin user management
│   │   │   ├── (tenant)/             # Main tenant app (all modules)
│   │   │   │   ├── dashboard/
│   │   │   │   ├── employees/
│   │   │   │   ├── leave/
│   │   │   │   ├── attendance/
│   │   │   │   ├── time-tracker/
│   │   │   │   ├── performance/
│   │   │   │   ├── files/
│   │   │   │   ├── compensation/
│   │   │   │   ├── recruitment/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── offboarding/
│   │   │   │   ├── reports/
│   │   │   │   ├── settings/
│   │   │   │   └── account/
│   │   ├── components/
│   │   │   ├── ui/                   # Base UI components (shadcn)
│   │   │   ├── layout/              # Shell, sidebar, header
│   │   │   ├── shared/              # DataTable, ExportMenu, SearchBar, etc.
│   │   │   └── modules/             # Module-specific components
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── services/                # API client functions
│   │   └── types/
│   │
│   └── api/                          # NestJS backend
│       ├── src/
│       │   ├── common/               # Guards, decorators, pipes, interceptors, filters
│       │   ├── core/                 # Shared services (email, file, notification, export, audit)
│       │   ├── platform/             # Super Admin: auth, tenant mgmt, billing, admin mgmt
│       │   │   ├── platform-auth/
│       │   │   ├── tenants/
│       │   │   ├── billing/
│       │   │   └── super-admins/
│       │   ├── registration/         # Self-service tenant registration
│       │   ├── auth/                 # Tenant-level auth
│       │   ├── rbac/
│       │   ├── tenant/               # Tenant middleware, context resolution
│       │   ├── employees/
│       │   ├── leave/
│       │   ├── time-tracker/
│       │   ├── attendance/
│       │   ├── performance/
│       │   ├── files/
│       │   ├── compensation/
│       │   ├── recruitment/
│       │   ├── onboarding/
│       │   ├── offboarding/
│       │   ├── reports/
│       │   ├── dashboard/
│       │   └── settings/
│       ├── prisma/                   # Schema, migrations, seed
│       └── test/
│
├── packages/
│   └── shared/                       # Shared types, constants, validation schemas
│
├── docker-compose.yml
├── .env.example
└── README.md
```

### 2.3 Key Architectural Patterns

- **Backend modules:** Each NestJS module encapsulates its own controller, service, DTOs, and entities.
- **Dual auth systems:** Platform routes use `PlatformAuthGuard` (validates against `platform.super_admins`). Tenant routes use `TenantAuthGuard` (validates against tenant schema `users` table). These are completely separate JWT flows.
- **Tenant middleware:** Every tenant-level request passes through `TenantMiddleware` that resolves the tenant from subdomain/custom domain/header and sets the PostgreSQL `search_path` to the tenant's schema.
- **Platform routes bypass tenant middleware:** All `/api/platform/*` routes operate on the `platform` schema directly and skip tenant resolution.
- **RBAC guards:** A `@RequirePermission(module, action, resource)` decorator on each tenant route. A `PermissionGuard` checks the user's roles against the required permission.
- **Audit interceptor:** A global `AuditInterceptor` logs CUD (Create/Update/Delete) operations automatically.
- **Response interceptor:** Wraps all responses in a consistent `{ success, data, meta }` envelope.
- **Exception filter:** Catches all exceptions and formats them as `{ success: false, error: { code, message, details } }`.

---

## 3. Multi-Tenancy Architecture

### 3.1 Tenancy Model: Schema-per-Tenant

Each organization receives a **dedicated PostgreSQL schema**. A shared `platform` schema manages cross-tenant data.

### 3.2 Platform Schema

**Purpose:** Holds data that lives outside any single tenant — tenant registry, super admin accounts, billing, registration records.

**Table: `platform.tenants`**
- `id` (UUID, PK)
- `name` (VARCHAR 255) — Organization name
- `slug` (VARCHAR 100, UNIQUE) — URL-safe identifier, e.g., "acme-corp"
- `custom_domain` (VARCHAR 255, NULLABLE) — e.g., "hr.acmecorp.com"
- `schema_name` (VARCHAR 100, UNIQUE) — PostgreSQL schema name for this tenant
- `subscription_tier` (VARCHAR 50) — `'standard'` | `'with_recruitment'`
- `max_users` (INT) — Seat limit
- `current_user_count` (INT, DEFAULT 0)
- `billing_email` (VARCHAR 255)
- `status` (VARCHAR 20, DEFAULT 'active') — `'active'` | `'suspended'` | `'cancelled'` | `'trial'`
- `registration_source` (VARCHAR 50) — `'self_service'` | `'super_admin'` — tracks how the tenant was created
- `trial_ends_at` (TIMESTAMP, NULLABLE)
- `created_at`, `updated_at` (TIMESTAMP)

**Table: `platform.super_admins`**
- `id` (UUID, PK)
- `email` (VARCHAR 255, UNIQUE)
- `password_hash` (VARCHAR 255)
- `name` (VARCHAR 255)
- `is_active` (BOOLEAN, DEFAULT TRUE)
- `last_login_at` (TIMESTAMP, NULLABLE)
- `created_at` (TIMESTAMP)

**Table: `platform.super_admin_sessions`**
- `id` (UUID, PK)
- `super_admin_id` (FK → super_admins)
- `refresh_token_hash` (VARCHAR 255)
- `device_info` (JSONB) — `{ browser, os, ip, location }`
- `expires_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)

**Table: `platform.billing_records`**
- `id` (UUID, PK)
- `tenant_id` (FK → tenants)
- `period_start`, `period_end` (DATE)
- `user_count` (INT)
- `per_user_rate` (DECIMAL 10,2)
- `tier` (VARCHAR 50)
- `total_amount` (DECIMAL 10,2)
- `status` (VARCHAR 20) — `'pending'` | `'paid'` | `'overdue'`
- `created_at` (TIMESTAMP)

**Table: `platform.registration_requests`**
- `id` (UUID, PK)
- `organization_name` (VARCHAR 255)
- `slug` (VARCHAR 100, UNIQUE)
- `admin_name` (VARCHAR 255)
- `admin_email` (VARCHAR 255)
- `admin_password_hash` (VARCHAR 255)
- `subscription_tier` (VARCHAR 50)
- `email_verification_token` (VARCHAR 255)
- `email_verified` (BOOLEAN, DEFAULT FALSE)
- `status` (VARCHAR 20, DEFAULT 'pending') — `'pending'` | `'verified'` | `'provisioned'` | `'failed'`
- `tenant_id` (UUID, NULLABLE, FK → tenants) — Set after successful provisioning
- `created_at` (TIMESTAMP)
- `verified_at` (TIMESTAMP, NULLABLE)
- `provisioned_at` (TIMESTAMP, NULLABLE)

### 3.3 Tenant Resolution

Incoming tenant-level requests are resolved to a tenant in this priority order:

1. **Custom domain** — Match `Host` header against `tenants.custom_domain`
2. **Subdomain** — Extract slug from `{slug}.platform-domain.com`
3. **Header** — `X-Tenant-ID` header (for programmatic API access)

The `TenantMiddleware` runs before all tenant route handlers, resolves the tenant, and sets `SET search_path TO '{schema_name}'` on the database connection for that request.

**Important:** Platform routes (`/api/platform/*`) and public routes (`/api/public/*`) bypass tenant middleware entirely.

### 3.4 Tenant Provisioning Workflow (Internal — Used by Both Registration Paths)

Regardless of whether a tenant is created by a super admin or self-service registration, the same provisioning pipeline runs:

1. Create a new row in `platform.tenants`.
2. Create a new PostgreSQL schema named after the tenant's slug (sanitized).
3. Run all migrations on the new schema (creates all ~65 tables).
4. Seed default data:
   - Default roles: Admin, HR Admin, HR Manager, Manager/Team Lead, Employee (Basic)
   - Default permissions for each role
   - Default leave types: Casual Leave, Earned Leave, Leave Without Pay, Paternity Leave, Sabbatical Leave, Sick Leave
   - Default work schedule: General (9:00 AM – 6:00 PM, Mon–Fri)
   - Default candidate pipeline stages: New → In Review → Available → Engaged → Offered → Hired → Rejected
   - Default organization_settings record with basic config
5. Create the organization's admin user account (in the tenant schema's `users` table) with the "Admin" role.
6. Send welcome email to the admin with login credentials and a link to the platform.

---

## 4. Platform-Level: Super Admin Portal

### 4.1 Overview

The Super Admin Portal is a completely separate section of the application, accessible at `/platform/*`. It has its own authentication flow, its own layout, and its own set of pages. Super admins manage the SaaS infrastructure — they do NOT interact with tenant-level modules (leave, attendance, etc.).

### 4.2 Super Admin Authentication

**Login page:** `/platform/login`

This page is visually distinct from the tenant login page. It authenticates against the `platform.super_admins` table.

**Login Flow:**
1. Super admin navigates to `/platform/login`.
2. Submits email + password.
3. Backend validates against `platform.super_admins` table (no tenant resolution).
4. Returns a `platformAccessToken` (JWT, 15 min TTL) + `platformRefreshToken` (7 days).
5. Access token payload: `{ superAdminId, type: 'platform' }`
6. All subsequent `/api/platform/*` requests include `Authorization: Bearer {platformAccessToken}`.
7. A `PlatformAuthGuard` on all platform routes validates the token and confirms `type === 'platform'`.

**Password Reset:**
Same OTP flow as tenant users, but against `platform.super_admins` table. Routes: `/api/platform/auth/forgot-password`, `/api/platform/auth/verify-otp`, `/api/platform/auth/reset-password`.

### 4.3 Super Admin Portal Pages

**4.3.1 Platform Dashboard** (`/platform/dashboard`)

Landing page after super admin login. Widgets:
- **Total Tenants:** Count by status (active, trial, suspended, cancelled)
- **Total Users Across Tenants:** Aggregate user count
- **Revenue Overview:** Total billing for current month/period
- **Recent Registrations:** Last 10 self-service signups with status
- **Tenants Approaching Trial Expiry:** List of tenants whose trial ends within 7 days
- **Overdue Payments:** Tenants with unpaid billing records
- **System Health:** Basic health metrics (if applicable)

**4.3.2 Tenant Management** (`/platform/tenants`)

- **List View:** Searchable, filterable, paginated table
  - Columns: Org Name, Slug, Tier, Users (used/max), Status, Registration Source, Created Date, Actions
  - Filters: Status, Tier, Registration Source
  - Search: by name, slug, billing email
- **Create Tenant** (`/platform/tenants/new`): Form to manually provision a new organization
  - Fields: Organization Name\*, Slug\* (auto-generated from name, editable), Subscription Tier\* (dropdown: Standard, Standard + Recruitment), Max Users\* (number), Billing Email\*, Admin Name\*, Admin Email\*, Temporary Password\* (auto-generate option), Custom Domain (optional)
  - Submit triggers the full provisioning workflow (Section 3.4)
  - On success: shows confirmation with tenant details and admin credentials
- **Tenant Detail** (`/platform/tenants/:id`): Full tenant information
  - Sections: Basic Info (name, slug, domain, tier, status), Usage Stats (current users, storage used), Admin Account Info, Billing History, Registration Info (source, date, verification status)
  - Actions: Edit Tier, Change Max Users, Suspend Tenant, Reactivate Tenant, Cancel Tenant
- **Edit Tenant** (`/platform/tenants/:id/edit`): Modify tenant settings
  - Editable: Name, Subscription Tier, Max Users, Custom Domain, Status

**4.3.3 Billing Management** (`/platform/billing`)

- List of all billing records across tenants
- Filters: Tenant, Status (pending/paid/overdue), Date range
- "Generate Invoice" button: Select tenant + period to generate a billing record
- Billing detail: Tenant name, period, user count, rate, total, status
- Mark as Paid / Mark as Overdue actions

**4.3.4 Super Admin Management** (`/platform/admins`)

- List of super admin accounts (name, email, last login, active status)
- "Add Super Admin" form: Name, Email, Password
- Edit: Name, Active status
- Deactivate / Reactivate actions
- Cannot delete the last active super admin

**4.3.5 Registration Requests** (`/platform/registrations`)

- List of self-service registration attempts
- Columns: Org Name, Admin Email, Tier, Status (pending/verified/provisioned/failed), Created Date
- For failed provisioning: "Retry" button
- For pending (unverified email): "Resend Verification Email" button
- Filter by status

### 4.4 Super Admin Portal Layout

The super admin portal uses a separate, simpler layout from the tenant app:

```
┌──────────────────────────────────────────────────────────┐
│  [Platform Logo]   HRMS Platform Admin      👤 Super Admin │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│  📊 Dashboard  │         Main Content Area               │
│  🏢 Tenants    │                                         │
│  💳 Billing    │                                         │
│  📋 Registrations │                                      │
│  👥 Admins     │                                         │
│          │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### 4.5 Platform APIs

**Authentication:**

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/platform/auth/login` | None | Super admin login |
| POST | `/api/platform/auth/refresh` | Refresh token | Refresh token pair |
| POST | `/api/platform/auth/logout` | Platform JWT | Invalidate session |
| POST | `/api/platform/auth/forgot-password` | None | Send OTP to super admin email |
| POST | `/api/platform/auth/verify-otp` | None | Verify OTP |
| POST | `/api/platform/auth/reset-password` | Reset token | Reset password |

**Tenant Management:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform/tenants?status=&tier=&source=&search=&page=&limit=&sortBy=&sortOrder=` | List tenants |
| GET | `/api/platform/tenants/:id` | Tenant detail with usage stats and billing history |
| POST | `/api/platform/tenants` | Create + provision new tenant (full provisioning workflow) |
| PUT | `/api/platform/tenants/:id` | Update tenant (name, tier, max_users, custom_domain) |
| PUT | `/api/platform/tenants/:id/suspend` | Suspend tenant (blocks all tenant-level logins) |
| PUT | `/api/platform/tenants/:id/reactivate` | Reactivate suspended tenant |
| PUT | `/api/platform/tenants/:id/cancel` | Cancel tenant (soft — marks as cancelled) |

**Billing:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform/billing?tenantId=&status=&from=&to=&page=&limit=` | List billing records |
| GET | `/api/platform/billing/:id` | Billing record detail |
| POST | `/api/platform/billing/generate` | Generate billing record for tenant + period |
| PUT | `/api/platform/billing/:id/status` | Update status (mark paid/overdue) |

**Super Admin Management:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform/admins` | List super admins |
| POST | `/api/platform/admins` | Create new super admin |
| PUT | `/api/platform/admins/:id` | Update super admin (name, active status) |
| DELETE | `/api/platform/admins/:id` | Deactivate super admin (cannot delete last active) |

**Registration Requests:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform/registrations?status=&page=&limit=` | List registration requests |
| POST | `/api/platform/registrations/:id/retry` | Retry failed provisioning |
| POST | `/api/platform/registrations/:id/resend-verification` | Resend email verification |

### 4.6 Acceptance Criteria

- [ ] Super admin login at `/platform/login` authenticates against `platform.super_admins` — never against any tenant schema.
- [ ] Platform JWT tokens have `type: 'platform'` and are rejected by tenant auth guards (and vice versa).
- [ ] Super admin can create a new tenant via the portal form; provisioning creates schema, runs migrations, seeds defaults, creates admin user, sends welcome email.
- [ ] Suspending a tenant blocks all tenant-level logins immediately.
- [ ] Super admin cannot delete the last active super admin account.
- [ ] Platform dashboard shows accurate aggregate stats across all tenants.
- [ ] Registration requests page shows all self-service signups with their current status.

---

## 5. Self-Service Tenant Registration

### 5.1 Overview

Organizations can sign up on their own through a public registration page without needing to contact the platform owner. The flow includes email verification before provisioning.

### 5.2 Registration Page UI

**Page:** `/register` (public, no auth required)

**Form Fields:**
- Organization Name\* (text)
- Organization Slug\* (auto-generated from name as kebab-case, editable, uniqueness check on blur)
- Admin Full Name\* (text)
- Admin Email Address\* (email, uniqueness check on blur)
- Password\* (with strength indicator: min 8 chars, 1 uppercase, 1 number, 1 special character)
- Confirm Password\*
- Subscription Tier\* (radio/card selector):
  - **Standard** — All modules except Recruitment — ₹X/user/month
  - **Standard + Recruitment** — All modules — ₹Y/user/month
- Number of Users\* (number input, min 1, this sets `max_users`)
- Terms & Conditions checkbox\*

**UI Behavior:**
- Real-time slug generation: typing "Acme Corporation" auto-fills slug as "acme-corporation"
- Slug uniqueness check: debounced API call on blur → shows green checkmark or red "already taken" error
- Email uniqueness check: debounced API call on blur → shows error if email already exists in any tenant or platform admin
- Password strength meter
- On submit: show loading state → redirect to email verification pending page

### 5.3 Registration Flow

```
User fills form → POST /api/public/register
                       │
                       ▼
          Create registration_request record (status: 'pending')
          Generate email_verification_token (UUID)
          Send verification email with link: /register/verify?token={token}
                       │
                       ▼
          User clicks email link → GET /api/public/register/verify?token={token}
                       │
                       ▼
          Mark registration_request as 'verified'
          Trigger async tenant provisioning (Section 3.4)
                       │
                       ▼
          On success: Mark as 'provisioned', create tenant record, link tenant_id
          Send welcome email with login URL ({slug}.platform.com/login)
                       │
                       ▼
          User logs in at tenant URL with admin credentials
```

**Edge Cases:**
- If verification token is expired (24 hours), show "Token expired" page with "Resend Verification" button.
- If provisioning fails, mark as 'failed'. Super admin can see this in the Registration Requests page and retry.
- If the slug becomes taken between registration and provisioning (race condition), append a random suffix.

### 5.4 Post-Registration Pages

**Email Verification Pending** (`/register/pending`):
- Message: "We've sent a verification email to {email}. Please click the link to activate your organization."
- "Resend Email" button (rate-limited: once per 60 seconds)
- "Change Email" link (allows editing the email before verification)

**Email Verified / Provisioning** (`/register/verify?token=...`):
- On valid token: "Email verified! We're setting up your organization. This usually takes a few seconds..."
- Shows a progress indicator.
- On provisioning complete: "Your organization is ready! You can now log in." with a "Go to Login" button linking to `{slug}.platform-domain.com/login`
- On provisioning failure: "Something went wrong. Our team has been notified. Please try again later or contact support."

### 5.5 Public Registration APIs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/public/register` | None | Submit registration (creates registration_request, sends verification email) |
| GET | `/api/public/register/verify?token=` | None | Verify email, triggers provisioning |
| POST | `/api/public/register/resend-verification` | None | Resend verification email (requires email in body) |
| GET | `/api/public/register/check-slug?slug=` | None | Check if slug is available (returns boolean) |
| GET | `/api/public/register/check-email?email=` | None | Check if email is available (returns boolean) |

**POST `/api/public/register`** — Request Body:
```json
{
  "organizationName": "Acme Corporation",
  "slug": "acme-corporation",
  "adminName": "John Doe",
  "adminEmail": "john@acme.com",
  "password": "SecureP@ss1",
  "subscriptionTier": "standard",
  "maxUsers": 10
}
```

**Response:** `{ success: true, message: "Verification email sent", registrationId: "uuid" }`

### 5.6 Acceptance Criteria

- [ ] Registration page is publicly accessible without any authentication.
- [ ] Slug auto-generates from org name and shows real-time availability.
- [ ] Email uniqueness is checked across all tenants and platform admins.
- [ ] Verification email contains a link with a token that expires in 24 hours.
- [ ] Clicking a valid verification link triggers schema provisioning automatically.
- [ ] After provisioning, the admin can log in at the tenant URL.
- [ ] Expired verification tokens show a clear message with resend option.
- [ ] Failed provisioning is visible to super admins for retry.
- [ ] Rate limiting: max 5 registration attempts per IP per hour.
- [ ] Rate limiting: max 3 resend verification requests per registration per hour.

---

## 6. Global UI Shell & Navigation

### 6.1 Tenant App Layout Structure

The tenant application (used by organization admin, HR, managers, employees) uses a consistent shell:

```
┌─────────────────────────────────────────────────────────┐
│  [Platform Logo]           Header Bar       [+] 🔍 🔔 ⚙ 👤 │
├────────┬────────────────────────────────────────────────┤
│        │  Top Tab Navigation (module-specific)          │
│  Side  ├────────────────────────────────────────────────┤
│  bar   │                                                │
│  Nav   │              Main Content Area                 │
│        │                                                │
│  Home  │  ┌──────────────────────────────────────────┐  │
│  Onb.  │  │  Toolbar: View switcher, filters,        │  │
│  Leave │  │  search, primary action button, ⋮ export  │  │
│  Att.  │  ├──────────────────────────────────────────┤  │
│  Time  │  │                                          │  │
│  Perf. │  │  Data Table / Cards / Content             │  │
│  Files │  │                                          │  │
│  Comp. │  │                                          │  │
│  More▾ │  └──────────────────────────────────────────┘  │
│        │                                Pagination      │
│  Ops   │                                                │
│  Rpts  │                                                │
└────────┴────────────────────────────────────────────────┘
```

### 6.2 Sidebar Navigation Items

Items shown depend on the user's permissions:

| Icon | Label | Route | Visible To |
|------|-------|-------|------------|
| 🏠 | Home | `/dashboard` | All |
| 📋 | Onboarding | `/onboarding` | HR, Admin |
| 🏖 | Leave Tracker | `/leave` | All |
| 📅 | Attendance | `/attendance` | All |
| ⏱ | Time Tracker | `/time-tracker` | All (view own), Admin (config) |
| 📈 | Performance | `/performance` | All |
| 📁 | Files | `/files` | All |
| 💰 | Compensation | `/compensation` | All (own), HR/Admin (all) |
| ⋯ | More | Expands: Recruitment, Employee Mgmt | Context-dependent |
| ⚙ | Operations | `/settings` | Admin |
| 📊 | Reports | `/reports` | HR, Admin |

**Recruitment** appears under "More" — only visible if `subscription_tier === 'with_recruitment'` AND user has HR/Admin role.

### 6.3 Header Bar Components

- **Left:** Platform logo (no per-tenant logo customization)
- **Right:**
  - **[+] button:** Quick-create dropdown (new employee, new leave request, new goal — context-aware based on current page and permissions)
  - **🔍 Search:** Global search across employees, candidates, etc.
  - **🔔 Notification bell:** Shows red dot when unread notifications exist. Click opens notification panel.
  - **⚙ Settings:** Direct link to settings (Admin only)
  - **👤 Profile avatar:** Dropdown with: My Profile, My Account, Sign Out

### 6.4 Common Page Patterns

**Data Table Pages** (Employee list, Leave requests, Candidates, Interviews, etc.):
- Top-left: View name dropdown (e.g., "Employee View"), Edit link
- Top-right: Primary action button (e.g., "Add Employee"), expand/fullscreen icon, filter icon, **three-dots menu (⋮)** for export options
- Filter sidebar: Collapsible left panel with checkbox filters
- Table: Sortable columns, selectable rows, pagination at bottom
- Pagination: Records-per-page dropdown (10/25/50), page navigation

**Detail Pages** (Employee profile, Job Opening details, Candidate details):
- Left sidebar: Quick Access links, Related List, Tags, Links
- Main area: Overview tab (default) + Timeline tab
- Sections: Business Card (summary), then expandable detail sections
- Bottom: Notes, Attachments, related entities

**Form Modals/Drawers** (Apply Leave, Add Employee, Add Candidate):
- Slide-in drawer or modal dialog
- Grouped fields with section headers
- Required field markers (*)
- Submit / Cancel buttons at bottom

### 6.5 Three-Dots Export Menu

Present on every data-table page in the top-right toolbar:

```
⋮ (click) → Dropdown:
  📄 Export as PDF
  📊 Export as Excel (.xlsx)
  📝 Export as CSV
```

Exports respect the currently applied filters. Triggers a file download.

---

## 7. Tenant Authentication & Account Management

### 7.1 User Account Schema

**Table: `users`** (within each tenant schema)
- `id` (UUID, PK)
- `employee_id` (VARCHAR 50, UNIQUE, NULLABLE) — Auto-generated or manually set
- `email` (VARCHAR 255, UNIQUE)
- `password_hash` (VARCHAR 255)
- `first_name` (VARCHAR 100)
- `last_name` (VARCHAR 100)
- `display_name` (VARCHAR 100, NULLABLE)
- `phone` (VARCHAR 20, NULLABLE)
- `photo_url` (TEXT, NULLABLE)
- `email_domain_type` (VARCHAR 20) — `'company'` | `'external'`. Determines if the "External User" badge is shown.
- `status` (VARCHAR 20, DEFAULT 'active') — `'active'` | `'inactive'` | `'archived'`
- `must_reset_password` (BOOLEAN, DEFAULT TRUE) — Force password change on first login
- `last_login_at` (TIMESTAMP, NULLABLE)
- `created_at`, `updated_at` (TIMESTAMP)

**Table: `password_reset_otps`**
- `id` (UUID, PK)
- `user_id` (FK → users)
- `otp_hash` (VARCHAR 255)
- `expires_at` (TIMESTAMP) — 10 minutes from creation
- `used` (BOOLEAN, DEFAULT FALSE)
- `created_at` (TIMESTAMP)

**Table: `user_sessions`**
- `id` (UUID, PK)
- `user_id` (FK → users)
- `refresh_token_hash` (VARCHAR 255)
- `device_info` (JSONB) — `{ browser, os, ip, location }`
- `expires_at` (TIMESTAMP) — 7 days
- `created_at` (TIMESTAMP)

### 7.2 Authentication Flows

**Tenant Login Flow:**
1. User navigates to `/login` (tenant resolved from URL).
2. Submits email + password.
3. Backend validates credentials against the resolved tenant schema's `users` table.
4. Checks `users.status === 'active'` — archived/inactive users cannot log in.
5. Checks `platform.tenants.status === 'active'` — suspended/cancelled tenants block login.
6. On success: returns JWT access token (15 min TTL) + refresh token (7 days). Refresh token stored hashed in `user_sessions`.
7. Access token payload: `{ userId, tenantId, schemaName, roles: string[], permissions: string[], type: 'tenant' }`
8. If `must_reset_password` is true, redirect to forced password change page.
9. On failure: return 401 with generic "Invalid email or password" (no user enumeration).

**Token Refresh:**
1. Client detects access token expired (or 401 response).
2. Sends refresh token to `/api/auth/refresh`.
3. Backend validates refresh token, issues new access + refresh token pair, invalidates old refresh token.

**Password Reset (Forgot Password):**
1. User clicks "Forgot Password" on login page.
2. Submits their email.
3. Backend generates 6-digit numeric OTP, stores hash in `password_reset_otps` (expires 10 min), sends OTP via email.
4. User enters OTP on verification page.
5. Backend validates OTP, returns a short-lived `resetToken`.
6. User submits new password + `resetToken`.
7. Backend updates `password_hash`, invalidates all sessions, marks OTP as used.

**Compensation Re-authentication:**
1. User navigates to the Compensation module.
2. Modal prompts: "Please re-enter your password to access compensation data."
3. User submits password.
4. Backend validates and returns a `compensationAccessToken` (5-minute TTL).
5. All compensation API calls must include `X-Compensation-Token: {compensationAccessToken}` header.
6. If token expires while on the page, prompt re-authentication again.

### 7.3 Account Pages (Frontend)

**Profile Page** (`/account/profile`):
- Sections: Personal Information (name, display name, gender, country/region, state, language, timezone), My Email Addresses, My Mobile Numbers
- Reference: `accounts_profile.png`

**Security Page** (`/account/security`):
- Change Password, Device Sign-ins
- Reference: `accounts_security.png`

**Sessions Page** (`/account/sessions`):
- Active sessions with device info, "Revoke" per session
- Reference: `accounts_sessions.png`

**Settings Page** (`/account/settings`):
- User-specific display preferences
- Reference: `accounts_settings.png`

**Privacy Page** (`/account/privacy`):
- Data privacy controls
- Reference: `accounts_privacy.png`

**Organization Page** (`/account/organization`):
- Org details (read-only for non-admins), subscription info
- Reference: `accounts_organizatipn.png`

### 7.4 Tenant Auth & Account APIs

| Method | Endpoint | Body / Query | Description |
|--------|----------|--------------|-------------|
| POST | `/api/auth/login` | `{ email, password }` | Tenant login → `{ accessToken, refreshToken, user }` |
| POST | `/api/auth/refresh` | `{ refreshToken }` | Refresh tokens |
| POST | `/api/auth/logout` | — | Invalidate session |
| POST | `/api/auth/forgot-password` | `{ email }` | Send OTP |
| POST | `/api/auth/verify-otp` | `{ email, otp }` | Verify OTP → `{ resetToken }` |
| POST | `/api/auth/reset-password` | `{ resetToken, newPassword }` | Reset password |
| POST | `/api/auth/re-authenticate` | `{ password }` | Compensation re-auth → `{ compensationAccessToken }` |
| GET | `/api/account/profile` | — | Get own profile |
| PUT | `/api/account/profile` | `{ firstName, lastName, ... }` | Update profile |
| PUT | `/api/account/profile/photo` | multipart `{ photo }` | Upload profile photo |
| PUT | `/api/account/change-password` | `{ currentPassword, newPassword }` | Change password |
| GET | `/api/account/sessions` | — | List active sessions |
| DELETE | `/api/account/sessions/:id` | — | Revoke a session |

### 7.5 Acceptance Criteria

- [ ] Tenant login validates against tenant schema — never against platform schema.
- [ ] Login is blocked if tenant status is 'suspended' or 'cancelled' (show: "Your organization's account has been suspended. Please contact your administrator.").
- [ ] Login is blocked if user status is not 'active'.
- [ ] Platform JWT and tenant JWT are not interchangeable — each is rejected by the other's guard.
- [ ] After 5 failed login attempts from same IP in 5 minutes, rate-limit (429) kicks in.
- [ ] Refresh token rotation works — old refresh token becomes invalid after use.
- [ ] Password reset OTP expires after 10 minutes and can only be used once.
- [ ] Password reset invalidates all existing sessions.
- [ ] First login with `must_reset_password=true` forces password change before proceeding.
- [ ] Compensation re-auth token expires after 5 minutes.
- [ ] Users with `email_domain_type='external'` show an "External" badge throughout the UI.

---

## 8. RBAC — Roles, Permissions & Access Control

### 8.1 Database Schema

**Table: `permissions`**
- `id` (UUID, PK)
- `module` (VARCHAR 100) — e.g., `'employee_management'`, `'leave'`, `'recruitment'`, `'compensation'`
- `action` (VARCHAR 100) — e.g., `'view'`, `'create'`, `'edit'`, `'delete'`, `'approve'`, `'export'`
- `resource` (VARCHAR 100) — e.g., `'employees'`, `'leave_requests'`, `'goals'`, `'salary'`
- `description` (TEXT)
- `created_at` (TIMESTAMP)

**Table: `roles`**
- `id` (UUID, PK)
- `name` (VARCHAR 100)
- `description` (TEXT)
- `is_system_role` (BOOLEAN) — TRUE for built-in roles (cannot be deleted)
- `is_custom` (BOOLEAN) — TRUE for admin-created custom roles
- `created_at`, `updated_at` (TIMESTAMP)

**Table: `role_permissions`** (many-to-many)
- `id` (UUID, PK), `role_id` (FK), `permission_id` (FK), UNIQUE(`role_id`, `permission_id`)

**Table: `user_roles`** (many-to-many — users can have multiple roles)
- `id` (UUID, PK), `user_id` (FK), `role_id` (FK), `assigned_by` (FK), `assigned_at` (TIMESTAMP), UNIQUE(`user_id`, `role_id`)

### 8.2 Default System Roles & Their Permissions

**Admin:** Full access to every module, every action, every resource. Can configure settings, manage RBAC, create custom roles, create/delete users.

**HR Admin:** Employee CRUD, leave approval, attendance (all), performance (all), compensation (all, with re-auth), recruitment (full, if tier), onboarding (full), offboarding (full), reports (all). Cannot modify RBAC or org settings.

**HR Manager:** Same as HR Admin minus: create salary components, delete employees, manage templates.

**Manager / Team Lead:** View own + reportees (employees, attendance, leave, goals), assign goals/tasks, manage delegations, view project budgets for own projects. Cannot access recruitment, compensation (except own), settings.

**Employee (Basic):** View own profile, leave, attendance, goals, files, compensation. Apply for leave, update goal progress, upload files, submit resignation.

### 8.3 Permission Enforcement

**Backend:** `@RequirePermission('leave', 'approve', 'leave_requests')` decorator + `PermissionGuard`.

**Frontend:** `usePermission(module, action, resource)` hook → conditionally render UI. Sidebar, buttons, entire pages wrapped with permission checks. Unauthorized URL navigation shows "You don't have permission to access this page."

### 8.4 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/roles` | Any authenticated | List all roles |
| POST | `/api/roles` | Admin | Create custom role with permissions |
| PUT | `/api/roles/:id` | Admin | Update role |
| DELETE | `/api/roles/:id` | Admin | Delete custom role (system roles protected) |
| GET | `/api/roles/:id/permissions` | Admin | Get permissions for a role |
| GET | `/api/permissions` | Admin | List all permissions grouped by module |
| GET | `/api/users/:id/roles` | Admin, self | Get user's roles |
| POST | `/api/users/:id/roles` | Admin | Assign roles to user |
| DELETE | `/api/users/:userId/roles/:roleId` | Admin | Remove role from user |

### 8.5 Acceptance Criteria

- [ ] Users can hold multiple roles; effective permissions = union of all role permissions.
- [ ] Admin can create custom roles (e.g., "CEO") with specific permissions.
- [ ] System roles cannot be deleted.
- [ ] Removing a permission from a role takes effect immediately for all users with that role.
- [ ] Frontend hides UI elements the user lacks permission for.
- [ ] API returns 403 with a clear message when permission is denied.
- [ ] Permissions are stored as data in the database, not hardcoded.

---

## 9. Core Shared Services

### 9.1 File Storage Service

**Purpose:** Abstracts file storage — swappable from PostgreSQL to S3/GCS later.

**Interface:** `upload`, `download`, `delete`, `getUrl`

**Table: `file_storage`**
- `id` (UUID, PK), `file_name`, `original_name`, `mime_type`, `file_size` (BIGINT), `data` (BYTEA), `uploaded_by` (FK), `context` (VARCHAR), `context_id` (UUID), `created_at`

Active implementation selected via `FILE_STORAGE_PROVIDER=postgres|s3` env variable.

### 9.2 Email Service

**Interface:** `send(to, subject, htmlBody, options?)`, `sendBulk(recipients, subject, htmlBody)`

**Table: `email_config`** (per-tenant)
- `id`, `provider` ('sendgrid'|'aws_ses'|'smtp'), `config` (JSONB, encrypted), `from_email`, `from_name`, `is_active`

Admin can test via `POST /api/settings/email/test`.

**Platform-level email:** For registration verification emails, OTPs for super admin password reset, and welcome emails — a platform-level email config is stored in environment variables (not per-tenant). This is used before a tenant exists.

### 9.3 Notification Service

**Table: `notifications`**
- `id`, `user_id` (FK), `type`, `title`, `message`, `data` (JSONB), `is_read` (BOOLEAN), `created_at`

**Table: `notification_settings`** (admin-controlled global toggles)
- `id`, `notification_type` (UNIQUE), `email_enabled`, `in_app_enabled`

**Real-time:** NestJS WebSocket gateway. On notification creation → emit to user's socket room → frontend shows red dot + toast.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications?page=&limit=&unreadOnly=` | List notifications |
| PUT | `/api/notifications/:id/read` | Mark as read |
| PUT | `/api/notifications/read-all` | Mark all as read |
| GET | `/api/notifications/unread-count` | Unread count |
| GET | `/api/settings/notifications` | Admin: get settings |
| PUT | `/api/settings/notifications` | Admin: update settings |

### 9.4 Export Service

Reusable across all modules. Formats: CSV (UTF-8 BOM), Excel (.xlsx), PDF (landscape, tabular).

Pattern: Each module has `/export?format=csv|xlsx|pdf` → calls export service → returns `StreamableFile`.

### 9.5 Audit Log Service

**Table: `audit_logs`**
- `id`, `user_id` (FK), `action`, `module`, `entity_type`, `entity_id`, `old_value` (JSONB), `new_value` (JSONB), `ip_address`, `user_agent`, `created_at`

NestJS `AuditInterceptor` auto-captures before/after states.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit-logs?module=&userId=&action=&entityType=&from=&to=&page=&limit=` | Admin: search logs |
| GET | `/api/audit-logs/:entityType/:entityId` | Admin: entity history |

---

## 10. Module: Employee Management

### 10.1 Overview

Central module — almost every other module depends on it.

### 10.2 Pages & UI

**10.2.1 Employee List Page** (`/employees`)
- **Reference:** `EmployeeManagement.png`
- **Top tabs:** Employees | Departments | Designations | Groups | Delegation
- **Toolbar:** View dropdown, "Add Employee(s)" button, filter, search, three-dots export
- **Table columns:** Checkbox, Employee ID, First Name, Last Name, Email, Photo, Department, Designation, Employment Type, Status
- **Pagination:** Records-per-page, page nav, total count

**10.2.2 Add Employee Form** (drawer/full page)

Sections:
- *Basic Info:* Employee ID (auto-gen or manual), First Name\*, Last Name\*, Display Name, Email\* (domain type detection → 'company' or 'external'), Phone, Photo, Department\*, Designation\*, Reports To (searchable), Employment Type\* (Permanent/Contract/Intern/Freelance), Date of Joining\*
- *Personal:* Date of Birth, Gender, Marital Status, Blood Group
- *Emergency Contact:* Name, Phone, Relationship
- *Address:* Present Address (JSONB), Permanent Address (with "Same as Present" checkbox)
- *Roles:* Multi-select from available roles

On submit: Creates user account + employee profile, sends welcome email with temp password, audit log.

**10.2.3 Employee Detail** (`/employees/:id`) — Tabs: Overview | Timeline

**10.2.4 Departments** (`/employees/departments`) — Reference: `EmployeeManagement_departments.png`
Table with CRUD. Form: Name, Code, Mail Alias, Head (dropdown), Parent Department.

**10.2.5 Designations** (`/employees/designations`) — Reference: `EmployeeManagement_designations.png`
Table with CRUD. Form: Name, Code, Hierarchy Level.

**10.2.6 Reporting Hierarchy** (`/employees/reporting-hierarchy`)
Admin configures multi-level chain visually: CEO → VP → Director → Manager → Team Lead → Employee.

**10.2.7 Groups** (`/employees/groups`)
Informal cross-department collections. CRUD + member management.

**10.2.8 Projects** (`/employees/projects`)
List with CRUD. Fields: Name, Description, Manager, Budget (visible only to manager + admin), Start/End Date, Members. Sub-page: Tasks (title, assignee, status, priority, due date).

**10.2.9 Delegations** (`/employees/delegations`) — Reference: `EmployeeManagement_delegations.png`
Manager/team lead assigns work to reportees. Table: Delegator, Delegatee, Type, Date Range, Status.

### 10.3 Database Schema

**Tables:** `departments`, `designations`, `employee_profiles`, `reporting_hierarchy`, `groups`, `group_members`, `projects`, `project_members`, `project_tasks`, `delegations`

Key: `employee_profiles` extends `users` with department_id, designation_id, reports_to, employment_type, date_of_joining, date_of_birth, gender, marital_status, blood_group, emergency contacts, addresses.

### 10.4 APIs

| Category | Key Endpoints |
|----------|---------------|
| Employees | GET (list, detail, reportees, org-chart), POST (create), PUT (update), DELETE (soft), POST (import), GET (import template), GET (export) |
| Departments | Full CRUD + `/departments/:id/members` |
| Designations | Full CRUD |
| Reporting Hierarchy | GET + PUT (admin configures) |
| Groups | CRUD + member management |
| Projects | CRUD + members + tasks |
| Delegations | CRUD (manager → reportees only) |

### 10.5 Acceptance Criteria

- [ ] Employee ID auto-generates if blank; unique within tenant.
- [ ] Creating employee creates user account + sends welcome email.
- [ ] External user badge shows when email domain ≠ org domain.
- [ ] Delete is soft (status → 'archived').
- [ ] Manager sees only reportees; cannot view other employees.
- [ ] Org chart renders full hierarchy.
- [ ] Project budget hidden from API unless requester is project manager or admin.
- [ ] Task assignment triggers notification to assignee.
- [ ] CSV import validates and returns detailed per-row error report.

---

## 11. Module: Leave Management

### 11.1 Overview

Employees apply; HR approves/rejects. Managers see reportees on leave but have NO approval power.

### 11.2 Pages & UI

**Leave Summary** (`/leave`) — Reference: `Leave_summary.png`
Top tabs: My Data | Team | Holidays. Sub-tabs: Leave Summary | Leave Balance | Leave Requests. Year selector. Leave type cards (icon, color, available, booked). Upcoming/past leaves sections. "Apply Leave" button.

**Apply Leave Modal** — Reference: `Leave_summary_apply.png`
Fields: Leave Type\*, Start/End Date\*, Duration Type (Full Day | First Half | Second Half), Team Email (optional), Reason.

**Leave Balance** — Reference: `Leave_balance.png`
Card-style per type: Available, Booked.

**Leave Requests** — Reference: `Leave_requests.png`
Detail view: employee info, dates, balance impact. HR: Approve/Reject + comment. Employee: Cancel (pending only).

**Team View:** Who's on leave today in department/reportees.

**Holidays:** List of public holidays. Admin: Add Holiday.

### 11.3 Database Schema

**Tables:** `leave_types`, `leave_policies`, `leave_balances`, `leave_requests`, `holidays`

- `leave_types`: Configurable (name, code, color, icon, is_paid, max_consecutive_days)
- `leave_policies`: Per designation/department/employment_type rules (annual_allocation, carry_forward, accrual_type)
- `leave_balances`: Per user per type per year. `available` = generated column: `total_allocated + carried_forward - used`
- `leave_requests`: start/end, duration_type, total_days (supports 0.5), status, reviewed_by
- `holidays`: Declared by org admin

### 11.4 Business Rules

1. Employee → HR only (no manager approval).
2. Managers see reportees' leave status but cannot approve/reject.
3. Half-day = 0.5 days deducted.
4. Overlapping approved leaves rejected.
5. Warning (not block) if leave request includes a holiday.
6. Balance validation (except Leave Without Pay which has no cap).

### 11.5 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/leave/summary?year=` | All (own) | Leave summary |
| GET | `/api/leave/balance?year=` | All (own) | Balances by type |
| POST | `/api/leave/requests` | All | Apply leave |
| GET | `/api/leave/requests?status=&year=&page=&limit=` | Self, HR (all), Manager (reportees) | List requests |
| GET | `/api/leave/requests/:id` | Self, HR, Admin | Request detail |
| PUT | `/api/leave/requests/:id/cancel` | Owner (pending only) | Cancel |
| PUT | `/api/leave/requests/:id/review` | HR, Admin | Approve/reject |
| GET | `/api/leave/team?date=&departmentId=` | All | Department leave today |
| GET | `/api/leave/reportees?date=` | Manager | Reportees on leave |
| CRUD | `/api/leave/types` | Admin | Leave types |
| CRUD | `/api/leave/policies` | Admin | Policies |
| CRUD | `/api/holidays?year=` | Admin | Holidays |
| GET | `/api/leave/export?format=` | Admin, HR | Export |

---

## 12. Module: Time Tracker

### 12.1 Overview

No built-in tracking. Integrates with external tools (eSSL biometric, Hubstaff, etc.) via API adapters. Mock adapter for development.

### 12.2 Pages & UI

**Config Page** (`/time-tracker` — Admin): List integrations, add/edit/delete, test connection, sync now.
**Time Log View** (all users): Date-filtered punch events + daily summary.

### 12.3 Database Schema

**Tables:** `time_tracker_config`, `time_logs`, `daily_time_summary`

### 12.4 Adapter Architecture

Interface: `fetchLogs(since)`, `mapToStandardFormat(raw)`, `testConnection()`.
Adapters: EsslAdapter, HubstaffAdapter, CustomApiAdapter, **MockAdapter** (generates realistic dummy data).
Cron job syncs at configured frequency.

### 12.5 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| CRUD | `/api/time-tracker/config` | Admin | Manage integrations |
| POST | `/api/time-tracker/config/:id/test` | Admin | Test connection |
| POST | `/api/time-tracker/sync` | Admin | Manual sync |
| GET | `/api/time-tracker/logs?userId=&from=&to=` | Self, Manager, HR, Admin | View logs |
| GET | `/api/time-tracker/daily-summary?userId=&from=&to=` | Self, Manager, HR, Admin | Daily summaries |

---

## 13. Module: Attendance

### 13.1 Overview

**Entirely derived from Time Tracker.** No manual check-in/check-out button.

### 13.2 Pages & UI

**My Attendance** (`/attendance`) — Reference: `attendance.png`
Top tabs: My Data | Team. Week navigator, timeline/list/calendar views. Shows per day: punch-in, punch-out, hours, late/early badges. Weekends labeled.

**Team Attendance** — HR: all employees with department filter. Manager: reportees only.

### 13.3 Database Schema

Uses `daily_time_summary` + adds:
- **`work_schedule`**: start_time, end_time, working_days[], grace_period_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_hours
- **`attendance_regularizations`**: For correcting missing punches.

### 13.4 Calculations

- **Late:** `first_punch_in > start_time + grace`
- **Early departure:** `last_punch_out < end_time`
- **Overtime:** `max(0, total_hours - threshold)`
- **Status:** Cross-reference with approved leaves + holidays → present/absent/half_day/on_leave/holiday/weekend

### 13.5 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/attendance/my-summary?from=&to=&view=` | All (own) | Own attendance |
| GET | `/api/attendance/team?from=&to=&departmentId=` | HR, Admin | All employees |
| GET | `/api/attendance/reportees?from=&to=` | Manager | Reportees |
| POST | `/api/attendance/regularize` | All | Request regularization |
| GET/PUT | `/api/attendance/regularizations` | Self (own), HR (all, review) | Regularizations |
| CRUD | `/api/attendance/work-schedule` | Admin | Work schedules |
| GET | `/api/attendance/export?format=` | HR, Admin | Export |

---

## 14. Module: Performance & Goals

### 14.1 Overview

Flat-structure goal tracking. Goals assignable to individuals, groups, or projects. Formal review cycles (quarterly/annual) managed separately.

### 14.2 Pages & UI

**Goals Page** (`/performance`) — Reference: `goals.png`
Tabs: My Data | Team. Filter tabs: All/This Week/Last Week/This Month/Last Month.
Goal cards: Title, Priority badge, Description, Progress bar + %, Status.
"Add Goals" button.

**Performance Reviews** — Under Reports module (Section 20).

### 14.3 Database Schema

**Tables:** `goals`, `goal_progress_history`, `performance_review_cycles`, `performance_reviews`

### 14.4 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/goals?assignedToType=&status=&priority=&filter=&page=&limit=` | Self (own), Manager/Admin (all) | List goals |
| GET | `/api/goals/:id` | Assignee, Admin, Manager | Detail + history |
| POST | `/api/goals` | Admin, Manager | Create (notifies assignee) |
| PUT | `/api/goals/:id` | Admin, Manager (assigner) | Update |
| PUT | `/api/goals/:id/progress` | Assignee, Admin, Manager | Update progress (notifies assigner) |
| DELETE | `/api/goals/:id` | Admin, Manager (assigner) | Delete |
| CRUD | `/api/performance/review-cycles` | Admin | Review cycles |
| GET/POST/PUT | `/api/performance/reviews` | Manager, Employee (acknowledge) | Reviews |
| GET | `/api/goals/export?format=` | Admin, HR | Export |

---

## 15. Module: Files

### 15.1 Overview

Three scopes: personal, team (department), organization. Fine-grained sharing.

### 15.2 Pages & UI — Reference: `files.png`

Tabs: My Files | Team | Organization. Upload, folder navigation, sharing.

### 15.3 Database Schema

**Tables:** `file_records`, `file_folders`, `file_shares`

### 15.4 APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/files?scope=&folderId=&search=` | List files/folders |
| GET | `/api/files/:id/download` | Download |
| POST | `/api/files/upload` | Upload (multipart) |
| DELETE | `/api/files/:id` | Delete (owner/admin) |
| CRUD | `/api/files/folders` | Folder management |
| POST/DELETE | `/api/files/:id/share` | Share/unshare with user + permission level |
| GET | `/api/files/shared-with-me` | Files shared with me |

---

## 16. Module: Compensation

### 16.1 Overview

**Password re-authentication gate** required. All monetary values **blurred** in UI until eye icon clicked. Employee sees own only; HR/Admin see all.

### 16.2 Pages & UI

**Re-auth gate modal** → My Compensation (salary card, breakdown, payslips, appraisals) → HR/Admin: all employees view.

### 16.3 Database Schema

**Tables:** `salary_components`, `employee_salaries`, `salary_breakdowns`, `payslips`, `appraisal_records`

### 16.4 Key UI Behavior

All monetary values rendered with CSS blur. Eye icon toggle reveals. Re-auth modal reappears on token expiry (5 min).

### 16.5 APIs

All require `X-Compensation-Token` header.

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/compensation/my-salary` | All (own) | Own salary + breakdown |
| GET | `/api/compensation/my-payslips?year=` | All (own) | Payslip list |
| GET | `/api/compensation/my-payslips/:id/download` | All (own) | Download PDF |
| GET | `/api/compensation/my-appraisals` | All (own) | Appraisal history |
| GET | `/api/compensation/employees?departmentId=&search=` | HR, Admin | All employees |
| GET/POST | `/api/compensation/employees/:userId/salary` | HR, Admin | View/create salary |
| POST | `/api/compensation/payslips/generate` | Admin, HR Admin | Generate payslips |
| CRUD | `/api/compensation/components` | Admin | Salary components |
| GET/POST | `/api/compensation/employees/:userId/appraisals` | HR Admin, Admin | Appraisals |
| GET | `/api/compensation/export?format=` | Admin, HR Admin | Export |

---

## 17. Module: Recruitment

**Availability:** Only when `subscription_tier === 'with_recruitment'`. API returns 403 otherwise. Only HR and Admin roles can access.

### 17.1 Overview

Full pipeline: Job Openings → Candidates → Interviews → Assessments → Offer → Hire.

### 17.2 Pages & UI

**Dashboard** (`/recruitment`) — Reference: `recruit_home.png`
Widgets: Hiring Pipeline, Time-to-fill, Time-to-hire, Upcoming Interviews, Source Analytics.

**Job Openings** — Reference: `recruit_job_openings.png`, `recruit_job_openings_details.png`, `recruit_job_openings_details_timeline.png`
List + detail with pipeline, timeline. "Publish" generates shareable link.

**Candidates** — Reference: `recruit_candidates.png`, `recruit_candidates_details.png`, `recruit_candidates_moreOptions.png`
Stage summary bar, filterable table, detail with full profile + timeline. Three-dots: Mass Email, Mass Delete, etc.

**Interviews** — Reference: `recruit_interviews.png`, `recruit_interviews_details.png`
List + detail with participants, evaluation info, notes, attachments. "Submit Evaluation" action.

**Referrals** — Reference: `recruit_referal.png`, `recruit_referal_add.png`
"Refer a Candidate" button. Table: candidate, job, referred by, date.

**Departments** — Reference: `recruit_departments.png`, `recruit_departments_details.png`
Departments with job openings and candidate counts.

**Assessments** — MCQ + subjective question builder. Send to candidates, evaluate submissions.

**Email Campaigns** — Compose body, select candidates, bulk send.

**Public Job Page** (`/careers/{slug}/jobs/{token}`) — No auth. Displays job details. "Apply" form: name, email, phone, resume, cover letter.

### 17.3 Database Schema

**Tables:** `job_openings`, `candidate_stages`, `candidates`, `candidate_stage_history`, `candidate_notes`, `interviews`, `interview_feedback`, `assessments`, `assessment_questions`, `assessment_submissions`, `referrals`, `offer_letters`, `recruitment_email_campaigns`

Default pipeline stages (admin-customizable): New → In Review → Available → Engaged → Offered → Hired → Rejected.

### 17.4 APIs

| Category | Key Endpoints |
|----------|---------------|
| Job Openings | CRUD + publish (generates link) |
| Public Job Page | `GET /api/public/jobs/:slug/:token` (no auth), `POST /api/public/jobs/:slug/:token/apply` (no auth) |
| Candidates | CRUD + stage change + notes + timeline |
| Interviews | CRUD + per-interviewer feedback |
| Assessments | CRUD questions + send + evaluate |
| Referrals | Create + list |
| Offer Letters | Create + send |
| Campaigns | Create + send bulk email |
| Analytics | Dashboard + reports |

---

## 18. Module: Onboarding

### 18.1 Overview

Manages hired candidates' onboarding. Configurable checklists. Completes with auto-conversion to employee.

### 18.2 Pages & UI

**Onboarding List** — Reference: `onboarding.png`
Table: Name, Email, Status, Department, Source. Sensitive fields (PAN, Aadhaar, UAN) masked with eye icon.

**Add Candidate** — Reference: `onboarding_add.png`
Sections: Candidate Details, Address, Professional Details, Education (repeatable), Experience (repeatable).

**Detail:** Assigned checklist with per-step progress. "Convert to Employee" (enabled when all required items complete).

### 18.3 Database Schema

**Tables:** `onboarding_templates`, `onboarding_checklist_items`, `onboarding_records`, `onboarding_checklist_progress`

### 18.4 Conversion Flow

All required checklist items completed → HR clicks "Convert to Employee" → Creates `users` + `employee_profiles` from onboarding + candidate data → Sends welcome email.

### 18.5 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/onboarding?status=&page=&limit=` | HR, Admin | List |
| GET | `/api/onboarding/:id` | HR, Admin | Detail + checklist |
| POST | `/api/onboarding` | HR, Admin | Create |
| POST | `/api/onboarding/:id/trigger` | HR, Admin | Start checklist |
| PUT | `/api/onboarding/:id/checklist/:itemId` | HR, Admin | Update step |
| POST | `/api/onboarding/:id/convert-to-employee` | Admin, HR Admin | Convert |
| CRUD | `/api/onboarding/templates` | Admin | Templates |

---

## 19. Module: Offboarding

### 19.1 Overview

Handles resignations and terminations. Customizable 5-step workflow: Preferences → Clearances → Exit Interview → Documents → Workflows.

### 19.2 Pages & UI

**Template Config (Settings)** — References: `offboarding_Preferences.png`, `offboarding_clearances.png`, `offboarding_exitInterview.png`, `offboarding_documents.png`, `offboarding_workflows.png`

5-step wizard: Preferences (notice period, approval chain) → Clearances (IT/HR/Admin clearance forms) → Exit Interview (customizable questionnaire) → Documents (required doc list) → Workflows (email alerts, custom triggers).

**Offboarding List** — Table: Employee, Type, Dates, Status, Current Step.
**Detail** — Progress tracker, clearance status, exit interview responses, documents.

### 19.3 Database Schema

**Tables:** `offboarding_templates`, `offboarding_template_preferences`, `offboarding_clearances`, `offboarding_exit_interview_templates`, `exit_interview_questions`, `offboarding_required_documents`, `offboarding_workflow_triggers`, `offboarding_records`, `offboarding_clearance_progress`, `exit_interview_responses`, `offboarding_documents`, `data_retention_config`

### 19.4 Post-Offboarding

User status → 'archived'. Data retained for configurable period (default: 365 days).

### 19.5 APIs

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| GET | `/api/offboarding?status=&type=&page=&limit=` | HR, Admin | List |
| GET | `/api/offboarding/:id` | HR, Admin, self | Detail |
| POST | `/api/offboarding/resign` | Any (self) | Submit resignation |
| POST | `/api/offboarding/terminate` | HR, Admin | Initiate termination |
| PUT | `/api/offboarding/:id/approve` | Approver | Approve/reject |
| PUT | `/api/offboarding/:id/clearances/:id` | Owner | Mark cleared |
| GET/POST | `/api/offboarding/:id/exit-interview` | Employee | View/submit |
| POST | `/api/offboarding/:id/documents` | Employee, HR | Upload doc |
| POST | `/api/offboarding/:id/complete` | HR, Admin | Complete |
| CRUD | `/api/offboarding/templates` | Admin | Templates |
| GET/PUT | `/api/offboarding/data-retention` | Admin | Retention config |

---

## 20. Module: Reports

### 20.1 Overview

Dedicated sidebar module aggregating reports from all modules. All exportable.

### 20.2 Report Types

| Report | Source | Filters |
|--------|--------|---------|
| Attendance | `daily_time_summary`, leaves, holidays | Date range, department, groupBy |
| Leave | `leave_requests`, `leave_balances` | Year, department, type |
| Headcount | `users`, `employee_profiles` | As-of date, groupBy |
| Recruitment | `job_openings`, `candidates`, `interviews` | Date range, department |
| Performance Reviews | `performance_reviews`, cycles | Cycle, department |
| Compensation Summary | `employee_salaries`, `appraisals` | Department. **Requires re-auth.** |
| Turnover | `offboarding_records` | Date range, groupBy |
| Overtime | `daily_time_summary` | Date range, department |

### 20.3 APIs

`GET /api/reports/{reportType}` per report + `GET /api/reports/{reportType}/export?format=`

---

## 21. Module: Dashboard (Home)

### 21.1 Overview

Landing page after tenant login. Same layout, role-specific content.

### 21.2 Widget Matrix

| Widget | Employee | Manager | HR | Admin |
|--------|----------|---------|-----|-------|
| My Leave Balance | ✓ | ✓ | ✓ | ✓ |
| Upcoming Holidays | ✓ | ✓ | ✓ | ✓ |
| My Goals Summary | ✓ | ✓ | ✓ | ✓ |
| My Attendance (this week) | ✓ | ✓ | ✓ | ✓ |
| Recent Notifications | ✓ | ✓ | ✓ | ✓ |
| Reportees on Leave Today | – | ✓ | – | – |
| Team Attendance Summary | – | ✓ | – | – |
| Pending Leave Approvals | – | – | ✓ | ✓ |
| New Candidates (if tier) | – | – | ✓ | ✓ |
| Onboarding Progress | – | – | ✓ | ✓ |
| Offboarding in Progress | – | – | ✓ | ✓ |
| Org Headcount | – | – | – | ✓ |
| Subscription Usage | – | – | – | ✓ |
| Recent Audit Log | – | – | – | ✓ |
| Hiring Pipeline (if tier) | – | – | ✓ | ✓ |

### 21.3 API

`GET /api/dashboard` — Returns role-based widgets.

---

## 22. Module: Settings

### 22.1 Overview

Tile-based settings page. Admin only. Reference: `settings.png`

### 22.2 Layout

Top banner: Organization name, User License count (used/max), current user info.

Tiles:

| Tile | Links To |
|------|----------|
| Manage Accounts | User CRUD, role assignment, bulk import |
| Onboarding | Templates, checklist items |
| Employee Information | Custom fields, reporting hierarchy |
| Leave Tracker | Leave types, policies, accrual rules |
| Attendance | Work schedules, grace periods, overtime rules |
| Time Tracker | Integration configs |
| Performance | Review cycle settings |
| Files | Storage settings |
| Compensation | Salary components, payslip config |
| Offboarding | Templates, workflows, data retention |
| Recruitment | Pipeline stages, assessment settings (if tier) |
| General | Org name, domain, timezone, date format, email config |
| Notifications | Enable/disable per type |
| Audit Logs | Searchable log viewer |

### 22.3 Organization Settings Schema

**Table: `organization_settings`**
- `id`, `org_name`, `custom_domain`, `default_timezone` (DEFAULT 'UTC'), `date_format` (DEFAULT 'DD-MMM-YYYY'), `financial_year_start_month` (DEFAULT 4), `default_currency` (DEFAULT 'INR')

---

## 23. Notification & Email System

### 23.1 Complete Event Matrix

| Event | In-App | Email | Recipients |
|-------|--------|-------|------------|
| New employee account created | ✓ | ✓ | The employee |
| Leave request submitted | ✓ | ✓ | HR Admin(s) |
| Leave request approved | ✓ | ✓ | The employee |
| Leave request rejected | ✓ | ✓ | The employee |
| Leave request cancelled | ✓ | ✓ | HR Admin(s) |
| Goal assigned | ✓ | ✓ | Assignee(s) |
| Goal progress updated | ✓ | ✓ | Assigner |
| Goal completed | ✓ | ✓ | Assigner |
| Task assigned (project) | ✓ | ✓ | Assignee |
| Task status updated | ✓ | – | Project manager |
| Delegation created | ✓ | ✓ | Delegatee |
| Review cycle started | ✓ | ✓ | All managers |
| Review submitted | ✓ | ✓ | Reviewed employee |
| Interview scheduled | ✓ | ✓ | Interviewers + candidate (email) |
| Interview cancelled | ✓ | ✓ | Interviewers + candidate (email) |
| Candidate stage changed | ✓ | – | Candidate owner |
| Assessment sent | – | ✓ | Candidate |
| Offer letter sent | – | ✓ | Candidate |
| Resignation submitted | ✓ | ✓ | Approval chain |
| Resignation approved/rejected | ✓ | ✓ | The employee |
| Clearance completed | ✓ | ✓ | HR partner |
| Onboarding triggered | ✓ | ✓ | HR + candidate |
| Onboarding completed | ✓ | ✓ | Admin + HR |
| File shared | ✓ | – | Recipient user |
| Payslip generated | ✓ | ✓ | The employee |
| Appraisal recorded | ✓ | ✓ | The employee |
| Attendance anomaly | ✓ | – | The employee |
| Overtime logged | ✓ | – | Employee + HR |
| Regularization requested | ✓ | ✓ | HR |
| Regularization approved/rejected | ✓ | ✓ | The employee |

### 23.2 Admin Control

Admin globally enables/disables each notification type for email and/or in-app via Settings → Notifications.

---

## 24. Data Import & Export

### 24.1 Import

**Supported:** Employees, Departments, Designations, Holidays, Leave Balances (initial setup)

**CSV format:** UTF-8, headers row, dates as `YYYY-MM-DD`, empty optionals left blank.

**Employee template columns:** employee_id, first_name\*, last_name\*, email\*, phone, department_code\*, designation_code\*, employment_type\*, date_of_joining\*, date_of_birth, reports_to_email, emergency_contact_name, emergency_contact_phone, role

`GET /api/employees/import/template` → CSV with headers + sample + format notes.
Import response: `{ imported, errors: [{ row, field, message }] }`

### 24.2 Export

Every data-table page via ⋮ menu. Formats: CSV (BOM), Excel (.xlsx), PDF (landscape, tabular). Respects current filters.

---

## 25. Subscription & Licensing

### 25.1 Tiers

| Tier | Includes | Price Model |
|------|----------|-------------|
| Standard | All except Recruitment | Per user/month |
| Standard + Recruitment | All modules | Per user/month (higher) |

### 25.2 Enforcement

- Recruitment routes → 403 if `standard` tier.
- Employee creation fails if `current_user_count >= max_users`.
- Dashboard widget shows usage for Admin.
- Self-service registration lets org choose tier during signup.
- Super admin can change tier at any time via tenant management.

---

## 26. API Design Standards

### 26.1 Route Prefixes

| Scope | Prefix | Auth | Tenant Resolution |
|-------|--------|------|-------------------|
| Platform (Super Admin) | `/api/platform/*` | PlatformAuthGuard (platform JWT) | None — operates on `platform` schema |
| Public (no auth) | `/api/public/*` | None | Varies — registration has no tenant, career page resolves tenant from slug param |
| Tenant (all modules) | `/api/*` (all other routes) | TenantAuthGuard (tenant JWT) | Yes — via subdomain/domain/header |

### 26.2 Response Envelopes

**Success:** `{ success: true, data: {...}, meta: { page, limit, total } }`
**Error:** `{ success: false, error: { code, message, details[] } }`

### 26.3 HTTP Status Codes

200 (OK), 201 (Created), 204 (No Content), 400 (Validation), 401 (Unauthenticated), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 429 (Rate Limited), 500 (Server Error)

### 26.4 Pagination

`?page=1&limit=10&sortBy=createdAt&sortOrder=desc` on all list endpoints.

### 26.5 Naming

- URLs: kebab-case (`/job-openings`)
- Request/Response: camelCase (`firstName`)
- DB columns: snake_case (`first_name`)
- TypeScript: PascalCase interfaces (`LeaveRequest`)

### 26.6 Rate Limiting

| Context | Limit |
|---------|-------|
| General tenant API | 100 req/min/user |
| Tenant auth endpoints | 10 req/min/IP |
| Platform auth endpoints | 10 req/min/IP |
| Export endpoints | 5 req/min/user |
| Public career page | 30 req/min/IP |
| Self-service registration | 5 req/hour/IP |
| Resend verification | 3 req/hour/registration |

---

## 27. Database Schema Reference

### Platform Schema
`platform.tenants`, `platform.super_admins`, `platform.super_admin_sessions`, `platform.billing_records`, `platform.registration_requests`

### Tenant Schema (per org — ~65 tables)

**Core:** `users`, `password_reset_otps`, `user_sessions`, `permissions`, `roles`, `role_permissions`, `user_roles`

**Shared Services:** `file_storage`, `email_config`, `notifications`, `notification_settings`, `audit_logs`, `organization_settings`

**Employee Management:** `departments`, `designations`, `employee_profiles`, `reporting_hierarchy`, `groups`, `group_members`, `projects`, `project_members`, `project_tasks`, `delegations`

**Leave:** `leave_types`, `leave_policies`, `leave_balances`, `leave_requests`, `holidays`

**Time Tracker:** `time_tracker_config`, `time_logs`, `daily_time_summary`

**Attendance:** `work_schedule`, `attendance_regularizations`

**Performance:** `goals`, `goal_progress_history`, `performance_review_cycles`, `performance_reviews`

**Files:** `file_records`, `file_folders`, `file_shares`

**Compensation:** `salary_components`, `employee_salaries`, `salary_breakdowns`, `payslips`, `appraisal_records`

**Recruitment:** `job_openings`, `candidate_stages`, `candidates`, `candidate_stage_history`, `candidate_notes`, `interviews`, `interview_feedback`, `assessments`, `assessment_questions`, `assessment_submissions`, `referrals`, `offer_letters`, `recruitment_email_campaigns`

**Onboarding:** `onboarding_templates`, `onboarding_checklist_items`, `onboarding_records`, `onboarding_checklist_progress`

**Offboarding:** `offboarding_templates`, `offboarding_template_preferences`, `offboarding_clearances`, `offboarding_exit_interview_templates`, `exit_interview_questions`, `offboarding_required_documents`, `offboarding_workflow_triggers`, `offboarding_records`, `offboarding_clearance_progress`, `exit_interview_responses`, `offboarding_documents`, `data_retention_config`

---

## 28. Development Phases & Dependency Map

### Phase 1 — Core Infrastructure
Multi-tenancy (platform schema, tenant provisioning pipeline), DB setup + migrations, **Platform auth (super admin login/sessions)**, **Self-service registration flow**, Tenant auth (login/OTP/sessions), RBAC engine, File Storage abstraction, Email Service abstraction (platform-level + tenant-level), Notification Service, Export Utility, Audit Logs, Settings skeleton

### Phase 2 — Super Admin Portal & Account Management
**Platform admin panel** (dashboard, tenant management CRUD, billing, super admin management, registration requests viewer), Tenant-level account management (profile, security, sessions pages), Subscription enforcement middleware

### Phase 3 — Employee Management
Employees, Departments, Designations, Reporting Hierarchy, Groups, Projects, Tasks, Delegations, Bulk CSV import

### Phase 4 — Leave Management & Time Tracker
Leave types/policies/requests/approvals/holidays + Time Tracker integrations/adapters/sync/mock

### Phase 5 — Attendance, Performance & Files
Attendance (derived from time tracker) + Goals/Reviews + File management

### Phase 6 — Compensation, Recruitment & Offboarding
Compensation (re-auth gate, salary, payslips, appraisals) + Full Recruitment pipeline + Offboarding workflows

### Phase 7 — Onboarding, Reports & Dashboard
Onboarding (linked to recruitment, auto-conversion) + Aggregated Reports + Role-based Dashboard

**Cross-cutting (built incrementally):** Notifications, Email alerts, Export menus, Audit logging, Settings tiles — added to each module as it's built.

---

*End of Technical PRD v2.0*
