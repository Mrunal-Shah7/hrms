# Sprint 2B — Billing, Admin Management & Registration Requests

## Goal
Build the remaining three platform admin pages: Billing Management (list, detail, generate invoice, mark paid/overdue), Super Admin Management (CRUD with last-active-admin protection), and Registration Requests (list with retry failed provisioning and resend verification). All APIs are platform-scoped under `PlatformAuthGuard`, operating on the `platform` schema.

---

## 1. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/platform/billing/platform-billing.module.ts` | NestJS module |
| `src/platform/billing/platform-billing.controller.ts` | 4 billing API endpoints |
| `src/platform/billing/platform-billing.service.ts` | Billing CRUD + generate logic |
| `src/platform/billing/dto/generate-billing.dto.ts` | DTO for invoice generation |
| `src/platform/billing/dto/update-billing-status.dto.ts` | DTO for status update |
| `src/platform/billing/dto/list-billing-query.dto.ts` | Query params DTO |
| `src/platform/billing/dto/index.ts` | Barrel export |
| `src/platform/super-admins/platform-admins.module.ts` | NestJS module |
| `src/platform/super-admins/platform-admins.controller.ts` | 4 super admin endpoints |
| `src/platform/super-admins/platform-admins.service.ts` | Admin CRUD logic |
| `src/platform/super-admins/dto/create-admin.dto.ts` | DTO for creating admin |
| `src/platform/super-admins/dto/update-admin.dto.ts` | DTO for updating admin |
| `src/platform/super-admins/dto/index.ts` | Barrel export |
| `src/platform/registrations/platform-registrations.module.ts` | NestJS module |
| `src/platform/registrations/platform-registrations.controller.ts` | 3 registration endpoints |
| `src/platform/registrations/platform-registrations.service.ts` | List + retry + resend logic |
| `src/platform/registrations/dto/list-registrations-query.dto.ts` | Query params DTO |
| `src/platform/registrations/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(platform)/platform/billing/page.tsx` | Billing list page (replace placeholder) |
| `src/app/(platform)/platform/billing/[id]/page.tsx` | Billing detail page |
| `src/app/(platform)/platform/billing/generate/page.tsx` | Generate invoice form page |
| `src/app/(platform)/platform/admins/page.tsx` | Super admin list page (replace placeholder) |
| `src/app/(platform)/platform/registrations/page.tsx` | Registration requests list (replace placeholder) |
| `src/services/platform-billing.ts` | Billing API helpers |
| `src/services/platform-admins.ts` | Admin API helpers |
| `src/services/platform-registrations.ts` | Registration API helpers |

### Module Registration
- Import `PlatformBillingModule`, `PlatformAdminsModule`, `PlatformRegistrationsModule` into `AppModule`
- All routes under `/api/platform/*` — protected by `PlatformAuthGuard`, bypass `TenantMiddleware`

---

## 2. Billing Management APIs

Controller prefix: `platform/billing`. All protected by `PlatformAuthGuard`.

### 2.1 `GET /api/platform/billing` — List Billing Records

**Query Parameters (DTO):**

| Param | Type | Default | Description |
|---|---|---|---|
| `tenantId` | string (UUID, optional) | — | Filter by specific tenant |
| `status` | string (optional) | — | Filter: `pending`, `paid`, `overdue` |
| `from` | string (date, optional) | — | Period start >= this date |
| `to` | string (date, optional) | — | Period end <= this date |
| `page` | number | 1 | Pagination page |
| `limit` | number | 20 | Records per page (max 100) |
| `sortBy` | string | `created_at` | Sort column: `created_at`, `period_start`, `total_amount`, `status` |
| `sortOrder` | string | `desc` | `asc` or `desc` |

**Service Logic:**
1. Build dynamic query against `platform.billing_records` with LEFT JOIN to `platform.tenants` (for tenant name/slug)
2. Apply optional WHERE clauses for each filter
3. Date range filters apply to `period_start` and `period_end`: `period_start >= $from AND period_end <= $to`
4. Count total for pagination
5. Apply ORDER BY + LIMIT/OFFSET

**Response:**
```
{
  success: true,
  data: [
    {
      id, tenantId, tenantName, tenantSlug,
      periodStart, periodEnd, userCount, perUserRate,
      tier, totalAmount, status, createdAt
    },
    ...
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 2.2 `GET /api/platform/billing/:id` — Billing Record Detail

**Path Param:** `id` (UUID)

**Service Logic:**
1. Fetch billing record by ID with JOIN to `platform.tenants`
2. If not found → `404`

**Response:**
```
{
  success: true,
  data: {
    id, tenantId, tenantName, tenantSlug, tenantBillingEmail,
    periodStart, periodEnd, userCount, perUserRate,
    tier, totalAmount, status, createdAt
  }
}
```

---

### 2.3 `POST /api/platform/billing/generate` — Generate Billing Record

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `tenantId` | string | `@IsUUID()` | Yes |
| `periodStart` | string | `@IsDateString()` | Yes |
| `periodEnd` | string | `@IsDateString()` | Yes |
| `perUserRate` | number | `@IsNumber()`, `@Min(0)` | Yes |

**Service Logic:**
1. Find tenant by ID. If not found → `404`
2. If tenant status is `cancelled` → `400 "Cannot generate billing for a cancelled tenant"`
3. Validate `periodEnd > periodStart`. If not → `400 "Period end must be after period start"`
4. Check for duplicate: `SELECT id FROM platform.billing_records WHERE tenant_id = $1 AND period_start = $2 AND period_end = $3`. If exists → `409 "Billing record already exists for this period"`
5. Get current user count for the tenant: `SELECT current_user_count FROM platform.tenants WHERE id = $1`
6. Calculate total: `userCount * perUserRate`
7. Insert into `platform.billing_records`:
   - `tenant_id`, `period_start`, `period_end`
   - `user_count` = tenant's `current_user_count` at time of generation
   - `per_user_rate` = provided rate
   - `tier` = tenant's current `subscription_tier`
   - `total_amount` = calculated total
   - `status` = `'pending'`
   - `created_at` = NOW()

**Response:**
```
{
  success: true,
  data: {
    id, tenantId, periodStart, periodEnd, userCount,
    perUserRate, tier, totalAmount, status: "pending", createdAt
  }
}
```

---

### 2.4 `PUT /api/platform/billing/:id/status` — Update Billing Status

**Path Param:** `id` (UUID)

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `status` | string | `@IsIn(['paid', 'overdue'])` | Yes |

**Service Logic:**
1. Find billing record by ID. If not found → `404`
2. Validate status transition:
   - `pending` → `paid` ✅
   - `pending` → `overdue` ✅
   - `overdue` → `paid` ✅
   - `paid` → `overdue` ❌ → `400 "Cannot change a paid record to overdue"`
   - `paid` → `paid` ❌ → `400 "Record is already marked as paid"`
3. Update `status`, set `updated_at = NOW()` (add `updated_at` column if not present — see Section 2.5)

**Response:**
```
{ success: true, data: { id, status, message: "Billing record marked as {status}" } }
```

### 2.5 Schema Note: `billing_records.updated_at`

The PRD's `billing_records` table does not include `updated_at`. Add this column:

**Prisma schema addition:**
Add `updatedAt DateTime @updatedAt @map("updated_at")` to `PlatformBillingRecord` model.

**Raw SQL migration:**
```sql
ALTER TABLE platform.billing_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
```

This is needed to track when status was last changed (e.g., when it was marked as paid).

---

## 3. Super Admin Management APIs

Controller prefix: `platform/admins`. All protected by `PlatformAuthGuard`.

### 3.1 `GET /api/platform/admins` — List Super Admins

**Service Logic:**
```sql
SELECT id, email, name, is_active, last_login_at, created_at
FROM platform.super_admins
ORDER BY created_at ASC
```

No pagination needed (super admin count will always be small). No search needed.

**Response:**
```
{
  success: true,
  data: [
    { id, email, name, isActive: true, lastLoginAt, createdAt },
    ...
  ]
}
```

---

### 3.2 `POST /api/platform/admins` — Create Super Admin

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `email` | string | `@IsEmail()` | Yes |
| `password` | string | Min 8 chars, 1 upper, 1 lower, 1 number, 1 special | Yes |

**Service Logic:**
1. Check email uniqueness: `SELECT id FROM platform.super_admins WHERE email = $1`. If exists → `409 "A super admin with this email already exists"`
2. Hash password (bcrypt, 12 rounds)
3. Insert into `platform.super_admins`: `name`, `email`, `password_hash`, `is_active = TRUE`, `created_at = NOW()`
4. Send welcome email to the new admin via `PlatformEmailService` with login URL and credentials

**Response:**
```
{
  success: true,
  data: { id, email, name, isActive: true, createdAt }
}
```

---

### 3.3 `PUT /api/platform/admins/:id` — Update Super Admin

**Path Param:** `id` (UUID)

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsOptional()`, `@MaxLength(255)` | No |
| `isActive` | boolean | `@IsOptional()`, `@IsBoolean()` | No |

**Service Logic:**
1. Find admin by ID. If not found → `404`
2. If `isActive` is being set to `false` (deactivating):
   - Self-deactivation check: if `req.user.userId === id` → `400 "Cannot deactivate your own account"`
   - Last active check: `SELECT COUNT(*) FROM platform.super_admins WHERE is_active = TRUE`. If count ≤ 1 → `400 "Cannot deactivate the last active super admin"` (PRD 4.6)
3. Update fields
4. If deactivating: invalidate all sessions for this admin: `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`

**Response:**
```
{ success: true, data: { id, email, name, isActive, lastLoginAt, createdAt } }
```

---

### 3.4 `DELETE /api/platform/admins/:id` — Deactivate Super Admin

**Path Param:** `id` (UUID)

The PRD lists this as `DELETE` but the behavior is deactivation (soft), not hard deletion.

**Service Logic:**
1. Find admin by ID. If not found → `404`
2. Self-deactivation check: if `req.user.userId === id` → `400 "Cannot deactivate your own account"`
3. Last active check: `SELECT COUNT(*) FROM platform.super_admins WHERE is_active = TRUE`. If count ≤ 1 → `400 "Cannot deactivate the last active super admin"`
4. Set `is_active = FALSE`
5. Invalidate all sessions: `DELETE FROM platform.super_admin_sessions WHERE super_admin_id = $1`

**Response:**
```
{ success: true, data: { message: "Super admin deactivated" } }
```

**Note:** This endpoint overlaps functionally with `PUT /api/platform/admins/:id` when `isActive = false`. Both exist for API design flexibility — the `DELETE` provides a semantic endpoint for deactivation, while `PUT` handles it as part of a general update. The service logic is shared internally.

---

## 4. Registration Requests APIs

Controller prefix: `platform/registrations`. All protected by `PlatformAuthGuard`.

### 4.1 `GET /api/platform/registrations` — List Registration Requests

**Query Parameters (DTO):**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string (optional) | — | Filter: `pending`, `verified`, `provisioned`, `failed` |
| `search` | string (optional) | — | Search by org name or admin email |
| `page` | number | 1 | Pagination page |
| `limit` | number | 20 | Records per page (max 100) |
| `sortBy` | string | `created_at` | Sort column: `created_at`, `organization_name`, `status` |
| `sortOrder` | string | `desc` | `asc` or `desc` |

**Service Logic:**
1. Query `platform.registration_requests` with optional WHERE filters
2. Search applies: `WHERE (organization_name ILIKE '%{search}%' OR admin_email ILIKE '%{search}%')`
3. LEFT JOIN to `platform.tenants` to show tenant link for provisioned requests
4. Pagination with count

**Response:**
```
{
  success: true,
  data: [
    {
      id, organizationName, slug, adminName, adminEmail,
      subscriptionTier, maxUsers, emailVerified, status,
      tenantId, createdAt, verifiedAt, provisionedAt
    },
    ...
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.2 `POST /api/platform/registrations/:id/retry` — Retry Failed Provisioning

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find registration request by ID. If not found → `404`
2. If `status !== 'failed'` → `400 "Only failed registrations can be retried"`
3. Update status to `'verified'` (reset to pre-provisioning state)
4. Call `TenantProvisioningService.provision()` with the registration data:
   - Organization name, slug, admin name, admin email, hashed password, tier, max_users
   - `registrationSource = 'self_service'`
5. On success:
   - Update registration: `status = 'provisioned'`, `provisioned_at = NOW()`, `tenant_id = <new tenant ID>`
   - Send welcome email to admin
6. On failure:
   - Update registration: `status = 'failed'`
   - Return error details

**Response (success):**
```
{
  success: true,
  data: {
    registrationId: "...",
    tenantId: "...",
    status: "provisioned",
    message: "Provisioning retry successful. Welcome email sent."
  }
}
```

**Response (failure):**
```
{
  success: false,
  error: {
    code: "PROVISIONING_FAILED",
    message: "Provisioning retry failed: {error details}"
  }
}
```

---

### 4.3 `POST /api/platform/registrations/:id/resend-verification` — Resend Verification Email

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find registration request by ID. If not found → `404`
2. If `status !== 'pending'` → `400 "Verification email can only be resent for pending registrations"`
3. Generate a new `email_verification_token` (UUID)
4. Update the registration request: `email_verification_token = newToken`, `created_at = NOW()` (reset 24h expiry)
5. Send verification email to `admin_email` via `PlatformEmailService` using the verification email template (Sprint 1G)

**Response:**
```
{ success: true, data: { message: "Verification email resent to {adminEmail}" } }
```

---

## 5. Frontend: Billing Pages

### 5.1 Billing List Page — `/platform/billing`

**Layout:** Standard data table page.

**Toolbar:**
- "Generate Invoice" primary action button → navigates to `/platform/billing/generate`
- Filter button → opens filter sidebar

**Filters (sidebar):**
- Tenant: searchable dropdown (fetches tenant list from `GET /api/platform/tenants?limit=100`)
- Status: checkboxes (Pending, Paid, Overdue)
- Date Range: start date picker + end date picker

**Table Columns:**

| Column | Type | Sortable |
|---|---|---|
| Tenant | text (tenant name, clickable → tenant detail page) | No |
| Period | `{periodStart} — {periodEnd}` (formatted dates) | Yes (by `period_start`) |
| Users | number | No |
| Rate | currency formatted (₹ / $ based on locale) | No |
| Total | currency formatted, bold | Yes (by `total_amount`) |
| Status | colored badge (pending=amber, paid=green, overdue=red) | Yes |
| Created | relative date | Yes |
| Actions | dropdown | No |

**Actions Dropdown per Row:**
- "View Details" → `/platform/billing/{id}`
- Divider
- If status is `pending` → "Mark as Paid" (confirm dialog) + "Mark as Overdue" (confirm dialog)
- If status is `overdue` → "Mark as Paid" (confirm dialog)
- If status is `paid` → no status actions (read-only)

**Data Fetching:** React Query with filter/sort/pagination params as query keys. URL state sync.

### 5.2 Billing Detail Page — `/platform/billing/[id]`

**Layout:** Detail card with all billing record fields.

**Sections:**

**Billing Info (card):**
| Label | Value |
|---|---|
| Billing Record ID | `{id}` (monospace, muted) |
| Status | colored badge |
| Created | full date |
| Last Updated | full date (from `updated_at`) |

**Tenant Info (card):**
| Label | Value |
|---|---|
| Tenant Name | clickable link → `/platform/tenants/{tenantId}` |
| Slug | monospace |
| Billing Email | email |

**Billing Details (card):**
| Label | Value |
|---|---|
| Period | `{periodStart} — {periodEnd}` |
| User Count | number |
| Per User Rate | currency |
| Subscription Tier | badge |
| **Total Amount** | currency, large bold |

**Header Actions:**
- Status-appropriate buttons (same logic as list page actions)

### 5.3 Generate Invoice Page — `/platform/billing/generate`

**Layout:** Form page with `<PageHeader>` ("Generate Invoice", breadcrumb: Billing → Generate).

**Form Fields:**

| Field | Type | Behavior |
|---|---|---|
| Tenant* | searchable select dropdown | Loads from `GET /api/platform/tenants?status=active&status=trial&limit=100`. Shows name + slug. On select: auto-fills current user count. |
| Period Start* | date picker | Required |
| Period End* | date picker | Must be after period start |
| Per User Rate* | number input (currency) | Required. Accepts decimals (2 places). |

**Calculated Preview (shown below form, updates on any field change):**
- "Users: {currentUserCount}"
- "Rate: ₹{perUserRate} per user"
- "**Estimated Total: ₹{currentUserCount × perUserRate}**"

**Submit Behavior:**
1. Call `POST /api/platform/billing/generate`
2. On success → redirect to billing list with success toast "Invoice generated successfully"
3. On `409` duplicate → show inline error "A billing record already exists for this period"

### 5.4 API Helper

**File:** `src/services/platform-billing.ts`

Exports:
- `list(params)` → `GET /api/platform/billing?...`
- `getById(id)` → `GET /api/platform/billing/{id}`
- `generate(data)` → `POST /api/platform/billing/generate`
- `updateStatus(id, status)` → `PUT /api/platform/billing/{id}/status`

All use the platform Axios instance.

---

## 6. Frontend: Super Admin Management Page

### 6.1 Admin List Page — `/platform/admins`

**Layout:** Simple list page (no complex filters needed — admin count is small).

**Toolbar:**
- "Add Super Admin" primary action button → opens slide-over drawer form

**Table Columns:**

| Column | Type |
|---|---|
| Name | text |
| Email | text |
| Status | badge (Active = green, Inactive = red) |
| Last Login | relative date or "Never" |
| Created | relative date |
| Actions | dropdown |

**Actions Dropdown per Row:**
- "Edit" → opens edit drawer
- Divider
- If active → "Deactivate" (confirm dialog with last-admin warning if applicable)
- If inactive → "Reactivate" (confirm dialog)

**No pagination** — simple table, all admins shown.

### 6.2 Add Super Admin Drawer

Slide-over drawer (shadcn `Sheet`) from right:

| Field | Type | Validation |
|---|---|---|
| Name* | text input | Required |
| Email* | email input | Required, validated |
| Password* | password input | Min 8 chars, complexity rules. Show/hide toggle. |

**Password strength indicator:** Same component as registration form (Sprint 1D) — reuse.

**Submit:** Call `POST /api/platform/admins`. On success → close drawer, refetch admin list, show success toast.

### 6.3 Edit Super Admin Drawer

Same drawer layout, pre-filled with current values:

| Field | Type | Notes |
|---|---|---|
| Name | text input | Editable |
| Email | text input | **Read-only** (displayed but disabled — email cannot be changed) |
| Active Status | toggle switch | Editable (with same protections as API) |

**Submit:** Call `PUT /api/platform/admins/{id}`. On success → close drawer, refetch list.

### 6.4 Confirm Dialogs

**Deactivate:**
- Title: "Deactivate Super Admin"
- Description: "**{name}** will no longer be able to log in to the platform admin portal. Their active sessions will be terminated immediately."
- If this is the last active admin (detect by counting active admins in the list): show disabled button + red text "Cannot deactivate — this is the only active admin."
- Confirm label: "Deactivate"
- Variant: destructive

**Reactivate:**
- Title: "Reactivate Super Admin"
- Description: "**{name}** will be able to log in to the platform admin portal again."
- Confirm label: "Reactivate"
- Variant: default

### 6.5 API Helper

**File:** `src/services/platform-admins.ts`

Exports:
- `list()` → `GET /api/platform/admins`
- `create(data)` → `POST /api/platform/admins`
- `update(id, data)` → `PUT /api/platform/admins/{id}`
- `deactivate(id)` → `DELETE /api/platform/admins/{id}`

---

## 7. Frontend: Registration Requests Page

### 7.1 Registration List Page — `/platform/registrations`

**Layout:** Standard data table page.

**Toolbar:**
- Search input: placeholder "Search by org name or email..."
- Filter button → opens filter sidebar
- No primary action button (registrations are created by end-users, not admins)

**Filters (sidebar):**
- Status: checkboxes (Pending, Verified, Provisioned, Failed)

**Table Columns:**

| Column | Type | Sortable |
|---|---|---|
| Organization Name | text | Yes |
| Slug | text, monospace | No |
| Admin Name | text | No |
| Admin Email | text | No |
| Tier | badge | No |
| Max Users | number | No |
| Email Verified | icon (✓ green / ✗ red) | No |
| Status | colored badge (pending=amber, verified=blue, provisioned=green, failed=red) | Yes |
| Created | relative date | Yes |
| Actions | contextual buttons | No |

**Status Badges:**
- `pending` — amber: "Pending Verification"
- `verified` — blue: "Verified — Awaiting Provisioning" (should be brief, provisioning happens immediately on verification)
- `provisioned` — green: "Provisioned" with link to tenant detail
- `failed` — red: "Provisioning Failed"

**Contextual Action Buttons (inline, not dropdown):**
- If `status === 'pending'` → "Resend Email" button (text button, not primary)
- If `status === 'failed'` → "Retry Provisioning" button (primary/brand colored)
- If `status === 'provisioned'` → "View Tenant" link → `/platform/tenants/{tenantId}`
- If `status === 'verified'` → no action (provisioning should be in progress)

**Retry behavior:**
1. Click "Retry Provisioning" → confirm dialog:
   - Title: "Retry Provisioning"
   - Description: "This will attempt to create the schema and set up the organization for **{organizationName}** again."
   - Confirm: "Retry"
2. On confirm → call `POST /api/platform/registrations/{id}/retry`
3. Show loading spinner on the button
4. On success → refetch list, row updates to `provisioned`, show success toast
5. On failure → show error toast with details, row stays `failed`

**Resend behavior:**
1. Click "Resend Email" → call `POST /api/platform/registrations/{id}/resend-verification` directly (no confirm dialog needed)
2. Show success toast: "Verification email resent"
3. Rate limit: disable button for 60 seconds after successful resend (frontend-only cooldown, matching Sprint 1D's user-facing resend)

### 7.2 API Helper

**File:** `src/services/platform-registrations.ts`

Exports:
- `list(params)` → `GET /api/platform/registrations?...`
- `retry(id)` → `POST /api/platform/registrations/{id}/retry`
- `resendVerification(id)` → `POST /api/platform/registrations/{id}/resend-verification`

---

## 8. Schema Migration Note

### 8.1 `billing_records.updated_at` Column

The original Prisma schema in Sprint 1A for `PlatformBillingRecord` does not include `updated_at`. Add it:

**Prisma model update:**
Add `updatedAt DateTime @updatedAt @map("updated_at")` to the `PlatformBillingRecord` model in `schema.prisma`.

**Raw SQL migration:**
```sql
ALTER TABLE platform.billing_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
```

**`setup-platform.sql` update:**
Add `updated_at TIMESTAMP NOT NULL DEFAULT NOW()` to the `CREATE TABLE platform.billing_records` statement for new installations.

---

## 9. Verification & Acceptance Criteria

### Billing API Tests

**Test 1: List billing records with filters**
```
GET /api/platform/billing?status=pending&page=1&limit=10
Headers: Authorization: Bearer <platform_token>
→ 200: Filtered, paginated billing list with tenant names

GET /api/platform/billing?tenantId=<uuid>&from=2026-01-01&to=2026-01-31
→ 200: Records for specific tenant in January
```

**Test 2: Billing detail**
```
GET /api/platform/billing/<record-id>
→ 200: Full billing record with tenant info
```

**Test 3: Generate invoice**
```
POST /api/platform/billing/generate
Body: {
  "tenantId": "<uuid>",
  "periodStart": "2026-02-01",
  "periodEnd": "2026-02-28",
  "perUserRate": 299.00
}
→ 201: { id, userCount, totalAmount: <count * 299>, status: "pending" }

Verify DB: SELECT * FROM platform.billing_records WHERE id = '<new-id>'; → user_count matches tenant's current count
```

**Test 4: Duplicate period prevention**
```
POST /api/platform/billing/generate
Body: { same tenantId + same period }
→ 409: "Billing record already exists for this period"
```

**Test 5: Status transitions**
```
PUT /api/platform/billing/<id>/status
Body: { "status": "paid" }
→ 200: "Billing record marked as paid"

PUT /api/platform/billing/<id>/status
Body: { "status": "overdue" }
→ 400: "Cannot change a paid record to overdue"
```

### Super Admin API Tests

**Test 6: List admins**
```
GET /api/platform/admins
→ 200: Array of all super admins with status and last login
```

**Test 7: Create admin**
```
POST /api/platform/admins
Body: { "name": "New Admin", "email": "new@platform.com", "password": "Secure@123" }
→ 201: { id, email, name, isActive: true }

POST /api/platform/admins
Body: { "email": "new@platform.com", ... }
→ 409: "A super admin with this email already exists"
```

**Test 8: Update admin**
```
PUT /api/platform/admins/<id>
Body: { "name": "Updated Name" }
→ 200: Updated admin
```

**Test 9: Last active admin protection**
```
# With only one active admin
DELETE /api/platform/admins/<only-active-admin-id>
→ 400: "Cannot deactivate the last active super admin"

# Self-deactivation
DELETE /api/platform/admins/<own-id>
→ 400: "Cannot deactivate your own account"
```

**Test 10: Deactivate + session invalidation**
```
# Create second admin, log them in
POST /api/platform/admins (create second)
POST /api/platform/auth/login (as second admin → get tokens)

# Deactivate second admin from first admin's session
DELETE /api/platform/admins/<second-admin-id>
→ 200: "Super admin deactivated"

# Second admin tries to refresh token
POST /api/platform/auth/refresh (with second admin's refresh token)
→ 401 (session was invalidated)
```

### Registration API Tests

**Test 11: List registrations**
```
GET /api/platform/registrations?status=failed&page=1&limit=20
→ 200: Filtered list of failed registrations

GET /api/platform/registrations?search=acme
→ 200: Registrations matching "acme" in org name or admin email
```

**Test 12: Retry failed provisioning**
```
# Given a registration with status = 'failed'
POST /api/platform/registrations/<id>/retry
→ 200: { status: "provisioned", tenantId: "<new-uuid>", message: "..." }

Verify: Tenant schema now exists, admin user created, welcome email sent

# Retry on non-failed registration
POST /api/platform/registrations/<provisioned-id>/retry
→ 400: "Only failed registrations can be retried"
```

**Test 13: Resend verification**
```
# Given a registration with status = 'pending'
POST /api/platform/registrations/<id>/resend-verification
→ 200: "Verification email resent to admin@example.com"

Verify: New verification token generated, old token invalidated, email sent

# Resend on non-pending registration
POST /api/platform/registrations/<provisioned-id>/resend-verification
→ 400: "Verification email can only be resent for pending registrations"
```

### Frontend Tests

- [ ] Billing list page: table with tenant names, status badges, date formatting
- [ ] Billing filters: tenant dropdown (searchable), status checkboxes, date range pickers
- [ ] Billing actions: "Mark as Paid"/"Mark as Overdue" with confirm dialogs
- [ ] Billing detail page: all fields displayed, status action buttons
- [ ] Generate invoice form: tenant dropdown auto-fills user count, calculated total preview
- [ ] Generate invoice: duplicate period shows error inline
- [ ] Admin list: table with all admins, status badges, last login
- [ ] Add admin drawer: form with name/email/password + strength indicator
- [ ] Edit admin drawer: pre-filled, email read-only, active toggle
- [ ] Deactivate confirm: shows warning, disabled if last active admin
- [ ] Registration list: status badges with correct colors, contextual action buttons
- [ ] "Retry Provisioning" button: confirm dialog, loading state, success/failure handling
- [ ] "Resend Email" button: no confirm, success toast, 60s cooldown
- [ ] "View Tenant" link on provisioned registrations navigates to tenant detail
- [ ] All data tables: URL state sync for filters/search/pagination

### Full Checklist

**Billing:**
- [ ] `GET /api/platform/billing` — list with filters (tenant, status, date range), pagination, sort
- [ ] `GET /api/platform/billing/:id` — detail with tenant info
- [ ] `POST /api/platform/billing/generate` — creates billing record from tenant snapshot
- [ ] Duplicate period check returns 409
- [ ] `PUT /api/platform/billing/:id/status` — valid transitions enforced (paid ↛ overdue)
- [ ] `billing_records.updated_at` column added (schema migration)
- [ ] Generate invoice calculates total = userCount × perUserRate
- [ ] Cannot generate for cancelled tenants

**Super Admins:**
- [ ] `GET /api/platform/admins` — list all admins
- [ ] `POST /api/platform/admins` — create with email uniqueness check + welcome email
- [ ] `PUT /api/platform/admins/:id` — update name and/or active status
- [ ] `DELETE /api/platform/admins/:id` — deactivate (soft) + session invalidation
- [ ] Cannot deactivate last active admin
- [ ] Cannot deactivate own account
- [ ] Session invalidation on deactivation prevents subsequent token refresh

**Registration Requests:**
- [ ] `GET /api/platform/registrations` — list with status filter, search, pagination
- [ ] `POST /api/platform/registrations/:id/retry` — retriggers provisioning pipeline for failed requests
- [ ] `POST /api/platform/registrations/:id/resend-verification` — generates new token + sends email for pending requests
- [ ] Retry only works on `failed` status
- [ ] Resend only works on `pending` status

**General:**
- [ ] All 11 endpoints (4 billing + 4 admin + 3 registration) in Swagger docs
- [ ] All endpoints protected by `PlatformAuthGuard`
- [ ] Frontend pages use shared `<DataTable>`, `<ConfirmDialog>`, `<PageHeader>` from Sprint 1H

---

*Sprint 2B Complete. Next: Sprint 2C — Tenant Account Management Pages*
