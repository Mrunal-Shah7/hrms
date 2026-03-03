# Sprint 2D — Subscription Enforcement & Navigation Polish

## Goal
Build the two subscription enforcement guards (`SubscriptionTierGuard` for recruitment route gating and `SeatLimitGuard` for employee creation), add a tenant admin dashboard widget showing subscription usage, and finalize all navigation polish items: sidebar permission rendering edge cases, header component completion, mobile responsiveness, and overall UI tightness. This is the final sprint of Sprint 2 and the last infrastructure sprint before module development begins.

---

## 1. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/common/guards/subscription-tier.guard.ts` | Guards recruitment routes — 403 if `standard` tier |
| `src/common/guards/seat-limit.guard.ts` | Guards employee creation — 400 if seat limit reached |
| `src/common/decorators/require-tier.decorator.ts` | `@RequireTier('with_recruitment')` metadata decorator |
| `src/common/decorators/check-seat-limit.decorator.ts` | `@CheckSeatLimit()` metadata decorator |
| `src/dashboard/tenant-dashboard.module.ts` | NestJS module |
| `src/dashboard/tenant-dashboard.controller.ts` | Tenant dashboard API |
| `src/dashboard/tenant-dashboard.service.ts` | Dashboard widget data queries |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/dashboard/page.tsx` | Tenant dashboard page (replace placeholder, partial — subscription widget + skeleton for future widgets) |
| `src/components/layout/subscription-banner.tsx` | Banner for subscription warnings (trial expiry, seat limit approaching) |
| `src/services/tenant-dashboard.ts` | Dashboard API helpers |

### Module Registration
- Both guards registered as providers in `AppModule` (available globally, applied per-route via decorators)
- `TenantDashboardModule` imported into `AppModule`

---

## 2. `SubscriptionTierGuard` + `@RequireTier()` Decorator

### 2.1 Purpose

Gates access to module routes based on the tenant's `subscription_tier`. The primary use case is Recruitment — all recruitment routes require `with_recruitment` tier. Tenants on `standard` tier receive a 403.

### 2.2 `@RequireTier()` Decorator

**Signature:**
```
@RequireTier(tier: string)
```

**Usage:**
```
@RequireTier('with_recruitment')
```

Uses `@SetMetadata()` from `@nestjs/common` to store the required tier under metadata key `REQUIRED_TIER`.

### 2.3 Guard Logic

**Execution order:** Runs AFTER `TenantAuthGuard` (needs `req.user`) and BEFORE `PermissionGuard`.

```
Guard chain: TenantAuthGuard → SubscriptionTierGuard → PermissionGuard
```

**Flow:**
1. Read `REQUIRED_TIER` metadata from handler via `Reflector`
2. If no metadata → allow (route has no tier requirement)
3. Get tenant's subscription tier:
   - Option A: Read from `req.user.tenantId` → query `platform.tenants` for `subscription_tier`
   - Option B (preferred for performance): Include `subscriptionTier` in the JWT payload (already added in Sprint 1H retroactive update to Sprint 1E)
4. If tenant tier matches or exceeds required tier → allow
5. If not → throw `ForbiddenException`:

```
{
  success: false,
  error: {
    code: "SUBSCRIPTION_REQUIRED",
    message: "This feature requires the 'Standard + Recruitment' subscription plan. Please contact your administrator to upgrade.",
    details: {
      requiredTier: "with_recruitment",
      currentTier: "standard"
    }
  }
}
```

HTTP status: `403 Forbidden`

### 2.4 JWT Payload Update

Sprint 1H already specified adding `tenant.subscriptionTier` to the login response and Zustand store. For the backend guard, also include `subscriptionTier` directly in the JWT access token payload to avoid a DB query on every recruitment request.

**Updated tenant JWT payload (retroactive Sprint 1E):**
```
{
  userId, tenantId, schemaName, roles, permissions,
  type: 'tenant', sessionId, subscriptionTier
}
```

This way the guard reads `req.user.subscriptionTier` directly — no DB call.

### 2.5 Application to Recruitment Routes

When the Recruitment module is built (Sprint 6C+), every controller in the recruitment module will apply:
```
@UseGuards(TenantAuthGuard, SubscriptionTierGuard, PermissionGuard)
@RequireTier('with_recruitment')
```

For now, the guard and decorator are created and tested but not yet applied to any controller (recruitment doesn't exist yet). Document the usage pattern for future sprints.

### 2.6 Tier Hierarchy

For v1, there are only two tiers with a simple check:
- `standard` — base tier
- `with_recruitment` — includes everything in standard + recruitment

If a route requires `with_recruitment` and the tenant has `standard` → blocked.
If a route requires `with_recruitment` and the tenant has `with_recruitment` → allowed.

No route currently requires just `standard` (all tenants have at least standard). The guard only activates when `@RequireTier()` is present.

---

## 3. `SeatLimitGuard` + `@CheckSeatLimit()` Decorator

### 3.1 Purpose

Prevents employee creation when the tenant has reached its `max_users` seat limit (PRD 25.2: "Employee creation fails if `current_user_count >= max_users`").

### 3.2 `@CheckSeatLimit()` Decorator

**Signature:**
```
@CheckSeatLimit()
```

No parameters. Uses `@SetMetadata()` to set a boolean flag `CHECK_SEAT_LIMIT = true`.

### 3.3 Guard Logic

**Execution order:** Runs AFTER `TenantAuthGuard`.

**Flow:**
1. Read `CHECK_SEAT_LIMIT` metadata from handler via `Reflector`
2. If not set → allow (route doesn't involve user creation)
3. Query `platform.tenants` for current tenant: `SELECT current_user_count, max_users FROM platform.tenants WHERE id = $1`
4. If `current_user_count >= max_users` → throw `ForbiddenException`:

```
{
  success: false,
  error: {
    code: "SEAT_LIMIT_REACHED",
    message: "Your organization has reached the maximum number of users ({maxUsers}). Please contact your administrator to increase the seat limit.",
    details: {
      currentUserCount: N,
      maxUsers: N
    }
  }
}
```

HTTP status: `403 Forbidden`

5. If under limit → allow

### 3.4 Application Points

Applied to these endpoints (when built in Sprint 3A):
- `POST /api/employees` — create employee (creates a user account)
- `POST /api/employees/import` — bulk CSV import (check before processing)

**Usage example:**
```
@Post()
@UseGuards(TenantAuthGuard, PermissionGuard, SeatLimitGuard)
@RequirePermission('employee_management', 'create', 'employees')
@CheckSeatLimit()
async createEmployee(@Body() dto: CreateEmployeeDto) { ... }
```

### 3.5 `current_user_count` Maintenance

The `platform.tenants.current_user_count` column must stay in sync with actual user count. This requires:

**Increment on employee creation:**
After successfully creating a user in the tenant schema, increment:
```sql
UPDATE platform.tenants SET current_user_count = current_user_count + 1 WHERE id = $1
```

**Decrement on employee archival/deletion:**
After soft-deleting (archiving) a user:
```sql
UPDATE platform.tenants SET current_user_count = current_user_count - 1 WHERE id = $1
```

**Recount safety net:**
Add a utility method `recountUsers(tenantId)` on `PlatformTenantsService`:
```sql
UPDATE platform.tenants
SET current_user_count = (
  SELECT COUNT(*) FROM "{schemaName}".users WHERE status != 'archived'
)
WHERE id = $1
```

This can be called manually by super admins or run as a periodic cron job (daily) to fix any drift. Register as a cron in `TaskScheduleModule`:
- Schedule: daily at 2:00 AM
- Iterates all non-cancelled tenants, runs recount for each

### 3.6 Bulk Import Handling

For CSV import (Sprint 3D), the seat limit check needs to be smarter:
1. Before processing the import, count rows in the CSV
2. Check if `current_user_count + csvRowCount > max_users`
3. If so → reject the entire import with: `"Import would exceed seat limit. You have {available} seats remaining but the file contains {csvRowCount} employees."`

This pre-flight check is in the import service logic (Sprint 3D), not in the guard. The guard handles the single-employee creation case. The `@CheckSeatLimit()` decorator on the import endpoint triggers the basic guard check (are we already at/over limit?), and the service does the count-aware check.

---

## 4. Tenant Dashboard API

### 4.1 `GET /api/dashboard` — Tenant Dashboard Data

**Auth:** `TenantAuthGuard` (any authenticated user)

The dashboard shows different widgets based on the user's role. For this sprint, we build the subscription/usage widget (visible to Admin only) and define the framework for role-based widget visibility. Other widgets (leave summary, attendance, tasks, etc.) will be added by their respective module sprints.

**Service Logic:**

**For all users:**
- Quick stats: these will be populated by module sprints. For now return empty/zero placeholders.

**For Admin role only — Subscription Widget:**
```sql
SELECT current_user_count, max_users, subscription_tier, status, trial_ends_at
FROM platform.tenants WHERE id = $1
```

**Response:**
```
{
  success: true,
  data: {
    subscription: {                          // null if user is not Admin
      tier: "with_recruitment",
      currentUserCount: 8,
      maxUsers: 25,
      utilizationPercent: 32,
      status: "active",
      trialEndsAt: null | "2026-03-15T00:00:00Z",
      warnings: [                            // array of warning objects
        { type: "trial_expiring", message: "Trial expires in 5 days", severity: "warning" },
        { type: "seat_limit_approaching", message: "80% of user seats used", severity: "info" }
      ]
    },
    quickStats: {                            // placeholder for future module data
      totalEmployees: null,                  // populated by Sprint 3A
      pendingLeaveRequests: null,            // populated by Sprint 4A
      activeGoals: null,                     // populated by Sprint 5B
      openJobOpenings: null                  // populated by Sprint 6C
    }
  }
}
```

**Warning logic:**
Generate warnings array based on conditions:

| Condition | Type | Severity | Message |
|---|---|---|---|
| `status === 'trial'` AND `trial_ends_at` within 7 days | `trial_expiring` | `warning` | "Your trial expires in {N} days. Contact your administrator to activate your subscription." |
| `status === 'trial'` AND `trial_ends_at` within 2 days | `trial_expiring` | `critical` | "Your trial expires tomorrow! Contact your administrator immediately." |
| `current_user_count / max_users >= 0.8` | `seat_limit_approaching` | `info` | "{percent}% of user seats used ({current}/{max})" |
| `current_user_count >= max_users` | `seat_limit_reached` | `critical` | "User seat limit reached. No new employees can be added." |

---

## 5. Frontend: Tenant Dashboard (Partial)

### 5.1 Page: `/dashboard`

Replace the placeholder page from Sprint 1H with a real dashboard page. For this sprint, only the subscription widget and quick stat cards are built. Other widgets (charts, lists) will be added by their module sprints.

**Layout:** Grid — 4-column stat cards at top, then wider widget cards below.

**Top Row: Quick Stat Cards (4 columns)**

| Card | Icon | Value | Label | Color |
|---|---|---|---|---|
| Total Employees | `Users` | `{totalEmployees}` or "—" | "Employees" | brand |
| Pending Leave | `Calendar` | `{pendingLeaveRequests}` or "—" | "Pending Leaves" | amber |
| Active Goals | `Target` | `{activeGoals}` or "—" | "Active Goals" | green |
| Open Positions | `Briefcase` | `{openJobOpenings}` or "—" | "Open Positions" | blue |

Values show "—" until the respective module populates them. Cards are always visible (even with "—") so the dashboard layout is consistent.

**Subscription Widget (Admin only):**

Visible only if `subscription` is non-null in the API response (i.e., user is Admin).

**Card content:**
- Title: "Subscription & Usage"
- Plan badge: "Standard" or "Standard + Recruitment"
- Seat usage: progress bar with `{currentUserCount} / {maxUsers} seats used`
  - Bar color: green (<60%), amber (60-79%), red (≥80%)
- Status badge: active (green), trial (blue), suspended (amber)
- Trial countdown: if trial → "Trial expires in {N} days" with urgency color

**Warning Banners:**
If `warnings` array has entries with `severity === 'critical'`:
- Show a dismissible banner at the top of the dashboard (above the stat cards)
- Banner: amber/red background with warning icon + message + action link
- Trial expiring → "Upgrade Now" link (navigates nowhere for v1, shows "Contact your platform administrator")
- Seat limit → "Manage Users" link → `/employees`

### 5.2 API Helper

**File:** `src/services/tenant-dashboard.ts`

Export:
- `getDashboardData()` → `GET /api/dashboard`

---

## 6. Frontend: `<SubscriptionBanner>` Component

### 6.1 Purpose

A persistent banner that appears at the very top of the tenant shell (above the header) when critical subscription warnings exist. This ensures warnings are visible on every page, not just the dashboard.

### 6.2 File

`src/components/layout/subscription-banner.tsx`

### 6.3 Behavior

1. On tenant app mount (in the `(tenant)` layout), fetch `GET /api/dashboard` (or a lightweight `GET /api/subscription/status` — see Section 6.4)
2. If there are `critical` severity warnings → render banner
3. Banner is dismissible per session (uses React state — dismissed state resets on page reload)
4. Banner content varies by warning type (same messages as dashboard widget)

### 6.4 Lightweight Subscription Status Endpoint

To avoid fetching the full dashboard just for the banner, add a lightweight endpoint:

**`GET /api/subscription/status`**

**Auth:** `TenantAuthGuard` (Admin only — non-admins get empty response)

**Response:**
```
{
  success: true,
  data: {
    tier, currentUserCount, maxUsers, status, trialEndsAt,
    warnings: [ ... ]   // same warning logic
  }
}
```

This is a subset of the dashboard API. It can be called from the tenant layout on mount. Cache with React Query (stale time: 5 minutes).

Add to `TenantDashboardController` or create a small `SubscriptionController`.

---

## 7. Navigation Polish

### 7.1 Sidebar Final Polish

**Items verified against Sprint 1H spec + permission checks:**

| Issue | Fix |
|---|---|
| Recruitment item should also check `subscriptionTier` from auth store | Verify: Sprint 1H Section 4.4 already specifies this. Ensure the check reads from `useAuthStore().tenant.subscriptionTier`. |
| "More" section hidden when both sub-items invisible | Verify: Sprint 1H Section 4.3 already specifies this. Ensure implementation. |
| Sidebar active state for nested routes | If on `/employees/departments` → "Employee Mgmt" sidebar item should be active. Use `pathname.startsWith(route)` matching. |
| Sidebar active state for account routes | If on `/account/*` → highlight the profile avatar in the header (no sidebar item for account) |
| Sidebar scroll on overflow | If sidebar has more items than viewport height → add vertical scroll with hidden scrollbar |

### 7.2 Header Final Polish

| Issue | Fix |
|---|---|
| Quick-create `[+]` button items permission-gated | Each item checks `usePermission()`. If user has no create permissions at all → hide the `[+]` button entirely. |
| Search `Cmd+K` shortcut | Add keyboard listener for `Cmd+K` (Mac) / `Ctrl+K` (Windows) to open the search command palette. Prevent default browser behavior. |
| Notification bell badge count format | If unread > 99 → show "99+" |
| Settings gear visibility | Only show if user has ANY `settings:*:*` permission. Use `useHasAnyPermission()` with a broad check. |
| Profile dropdown: show roles | Below user name/email, show role badges (e.g., "Admin", "HR Manager") |
| Profile dropdown: "External" badge | If `user.emailDomainType === 'external'` → show orange "External" badge next to name throughout: header avatar tooltip, profile dropdown, anywhere the user's name appears. |

### 7.3 Mobile Responsiveness Polish

| Component | Mobile Behavior |
|---|---|
| Sidebar | Hidden by default. Hamburger icon in header. Slide-over drawer from left on click. Backdrop overlay. Close on route change. Close on backdrop click. |
| Header | All items remain. `[+]` and search may collapse into a single "⋯" menu on very small screens (<380px). Notification bell and avatar always visible. |
| Dashboard cards | Stack vertically. Stat cards: 2-column on tablet, 1-column on mobile. |
| Data tables (Sprint 1H shared components) | Horizontal scroll with sticky first column. Reduce visible columns on mobile (show name + status + actions). Pagination at bottom, simplified (just prev/next, no page numbers). |
| Account sidebar | On mobile: horizontal scrollable tab bar at top instead of vertical sidebar. Each tab is an account page. |
| Confirm dialogs | Full-width on mobile (no side padding). |
| Forms | Full-width inputs. Stack horizontal field groups vertically. |

### 7.4 Loading States Polish

Ensure consistent loading patterns across all pages built so far:

| Pattern | Implementation |
|---|---|
| Page load | Full page skeleton (not spinner) matching the layout of the actual content |
| Data table loading | Skeleton rows (5 rows) with shimmer animation |
| Button action (submit, save) | Button shows loading spinner, disabled during action |
| Navigation | Sidebar item shows subtle loading indicator during route transition (Next.js built-in) |
| Error state | Inline error message with retry button. No full-page error screens (except 404). |

### 7.5 Empty States Polish

Verify all placeholder pages (Sprint 1H) have proper empty states:
- Centered icon (from lucide-react, relevant to the module)
- Title: module name
- Description: "This module will be available soon." or "No data yet."
- For modules behind subscription tier: "This feature requires the Standard + Recruitment plan."

---

## 8. `external_user` Badge Logic

### 8.1 Backend

The `email_domain_type` field on `users` is already set during employee creation (Sprint 3A will implement the detection logic). The value is already included in the JWT payload and login response.

### 8.2 Frontend Component

Create a small reusable badge component:

**File:** `src/components/shared/external-badge.tsx`

**Props:** `emailDomainType: 'company' | 'external'`

**Render:** If `external` → orange badge with "External" text (small, inline). If `company` → render nothing.

**Usage points (for future sprints):**
- Employee list table (name column)
- Employee detail header
- Profile dropdown in header (if current user is external)
- Any user mention/avatar component

For this sprint, create the component and apply it to the header profile dropdown only (if current user is external). Other application points will be added as those modules are built.

---

## 9. Scope Boundaries

### In Scope (Sprint 2D)
- `SubscriptionTierGuard` + `@RequireTier()` decorator
- `SeatLimitGuard` + `@CheckSeatLimit()` decorator
- `current_user_count` increment/decrement pattern documented (applied in Sprint 3A)
- User recount cron job (daily safety net)
- `GET /api/dashboard` — tenant dashboard with subscription widget + quick stat placeholders
- `GET /api/subscription/status` — lightweight status for banner
- Subscription warning banner component (persistent, dismissible per session)
- Tenant dashboard page (subscription widget, quick stat cards with placeholders)
- Sidebar navigation final polish (active states, overflow scroll, nested route matching)
- Header final polish (quick-create permissions, search shortcut, notification count format, role badges, external badge)
- Mobile responsiveness for all existing pages
- Loading/empty state consistency
- `<ExternalBadge>` component
- Retroactive: `subscriptionTier` in JWT access token payload

### Out of Scope
| Feature | Sprint |
|---|---|
| Applying `@RequireTier()` to recruitment controllers | 6C (when recruitment is built) |
| Applying `@CheckSeatLimit()` to employee creation | 3A (when employee CRUD is built) |
| Dashboard module-specific widgets (leave, attendance, goals) | Each module sprint |
| Global search API integration | Per-module |
| Quick-create form modals | Per-module |

---

## 10. Verification & Acceptance Criteria

### Guard Tests

**Test 1: SubscriptionTierGuard blocks standard tier**
```
# Create a test route with @RequireTier('with_recruitment')
# Login as user from a tenant with subscription_tier = 'standard'
GET /api/test-recruitment-route
→ 403: { code: "SUBSCRIPTION_REQUIRED", message: "This feature requires the 'Standard + Recruitment' subscription plan..." }
```

**Test 2: SubscriptionTierGuard allows correct tier**
```
# Login as user from a tenant with subscription_tier = 'with_recruitment'
GET /api/test-recruitment-route
→ 200: Allowed
```

**Test 3: SubscriptionTierGuard passes when no decorator**
```
# Route without @RequireTier()
GET /api/roles
→ 200: Works normally regardless of tier
```

**Test 4: SeatLimitGuard blocks at limit**
```
# Set tenant max_users = 5, current_user_count = 5
# Route with @CheckSeatLimit()
POST /api/test-create-user
→ 403: { code: "SEAT_LIMIT_REACHED", message: "...maximum number of users (5)..." }
```

**Test 5: SeatLimitGuard allows under limit**
```
# Set tenant max_users = 5, current_user_count = 3
POST /api/test-create-user
→ Allowed (guard passes)
```

**Test 6: User count recount cron**
```
# Manually set current_user_count to incorrect value
UPDATE platform.tenants SET current_user_count = 99 WHERE slug = 'acme-corp';

# Trigger recount (manually or wait for cron)
→ Verify: current_user_count now matches actual user count in tenant schema
```

### Dashboard Tests

**Test 7: Dashboard API — Admin user**
```
GET /api/dashboard
Headers: Authorization: Bearer <admin_token>
→ 200: {
  subscription: { tier, currentUserCount, maxUsers, warnings: [...], ... },
  quickStats: { totalEmployees: null, ... }
}
```

**Test 8: Dashboard API — Employee user**
```
GET /api/dashboard
Headers: Authorization: Bearer <employee_token>
→ 200: { subscription: null, quickStats: { ... } }
```

**Test 9: Subscription status**
```
GET /api/subscription/status
Headers: Authorization: Bearer <admin_token>
→ 200: { tier, currentUserCount, maxUsers, warnings: [...] }

GET /api/subscription/status
Headers: Authorization: Bearer <employee_token>
→ 200: { } (empty — non-admin)
```

**Test 10: Warning generation**
```
# Tenant with trial_ends_at = NOW() + 3 days
GET /api/subscription/status
→ warnings includes { type: "trial_expiring", severity: "warning" }

# Tenant with current_user_count = 9, max_users = 10
GET /api/subscription/status
→ warnings includes { type: "seat_limit_approaching", severity: "info" }

# Tenant with current_user_count = 10, max_users = 10
GET /api/subscription/status
→ warnings includes { type: "seat_limit_reached", severity: "critical" }
```

### Frontend Tests

- [ ] Dashboard page: 4 quick stat cards visible (values show "—" for unpopulated modules)
- [ ] Dashboard page: subscription widget visible only for Admin
- [ ] Subscription widget: progress bar color changes at 60%/80% thresholds
- [ ] Subscription widget: trial countdown shows when applicable
- [ ] Warning banner: appears at top of all pages when critical warning exists
- [ ] Warning banner: dismissible per session, reappears on reload
- [ ] Sidebar: active state correct for nested routes (`/employees/departments` → Employee Mgmt active)
- [ ] Sidebar: "More" section hidden when both sub-items invisible
- [ ] Sidebar: Recruitment hidden when tier is `standard` (even if user has permission)
- [ ] Sidebar: vertical scroll when items overflow viewport
- [ ] Header: `[+]` button hidden if no create permissions
- [ ] Header: `Cmd+K` / `Ctrl+K` opens search palette
- [ ] Header: notification badge shows "99+" when count > 99
- [ ] Header: settings gear hidden for non-settings users
- [ ] Header: profile dropdown shows role badges
- [ ] Header: external badge shows if user is external
- [ ] Mobile: sidebar becomes slide-over drawer with backdrop
- [ ] Mobile: close drawer on route change and backdrop click
- [ ] Mobile: data tables horizontally scrollable with sticky first column
- [ ] Mobile: account sidebar becomes horizontal tab bar
- [ ] Mobile: forms stack fields vertically
- [ ] All placeholder pages have proper empty state with icon + message
- [ ] Subscription-gated empty states show "requires Standard + Recruitment plan"
- [ ] Loading states: skeleton patterns on all data pages (not spinners)
- [ ] Error states: inline with retry button, no full-page crashes

### Full Checklist

**Backend Guards:**
- [ ] `@RequireTier()` decorator stores required tier in metadata
- [ ] `SubscriptionTierGuard` reads metadata, checks `req.user.subscriptionTier`, returns 403 with `SUBSCRIPTION_REQUIRED`
- [ ] `@CheckSeatLimit()` decorator stores boolean flag in metadata
- [ ] `SeatLimitGuard` queries `platform.tenants`, checks `current_user_count >= max_users`, returns 403 with `SEAT_LIMIT_REACHED`
- [ ] Guard execution order documented: `TenantAuthGuard → SubscriptionTierGuard → PermissionGuard` (and `SeatLimitGuard` as additional)
- [ ] `current_user_count` increment/decrement pattern documented for Sprint 3A
- [ ] User recount cron job runs daily at 2 AM for all non-cancelled tenants
- [ ] `subscriptionTier` added to tenant JWT access token payload (retroactive Sprint 1E)

**Dashboard:**
- [ ] `GET /api/dashboard` returns subscription widget (Admin) + quick stat placeholders
- [ ] `GET /api/subscription/status` returns lightweight status for banner
- [ ] Warning logic generates correct warnings for trial expiry / seat approaching / seat reached
- [ ] Dashboard page: 4 stat cards + subscription widget (Admin only)
- [ ] `<SubscriptionBanner>` shows on all pages when critical warnings exist

**Navigation Polish:**
- [ ] Sidebar: nested route active state matching (`pathname.startsWith`)
- [ ] Sidebar: overflow scroll, "More" collapse, Recruitment tier+permission gate
- [ ] Header: `[+]` permission-gated, search shortcut, "99+" badge, role badges, external badge
- [ ] `<ExternalBadge>` component created, applied to header profile dropdown
- [ ] Mobile: sidebar drawer, table scroll, account tab bar, form stacking
- [ ] Loading: skeleton patterns on all existing pages
- [ ] Empty: proper empty states with icons and messages on all placeholder pages

---

*Sprint 2D Complete. Sprint 2 — Super Admin Portal & Account Management is now fully specified.*

*Next: Sprint 3A — Employee CRUD & List Page*
