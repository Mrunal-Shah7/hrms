# Sprint 2A — Super Admin Dashboard & Tenant Management

## Goal
Build the platform admin's two primary pages: the Dashboard (aggregate stats across all tenants) and Tenant Management (list, create, detail, edit, suspend/reactivate/cancel). All backend APIs are platform-scoped (protected by `PlatformAuthGuard`), operate on the `platform` schema, and are accessed from the platform admin shell built in Sprint 1H. By the end of this sprint, a super admin can view platform health at a glance and fully manage the tenant lifecycle.

---

## 1. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/platform/dashboard/platform-dashboard.module.ts` | NestJS module |
| `src/platform/dashboard/platform-dashboard.controller.ts` | 1 dashboard API endpoint |
| `src/platform/dashboard/platform-dashboard.service.ts` | Aggregate stat queries |
| `src/platform/tenants/platform-tenants.module.ts` | NestJS module |
| `src/platform/tenants/platform-tenants.controller.ts` | 7 tenant management endpoints |
| `src/platform/tenants/platform-tenants.service.ts` | Tenant CRUD + status actions |
| `src/platform/tenants/dto/create-tenant.dto.ts` | Create tenant DTO |
| `src/platform/tenants/dto/update-tenant.dto.ts` | Update tenant DTO |
| `src/platform/tenants/dto/list-tenants-query.dto.ts` | Query params DTO for list |
| `src/platform/tenants/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(platform)/platform/dashboard/page.tsx` | Dashboard page (replace placeholder) |
| `src/app/(platform)/platform/tenants/page.tsx` | Tenant list page (replace placeholder) |
| `src/app/(platform)/platform/tenants/new/page.tsx` | Create tenant form page |
| `src/app/(platform)/platform/tenants/[id]/page.tsx` | Tenant detail page |
| `src/app/(platform)/platform/tenants/[id]/edit/page.tsx` | Edit tenant page |
| `src/services/platform-tenants.ts` | API helper functions |
| `src/services/platform-dashboard.ts` | API helper functions |

### Module Registration
- Import `PlatformDashboardModule` and `PlatformTenantsModule` into `AppModule`
- All routes under `/api/platform/*` — protected by `PlatformAuthGuard`, bypass `TenantMiddleware`

---

## 2. Platform Dashboard API

### 2.1 `GET /api/platform/dashboard` — Dashboard Stats

**Auth:** `PlatformAuthGuard`

**Service Logic — Queries against `platform` schema:**

**Widget 1: Total Tenants by Status**
```sql
SELECT status, COUNT(*) as count
FROM platform.tenants
GROUP BY status
```
Returns: `{ active: N, trial: N, suspended: N, cancelled: N, total: N }`

**Widget 2: Total Users Across Tenants**
For each non-cancelled tenant, query its schema's `users` table:
```sql
SELECT SUM(current_user_count) as total_users,
       SUM(max_users) as total_seats
FROM platform.tenants
WHERE status != 'cancelled'
```
Returns: `{ totalUsers: N, totalSeats: N, utilizationPercent: N }`

**Widget 3: Revenue Overview**
```sql
SELECT
  SUM(CASE WHEN status = 'paid' AND period_start >= date_trunc('month', CURRENT_DATE) THEN total_amount ELSE 0 END) as current_month_revenue,
  SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) as total_revenue,
  SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END) as pending_revenue
FROM platform.billing_records
```
Returns: `{ currentMonthRevenue: N, totalRevenue: N, pendingRevenue: N }`

**Widget 4: Recent Registrations (last 10)**
```sql
SELECT id, organization_name, admin_email, subscription_tier, status, created_at
FROM platform.registration_requests
ORDER BY created_at DESC
LIMIT 10
```
Returns: Array of 10 registration request summaries.

**Widget 5: Tenants Approaching Trial Expiry (within 7 days)**
```sql
SELECT id, name, slug, trial_ends_at, billing_email
FROM platform.tenants
WHERE status = 'trial'
  AND trial_ends_at IS NOT NULL
  AND trial_ends_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
ORDER BY trial_ends_at ASC
```
Returns: Array of tenants nearing trial end.

**Widget 6: Overdue Payments**
```sql
SELECT br.id, br.total_amount, br.period_start, br.period_end,
       t.name as tenant_name, t.slug as tenant_slug
FROM platform.billing_records br
JOIN platform.tenants t ON br.tenant_id = t.id
WHERE br.status = 'overdue'
ORDER BY br.period_end ASC
```
Returns: Array of overdue billing records with tenant info.

**Widget 7: System Health (basic)**
Returns: `{ dbConnectionOk: boolean, tenantsWithErrors: number }` — a simple health probe. For v1, just check that the DB connection is alive and count tenants with `status = 'failed'` in `registration_requests`. Extend in future if needed.

**Full Response Shape:**
```
{
  success: true,
  data: {
    tenantStats: { active, trial, suspended, cancelled, total },
    userStats: { totalUsers, totalSeats, utilizationPercent },
    revenue: { currentMonthRevenue, totalRevenue, pendingRevenue },
    recentRegistrations: [ { id, organizationName, adminEmail, tier, status, createdAt }, ... ],
    trialExpiring: [ { id, name, slug, trialEndsAt, billingEmail }, ... ],
    overduePayments: [ { id, totalAmount, periodStart, periodEnd, tenantName, tenantSlug }, ... ],
    systemHealth: { dbConnectionOk, tenantsWithErrors }
  }
}
```

---

## 3. Tenant Management APIs

All endpoints protected by `PlatformAuthGuard`. Controller prefix: `platform/tenants`.

### 3.1 `GET /api/platform/tenants` — List Tenants

**Query Parameters (DTO):**

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string (optional) | — | Filter: `active`, `trial`, `suspended`, `cancelled` |
| `tier` | string (optional) | — | Filter: `standard`, `with_recruitment` |
| `source` | string (optional) | — | Filter: `self_service`, `super_admin` |
| `search` | string (optional) | — | Search by name, slug, or billing email (case-insensitive `ILIKE`) |
| `page` | number | 1 | Pagination page |
| `limit` | number | 20 | Records per page (max 100) |
| `sortBy` | string | `created_at` | Sort column: `name`, `slug`, `created_at`, `status`, `current_user_count` |
| `sortOrder` | string | `desc` | `asc` or `desc` |

**Service Logic:**
1. Build dynamic SQL with optional WHERE clauses for each filter
2. Search applies: `WHERE (name ILIKE '%{search}%' OR slug ILIKE '%{search}%' OR billing_email ILIKE '%{search}%')`
3. Count total matching rows for pagination metadata
4. Apply `ORDER BY {sortBy} {sortOrder}`, `LIMIT {limit} OFFSET {(page-1) * limit}`

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, slug, subscriptionTier, maxUsers, currentUserCount,
      status, registrationSource, customDomain, billingEmail, createdAt
    },
    ...
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 3.2 `GET /api/platform/tenants/:id` — Tenant Detail

**Path Param:** `id` (UUID)

**Service Logic:**
1. Fetch tenant from `platform.tenants` by ID. If not found → `404`
2. Fetch usage stats by querying the tenant's schema:
   - User count: `SELECT COUNT(*) FROM "{schemaName}".users WHERE status = 'active'`
   - Total storage: `SELECT COALESCE(SUM(file_size), 0) FROM "{schemaName}".file_storage`
3. Fetch billing history: `SELECT * FROM platform.billing_records WHERE tenant_id = $1 ORDER BY period_start DESC LIMIT 10`
4. Fetch admin account info: `SELECT id, email, first_name, last_name, status, last_login_at FROM "{schemaName}".users WHERE email = (SELECT billing_email FROM platform.tenants WHERE id = $1)` — or the first user with the "Admin" role
5. Fetch registration info (if exists): `SELECT * FROM platform.registration_requests WHERE tenant_id = $1`

**Response:**
```
{
  success: true,
  data: {
    tenant: {
      id, name, slug, customDomain, schemaName, subscriptionTier,
      maxUsers, currentUserCount, billingEmail, status,
      registrationSource, trialEndsAt, createdAt, updatedAt
    },
    usage: {
      activeUsers: N,
      storageUsedBytes: N,
      storageUsedFormatted: "12.5 MB"
    },
    adminAccount: {
      id, email, firstName, lastName, status, lastLoginAt
    },
    billingHistory: [
      { id, periodStart, periodEnd, userCount, perUserRate, tier, totalAmount, status, createdAt },
      ...
    ],
    registration: {
      id, status, source, createdAt, verifiedAt, provisionedAt
    } | null
  }
}
```

---

### 3.3 `POST /api/platform/tenants` — Create + Provision Tenant

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `organizationName` | string | `@IsNotEmpty()` | Yes |
| `slug` | string | `@IsNotEmpty()`, regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Yes |
| `subscriptionTier` | string | `@IsIn(['standard', 'with_recruitment'])` | Yes |
| `maxUsers` | number | `@IsInt()`, `@Min(1)` | Yes |
| `billingEmail` | string | `@IsEmail()` | Yes |
| `adminName` | string | `@IsNotEmpty()` | Yes |
| `adminEmail` | string | `@IsEmail()` | Yes |
| `temporaryPassword` | string | `@IsOptional()`, min 8 chars if provided | No |
| `customDomain` | string | `@IsOptional()` | No |

**Service Logic:**
1. Validate slug uniqueness: check `platform.tenants` AND `platform.registration_requests` (status `pending`/`verified`)
2. If `temporaryPassword` not provided → auto-generate a secure 12-char password
3. Hash the password (bcrypt, 12 rounds)
4. Call `TenantProvisioningService.provision()` with all fields + `registrationSource = 'super_admin'`
5. Send welcome email to admin (via `PlatformEmailService`) with:
   - Organization name
   - Login URL
   - Admin email (username)
   - Temporary password (in plaintext — only for super-admin-created tenants, since the admin needs to know the initial password)
   - Note: "You will be asked to change your password on first login"
6. On success → return tenant details + admin credentials summary

**Response:**
```
{
  success: true,
  data: {
    tenant: { id, name, slug, schemaName, subscriptionTier, maxUsers, status },
    adminCredentials: {
      email: "admin@acme.com",
      temporaryPassword: "xK9#mP2$qR4w"   // only returned on creation
    },
    message: "Tenant provisioned successfully. Welcome email sent."
  }
}
```

**Error Responses:**
- `409 Conflict` — slug already taken
- `500 Internal Server Error` — provisioning failed (with cleanup)

---

### 3.4 `PUT /api/platform/tenants/:id` — Update Tenant

**Path Param:** `id` (UUID)

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsOptional()` | No |
| `subscriptionTier` | string | `@IsOptional()`, `@IsIn(['standard', 'with_recruitment'])` | No |
| `maxUsers` | number | `@IsOptional()`, `@IsInt()`, `@Min(1)` | No |
| `customDomain` | string | `@IsOptional()` | No |

**Service Logic:**
1. Find tenant by ID. If not found → `404`
2. If `name` provided → update
3. If `subscriptionTier` provided → update. If downgrading from `with_recruitment` to `standard` and tenant has active recruitment data, log a warning but allow (recruitment features become inaccessible but data is preserved)
4. If `maxUsers` provided → validate `maxUsers >= currentUserCount` (cannot set below current usage). If violation → `400 "Cannot set max users below current user count ({currentUserCount})"`
5. If `customDomain` provided → validate uniqueness across all tenants. If taken → `409`
6. Update fields + set `updated_at = NOW()`

**Response:** Updated tenant object.

---

### 3.5 `PUT /api/platform/tenants/:id/suspend` — Suspend Tenant

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find tenant by ID. If not found → `404`
2. If `status` is already `suspended` → `400 "Tenant is already suspended"`
3. If `status` is `cancelled` → `400 "Cannot suspend a cancelled tenant"`
4. Update `status = 'suspended'`, `updated_at = NOW()`
5. Effect: `TenantMiddleware` (Sprint 1B) already blocks requests to suspended tenants with a 403 message. No additional session invalidation needed — existing JWTs will continue to work until they expire (15 min max), but the middleware blocks all new requests at the gate.

**Response:**
```
{ success: true, data: { message: "Tenant suspended. All tenant-level access is now blocked." } }
```

---

### 3.6 `PUT /api/platform/tenants/:id/reactivate` — Reactivate Tenant

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find tenant by ID. If not found → `404`
2. If `status` is not `suspended` → `400 "Only suspended tenants can be reactivated"`
3. Update `status = 'active'`, `updated_at = NOW()`

**Response:**
```
{ success: true, data: { message: "Tenant reactivated. Access restored." } }
```

---

### 3.7 `PUT /api/platform/tenants/:id/cancel` — Cancel Tenant

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find tenant by ID. If not found → `404`
2. If `status` is already `cancelled` → `400 "Tenant is already cancelled"`
3. Update `status = 'cancelled'`, `updated_at = NOW()`
4. This is a soft cancel — the schema and data are preserved. The tenant is just blocked from access.
5. Do NOT drop the PostgreSQL schema. Data retention is important for compliance.

**Response:**
```
{ success: true, data: { message: "Tenant cancelled. All access is permanently blocked." } }
```

---

## 4. Frontend: Dashboard Page

### 4.1 Page: `/platform/dashboard`

**Layout:** Grid of widget cards. Responsive: 3 columns on desktop, 2 on tablet, 1 on mobile.

**Widget Cards:**

| Widget | Visual | Data Source |
|---|---|---|
| **Total Tenants** | Large number with status breakdown as colored badges below (Active: green, Trial: blue, Suspended: amber, Cancelled: red) | `tenantStats` |
| **Total Users** | Large number + progress bar showing utilization (`totalUsers / totalSeats`) | `userStats` |
| **Revenue** | Current month revenue as primary number. Total revenue and pending revenue as secondary labels below. | `revenue` |
| **Recent Registrations** | Mini table (5 rows visible, scrollable): Org Name, Email, Status badge, Date. "View All" link → `/platform/registrations` | `recentRegistrations` |
| **Trial Expiring** | List of tenants with expiry date, urgency color (red if < 2 days, amber if < 5, green otherwise). Empty state if none. "View All" → `/platform/tenants?status=trial` | `trialExpiring` |
| **Overdue Payments** | List of overdue billing records: tenant name, amount, period. "View All" → `/platform/billing?status=overdue` | `overduePayments` |
| **System Health** | Green checkmark if all OK. Warning icon + count if issues found. | `systemHealth` |

**Data Fetching:**
- Use React Query: `useQuery(['platform-dashboard'], () => platformDashboardApi.getStats())`
- Refetch on window focus
- Show skeleton loading state per widget while fetching

### 4.2 API Helper

**File:** `src/services/platform-dashboard.ts`

Export:
- `getStats()` → `GET /api/platform/dashboard` (uses platform API Axios instance)

---

## 5. Frontend: Tenant Management Pages

### 5.1 Tenant List Page — `/platform/tenants`

**Layout:** Standard data table page using `<DataTable>` from Sprint 1H.

**Toolbar:**
- Search input: placeholder "Search by name, slug, or email..."
- "Create Tenant" primary action button → navigates to `/platform/tenants/new`
- Filter button → opens filter sidebar

**Filters (sidebar):**
- Status: checkboxes (Active, Trial, Suspended, Cancelled)
- Tier: checkboxes (Standard, Standard + Recruitment)
- Source: checkboxes (Self Service, Super Admin)

**Table Columns:**

| Column | Type | Sortable |
|---|---|---|
| Organization Name | text (clickable → navigates to detail page) | Yes |
| Slug | text, monospace | Yes |
| Tier | badge (`Standard` = gray, `With Recruitment` = blue) | No |
| Users | `{currentUserCount} / {maxUsers}` with progress bar | Yes (by `currentUserCount`) |
| Status | colored badge (active=green, trial=blue, suspended=amber, cancelled=red) | Yes |
| Source | text (`Self Service` / `Super Admin`) | No |
| Created | relative date (e.g., "3 days ago"), tooltip shows full date | Yes |
| Actions | dropdown menu: View, Edit, Suspend/Reactivate, Cancel | No |

**Actions Dropdown per Row:**
- "View Details" → `/platform/tenants/{id}`
- "Edit" → `/platform/tenants/{id}/edit`
- Divider
- If status is `active` or `trial` → "Suspend Tenant" (amber text, confirm dialog)
- If status is `suspended` → "Reactivate Tenant" (green text, confirm dialog)
- If status is not `cancelled` → "Cancel Tenant" (red text, confirm dialog with "This action cannot be undone" warning)

**Pagination:** `<DataTablePagination>` from Sprint 1H.

**Data Fetching:**
- React Query with query key including all filter/search/sort/pagination params
- Debounced search (300ms)
- URL state sync: filters + search + page reflected in URL query params for shareable links

### 5.2 Create Tenant Page — `/platform/tenants/new`

**Layout:** Form page with `<PageHeader>` ("Create New Tenant", breadcrumb: Tenants → Create).

**Form (using react-hook-form + zod validation):**

| Field | Type | Behavior |
|---|---|---|
| Organization Name* | text input | On change: auto-generate slug (same kebab-case logic as registration) |
| Slug* | text input, pre-filled | Editable. On blur: debounced uniqueness check → green/red indicator |
| Subscription Tier* | select dropdown | Options: "Standard", "Standard + Recruitment" |
| Max Users* | number input | Min 1, default 10 |
| Billing Email* | email input | Required |
| Admin Name* | text input | Required |
| Admin Email* | email input | Required |
| Temporary Password | text input | Optional. "Auto-generate" checkbox — when checked, disables input and shows generated password. Default: auto-generate checked. |
| Custom Domain | text input | Optional. Placeholder: "hr.acmecorp.com" |

**Auto-generate password behavior:**
- Checkbox checked (default) → generate a 12-char random password (2 uppercase, 2 lowercase, 2 numbers, 2 special chars, 4 random). Display it in a readonly input so admin can copy it.
- Checkbox unchecked → admin types a custom password (validated: min 8 chars, complexity rules)

**Submit behavior:**
1. Call `POST /api/platform/tenants`
2. Show loading state
3. On success → show confirmation dialog/page with:
   - "Tenant provisioned successfully!"
   - Tenant details: name, slug, tier
   - Admin credentials: email + temporary password (displayed clearly for copying)
   - "Copy Credentials" button
   - "Go to Tenant List" button
4. On error → show error alert

### 5.3 Tenant Detail Page — `/platform/tenants/[id]`

**Layout:** Detail page with sections. `<PageHeader>` with breadcrumb (Tenants → {Tenant Name}) and action buttons.

**Header Actions:**
- "Edit Tenant" button → `/platform/tenants/{id}/edit`
- Status action button (context-dependent):
  - Active/Trial → "Suspend" (amber)
  - Suspended → "Reactivate" (green)
  - Not cancelled → "Cancel" (red, with confirm)

**Sections:**

**Section 1: Basic Info (card)**
| Label | Value |
|---|---|
| Organization Name | {name} |
| Slug | {slug} (monospace) |
| Custom Domain | {customDomain} or "Not set" |
| Schema Name | {schemaName} (monospace, muted) |
| Subscription Tier | badge |
| Status | colored badge |
| Created | full date + relative |

**Section 2: Usage Stats (card)**
| Label | Value |
|---|---|
| Active Users | {activeUsers} / {maxUsers} + progress bar |
| Storage Used | {storageUsedFormatted} |

**Section 3: Admin Account (card)**
| Label | Value |
|---|---|
| Admin Name | {firstName} {lastName} |
| Admin Email | {email} |
| Account Status | badge |
| Last Login | date or "Never" |

**Section 4: Billing History (table card)**
Mini table showing last 10 billing records:
| Period | Users | Rate | Total | Status |
Columns: `{periodStart} – {periodEnd}`, userCount, perUserRate, totalAmount (formatted as ₹), status badge.
"View All Billing" link → `/platform/billing?tenantId={id}`

**Section 5: Registration Info (card, if exists)**
| Label | Value |
|---|---|
| Source | {registrationSource} |
| Registered | {createdAt} |
| Email Verified | {verifiedAt} or "Pending" |
| Provisioned | {provisionedAt} |

**Data Fetching:**
- React Query: `useQuery(['platform-tenant', id], () => platformTenantsApi.getById(id))`

### 5.4 Edit Tenant Page — `/platform/tenants/[id]/edit`

**Layout:** Form page with `<PageHeader>` (breadcrumb: Tenants → {Name} → Edit).

**Form Fields (pre-filled from current tenant data):**

| Field | Type | Notes |
|---|---|---|
| Organization Name | text input | Editable |
| Subscription Tier | select dropdown | Editable. Warning shown if downgrading |
| Max Users | number input | Min = currentUserCount. Validation message if set too low. |
| Custom Domain | text input | Editable. On blur: uniqueness check |

**Non-editable fields (displayed but disabled):**
- Slug (cannot change after creation — URL stability)
- Schema Name
- Status (managed via suspend/reactivate/cancel actions, not this form)
- Billing Email (managed separately — could be added later)

**Submit behavior:**
1. Call `PUT /api/platform/tenants/{id}`
2. On success → redirect to tenant detail page with success toast
3. On error → show error alert

### 5.5 API Helper

**File:** `src/services/platform-tenants.ts`

Exports:
- `list(params)` → `GET /api/platform/tenants?...`
- `getById(id)` → `GET /api/platform/tenants/{id}`
- `create(data)` → `POST /api/platform/tenants`
- `update(id, data)` → `PUT /api/platform/tenants/{id}`
- `suspend(id)` → `PUT /api/platform/tenants/{id}/suspend`
- `reactivate(id)` → `PUT /api/platform/tenants/{id}/reactivate`
- `cancel(id)` → `PUT /api/platform/tenants/{id}/cancel`
- `checkSlug(slug)` → reuse `GET /api/public/register/check-slug?slug=` (already exists from Sprint 1D)

All use the platform Axios instance (from Sprint 1H Section 9.2).

---

## 6. Confirm Dialogs for Status Actions

All status change actions (suspend, reactivate, cancel) must use `<ConfirmDialog>` (from Sprint 1H):

**Suspend:**
- Title: "Suspend Tenant"
- Description: "This will immediately block all users in **{tenantName}** from logging in. Existing sessions will expire within 15 minutes. Are you sure?"
- Confirm label: "Suspend"
- Variant: destructive (amber)

**Reactivate:**
- Title: "Reactivate Tenant"
- Description: "This will restore access for all users in **{tenantName}**."
- Confirm label: "Reactivate"
- Variant: default (green)

**Cancel:**
- Title: "Cancel Tenant"
- Description: "This will permanently block access for **{tenantName}**. Data will be preserved but the organization will not be able to use the platform. This action should only be performed for terminated contracts."
- Confirm label: "Cancel Tenant"
- Variant: destructive (red)

---

## 7. Verification & Acceptance Criteria

### API Tests

**Test 1: Dashboard stats**
```
GET /api/platform/dashboard
Headers: Authorization: Bearer <platform_token>
→ 200: All 7 widgets populated with aggregate data
```

**Test 2: List tenants with filters**
```
GET /api/platform/tenants?status=active&tier=standard&search=acme&page=1&limit=10&sortBy=name&sortOrder=asc
→ 200: Filtered, sorted, paginated tenant list with meta

GET /api/platform/tenants
→ 200: All tenants, default sort (created_at desc), page 1
```

**Test 3: Create tenant**
```
POST /api/platform/tenants
Headers: Authorization: Bearer <platform_token>
Body: {
  "organizationName": "Beta Corp",
  "slug": "beta-corp",
  "subscriptionTier": "with_recruitment",
  "maxUsers": 25,
  "billingEmail": "billing@beta.com",
  "adminName": "Jane Admin",
  "adminEmail": "jane@beta.com"
}
→ 201: { tenant: { id, slug, ... }, adminCredentials: { email, temporaryPassword }, message: "..." }

Verify in DB:
  SELECT * FROM platform.tenants WHERE slug = 'beta-corp'; → status = 'active'
  SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_beta_corp'; → exists
  SET search_path TO "tenant_beta_corp";
  SELECT email, must_reset_password FROM users; → jane@beta.com, must_reset_password = true
```

**Test 4: Tenant detail**
```
GET /api/platform/tenants/<beta-corp-id>
→ 200: Full detail with usage stats, admin account, billing history, registration info
```

**Test 5: Update tenant**
```
PUT /api/platform/tenants/<beta-corp-id>
Body: { "maxUsers": 50, "subscriptionTier": "standard" }
→ 200: Updated tenant

PUT /api/platform/tenants/<beta-corp-id>
Body: { "maxUsers": 0 }
→ 400: "Cannot set max users below current user count"
```

**Test 6: Suspend**
```
PUT /api/platform/tenants/<beta-corp-id>/suspend
→ 200: "Tenant suspended"

POST /api/auth/login (as tenant user of beta-corp)
→ 403: "Your organization's account has been suspended..." (blocked by TenantMiddleware)
```

**Test 7: Reactivate**
```
PUT /api/platform/tenants/<beta-corp-id>/reactivate
→ 200: "Tenant reactivated"

POST /api/auth/login (as tenant user of beta-corp)
→ 200: Login succeeds again
```

**Test 8: Cancel**
```
PUT /api/platform/tenants/<beta-corp-id>/cancel
→ 200: "Tenant cancelled"

PUT /api/platform/tenants/<beta-corp-id>/reactivate
→ 400: "Only suspended tenants can be reactivated"

Verify: Schema still exists (data preserved), but login blocked.
```

**Test 9: Duplicate slug on create**
```
POST /api/platform/tenants
Body: { "slug": "beta-corp", ... }
→ 409: "Slug already taken"
```

### Frontend Tests

- [ ] Dashboard page loads with all 7 widget cards, data from API
- [ ] Dashboard widgets show skeleton loading state while fetching
- [ ] "View All" links on dashboard navigate to correct pages with pre-applied filters
- [ ] Tenant list shows paginated table with all columns
- [ ] Search input filters tenants by name/slug/email (debounced)
- [ ] Status/tier/source filters work correctly
- [ ] Sorting by column headers works
- [ ] URL query params update on filter/search/sort/page change
- [ ] Row click navigates to tenant detail page
- [ ] Actions dropdown shows context-appropriate options per tenant status
- [ ] Create tenant form: slug auto-generates, uniqueness check on blur
- [ ] Auto-generate password checkbox works, shows generated password
- [ ] Create success → shows confirmation with credentials
- [ ] Tenant detail page shows all 5 sections with correct data
- [ ] Edit tenant form pre-fills current values, validates max users ≥ current
- [ ] Suspend/Reactivate/Cancel dialogs show correct messaging
- [ ] After status change → UI updates immediately (optimistic or refetch)

### Full Checklist

- [ ] `GET /api/platform/dashboard` returns all 7 widget data sets
- [ ] Dashboard queries are efficient (aggregate queries, not per-tenant loops where possible)
- [ ] `GET /api/platform/tenants` supports search, filter, sort, pagination
- [ ] `GET /api/platform/tenants/:id` returns detail with usage, admin, billing, registration
- [ ] `POST /api/platform/tenants` creates tenant + provisions schema + sends welcome email
- [ ] Welcome email includes temporary password for super-admin-created tenants
- [ ] `PUT /api/platform/tenants/:id` updates name, tier, max_users, custom_domain
- [ ] Cannot set `maxUsers` below `currentUserCount`
- [ ] Custom domain uniqueness validated on update
- [ ] `PUT /api/platform/tenants/:id/suspend` sets status to suspended
- [ ] Suspended tenant → all tenant-level logins blocked immediately
- [ ] `PUT /api/platform/tenants/:id/reactivate` restores access (only from suspended)
- [ ] `PUT /api/platform/tenants/:id/cancel` soft-cancels (data preserved, access blocked)
- [ ] Cannot reactivate a cancelled tenant
- [ ] All 8 endpoints (1 dashboard + 7 tenant) in Swagger docs under "Platform" tags
- [ ] All endpoints protected by `PlatformAuthGuard`
- [ ] Frontend dashboard: 7 widgets with real data, loading states, responsive grid
- [ ] Frontend tenant list: full-featured data table with search/filter/sort/pagination
- [ ] Frontend create form: auto-slug, password generation, provisioning confirmation
- [ ] Frontend detail: 5 sections, status actions with confirm dialogs
- [ ] Frontend edit: pre-filled form, validation, success redirect

---

*Sprint 2A Complete. Next: Sprint 2B — Billing, Admin Management & Registration Requests*
