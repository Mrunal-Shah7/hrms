# Post-Sprint 2D — Gap Fixes & Sprint 1E Consolidated Patches

**Date:** February 27, 2026
**Applies to:** Implemented codebase through Sprint 2D
**Priority:** Apply all fixes before beginning Sprint 3A

---

## Overview

A comprehensive audit of Sprints 1A–2D against the full PRD identified 3 implementation gaps and 4 scattered retroactive updates to Sprint 1E that were specified across later sprints but never consolidated. This document provides formal fix specifications for all items. No code is included — only the technical details needed to implement each fix.

---

## Fix 1: File Download Controller Endpoint

**Severity:** High — Blocks Sprint 2C profile photo display
**Affected Sprint:** Sprint 1G (Core Shared Services)
**PRD Reference:** Section 9.1 (File Storage Service)

### Problem

Sprint 1G's `FileStorageService.getUrl()` returns paths in the format `/api/files/download/{id}`. Sprint 2C's profile photo upload stores this URL in `users.photo_url`. However, no controller endpoint exists to serve `GET /api/files/download/:id`. The endpoint was explicitly deferred to "the Files module sprint" (Sprint 5D). This means any uploaded profile photo will produce a 404 when the frontend attempts to display it.

### Required Fix

Add a `FileDownloadController` to the existing `CoreModule` (from Sprint 1G).

**New endpoint:**

`GET /api/files/download/:id`

**Auth:** `TenantAuthGuard` — any authenticated tenant user can request a file by ID. Future sprints may add finer-grained access control (file ownership, sharing permissions) when the Files module is built.

**Path parameter:** `id` (UUID) — the `file_storage` primary key.

**Service logic:**
1. Set `search_path` to the tenant's schema (already handled by `TenantMiddleware`)
2. Call `FileStorageService.download(id)` to retrieve the file buffer and metadata
3. If file not found → `404 "File not found"`
4. Return the file as a NestJS `StreamableFile` with headers:
   - `Content-Type`: from `metadata.mimeType`
   - `Content-Disposition`: `inline; filename="{metadata.originalName}"` — use `inline` for images (so browsers display them), `attachment` for non-image types
   - `Content-Length`: from `metadata.fileSize`
5. The `ResponseInterceptor` (Sprint 1G) already has a pass-through for `StreamableFile` responses — no envelope wrapping occurs

**File location:** `src/core/file-storage/file-download.controller.ts` — placed inside the existing `CoreModule` since this is a shared infrastructure endpoint, not part of the full Files module.

**Module registration:** Add `FileDownloadController` to the `controllers` array of `CoreModule`. Since `CoreModule` is already `@Global()` and imported into `AppModule`, no additional module registration is needed.

**Security consideration:** For v1, any authenticated tenant user can download any file within their tenant schema. This is acceptable because tenant schemas are already isolated, and the Files module (Sprint 5D) will add proper sharing/ownership checks later. Do NOT allow cross-tenant file access — the `search_path` isolation already prevents this.

### Verification

```
# Upload a profile photo (Sprint 2C)
PUT /api/account/profile/photo → returns { photoUrl: "/api/files/download/{id}" }

# Access the photo
GET /api/files/download/{id}
→ 200: Image binary data with correct Content-Type header
→ Browser renders the image inline

# Unauthenticated access
GET /api/files/download/{id} (no Authorization header)
→ 401

# Non-existent file
GET /api/files/download/00000000-0000-0000-0000-000000000000
→ 404: "File not found"
```

---

## Fix 2: Company Email Domain Storage

**Severity:** Medium — Blocks Sprint 3A employee creation domain detection
**Affected Sprint:** Sprint 1A (Schema), Sprint 1B (Provisioning Seed)
**PRD Reference:** Section 7.1 (`email_domain_type` field), Section 10.2.2 (domain type detection on employee creation)

### Problem

The `users` table has an `email_domain_type` field (`'company'` | `'external'`). PRD 10.2.2 specifies that when creating an employee, the system should detect whether their email domain is the company's domain (e.g., `@acme.com`) or external (e.g., `@gmail.com`).

However, nowhere in the schema is the company's email domain stored. The `organization_settings` table has no `company_email_domain` column. Without this, Sprint 3A's employee creation logic has no reference domain to compare against.

### Required Fix

**Step 1 — Schema addition to `organization_settings`:**

Add a new column `company_email_domain VARCHAR(255)` to the `organization_settings` table.

Prisma model update — add to `OrganizationSettings`:
- Field name: `companyEmailDomain`
- Type: `String?` (nullable)
- DB column: `company_email_domain`
- DB type: `VARCHAR(255)`

Raw SQL migration (for already-provisioned tenants):
```
ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS company_email_domain VARCHAR(255);
```

Also update `setup-tenant-schema.sql` so newly provisioned tenants include this column.

**Step 2 — Provisioning seed update (Sprint 1B):**

During the provisioning pipeline's "seed organization_settings" step, extract the admin email's domain and set it as the company domain:

- Input: `adminEmail` from the provisioning parameters (e.g., `jane@acme.com`)
- Extract domain: split on `@`, take the second part → `acme.com`
- Insert into `organization_settings.company_email_domain` alongside the other org defaults

For super-admin-created tenants (Sprint 2A), the `adminEmail` from the create tenant form is used. For self-service registrations (Sprint 1D), the `admin_email` from `registration_requests` is used. Both paths feed into the same provisioning pipeline.

**Step 3 — Backfill for existing tenants:**

Since the user has already implemented through Sprint 2D and likely has test tenants provisioned, run a backfill across all existing tenants:

For each non-cancelled tenant:
1. Query the tenant's schema for the first user with the "Admin" role
2. Extract their email domain
3. Update `organization_settings.company_email_domain` for that tenant

**Step 4 — Sprint 2C Organization page update:**

The Organization page (`/account/organization`) should display `company_email_domain` as a read-only field for all users, and an editable field for Admins (via `PUT /api/account/organization`).

Add `companyEmailDomain` to:
- The `GET /api/account/organization` response (under `organization` object)
- The `PUT /api/account/organization` request DTO (optional, `@IsOptional()`, validated as a domain format — no `@` prefix, e.g., `acme.com`)
- The Organization page UI under Organization Info section

**Step 5 — Sprint 3A usage (future, for reference):**

When Sprint 3A creates an employee, the service will:
1. Read `company_email_domain` from `organization_settings`
2. Extract the new employee's email domain
3. If domains match → set `email_domain_type = 'company'`
4. If no match or `company_email_domain` is null → set `email_domain_type = 'external'`

### Verification

```
# New tenant provisioned with admin email jane@acme.com
SELECT company_email_domain FROM organization_settings;
→ 'acme.com'

# Admin updates company domain
PUT /api/account/organization
Body: { "companyEmailDomain": "acmecorp.com" }
→ 200: Updated

# GET returns the domain
GET /api/account/organization
→ organization.companyEmailDomain: "acmecorp.com"
```

---

## Fix 3: Notification Settings Seed Data

**Severity:** Medium — Admin notification settings page shows empty list
**Affected Sprint:** Sprint 1B (Provisioning Seed)
**PRD Reference:** Section 23.1 (Complete Event Matrix), Section 23.2 (Admin Control)

### Problem

Sprint 1B creates the `notification_settings` table during tenant provisioning but seeds zero rows into it. Sprint 1G defines `GET /api/settings/notifications` and `PUT /api/settings/notifications` endpoints that read from and write to this table. When an admin navigates to Settings → Notifications, the page will be empty — there are no notification type records to display or toggle.

PRD Section 23.1 defines 28 notification event types. These should be pre-populated as default rows during provisioning so the admin has something to configure from day one.

### Required Fix

**Step 1 — Add seed data to provisioning pipeline (Sprint 1B):**

After the existing seed steps (roles, permissions, leave types, work schedule, candidate stages, organization settings), add a new step: seed `notification_settings` with one row per notification type.

The 28 notification types from PRD 23.1, using consistent snake_case type identifiers:

| `notification_type` | `in_app_enabled` | `email_enabled` |
|---|---|---|
| `employee_account_created` | true | true |
| `leave_request_submitted` | true | true |
| `leave_request_approved` | true | true |
| `leave_request_rejected` | true | true |
| `leave_request_cancelled` | true | true |
| `goal_assigned` | true | true |
| `goal_progress_updated` | true | true |
| `goal_completed` | true | true |
| `task_assigned` | true | true |
| `task_status_updated` | true | false |
| `delegation_created` | true | true |
| `review_cycle_started` | true | true |
| `review_submitted` | true | true |
| `interview_scheduled` | true | true |
| `interview_cancelled` | true | true |
| `candidate_stage_changed` | true | false |
| `assessment_sent` | false | true |
| `offer_letter_sent` | false | true |
| `resignation_submitted` | true | true |
| `resignation_approved_rejected` | true | true |
| `clearance_completed` | true | true |
| `onboarding_triggered` | true | true |
| `onboarding_completed` | true | true |
| `file_shared` | true | false |
| `payslip_generated` | true | true |
| `appraisal_recorded` | true | true |
| `attendance_anomaly` | true | false |
| `overtime_logged` | true | false |
| `regularization_requested` | true | true |
| `regularization_approved_rejected` | true | true |

Note: The default `in_app_enabled` and `email_enabled` values match the PRD 23.1 matrix (✓ = true, – = false). All 30 rows (28 from PRD plus `regularization_requested` and `regularization_approved_rejected` which map to 2 separate events) use the exact in-app/email combination specified in the PRD.

**Step 2 — Backfill for existing tenants:**

For each existing non-cancelled tenant:
1. Set `search_path` to the tenant's schema
2. Insert the 30 notification_settings rows with `ON CONFLICT (notification_type) DO NOTHING` — this ensures existing rows (if any) are preserved and only missing types are added

**Step 3 — Provisioning code update:**

Add the notification settings seed to the provisioning service method, after the existing candidate stages seed. Log it as a step: `"Step 4f: Notification settings seeded"` (following the existing step numbering pattern in Sprint 1B).

The insert uses a bulk INSERT with multiple VALUES rows — same pattern as the leave types and candidate stages seeds already in the provisioning pipeline.

### Verification

```
# After provisioning a new tenant
SET search_path TO "tenant_acme_corp";
SELECT COUNT(*) FROM notification_settings;
→ 30

SELECT notification_type, in_app_enabled, email_enabled
FROM notification_settings
WHERE notification_type = 'task_status_updated';
→ in_app_enabled: true, email_enabled: false (matches PRD: ✓ in-app, – email)

# Admin views notification settings
GET /api/settings/notifications
→ 200: Array of 30 notification type settings with toggles

# Admin disables email for leave requests
PUT /api/settings/notifications
Body: [{ "notificationType": "leave_request_submitted", "emailEnabled": false }]
→ 200: Updated
```

---

## Fix 4: Sprint 1E Consolidated Patches

**Severity:** High — Required by Sprints 2C, 2D, and 1H
**Affected Sprint:** Sprint 1E (Tenant Auth & Session Management)

### Problem

Four separate retroactive updates to Sprint 1E have been specified across three later sprint documents. If implemented individually, they're easy to miss or partially apply. This fix consolidates them into a single specification.

### Patch 4A: Login Response Must Include Tenant Context

**Specified in:** Sprint 1H (Section 14)

**Current login response (Sprint 1E Section 4.1):**
```
{
  accessToken, refreshToken,
  user: { id, email, firstName, lastName, displayName, photoUrl, emailDomainType, roles, mustResetPassword }
}
```

**Updated login response:**
```
{
  accessToken, refreshToken,
  user: { id, email, firstName, lastName, displayName, photoUrl, emailDomainType, roles, mustResetPassword },
  tenant: { id, name, slug, schemaName, subscriptionTier }
}
```

**Implementation:** The login service already has `req.tenant` available (set by `TenantMiddleware`). After successful authentication, include `req.tenant` fields in the response. Query `platform.tenants` for the tenant row using the tenant ID from middleware context.

**Consumed by:**
- Sprint 1H: Zustand auth store needs `tenant.subscriptionTier` for sidebar Recruitment visibility
- Sprint 1H: Axios request interceptor needs `tenant.slug` for `X-Tenant-Slug` header
- Sprint 2C: Organization page displays tenant name
- Sprint 2D: Frontend subscription banner reads tier from store

---

### Patch 4B: JWT Access Token Payload Must Include `sessionId`

**Specified in:** Sprint 2C (Section 7.1)

**Current JWT payload (Sprint 1E Section 4.1):**
```
{ userId, tenantId, schemaName, roles, permissions, type: 'tenant' }
```

**Updated JWT payload:**
```
{ userId, tenantId, schemaName, roles, permissions, type: 'tenant', sessionId }
```

**Implementation:** During login (Step 10 in Sprint 1E Section 4.1), after inserting the refresh token hash into `user_sessions`, take the returned session row's `id` and include it in the JWT access token payload as `sessionId`.

During token refresh (Sprint 1E Section 4.2), the new session's `id` must also be included in the newly generated access token.

**Consumed by:**
- Sprint 2C `PUT /api/account/change-password`: identifies which session to preserve when invalidating other sessions
- Sprint 2C `GET /api/account/sessions`: marks the current session with `isCurrent: true`
- Sprint 2C `DELETE /api/account/sessions/:id`: prevents revoking the current session

**`TenantJwtStrategy` update:** The `validate` method (Sprint 1E Section 5.1) must also extract and return `sessionId` so it's available on `req.user.sessionId`.

---

### Patch 4C: JWT Access Token Payload Must Include `subscriptionTier`

**Specified in:** Sprint 2D (Section 2.4)

**Updated JWT payload (combined with Patch 4B):**
```
{ userId, tenantId, schemaName, roles, permissions, type: 'tenant', sessionId, subscriptionTier }
```

**Implementation:** During login, read `subscription_tier` from the tenant record (already available from `req.tenant` or the same query used for Patch 4A). Include it in the JWT payload.

During token refresh, re-read the tenant's `subscription_tier` from `platform.tenants` (it may have changed since last login) and include in the new JWT.

**Consumed by:**
- Sprint 2D `SubscriptionTierGuard`: reads `req.user.subscriptionTier` to determine if the tenant's tier allows access to the requested route. Including it in the JWT avoids a DB query on every guarded request.

**`TenantJwtStrategy` update:** Also extract and return `subscriptionTier` from the payload.

---

### Patch 4D: Rate Limiting on Registration Endpoints

**Specified in:** Sprint_1A_1E_Gap_Fixes.md (Fix 2)

**Current state:** Sprint 1E's rate limiting section covers only auth endpoints. The `ThrottlerModule` is registered globally in `AppModule`, but the registration controller (Sprint 1D) has no `@Throttle()` decorators.

**Required additions to `RegistrationController`:**

| Endpoint | Limit | Window | Rationale |
|---|---|---|---|
| `POST /api/public/register` | 5 requests | 1 hour | Per IP. PRD 5.6 specifies 5 registration attempts per hour per IP. |
| `POST /api/public/register/resend-verification` | 3 requests | 1 hour | Per IP. PRD 5.6 specifies 3 resend attempts per hour. |

**Implementation:** Add `@Throttle({ default: { limit: 5, ttl: 3600000 } })` on the `register()` method and `@Throttle({ default: { limit: 3, ttl: 3600000 } })` on the `resendVerification()` method. The `ThrottlerModule` from Sprint 1E already handles the rest (IP extraction, 429 response via `GlobalExceptionFilter`).

---

### Patch 4E: `/api/auth/me` Response Must Include Tenant Context

**Not explicitly specified as retroactive, but required for consistency.**

**Current `/api/auth/me` response (Sprint 1E Section 4.9):**
```
{
  id, email, firstName, lastName, displayName, phone, photoUrl,
  emailDomainType, status, mustResetPassword, lastLoginAt,
  roles, permissions
}
```

**Updated `/api/auth/me` response:**
```
{
  id, email, firstName, lastName, displayName, phone, photoUrl,
  emailDomainType, status, mustResetPassword, lastLoginAt,
  roles, permissions,
  tenant: { id, name, slug, schemaName, subscriptionTier }
}
```

**Rationale:** The `/me` endpoint is used by the frontend on page refresh to rehydrate the auth store. If the login response includes tenant context (Patch 4A) but `/me` does not, the frontend will lose tenant context on every page refresh until the next full login. Both must return the same shape.

**Implementation:** Same approach as Patch 4A — query `platform.tenants` using `req.user.tenantId` from the JWT and include in the response.

---

### Combined Final JWT Payload

After all patches, the tenant access token payload is:

```
{
  userId: string,
  tenantId: string,
  schemaName: string,
  roles: string[],
  permissions: string[],
  type: 'tenant',
  sessionId: string,
  subscriptionTier: 'standard' | 'with_recruitment'
}
```

And the `TenantJwtStrategy.validate()` method returns all of these fields on `req.user`.

### Combined Final Login Response

```
{
  success: true,
  data: {
    accessToken: "...",
    refreshToken: "...",
    user: {
      id, email, firstName, lastName, displayName, photoUrl,
      emailDomainType, roles, mustResetPassword
    },
    tenant: {
      id, name, slug, schemaName, subscriptionTier
    }
  }
}
```

### Combined Final `/api/auth/me` Response

```
{
  success: true,
  data: {
    id, email, firstName, lastName, displayName, phone, photoUrl,
    emailDomainType, status, mustResetPassword, lastLoginAt,
    roles: ["Admin"],
    permissions: ["leave:approve:leave_requests", ...],
    tenant: {
      id, name, slug, schemaName, subscriptionTier
    }
  }
}
```

---

## Application Order

These fixes should be applied in this order to avoid dependency issues:

1. **Fix 4 (Sprint 1E Patches)** — Apply all five sub-patches (4A–4E) together. This updates the auth foundation that other fixes depend on.
2. **Fix 1 (File Download Controller)** — Standalone, no dependencies beyond Sprint 1G's existing `FileStorageService`.
3. **Fix 2 (Company Email Domain)** — Schema addition + provisioning update + backfill.
4. **Fix 3 (Notification Settings Seed)** — Provisioning update + backfill.

Fixes 2 and 3 both require backfills across existing tenants. These can be combined into a single migration script that iterates all non-cancelled tenants and applies both updates per tenant.

---

## Full Verification Checklist

- [ ] **Fix 1:** `GET /api/files/download/:id` serves files with correct `Content-Type` and `Content-Disposition`
- [ ] **Fix 1:** Profile photo uploaded via Sprint 2C displays correctly in browser
- [ ] **Fix 1:** Unauthenticated requests to file download return 401
- [ ] **Fix 2:** `organization_settings` has `company_email_domain` column
- [ ] **Fix 2:** New tenant provisioned with admin email `jane@acme.com` → `company_email_domain = 'acme.com'`
- [ ] **Fix 2:** Existing tenants backfilled with domain from admin user's email
- [ ] **Fix 2:** Admin can update company domain via `PUT /api/account/organization`
- [ ] **Fix 2:** Organization page displays company email domain
- [ ] **Fix 3:** New tenant provisioned → `notification_settings` has 30 rows
- [ ] **Fix 3:** Existing tenants backfilled with 30 notification type rows
- [ ] **Fix 3:** `GET /api/settings/notifications` returns all 30 types with correct default toggles
- [ ] **Fix 3:** Default in-app/email values match PRD 23.1 matrix
- [ ] **Fix 4A:** Login response includes `tenant: { id, name, slug, schemaName, subscriptionTier }`
- [ ] **Fix 4A:** Zustand auth store hydrates tenant context on login
- [ ] **Fix 4B:** JWT payload includes `sessionId`
- [ ] **Fix 4B:** `req.user.sessionId` available in controllers after `TenantAuthGuard`
- [ ] **Fix 4B:** Change password preserves current session, invalidates others
- [ ] **Fix 4B:** Sessions list marks current session with `isCurrent: true`
- [ ] **Fix 4C:** JWT payload includes `subscriptionTier`
- [ ] **Fix 4C:** `SubscriptionTierGuard` reads `req.user.subscriptionTier` without DB query
- [ ] **Fix 4C:** Token refresh reloads `subscriptionTier` from DB (reflects tier changes)
- [ ] **Fix 4D:** 6th `POST /api/public/register` from same IP within 1 hour → 429
- [ ] **Fix 4D:** 4th `POST /api/public/register/resend-verification` from same IP within 1 hour → 429
- [ ] **Fix 4E:** `GET /api/auth/me` includes `tenant` context matching login response
- [ ] **Fix 4E:** Frontend page refresh rehydrates tenant context from `/me` endpoint

---

*End of Gap Fixes Document. Apply before Sprint 3A.*
