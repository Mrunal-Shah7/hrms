# Sprint 4A — Leave Configuration & Balance Engine

## Goal
Build the complete leave administration backend: Leave Types CRUD (the types of leave available in the organization), Leave Policies CRUD (allocation rules per designation/department/employment type), Holidays CRUD (organization-wide holiday calendar), the Leave Balance Initialization Engine (how employee balances are generated from policies, including year-start allocation, mid-year prorating, and carry-forward), and Holiday CSV import. This sprint creates all the admin-facing configuration that Sprint 4B's request/approval workflow depends on. By the end, admins can configure leave types, define per-segment allocation policies, manage holidays, and the system can generate per-employee leave balances for any year.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `leave_types` table (id, name, code, color, icon, is_paid, max_consecutive_days, created_at, updated_at) | 1A / 1B | ✅ |
| `leave_policies` table (id, leave_type_id, designation_id, department_id, employment_type, annual_allocation, carry_forward, max_carry_forward, accrual_type, created_at, updated_at) | 1A / 1B | ✅ |
| `leave_balances` table (id, user_id, leave_type_id, year, total_allocated, carried_forward, used; UNIQUE user_id+leave_type_id+year) | 1A / 1B | ✅ |
| `leave_requests` table (full schema) | 1A / 1B | ✅ (used in Sprint 4B) |
| `holidays` table (id, name, date, is_optional, year, created_at) | 1A / 1B | ✅ |
| Default leave types seeded during provisioning: CL, EL, LWP, PL, SL, SKL (6 types) | 1B | ✅ |
| Seeded permissions: `leave:*:leave_types` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `leave:*:leave_policies` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `leave:*:holidays` (view, create, edit, delete) | 1B | ✅ |
| `organization_settings.financial_year_start_month` (default: 1 = January) | 1B / 2C | ✅ |
| Admin/HR Admin roles: full CRUD on leave_types, leave_policies, holidays | 1B | ✅ |
| HR Manager role: full CRUD on leave_types, leave_policies, holidays | 1B | ✅ |
| Manager/Employee roles: view-only on leave_types, holidays | 1B | ✅ |
| `/leave` placeholder page in sidebar navigation | 1H | ✅ |
| `ExportService` (CSV, XLSX, PDF) | 1G | ✅ |
| `AuditInterceptor` + `@AuditAction()` | 1G | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/leave/leave.module.ts` | NestJS module for the entire leave module |
| `src/leave/types/leave-types.controller.ts` | Leave types CRUD |
| `src/leave/types/leave-types.service.ts` | Leave types business logic |
| `src/leave/types/dto/create-leave-type.dto.ts` | Create DTO |
| `src/leave/types/dto/update-leave-type.dto.ts` | Update DTO |
| `src/leave/types/dto/index.ts` | Barrel |
| `src/leave/policies/leave-policies.controller.ts` | Leave policies CRUD |
| `src/leave/policies/leave-policies.service.ts` | Policies business logic + balance generation |
| `src/leave/policies/dto/create-leave-policy.dto.ts` | Create DTO |
| `src/leave/policies/dto/update-leave-policy.dto.ts` | Update DTO |
| `src/leave/policies/dto/index.ts` | Barrel |
| `src/leave/holidays/holidays.controller.ts` | Holidays CRUD + import |
| `src/leave/holidays/holidays.service.ts` | Holidays business logic |
| `src/leave/holidays/dto/create-holiday.dto.ts` | Create DTO |
| `src/leave/holidays/dto/update-holiday.dto.ts` | Update DTO |
| `src/leave/holidays/dto/index.ts` | Barrel |
| `src/leave/balances/balance-engine.service.ts` | Balance initialization, accrual, carry-forward logic |
| `src/leave/balances/balance-engine.controller.ts` | Admin trigger for balance generation |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/leave/layout.tsx` | Leave module top-level tab layout |
| `src/app/(tenant)/leave/page.tsx` | Redirect to /leave/summary (Sprint 4B) |
| `src/app/(tenant)/leave/admin/types/page.tsx` | Leave types config page |
| `src/app/(tenant)/leave/admin/policies/page.tsx` | Leave policies config page |
| `src/app/(tenant)/leave/admin/holidays/page.tsx` | Holidays config page |
| `src/app/(tenant)/leave/admin/balances/page.tsx` | Balance generation admin page |
| `src/components/modules/leave/leave-type-form-drawer.tsx` | Leave type create/edit drawer |
| `src/components/modules/leave/leave-policy-form-drawer.tsx` | Leave policy create/edit drawer |
| `src/components/modules/leave/holiday-form-drawer.tsx` | Holiday create/edit drawer |
| `src/components/modules/leave/holiday-import-dialog.tsx` | Holiday CSV import dialog |
| `src/components/modules/leave/balance-generation-dialog.tsx` | Balance generation wizard |
| `src/services/leave-types.ts` | Leave types API helpers |
| `src/services/leave-policies.ts` | Leave policies API helpers |
| `src/services/holidays.ts` | Holidays API helpers |
| `src/services/leave-balances.ts` | Balance engine API helpers |

### Module Registration
- Import `LeaveModule` into `AppModule`

---

## 3. Leave Module Layout

### 3.1 Top-Level Tabs

The leave module uses a dual navigation pattern:

**Top bar (primary):** My Data | Team | Holidays

**Sub-tabs under My Data:** Leave Summary | Leave Balance | Leave Requests

Reference: `Leave_summary.png` — shows both tab levels.

**Note:** The screenshot also shows a "Shift" sub-tab — this maps to the Work Schedule feature in the Attendance module (Sprint 5A). Add it as a placeholder tab now.

### 3.2 Admin Configuration Pages

Admin configuration pages live at `/leave/admin/*` and are accessible via the Settings tile ("Leave Tracker" tile on the settings page, Sprint 8B) or via an "Admin Settings" gear icon in the leave module header visible only to Admin/HR Admin roles.

| Route | Page | Permission |
|---|---|---|
| `/leave/admin/types` | Leave Types config | `leave:view:leave_types` |
| `/leave/admin/policies` | Leave Policies config | `leave:view:leave_policies` |
| `/leave/admin/holidays` | Holidays config | `leave:view:holidays` |
| `/leave/admin/balances` | Balance Generation | `leave:create:leave_policies` (reuse — only admin can generate) |

### 3.3 Layout File

`src/app/(tenant)/leave/layout.tsx`:

**Top tab bar:** My Data | Team | Holidays | (gear icon → admin panel dropdown)

Admin dropdown (visible to users with any `leave:create:*` or `leave:edit:*` permission):
- Leave Types → `/leave/admin/types`
- Leave Policies → `/leave/admin/policies`
- Holidays → `/leave/admin/holidays`
- Balance Management → `/leave/admin/balances`

**Placeholder pages for Sprint 4B:**
- `/leave/summary` → `<EmptyState>` "Leave summary will be available soon."
- `/leave/balance` → `<EmptyState>`
- `/leave/requests` → `<EmptyState>`
- `/leave/team` → `<EmptyState>`

---

## 4. Financial Year Awareness

The leave system is **financial-year-aware**. The `financial_year_start_month` field in `organization_settings` determines when the leave year begins.

**Examples:**
- `financial_year_start_month = 1` → leave year: Jan 1 – Dec 31
- `financial_year_start_month = 4` → leave year: Apr 1 – Mar 31 (next year)

### 4.1 Year Calculation Utility

Create a shared utility `src/leave/utils/leave-year.util.ts` with:

**`getLeaveYear(date: Date, financialYearStartMonth: number): number`**
Returns the "leave year" integer for a given date. The leave year is identified by the calendar year of its start date.

Example: if `financialYearStartMonth = 4` (April):
- Date: Feb 15, 2026 → Leave year: 2025 (because Apr 2025 – Mar 2026)
- Date: Jun 1, 2026 → Leave year: 2026 (because Apr 2026 – Mar 2027)

**`getLeaveYearRange(year: number, financialYearStartMonth: number): { startDate: Date, endDate: Date }`**
Returns the start and end dates of a leave year.

Example: `getLeaveYearRange(2026, 4)` → `{ startDate: 2026-04-01, endDate: 2027-03-31 }`

**`getLeaveYearLabel(year: number, financialYearStartMonth: number): string`**
Returns a display label like "Apr 2026 – Mar 2027" or "Jan 2026 – Dec 2026".

These utilities are used across all leave APIs and the balance engine.

---

## 5. Leave Types API Specification

Leave types define the categories of leave (Casual Leave, Sick Leave, etc.). They are org-wide — every employee sees the same types, but allocation amounts come from policies.

Controller prefix: `leave/types`.

### 5.1 `GET /api/leave/types` — List Leave Types

**Permission:** `@RequirePermission('leave', 'view', 'leave_types')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 25 | |
| `search` | string | — | Search name or code (ILIKE) |
| `sortBy` | string | `name` | |
| `sortOrder` | string | `asc` | |

**Service Logic:**
```
SELECT lt.id, lt.name, lt.code, lt.color, lt.icon, lt.is_paid,
       lt.max_consecutive_days, lt.created_at, lt.updated_at,
       (SELECT COUNT(*) FROM leave_policies lp WHERE lp.leave_type_id = lt.id) AS policy_count
FROM leave_types lt
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, code, color, icon, isPaid,
      maxConsecutiveDays: number | null,
      policyCount: number,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 5.2 `POST /api/leave/types` — Create Leave Type

**Permission:** `@RequirePermission('leave', 'create', 'leave_types')`
**Audit:** `@AuditAction('create', 'leave', 'leave_types')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `code` | string | `@IsNotEmpty()`, `@MaxLength(20)`, regex `^[A-Z0-9_]+$` | Yes |
| `color` | string | `@IsOptional()`, regex `^#[0-9A-Fa-f]{6}$` | No |
| `icon` | string | `@IsOptional()`, `@MaxLength(50)` | No |
| `isPaid` | boolean | `@IsBoolean()` | Yes |
| `maxConsecutiveDays` | number | `@IsOptional()`, `@IsInt()`, `@Min(1)` | No |

**Service Logic:**
1. Validate code uniqueness: `SELECT id FROM leave_types WHERE code = $code` → `409`
2. Validate name uniqueness: `SELECT id FROM leave_types WHERE name = $name` → `409`
3. Insert into `leave_types`
4. Return created leave type

---

### 5.3 `GET /api/leave/types/:id` — Leave Type Detail

**Permission:** `@RequirePermission('leave', 'view', 'leave_types')`

Returns leave type fields + associated policies count + total employees covered (via policies).

---

### 5.4 `PUT /api/leave/types/:id` — Update Leave Type

**Permission:** `@RequirePermission('leave', 'edit', 'leave_types')`
**Audit:** `@AuditAction('update', 'leave', 'leave_types')`

Same fields as create, all optional. Code/name uniqueness checks (exclude self). Cannot change `code` if leave requests exist for this type (the code is used in exports and reports).

---

### 5.5 `DELETE /api/leave/types/:id` — Delete Leave Type

**Permission:** `@RequirePermission('leave', 'delete', 'leave_types')`
**Audit:** `@AuditAction('delete', 'leave', 'leave_types')`

**Service Logic:**
1. Check for existing leave requests: `SELECT COUNT(*) FROM leave_requests WHERE leave_type_id = $id`. If > 0 → `400 "Cannot delete leave type with existing requests. Archive it instead by removing its policies."`
2. Delete cascades to `leave_policies` and `leave_balances` for this type
3. Return `{ message: "Leave type deleted" }`

---

### 5.6 `GET /api/leave/types/export` — Export Leave Types

**Permission:** `@RequirePermission('leave', 'view', 'leave_types')`
**Rate Limit:** 5 req/min/user

**Export Columns:** Name, Code, Paid/Unpaid, Max Consecutive Days, Policy Count
**Formats:** CSV, XLSX

---

## 6. Leave Policies API Specification

A leave policy defines how many days of a specific leave type are allocated per year, and to which employee segment. Policies can target employees by designation, department, employment type, or any combination. A policy with all three scope fields null is a **default policy** — it applies to everyone not matched by a more specific policy.

Controller prefix: `leave/policies`.

### 6.1 Policy Matching Rules

When the balance engine computes an employee's allocation, it needs to find the most specific policy for each leave type. The matching priority (most specific wins):

1. **Exact match:** policy matches all three of the employee's designation + department + employment type
2. **Two-field match:** policy matches two of the three fields (and the third is null)
3. **Single-field match:** policy matches one field (and the other two are null)
4. **Default:** all three scope fields are null

If multiple policies tie at the same specificity level → use the one with the highest `annual_allocation` (employee-favorable).

If no policy exists for a leave type for a given employee → that employee gets 0 allocation for that type (the leave type still appears in their summary with 0 available).

**Special case — LWP (Leave Without Pay):** LWP has no allocation cap. The balance engine always sets `total_allocated = 0` for LWP. Employees can still apply for LWP with no balance check (Sprint 4B will handle this).

### 6.2 `GET /api/leave/policies` — List Leave Policies

**Permission:** `@RequirePermission('leave', 'view', 'leave_policies')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 25 | |
| `leaveTypeId` | UUID | — | Filter by leave type |
| `departmentId` | UUID | — | Filter by department |
| `designationId` | UUID | — | Filter by designation |
| `employmentType` | string | — | Filter by employment type |
| `sortBy` | string | `createdAt` | |
| `sortOrder` | string | `desc` | |

**Service Logic:**
```
SELECT lp.id, lp.leave_type_id, lp.designation_id, lp.department_id,
       lp.employment_type, lp.annual_allocation, lp.carry_forward,
       lp.max_carry_forward, lp.accrual_type, lp.created_at, lp.updated_at,
       lt.name AS leave_type_name, lt.code AS leave_type_code, lt.color AS leave_type_color,
       des.name AS designation_name,
       dept.name AS department_name
FROM leave_policies lp
JOIN leave_types lt ON lp.leave_type_id = lt.id
LEFT JOIN designations des ON lp.designation_id = des.id
LEFT JOIN departments dept ON lp.department_id = dept.id
```

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      leaveType: { id, name, code, color },
      designation: { id, name } | null,
      department: { id, name } | null,
      employmentType: string | null,
      annualAllocation: number,
      carryForward: boolean,
      maxCarryForward: number | null,
      accrualType: "annual" | "monthly" | "quarterly",
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 6.3 `POST /api/leave/policies` — Create Leave Policy

**Permission:** `@RequirePermission('leave', 'create', 'leave_policies')`
**Audit:** `@AuditAction('create', 'leave', 'leave_policies')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `leaveTypeId` | UUID | `@IsUUID()` | Yes |
| `designationId` | UUID | `@IsOptional()`, `@IsUUID()` | No |
| `departmentId` | UUID | `@IsOptional()`, `@IsUUID()` | No |
| `employmentType` | string | `@IsOptional()`, `@IsIn(['permanent', 'contract', 'intern', 'freelance'])` | No |
| `annualAllocation` | number | `@IsNumber()`, `@Min(0)`, `@Max(365)` | Yes |
| `carryForward` | boolean | `@IsBoolean()` | Yes |
| `maxCarryForward` | number | `@IsOptional()`, `@IsNumber()`, `@Min(0)`. Required if `carryForward` is `true`. | Conditional |
| `accrualType` | string | `@IsIn(['annual', 'monthly', 'quarterly'])` | Yes |

**Accrual Types:**
| Type | Description | Behavior |
|---|---|---|
| `annual` | Full allocation granted on the first day of the leave year | `total_allocated = annualAllocation` immediately |
| `monthly` | Allocation accrues monthly (annual ÷ 12 per month) | `total_allocated` increments each month |
| `quarterly` | Allocation accrues quarterly (annual ÷ 4 per quarter) | `total_allocated` increments each quarter |

**Service Logic:**
1. Validate `leaveTypeId` exists
2. If `designationId` provided → validate exists
3. If `departmentId` provided → validate exists
4. Check for duplicate policy: same leave_type_id + designation_id + department_id + employment_type combination (including nulls):
   ```
   SELECT id FROM leave_policies
   WHERE leave_type_id = $1
     AND (designation_id = $2 OR ($2 IS NULL AND designation_id IS NULL))
     AND (department_id = $3 OR ($3 IS NULL AND department_id IS NULL))
     AND (employment_type = $4 OR ($4 IS NULL AND employment_type IS NULL))
   ```
   If found → `409 "A policy with this exact scope already exists for this leave type"`
5. If `carryForward` is true and `maxCarryForward` not provided → `400 "Maximum carry forward days required when carry forward is enabled"`
6. Insert into `leave_policies`
7. Return created policy

---

### 6.4 `GET /api/leave/policies/:id` — Policy Detail

**Permission:** `@RequirePermission('leave', 'view', 'leave_policies')`

Returns policy fields plus a computed "affected employee count" — how many active employees match this policy's scope conditions.

---

### 6.5 `PUT /api/leave/policies/:id` — Update Policy

**Permission:** `@RequirePermission('leave', 'edit', 'leave_policies')`
**Audit:** `@AuditAction('update', 'leave', 'leave_policies')`

Same fields as create, all optional. Duplicate scope check (exclude self). Changing a policy does NOT retroactively update existing leave balances — admin must trigger balance regeneration manually (Section 9).

---

### 6.6 `DELETE /api/leave/policies/:id` — Delete Policy

**Permission:** `@RequirePermission('leave', 'delete', 'leave_policies')`
**Audit:** `@AuditAction('delete', 'leave', 'leave_policies')`

Deletes the policy row. Does NOT delete associated leave balances — those remain as historical records. Future balance generations will simply not allocate for the missing policy.

---

### 6.7 `GET /api/leave/policies/preview` — Preview Policy Impact

**Permission:** `@RequirePermission('leave', 'view', 'leave_policies')`

**Query Parameters:** `leaveTypeId` (required), `designationId`, `departmentId`, `employmentType`

Returns a preview of how many active employees match the given scope, along with a sample list (first 5). Used in the form drawer to show "This policy would affect N employees" before saving.

**Service Logic:**
Build a query against `users + employee_profiles` matching the given scope conditions. Return count + sample.

---

## 7. Holidays API Specification

Holidays are organization-declared days off. They can be mandatory or optional. Used by the leave request system (Sprint 4B) to warn when a leave overlaps a holiday, and by the attendance system (Sprint 5A) to exclude holidays from attendance calculations.

Controller prefix: `leave/holidays`.

### 7.1 `GET /api/holidays` — List Holidays

**Permission:** `@RequirePermission('leave', 'view', 'holidays')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `year` | number | Current leave year | Filter by year |
| `page` | number | 1 | |
| `limit` | number | 50 | |
| `sortBy` | string | `date` | |
| `sortOrder` | string | `asc` | |

**Service Logic:**
```
SELECT id, name, date, is_optional, year, created_at
FROM holidays
WHERE year = $year
ORDER BY date ASC
```

**Response:**
```
{
  success: true,
  data: [
    { id, name, date, isOptional, year, createdAt, dayOfWeek: "Monday" }
  ],
  meta: { page, limit, total, totalPages }
}
```

`dayOfWeek` is computed from the `date` field in the service layer.

---

### 7.2 `POST /api/holidays` — Create Holiday

**Permission:** `@RequirePermission('leave', 'create', 'holidays')`
**Audit:** `@AuditAction('create', 'leave', 'holidays')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `date` | string | `@IsDateString()` | Yes |
| `isOptional` | boolean | `@IsBoolean()`, default `false` | No |

**Service Logic:**
1. Extract `year` from date: compute the leave year using `getLeaveYear(date, financialYearStartMonth)`
2. Check for duplicate date: `SELECT id FROM holidays WHERE date = $date`. If found → `409 "A holiday already exists on this date"`
3. Insert with `year = computed leave year`
4. Return created holiday

---

### 7.3 `PUT /api/holidays/:id` — Update Holiday

**Permission:** `@RequirePermission('leave', 'edit', 'holidays')`
**Audit:** `@AuditAction('update', 'leave', 'holidays')`

Fields: `name`, `date`, `isOptional`. If `date` changes → recompute `year`.

---

### 7.4 `DELETE /api/holidays/:id` — Delete Holiday

**Permission:** `@RequirePermission('leave', 'delete', 'holidays')`
**Audit:** `@AuditAction('delete', 'leave', 'holidays')`

Hard delete. Return `{ message: "Holiday deleted" }`.

---

### 7.5 `GET /api/holidays/export` — Export Holidays

**Permission:** `@RequirePermission('leave', 'view', 'holidays')`
**Rate Limit:** 5 req/min/user

**Export Columns:** Name, Date, Day of Week, Optional, Year
**Formats:** CSV, XLSX

---

### 7.6 `GET /api/holidays/import/template` — Holiday Import Template

**Permission:** `@RequirePermission('leave', 'create', 'holidays')`

**Template Columns:**

| Column | Required | Format |
|---|---|---|
| `name` | Yes | Max 255 chars |
| `date` | Yes | YYYY-MM-DD |
| `is_optional` | No | `true` or `false`. Default: `false`. |

**Sample Row:**
```
Republic Day,2026-01-26,false
```

---

### 7.7 `POST /api/holidays/import` — Bulk Import Holidays

**Permission:** `@RequirePermission('leave', 'create', 'holidays')`
**Audit:** `@AuditAction('import', 'leave', 'holidays')`

**Request:** `multipart/form-data` with `file` (CSV, max 2MB) and `dryRun`.

**Processing:**
1. Parse CSV, validate headers
2. Row-by-row validation:
   - `name`: required, ≤255 chars
   - `date`: required, valid YYYY-MM-DD, no duplicate within file, no duplicate within tenant
   - `is_optional`: if present, must be `true` or `false`
3. Compute `year` for each row using `getLeaveYear()`
4. Batch insert valid rows
5. Return standard import response shape: `{ summary, imported, errors }`

---

## 8. Leave Balance Engine

The balance engine is the core business logic that turns policies into per-employee allocations. It runs in three contexts:

1. **Year-start generation:** Admin manually triggers balance generation for a new leave year (or a cron job does it automatically)
2. **New employee:** When an employee is created (Sprint 3A) mid-year, their balances need prorating
3. **Regeneration:** Admin re-runs generation after changing policies to update balances

### 8.1 `BalanceEngineService`

**Method: `generateBalancesForYear(year: number, options?: { userId?: string, dryRun?: boolean })`**

This is the core method. If `userId` is provided, generates for that single employee. Otherwise generates for ALL active employees.

**Algorithm:**

For each active employee:
1. Fetch employee's designation, department, and employment type from `employee_profiles`
2. For each leave type:
   a. Find the best-matching policy using the priority rules from Section 6.1
   b. If no matching policy → skip (leave balance will be 0)
   c. Compute `total_allocated` based on accrual type:
      - **Annual:** `total_allocated = policy.annualAllocation`
      - **Monthly/Quarterly:** See Section 8.2 below
   d. Compute `carried_forward`:
      - Look up previous year's balance: `SELECT * FROM leave_balances WHERE user_id = $userId AND leave_type_id = $typeId AND year = $year - 1`
      - If found and policy.carryForward is true:
        - `previousRemaining = prev.total_allocated + prev.carried_forward - prev.used`
        - `carried_forward = MIN(previousRemaining, policy.maxCarryForward)`
        - If `previousRemaining < 0` → `carried_forward = 0`
      - Otherwise → `carried_forward = 0`
   e. UPSERT into `leave_balances`:
      ```
      INSERT INTO leave_balances (user_id, leave_type_id, year, total_allocated, carried_forward, used)
      VALUES ($userId, $typeId, $year, $allocated, $carryForward, 0)
      ON CONFLICT (user_id, leave_type_id, year)
      DO UPDATE SET total_allocated = $allocated, carried_forward = $carryForward
      ```
      **Critical:** `used` is NOT reset on regeneration — it preserves actual usage. Only `total_allocated` and `carried_forward` are recalculated.

### 8.2 Mid-Year Prorating

When an employee joins mid-year OR when accrual type is monthly/quarterly, the allocation is prorated:

**Annual accrual with mid-year join:**
- Calculate months remaining in the leave year from the employee's `date_of_joining` (or from today if generating retroactively)
- `total_allocated = (annualAllocation / 12) * monthsRemaining` (rounded to 1 decimal)
- Only applies if the employee joined during the current leave year. If they joined in a previous year → full allocation.

**Monthly accrual:**
- At generation time: `total_allocated = (annualAllocation / 12) * monthsElapsedInYear`
- This value increases each month when the monthly accrual cron runs (Section 8.3)
- For mid-year joiners: start counting from the month they joined

**Quarterly accrual:**
- Same as monthly but `total_allocated = (annualAllocation / 4) * quartersElapsedInYear`
- Increments each quarter

### 8.3 Accrual Cron Job

For monthly and quarterly accrual policies, a cron job runs to increment balances:

**`LeaveAccrualCron`** — runs on the 1st of every month at 00:05 AM

1. Read `financial_year_start_month` from `organization_settings`
2. Determine current leave year and months elapsed
3. For each active leave policy with `accrual_type = 'monthly'`:
   - For each active employee matching the policy scope:
     - Compute new `total_allocated` = `(annualAllocation / 12) * monthsElapsed`
     - If employee joined mid-year → adjust start month
     - Update `leave_balances.total_allocated` (only increase, never decrease)
4. For quarterly accrual: only run on the 1st month of each quarter relative to the financial year start
5. Log completion in audit logs

**Note:** For tenants where the cron has not run yet (e.g., a new tenant), the balance engine's initial generation handles the full calculation. The cron only handles incremental accrual going forward.

### 8.4 New Employee Balance Generation

When an employee is created via `POST /api/employees` or `POST /api/employees/import` (Sprint 3A/3D), the leave module should be invoked to generate their initial leave balances.

**Integration point:** After employee creation succeeds (user + profile + roles created), call `BalanceEngineService.generateBalancesForYear(currentLeaveYear, { userId: newUserId })`.

This is a **cross-module call**. The `EmployeesService` imports `BalanceEngineService` and invokes it at the end of the create transaction. If the balance generation fails, it should log the error but NOT roll back the employee creation (non-critical side effect).

### 8.5 `POST /api/leave/balances/generate` — Admin Trigger Balance Generation

**Permission:** `@RequirePermission('leave', 'create', 'leave_policies')` (admin-level)
**Audit:** `@AuditAction('create', 'leave', 'leave_balances')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `year` | number | `@IsInt()`, `@Min(2020)`, `@Max(2099)` | Yes |
| `userId` | UUID | `@IsOptional()`, `@IsUUID()` | No (all employees if omitted) |
| `dryRun` | boolean | `@IsOptional()`, default `false` | No |

**Response:**
```
{
  success: true,
  data: {
    dryRun: false,
    year: 2026,
    summary: {
      employeesProcessed: 50,
      balancesCreated: 250,
      balancesUpdated: 50,
      carryForwardsApplied: 30
    }
  }
}
```

### 8.6 `GET /api/leave/balances/status` — Balance Generation Status

**Permission:** `@RequirePermission('leave', 'view', 'leave_policies')`

**Query Parameters:** `year` (required)

Returns a summary of how many employees have balances for the given year, and how many are missing.

**Response:**
```
{
  success: true,
  data: {
    year: 2026,
    leaveYearLabel: "Jan 2026 – Dec 2026",
    totalActiveEmployees: 50,
    employeesWithBalances: 48,
    employeesWithoutBalances: 2,
    missingEmployees: [ { id, employeeId, firstName, lastName } ],
    lastGeneratedAt: "2026-01-01T00:05:00Z" | null
  }
}
```

---

## 9. Frontend: Leave Types Page

### 9.1 Route: `/leave/admin/types`

**Page Header:**
- Title: "Leave Types"
- Subtitle: "Configure the types of leave available in your organization"
- Right: "Add Leave Type" button

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Color | `color` | Color swatch circle |
| Icon | `icon` | Lucide icon name rendered |
| Name | `name` | |
| Code | `code` | Monospace badge |
| Paid | `isPaid` | ✅ / ❌ badge |
| Max Consecutive Days | `maxConsecutiveDays` | Number or "—" |
| Policies | `policyCount` | Badge count |
| Actions | — | Edit, Delete (permission-gated) |

### 9.2 Leave Type Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Name | text | Required |
| Code | text | Required. Auto-generated from name (uppercase, e.g., "Casual Leave" → "CL"). Editable. |
| Color | color picker | Shows 8 preset colors + custom hex input. Default: random from preset palette. |
| Icon | icon selector | Grid of ~15 relevant Lucide icons (sun, calendar, thermometer, baby, briefcase, heart, coffee, umbrella, etc.). |
| Paid Leave | toggle | Required. Default: on. |
| Max Consecutive Days | number | Optional. Helper text: "Maximum days allowed in a single request. Leave blank for no limit." |

### 9.3 Delete Protection

If the leave type has existing requests → show error toast from API. Otherwise confirm dialog → delete.

---

## 10. Frontend: Leave Policies Page

### 10.1 Route: `/leave/admin/policies`

**Page Header:**
- Title: "Leave Policies"
- Subtitle: "Define allocation rules for each leave type per employee segment"
- Right: "Add Policy" button

**Toolbar:** Filter by leave type, filter by department

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Leave Type | `leaveType.name` | Color badge matching leave type color |
| Designation | `designation.name` | "All" if null |
| Department | `department.name` | "All" if null |
| Employment Type | `employmentType` | "All" if null. Capitalized. |
| Annual Allocation | `annualAllocation` | "{N} days" |
| Accrual | `accrualType` | Badge: Annual / Monthly / Quarterly |
| Carry Forward | `carryForward` | ✅ or ❌. If ✅, show "(max {N})" |
| Actions | — | Edit, Delete |

**Scope display logic:** When all three scope fields are null, show a "Default — All Employees" label spanning the scope columns.

### 10.2 Policy Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Leave Type | select dropdown | Required. Options from `GET /api/leave/types`. Shows name + color swatch. |
| Scope: Designation | searchable select | Optional. "All designations" default. |
| Scope: Department | searchable select | Optional. "All departments" default. |
| Scope: Employment Type | select | Optional. Options: All / Permanent / Contract / Intern / Freelance. |
| Annual Allocation | number (with decimal) | Required. Label: "Days per year". Step: 0.5. |
| Accrual Type | select | Required. Options: Annual (full amount on year start), Monthly (1/12 per month), Quarterly (1/4 per quarter). |
| Carry Forward | toggle | Default: off |
| Max Carry Forward Days | number | Visible only when carry forward is on. Required when visible. |

**Impact preview:** Below the scope fields, show a live preview: "This policy would affect **N employees**" (fetched from `GET /api/leave/policies/preview` when scope fields change, debounced 500ms).

---

## 11. Frontend: Holidays Page

### 11.1 Route: `/leave/admin/holidays`

**Page Header:**
- Title: "Holidays"
- Year selector (dropdown or navigator arrows) → filters by leave year
- Right: "Add Holiday" button dropdown: "Add Holiday" + "Import from CSV"

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Date | `date` | Formatted per org date_format setting |
| Day | computed | Day of week (Monday, Tuesday, etc.) |
| Holiday Name | `name` | |
| Optional | `isOptional` | Badge: "Optional" or "Mandatory" |
| Actions | — | Edit, Delete |

Default sort: `date ASC`. Shows upcoming holidays highlighted.

### 11.2 Holiday Form Drawer

**Fields:**
- Holiday Name (text, required)
- Date (date picker, required)
- Optional Holiday (toggle, default: off). Helper text: "Optional holidays can be substituted by employees."

### 11.3 Holiday Import

Same 3-step wizard pattern as Sprint 3D imports. Template download → dry-run → import.

---

## 12. Frontend: Balance Management Page

### 12.1 Route: `/leave/admin/balances`

**Page Header:**
- Title: "Leave Balance Management"
- Subtitle: "Generate and manage employee leave allocations"

**Layout — Two sections:**

**Section 1: Balance Status Card**

Shows the current state for the selected year (year selector dropdown):
- Leave year label (e.g., "Jan 2026 – Dec 2026")
- Total active employees: N
- Employees with balances: N (green)
- Missing balances: N (red, with "View" link → shows names)
- Last generated: timestamp or "Never"

**Section 2: Generate Balances Action Card**

- "Generate Balances" button
- Year selector (pre-filled with current leave year)
- Checkbox: "Generate for specific employee only" → shows employee lookup field
- "Preview" button → calls the endpoint with `dryRun: true` → shows summary
- "Generate" button → calls with `dryRun: false` → shows results toast

**Warning banner:** "Regenerating balances will recalculate allocations and carry-forwards based on current policies. Existing leave usage (used days) will NOT be affected."

---

## 13. Integration: Sprint 3A Cross-Module Call

Add a hook in the employee creation flow (Sprint 3A) to generate initial leave balances for newly created employees.

**Backend change in `EmployeesService`:**

After successfully creating the employee (user + profile + roles), invoke:
```
this.balanceEngineService.generateBalancesForYear(currentLeaveYear, { userId: newUser.id })
```

Wrap in try/catch — if balance generation fails, log the error but do not fail the employee creation. The admin can regenerate manually from the balance management page.

This also applies to the CSV import (Sprint 3D): after all employees are imported, call balance generation for each new employee.

---

## 14. Scope Boundaries

### In Scope (Sprint 4A)
- Leave Types CRUD (6 endpoints: list, create, detail, update, delete, export)
- Leave Policies CRUD (6 endpoints: list, create, detail, update, delete, preview)
- Holidays CRUD (5 endpoints: list, create, update, delete, export)
- Holiday import (template download + bulk import with dry-run)
- Balance Engine: `generateBalancesForYear()` with policy matching, prorating, carry-forward
- Balance generation admin API (trigger + status)
- Accrual cron job (monthly runner for monthly/quarterly policies)
- Financial year utility functions
- Leave module layout with top tabs + admin config route group
- Leave Types admin page with color/icon picker
- Leave Policies admin page with scope selector + impact preview
- Holidays admin page with year selector + import
- Balance management admin page with generation wizard
- Integration: new employee creation triggers balance generation
- Audit logging on all CUD + import + generation operations
- Placeholder pages for Sprint 4B (summary, balance, requests, team)

### Out of Scope
| Feature | Sprint |
|---|---|
| Leave request submission (Apply Leave modal) | 4B |
| Leave approval/rejection workflow | 4B |
| Leave summary page (employee-facing) | 4B |
| Leave balance page (employee-facing cards) | 4B |
| Leave requests list + detail | 4B |
| Team view (who's on leave today) | 4B |
| Reportees on leave (manager view) | 4B |
| Leave notifications (submitted, approved, rejected, cancelled) | 4B |
| Leave export (requests export) | 4B |
| Leave Balance CSV import (PRD 24.1 — initial setup) | 4B |
| Shift/Work Schedule tab | 5A (Attendance) |

---

## 15. Verification & Acceptance Criteria

### Leave Type Tests

**Test 1: List seeded leave types**
```
GET /api/leave/types
→ 200: 6 default leave types (CL, EL, LWP, PL, SL, SKL) from provisioning
```

**Test 2: Create leave type**
```
POST /api/leave/types
Body: { name: "Bereavement Leave", code: "BL", color: "#795548", icon: "heart", isPaid: true, maxConsecutiveDays: 5 }
→ 201
```

**Test 3: Duplicate code rejected**
```
POST /api/leave/types { code: "CL" }
→ 409: code already exists
```

**Test 4: Delete type with requests**
```
DELETE /api/leave/types/{id}  # has leave_requests
→ 400: "Cannot delete leave type with existing requests"
```

### Leave Policy Tests

**Test 5: Create default policy (all employees)**
```
POST /api/leave/policies
Body: { leaveTypeId: "{clId}", annualAllocation: 12, carryForward: true, maxCarryForward: 5, accrualType: "annual" }
→ 201: Policy with all scope fields null (default for all employees)
```

**Test 6: Create scoped policy**
```
POST /api/leave/policies
Body: { leaveTypeId: "{clId}", designationId: "{mgrId}", departmentId: "{engId}", employmentType: "permanent", annualAllocation: 15, carryForward: true, maxCarryForward: 10, accrualType: "monthly" }
→ 201: Scoped policy for permanent managers in Engineering
```

**Test 7: Duplicate scope rejected**
```
POST /api/leave/policies
Body: { leaveTypeId: "{clId}", annualAllocation: 10, carryForward: false, accrualType: "annual" }
→ 409: "A policy with this exact scope already exists for this leave type" (duplicate of Test 5)
```

**Test 8: Carry forward without max rejected**
```
POST /api/leave/policies
Body: { leaveTypeId: "{elId}", annualAllocation: 20, carryForward: true, accrualType: "annual" }
→ 400: "Maximum carry forward days required when carry forward is enabled"
```

**Test 9: Preview impact**
```
GET /api/leave/policies/preview?leaveTypeId={clId}&departmentId={engId}
→ 200: { affectedEmployeeCount: 8, sampleEmployees: [...] }
```

### Holiday Tests

**Test 10: Create holiday**
```
POST /api/holidays
Body: { name: "Republic Day", date: "2026-01-26", isOptional: false }
→ 201: Holiday with year=2026 (assuming financial_year_start_month=1)
```

**Test 11: Duplicate date**
```
POST /api/holidays { date: "2026-01-26" }
→ 409: "A holiday already exists on this date"
```

**Test 12: Holiday import**
```
POST /api/holidays/import
File with 10 holidays, dryRun=false
→ 200: 10 holidays imported, each with correct year computed
```

**Test 13: Financial year holiday year calculation**
```
# org financial_year_start_month = 4 (April)
POST /api/holidays { date: "2027-02-15" }
→ Created with year = 2026 (Apr 2026 – Mar 2027)
```

### Balance Engine Tests

**Test 14: Generate balances for year (annual accrual)**
```
POST /api/leave/balances/generate
Body: { year: 2026 }
→ 200: { employeesProcessed: 10, balancesCreated: 60 }

Verify: Each active employee has one leave_balance row per leave type
Verify: total_allocated matches the best-matching policy's annualAllocation
```

**Test 15: Policy matching priority**
```
# Default CL policy: 12 days
# Engineering permanent CL policy: 15 days
# Employee: Engineering dept, permanent

POST /api/leave/balances/generate { year: 2026, userId: "{engEmployeeId}" }
→ CL balance: total_allocated = 15 (more specific policy wins)
```

**Test 16: Mid-year prorate**
```
# Employee joined June 15, 2026 (financial year = Jan-Dec)
# CL policy: 12 days annual accrual
# Months remaining: 7 (Jun-Dec)

POST /api/leave/balances/generate { year: 2026, userId: "{midYearJoinerId}" }
→ CL balance: total_allocated = 7.0 (12 / 12 * 7)
```

**Test 17: Carry forward**
```
# 2025 CL balance: total_allocated=12, carried_forward=0, used=8 → remaining=4
# CL policy: carryForward=true, maxCarryForward=5

POST /api/leave/balances/generate { year: 2026 }
→ 2026 CL balance: carried_forward = 4 (MIN(4, 5))
```

**Test 18: Carry forward capped**
```
# 2025 EL balance: total_allocated=20, used=5 → remaining=15
# EL policy: carryForward=true, maxCarryForward=10

POST /api/leave/balances/generate { year: 2026 }
→ 2026 EL balance: carried_forward = 10 (capped at maxCarryForward)
```

**Test 19: LWP always 0 allocation**
```
# LWP leave type exists
POST /api/leave/balances/generate { year: 2026 }
→ LWP balance: total_allocated = 0, carried_forward = 0
```

**Test 20: Regeneration preserves used**
```
# Existing 2026 CL balance: total_allocated=12, carried_forward=3, used=5
# Admin changes CL policy to 15 days, then regenerates

POST /api/leave/balances/generate { year: 2026 }
→ CL balance: total_allocated=15, carried_forward=3, used=5 (preserved)
```

**Test 21: Dry run**
```
POST /api/leave/balances/generate { year: 2026, dryRun: true }
→ 200: { dryRun: true, summary: { ... } }
Verify: No leave_balances rows created or modified
```

**Test 22: New employee auto-generation**
```
POST /api/employees { ... }  # Create new employee
→ 201: Employee created

Verify: leave_balances rows exist for the new employee for the current leave year
```

**Test 23: Balance status**
```
GET /api/leave/balances/status?year=2026
→ 200: { totalActiveEmployees: 50, employeesWithBalances: 48, missingEmployees: [...] }
```

### Frontend Tests

- [ ] Leave module layout: My Data | Team | Holidays tabs + admin gear dropdown
- [ ] Leave Types page: table with color swatch, icon, code, paid badge
- [ ] Leave Type form: color picker (8 presets + custom), icon selector grid
- [ ] Leave Type code auto-generation from name
- [ ] Leave Policies page: table with scope display, "All" for null fields
- [ ] Policy form: scope selectors (designation, department, employment type)
- [ ] Policy form: impact preview "This policy would affect N employees"
- [ ] Policy form: carry forward toggle shows/hides maxCarryForward field
- [ ] Holidays page: year selector, date/day/name/optional columns
- [ ] Holiday form: date picker, optional toggle
- [ ] Holiday import: 3-step wizard (template download → dry-run → import)
- [ ] Balance management page: status card with missing employee count
- [ ] Balance generation: year selector, optional employee filter, preview + generate
- [ ] Warning banner about regeneration preserving used days
- [ ] Placeholder pages for Sprint 4B tabs (summary, balance, requests, team)
- [ ] Admin config pages accessible via gear icon in leave layout
- [ ] Mobile: all tables horizontally scrollable, forms full-page

### Full Checklist

**Backend:**
- [ ] `GET /api/leave/types` — list with policy count
- [ ] `POST /api/leave/types` — create with code/name uniqueness
- [ ] `GET /api/leave/types/:id` — detail
- [ ] `PUT /api/leave/types/:id` — update with code immutability check
- [ ] `DELETE /api/leave/types/:id` — delete with request-existence guard
- [ ] `GET /api/leave/types/export` — CSV/XLSX
- [ ] `GET /api/leave/policies` — list with leave type/scope filters
- [ ] `POST /api/leave/policies` — create with duplicate scope check, carry-forward validation
- [ ] `GET /api/leave/policies/:id` — detail with affected employee count
- [ ] `PUT /api/leave/policies/:id` — update
- [ ] `DELETE /api/leave/policies/:id` — delete
- [ ] `GET /api/leave/policies/preview` — affected employee count for a scope
- [ ] `GET /api/holidays` — list by year
- [ ] `POST /api/holidays` — create with duplicate date check, year auto-computation
- [ ] `PUT /api/holidays/:id` — update
- [ ] `DELETE /api/holidays/:id` — delete
- [ ] `GET /api/holidays/export` — CSV/XLSX
- [ ] `GET /api/holidays/import/template` — CSV template
- [ ] `POST /api/holidays/import` — bulk import with dry-run
- [ ] `POST /api/leave/balances/generate` — balance generation with policy matching + prorating + carry-forward
- [ ] `GET /api/leave/balances/status` — generation status per year
- [ ] Balance engine: policy matching priority (exact → two-field → single-field → default)
- [ ] Balance engine: mid-year prorating for annual accrual
- [ ] Balance engine: monthly/quarterly accrual calculation
- [ ] Balance engine: carry-forward with max cap
- [ ] Balance engine: LWP always 0 allocation
- [ ] Balance engine: UPSERT preserves `used` on regeneration
- [ ] Accrual cron job: monthly runner for monthly/quarterly policies
- [ ] Financial year utility: year calculation, date range, label
- [ ] New employee creation triggers balance generation (cross-module)
- [ ] Audit logging on all CUD + import + generation operations

**Frontend:**
- [ ] Leave module layout with tabs + admin dropdown
- [ ] Leave Types page with DataTable, form drawer (color picker + icon selector)
- [ ] Leave Policies page with DataTable, form drawer (scope selector + impact preview)
- [ ] Holidays page with DataTable, year selector, form drawer, import dialog
- [ ] Balance management page with status card + generation wizard
- [ ] Placeholder pages for Sprint 4B

---

*Sprint 4A Complete. Next: Sprint 4B — Leave Requests, Approvals & Balances*
