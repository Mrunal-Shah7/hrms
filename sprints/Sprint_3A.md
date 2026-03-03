# Sprint 3A — Employee CRUD & List Page

## Goal
Build the employee list page with its top tab layout, the "Add Employee" drawer form, the employee detail page (Overview + Timeline tabs), the edit employee flow, and the soft-delete (archive) mechanism. This is the first module sprint and the most heavily integrated — it creates user accounts, assigns roles, sends welcome emails, checks seat limits, detects email domain type, auto-generates employee IDs, manages the `current_user_count`, fires audit logs, and sends notifications. By the end of this sprint, admins and HR can fully manage the employee lifecycle (create → view → edit → archive).

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `users` table (id, employee_id, email, password_hash, first_name, last_name, display_name, phone, photo_url, email_domain_type, status, must_reset_password, etc.) | 1A | ✅ |
| `employee_profiles` table (user_id, department_id, designation_id, reports_to, employment_type, date_of_joining, personal fields, emergency contact, addresses) | 1A | ✅ |
| `departments` table | 1A | ✅ |
| `designations` table | 1A | ✅ |
| `user_roles` + `roles` + `permissions` tables | 1A | ✅ |
| `user_preferences` table | 2C | ✅ |
| Tenant DDL (all tables created during provisioning) | 1B | ✅ |
| `TenantAuthGuard` + `PermissionGuard` + `@RequirePermission()` | 1E / 1F | ✅ |
| `SeatLimitGuard` + `@CheckSeatLimit()` | 2D | ✅ |
| `EmailService` (tenant-level) | 1G | ✅ |
| `NotificationService` + WebSocket gateway | 1G | ✅ |
| `AuditInterceptor` + `@AuditAction()` | 1G | ✅ |
| `ExportService` (CSV, XLSX, PDF) | 1G | ✅ |
| `FileStorageService` + `FileDownloadController` | 1G + Gap Fix 1 | ✅ |
| `ResponseInterceptor` + `GlobalExceptionFilter` | 1G | ✅ |
| `<DataTable>`, `<DataTableToolbar>`, `<ExportMenu>`, `<PageHeader>`, `<ConfirmDialog>`, `<EmptyState>` shared components | 1H | ✅ |
| `<ExternalBadge>` component | 2D | ✅ |
| `company_email_domain` in `organization_settings` | Gap Fix 2 | ✅ |
| Seeded permissions: `employee_management:*:employees` (view, create, edit, delete, export, import) | 1B | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/employees/employees.module.ts` | NestJS module |
| `src/employees/employees.controller.ts` | Employee CRUD + list + export endpoints |
| `src/employees/employees.service.ts` | All employee business logic |
| `src/employees/dto/create-employee.dto.ts` | Create employee DTO |
| `src/employees/dto/update-employee.dto.ts` | Update employee DTO |
| `src/employees/dto/list-employees-query.dto.ts` | Query params DTO for list endpoint |
| `src/employees/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/employees/layout.tsx` | Employee module layout with top tab bar |
| `src/app/(tenant)/employees/page.tsx` | Employee list page (default "Employees" tab) |
| `src/app/(tenant)/employees/[id]/page.tsx` | Employee detail page |
| `src/app/(tenant)/employees/departments/page.tsx` | Placeholder — built in Sprint 3B |
| `src/app/(tenant)/employees/designations/page.tsx` | Placeholder — built in Sprint 3B |
| `src/app/(tenant)/employees/groups/page.tsx` | Placeholder — built in Sprint 3C |
| `src/app/(tenant)/employees/delegations/page.tsx` | Placeholder — built in Sprint 3C |
| `src/components/modules/employees/add-employee-drawer.tsx` | Add employee multi-section form |
| `src/components/modules/employees/edit-employee-drawer.tsx` | Edit employee multi-section form |
| `src/components/modules/employees/employee-overview.tsx` | Overview tab content for detail page |
| `src/components/modules/employees/employee-timeline.tsx` | Timeline tab content for detail page |
| `src/components/modules/employees/employee-filters.tsx` | Filter sidebar for employee list |
| `src/services/employees.ts` | Employee API helpers |

### Module Registration
- Import `EmployeesModule` into `AppModule`
- All routes under `/api/employees/*` — tenant-scoped, require `TenantAuthGuard`

---

## 3. Employee Module Top Tab Layout

Reference: `EmployeeManagement.png`

### 3.1 Layout File

`src/app/(tenant)/employees/layout.tsx` provides a horizontal tab bar at the top of the content area, shared across all employee sub-pages.

**Tab Items:**

| Label | Route | Permission | Sprint |
|---|---|---|---|
| Employees | `/employees` | `employee_management:view:employees` | 3A (this sprint) |
| Departments | `/employees/departments` | `employee_management:view:departments` | 3B |
| Designations | `/employees/designations` | `employee_management:view:designations` | 3B |
| Groups | `/employees/groups` | `employee_management:view:groups` | 3C |
| Delegations | `/employees/delegations` | `employee_management:view:delegations` | 3C |

Each tab is permission-gated via `usePermission()`. If the user lacks permission for a tab, it is hidden. If all tabs are hidden except one, the tab bar still renders (single visible tab).

Active tab determined by `pathname.startsWith(route)`. The "Employees" tab is the default when navigating to `/employees`.

### 3.2 Placeholder Pages

Departments, Designations, Groups, and Delegations pages render `<EmptyState>` with message "This section will be available soon." and the relevant lucide icon. These are replaced in Sprints 3B and 3C.

---

## 4. API Specification

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `employees`.

### 4.1 `GET /api/employees` — List Employees

**Permission:** `@RequirePermission('employee_management', 'view', 'employees')`

**Query Parameters (DTO):**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Records per page (max 100) |
| `search` | string | — | Search across employee_id, first_name, last_name, email (ILIKE) |
| `sortBy` | string | `createdAt` | Sort column |
| `sortOrder` | string | `desc` | `asc` or `desc` |
| `status` | string | — | Filter: `active`, `inactive`, `archived`. Omit = active only by default |
| `departmentId` | UUID | — | Filter by department |
| `designationId` | UUID | — | Filter by designation |
| `employmentType` | string | — | Filter: `permanent`, `contract`, `intern`, `freelance` |
| `emailDomainType` | string | — | Filter: `company`, `external` |

**Sortable columns:** `employeeId`, `firstName`, `lastName`, `email`, `departmentName`, `designationName`, `employmentType`, `dateOfJoining`, `status`, `createdAt`

**Service Logic:**

1. Build base query joining `users`, `employee_profiles`, `departments`, `designations`:
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.display_name, u.email, u.phone,
       u.photo_url, u.email_domain_type, u.status, u.created_at,
       ep.employment_type, ep.date_of_joining, ep.department_id, ep.designation_id, ep.reports_to,
       d.name AS department_name, des.name AS designation_name
FROM users u
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
```

2. **Data visibility filtering (PRD 10.5):**
   - If user has role "Admin" or "HR Admin" or "HR Manager" → see all employees (no filter)
   - If user has role "Manager" or "Team Lead" → see only direct reportees: `WHERE ep.reports_to = $currentUserId`
   - If user has role "Employee (Basic)" → see only own record: `WHERE u.id = $currentUserId`
   - For custom roles: check if role has `employee_management:view:employees` permission. If yes, check for an additional `employee_management:view_all:employees` permission to decide scope. If `view_all` is absent, default to own-record-only.
   - **Simplified approach for v1:** Use a `DATA_SCOPE` concept based on role names. Admin/HR Admin/HR Manager = `ALL`. Manager/Team Lead = `REPORTEES`. Employee = `SELF`. Custom roles default to `SELF` unless they have `view_all` permission.

3. Apply `status` filter. Default: `WHERE u.status = 'active'` (exclude archived unless explicitly filtered).

4. Apply search: `AND (u.employee_id ILIKE $search OR u.first_name ILIKE $search OR u.last_name ILIKE $search OR u.email ILIKE $search OR CONCAT(u.first_name, ' ', u.last_name) ILIKE $search)`

5. Apply optional filters (departmentId, designationId, employmentType, emailDomainType).

6. Apply sorting (with alias mapping for joined columns like `departmentName` → `d.name`).

7. Apply pagination: `LIMIT $limit OFFSET ($page - 1) * $limit`. Also run a `COUNT(*)` query with the same WHERE conditions for total.

**Response:**
```
{
  success: true,
  data: [ { id, employeeId, firstName, lastName, displayName, email, phone, photoUrl,
            emailDomainType, status, employmentType, dateOfJoining,
            department: { id, name } | null,
            designation: { id, name } | null,
            reportsTo: UUID | null,
            createdAt } ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.2 `POST /api/employees` — Create Employee

**Permission:** `@RequirePermission('employee_management', 'create', 'employees')`
**Guards:** `TenantAuthGuard`, `PermissionGuard`, `SeatLimitGuard` with `@CheckSeatLimit()`
**Audit:** `@AuditAction('create', 'employee_management', 'employees')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `employeeId` | string | `@IsOptional()`, `@MaxLength(50)` | No (auto-generated if blank) |
| `firstName` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `lastName` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `displayName` | string | `@IsOptional()`, `@MaxLength(100)` | No |
| `email` | string | `@IsEmail()` | Yes |
| `phone` | string | `@IsOptional()`, `@MaxLength(20)` | No |
| `departmentId` | UUID | `@IsUUID()` | Yes |
| `designationId` | UUID | `@IsUUID()` | Yes |
| `reportsTo` | UUID | `@IsOptional()`, `@IsUUID()` | No |
| `employmentType` | string | `@IsIn(['permanent', 'contract', 'intern', 'freelance'])` | Yes |
| `dateOfJoining` | string | `@IsDateString()` | Yes |
| `dateOfBirth` | string | `@IsOptional()`, `@IsDateString()` | No |
| `gender` | string | `@IsOptional()`, `@IsIn(['male', 'female', 'other', 'prefer_not_to_say'])` | No |
| `maritalStatus` | string | `@IsOptional()`, `@IsIn(['single', 'married', 'divorced', 'widowed'])` | No |
| `bloodGroup` | string | `@IsOptional()`, `@IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])` | No |
| `emergencyContactName` | string | `@IsOptional()`, `@MaxLength(255)` | No |
| `emergencyContactPhone` | string | `@IsOptional()`, `@MaxLength(20)` | No |
| `emergencyContactRelation` | string | `@IsOptional()`, `@MaxLength(50)` | No |
| `presentAddress` | object | `@IsOptional()`, `@ValidateNested()` | No |
| `permanentAddress` | object | `@IsOptional()`, `@ValidateNested()` | No |
| `sameAsPresentAddress` | boolean | `@IsOptional()` | No |
| `roleIds` | UUID[] | `@IsOptional()`, `@IsArray()`, `@IsUUID('4', { each: true })` | No |
| `sendWelcomeEmail` | boolean | `@IsOptional()`, default `true` | No |

**Address JSONB Structure:**
```
{
  addressLine1: string,
  addressLine2?: string,
  city: string,
  state: string,
  country: string,
  postalCode: string
}
```

**Service Logic (transactional — all steps in a single DB transaction):**

1. **Validate department exists:** `SELECT id FROM departments WHERE id = $departmentId` → `404` if not found
2. **Validate designation exists:** `SELECT id FROM designations WHERE id = $designationId` → `404` if not found
3. **Validate reportsTo exists (if provided):** `SELECT id FROM users WHERE id = $reportsTo AND status = 'active'` → `400 "Reports-to user not found or inactive"`
4. **Validate email uniqueness within tenant:** `SELECT id FROM users WHERE email = $email` → `409 "An employee with this email already exists"`
5. **Employee ID generation:**
   - If `employeeId` is provided and non-empty → validate uniqueness: `SELECT id FROM users WHERE employee_id = $employeeId` → `409 "Employee ID already exists"`
   - If blank/omitted → auto-generate: query `SELECT employee_id FROM users WHERE employee_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`, parse the last numeric portion, increment. Format: `"EMP-{NNNN}"` (e.g., `EMP-0001`, `EMP-0002`). If no existing employees → start at `EMP-0001`. If the last employee_id doesn't match the `EMP-NNNN` pattern (manual ID), use `SELECT COUNT(*) + 1` as fallback.
6. **Detect email domain type (Gap Fix 2):**
   - Read `company_email_domain` from `organization_settings`
   - Extract domain from `email` (split on `@`, take second part)
   - If domains match (case-insensitive) → `email_domain_type = 'company'`
   - If no match or `company_email_domain` is null → `email_domain_type = 'external'`
7. **Generate temporary password:** 12-character random string with at least 1 uppercase, 1 lowercase, 1 number, 1 special character. Store the plaintext temporarily (for the welcome email) and hash it with bcrypt (12 rounds).
8. **Create user record:**
   ```
   INSERT INTO users (id, employee_id, email, password_hash, first_name, last_name, display_name,
                      phone, email_domain_type, status, must_reset_password, created_at, updated_at)
   VALUES ($uuid, $employeeId, $email, $hash, $firstName, $lastName, $displayName,
           $phone, $emailDomainType, 'active', TRUE, NOW(), NOW())
   ```
9. **Create employee profile:**
   ```
   INSERT INTO employee_profiles (id, user_id, department_id, designation_id, reports_to,
                                   employment_type, date_of_joining, date_of_birth, gender,
                                   marital_status, blood_group, emergency_contact_name,
                                   emergency_contact_phone, emergency_contact_relation,
                                   present_address, permanent_address, created_at, updated_at)
   ```
   If `sameAsPresentAddress` is true → set `permanent_address = present_address`.
10. **Create user_preferences row:** Insert default preferences (same pattern as Sprint 2C Section 2.3).
11. **Assign roles:** If `roleIds` provided → insert into `user_roles` for each role. If not provided → assign the default "Employee (Basic)" role. Validate each roleId exists.
12. **Increment seat count:**
    ```
    UPDATE platform.tenants SET current_user_count = current_user_count + 1 WHERE id = $tenantId
    ```
    (Cross-schema query to platform. The `tenantId` is available from `req.user.tenantId`.)
13. **Send welcome email (if `sendWelcomeEmail` is true):**
    - Use tenant-level `EmailService`
    - To: the new employee's email
    - Subject: "Welcome to {orgName} — Your HRMS Account"
    - Body: branded HTML with employee name, login URL (`{slug}.platform-domain.com/login`), their email (as username), temporary password, instruction to change password on first login
    - The temporary password is included in plaintext in the email since `must_reset_password = true` forces an immediate change
14. **Send in-app notification:**
    - Use `NotificationService.create()` with type `employee_account_created`
    - Recipient: the new employee's user ID
    - Title: "Welcome to {orgName}"
    - Message: "Your account has been created. Please log in and change your password."
15. **Return** the created employee (same shape as the list item in Section 4.1, plus the generated password if `sendWelcomeEmail` is false — so the admin can share it manually).

**Response:**
```
{
  success: true,
  data: {
    id, employeeId, firstName, lastName, email, ...
    temporaryPassword: "abc123..." // ONLY if sendWelcomeEmail was false
  }
}
```

**Error Responses:**
- `409` — Email already exists
- `409` — Employee ID already exists
- `400` — Department/Designation not found
- `400` — Reports-to user not found
- `403` — Seat limit reached (from `SeatLimitGuard`)

---

### 4.3 `GET /api/employees/:id` — Employee Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'employees')`

**Path Param:** `id` (UUID — the `users.id`)

**Service Logic:**

1. **Data visibility check:** Same scoping as list endpoint. If user is Manager/Team Lead → verify the requested employee is a direct reportee. If Employee → verify it's their own ID. If neither → `403`.
2. Full query:
```
SELECT u.*, ep.*,
       d.name AS department_name, d.code AS department_code,
       des.name AS designation_name, des.code AS designation_code,
       mgr.first_name AS manager_first_name, mgr.last_name AS manager_last_name,
       mgr.id AS manager_id, mgr.employee_id AS manager_employee_id
FROM users u
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
LEFT JOIN users mgr ON ep.reports_to = mgr.id
WHERE u.id = $1
```
3. Load roles: `SELECT r.id, r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1`
4. If not found → `404 "Employee not found"`

**Response:**
```
{
  success: true,
  data: {
    id, employeeId, firstName, lastName, displayName, email, phone, photoUrl,
    emailDomainType, status, mustResetPassword, lastLoginAt, createdAt, updatedAt,
    profile: {
      employmentType, dateOfJoining, dateOfBirth, gender, maritalStatus, bloodGroup,
      emergencyContact: { name, phone, relation },
      presentAddress: { addressLine1, addressLine2, city, state, country, postalCode },
      permanentAddress: { ... }
    },
    department: { id, name, code } | null,
    designation: { id, name, code } | null,
    reportsTo: { id, employeeId, firstName, lastName } | null,
    roles: [ { id, name } ]
  }
}
```

---

### 4.4 `PUT /api/employees/:id` — Update Employee

**Permission:** `@RequirePermission('employee_management', 'edit', 'employees')`
**Audit:** `@AuditAction('update', 'employee_management', 'employees')`

**Path Param:** `id` (UUID)

**Request Body:** Same fields as create DTO, all optional. Plus:
- `status` — `@IsOptional()`, `@IsIn(['active', 'inactive'])`. Note: setting to `'archived'` is not allowed here — use the dedicated archive endpoint.

**Service Logic:**

1. Fetch existing employee (same query as detail endpoint). If not found → `404`.
2. If `email` is being changed:
   - Validate new email uniqueness within tenant
   - Re-detect `email_domain_type` using `company_email_domain`
3. If `employeeId` is being changed → validate uniqueness
4. If `departmentId` is being changed → validate department exists
5. If `designationId` is being changed → validate designation exists
6. If `reportsTo` is being changed → validate target user exists and is active. Prevent circular reference: employee cannot report to themselves.
7. Update `users` table fields (first_name, last_name, display_name, email, phone, email_domain_type, employee_id, status)
8. Update `employee_profiles` table fields (department_id, designation_id, reports_to, employment_type, date_of_joining, personal fields, address fields)
9. If `roleIds` is provided → replace all existing roles: delete from `user_roles` where `user_id = $id`, insert new role assignments. Preserve the `assigned_by` and `assigned_at` values.
10. If status changed to `inactive`:
    - Invalidate all sessions for this user: `DELETE FROM user_sessions WHERE user_id = $id`
    - Decrement seat count: `UPDATE platform.tenants SET current_user_count = current_user_count - 1 WHERE id = $tenantId`
11. If status changed from `inactive` back to `active`:
    - Increment seat count: `UPDATE platform.tenants SET current_user_count = current_user_count + 1 WHERE id = $tenantId`

**Response:** Updated employee detail (same shape as GET detail response).

---

### 4.5 `DELETE /api/employees/:id` — Archive Employee (Soft Delete)

**Permission:** `@RequirePermission('employee_management', 'delete', 'employees')`
**Audit:** `@AuditAction('delete', 'employee_management', 'employees')`

**Path Param:** `id` (UUID)

**Service Logic:**

1. Fetch employee. If not found → `404`.
2. Cannot archive yourself: if `id === req.user.userId` → `400 "You cannot archive your own account"`
3. Cannot archive the last Admin: count users with Admin role → if this is the last one → `400 "Cannot archive the last administrator"`
4. Set `users.status = 'archived'`, `users.updated_at = NOW()`
5. Invalidate all sessions: `DELETE FROM user_sessions WHERE user_id = $id`
6. Decrement seat count: `UPDATE platform.tenants SET current_user_count = current_user_count - 1 WHERE id = $tenantId`
7. Archived employees do not appear in the default list (filtered out by `status = 'active'` default). They can be viewed by explicitly filtering `status=archived`.
8. Archived employees cannot log in (Sprint 1E Step 5 checks `user.status === 'active'`).

**Note on "soft" delete:** The PRD explicitly states "Delete is soft (status → 'archived')." No data is removed. The employee's user record, profile, leave history, and all associated data remain intact. This supports potential future "unarchive" functionality.

**Response:**
```
{
  success: true,
  data: { message: "Employee archived successfully" }
}
```

---

### 4.6 `GET /api/employees/:id/reportees` — Get Direct Reportees

**Permission:** `@RequirePermission('employee_management', 'view', 'employees')`

**Path Param:** `id` (UUID — the manager's user ID)

**Service Logic:**
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
       u.email_domain_type, u.status,
       ep.employment_type, ep.department_id, ep.designation_id,
       d.name AS department_name, des.name AS designation_name
FROM users u
JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
WHERE ep.reports_to = $1 AND u.status = 'active'
ORDER BY u.first_name ASC
```

No pagination — typically a small set. Returns flat list of reportees.

**Data visibility:** Admin/HR can request reportees for any user. Manager can only request their own reportees (`id === req.user.userId`). Employee cannot access this endpoint for others.

---

### 4.7 `GET /api/employees/export` — Export Employee List

**Permission:** `@RequirePermission('employee_management', 'export', 'employees')`
**Rate Limit:** 5 requests/min/user (PRD 26.6)

**Query Parameters:** Same filters as list endpoint, plus:
- `format` — `@IsIn(['csv', 'xlsx', 'pdf'])`, required

**Service Logic:**

1. Build the same query as the list endpoint (with all applied filters and data visibility scoping) but without pagination — fetch all matching records.
2. Define export columns: Employee ID, First Name, Last Name, Email, Phone, Department, Designation, Employment Type, Date of Joining, Status, Email Type.
3. Call `ExportService.generate()` with the data, columns, and requested format.
4. Return `StreamableFile` with appropriate headers.

**File naming:** `employees_{YYYY-MM-DD}.{format}`

---

### 4.8 `GET /api/employees/lookup` — Lightweight Employee Lookup

**Permission:** Any authenticated tenant user

No full permission check — this is a utility endpoint used by search/select fields across the app (e.g., "Reports To" dropdown, "Assign To" in goals, etc.).

**Query Parameters:**
- `search` — string, required, min 2 chars. Searches first_name, last_name, email, employee_id.
- `limit` — number, default 10, max 20.
- `excludeId` — UUID, optional. Exclude a specific user (e.g., when editing an employee, exclude themselves from "Reports To").

**Response:**
```
{
  success: true,
  data: [
    { id, employeeId, firstName, lastName, email, photoUrl, department: { name } | null }
  ]
}
```

Returns only active employees. Lightweight — no profile fields, no pagination.

---

## 5. Frontend: Employee List Page

### 5.1 Route: `/employees`

Reference: `EmployeeManagement.png`

**Page Header:**
- Title: "Employees"
- Right side: "Add Employee(s)" button (permission-gated: `employee_management:create:employees`)

**Toolbar (via `<DataTableToolbar>`):**
- Search bar (debounced, searches across employee ID, name, email)
- Filter button → opens `<FilterSidebar>`
- Export menu (three-dots → CSV / XLSX / PDF)
- Data status filter ("All Data" dropdown with options: All, Active, Inactive, Archived)

**Filter Sidebar Options:**
- Department: multi-select dropdown (populated from `GET /api/employees/departments` — or for now a static query; proper departments API is Sprint 3B. Use a simple `SELECT id, name FROM departments ORDER BY name` query exposed as a sub-route or inline in the list query.)
- Designation: multi-select dropdown
- Employment Type: checkboxes (Permanent, Contract, Intern, Freelance)
- Email Type: checkboxes (Company, External)
- Date of Joining: date range picker

**Table Columns (via `<DataTable>`):**

| Column | Source | Sortable | Notes |
|---|---|---|---|
| Checkbox | — | No | Row selection for bulk actions (future) |
| Employee ID | `employeeId` | Yes | Monospace font |
| First Name | `firstName` | Yes | |
| Last Name | `lastName` | Yes | |
| Email | `email` | No | With `<ExternalBadge>` if `emailDomainType === 'external'` |
| Photo | `photoUrl` | No | Avatar (initials fallback) |
| Department | `department.name` | Yes | |
| Designation | `designation.name` | Yes | |
| Employment Type | `employmentType` | Yes | Capitalized badge |
| Status | `status` | Yes | Colored badge: green=active, gray=inactive, red=archived |

**Row click:** Navigates to `/employees/{id}`.

**URL State Sync:** All query params (page, limit, search, filters, sortBy, sortOrder) are synced to URL search params. Navigating back preserves state.

**Pagination:** Via `<DataTablePagination>` — page size selector (10/25/50/100), page navigation, total count.

---

## 6. Frontend: Add Employee Drawer

### 6.1 Trigger

"Add Employee(s)" button opens a right-side drawer (or full-page form on mobile). Uses `react-hook-form` + `zod` validation.

### 6.2 Form Sections

**Section 1: Basic Info**

| Field | Type | Required | Notes |
|---|---|---|---|
| Employee ID | text input | No | Placeholder: "Auto-generated if left blank" |
| First Name | text input | Yes | |
| Last Name | text input | Yes | |
| Display Name | text input | No | Placeholder: "How this person prefers to be called" |
| Email | email input | Yes | On blur: check uniqueness via inline query. Show `<ExternalBadge>` preview after domain detection. |
| Phone | text input | No | |
| Department | searchable select | Yes | Options from departments table |
| Designation | searchable select | Yes | Options from designations table |
| Reports To | searchable select | No | Uses `/api/employees/lookup` endpoint. Shows name + employee ID in dropdown. |
| Employment Type | select | Yes | Options: Permanent, Contract, Intern, Freelance |
| Date of Joining | date picker | Yes | |

**Section 2: Personal Info**

| Field | Type | Required | Notes |
|---|---|---|---|
| Date of Birth | date picker | No | |
| Gender | select | No | Male, Female, Other, Prefer not to say |
| Marital Status | select | No | Single, Married, Divorced, Widowed |
| Blood Group | select | No | A+, A-, B+, B-, AB+, AB-, O+, O- |

**Section 3: Emergency Contact**

| Field | Type | Required | Notes |
|---|---|---|---|
| Contact Name | text input | No | |
| Contact Phone | text input | No | |
| Relationship | text input | No | e.g., "Spouse", "Parent", "Sibling" |

**Section 4: Address**

| Field | Type | Required | Notes |
|---|---|---|---|
| Present Address Line 1 | text input | No | |
| Present Address Line 2 | text input | No | |
| City | text input | No | |
| State | text input | No | |
| Country | text input | No | |
| Postal Code | text input | No | |
| Same as Present Address | checkbox | No | If checked, hides permanent address fields and copies present address on submit |
| Permanent Address | same fields | No | Hidden if "Same as Present" is checked |

**Section 5: Role Assignment**

| Field | Type | Required | Notes |
|---|---|---|---|
| Roles | multi-select | No | Options: all roles from `GET /api/roles`. Default pre-selected: "Employee (Basic)". Admin can add/remove. |
| Send Welcome Email | checkbox | No | Default: checked. Uncheck to suppress email (admin will share credentials manually). |

### 6.3 Submit Flow

1. Client validates all fields via zod schema
2. Submit to `POST /api/employees`
3. Show loading state on submit button
4. On success:
   - Close drawer
   - Show toast: "Employee {firstName} {lastName} created successfully"
   - If welcome email was sent: toast includes "Welcome email sent to {email}"
   - If welcome email was NOT sent: show a one-time dialog with the temporary password and a "Copy" button. Warn: "This password will not be shown again."
   - Refresh employee list
5. On error: show inline error messages from the API response's `details` array

---

## 7. Frontend: Employee Detail Page

### 7.1 Route: `/employees/[id]`

**Page Header:**
- Back arrow → `/employees`
- Title: "{firstName} {lastName}" with `<ExternalBadge>` if applicable
- Subtitle: Employee ID + Department + Designation
- Right: "Edit" button (permission-gated: `employee_management:edit:employees`) + "Archive" button (permission-gated: `employee_management:delete:employees`, red text, only if status is `active` or `inactive`)

**Tabs:** Overview | Timeline

### 7.2 Overview Tab

Displays all employee information in organized card sections.

**Profile Card (top):**
- Large avatar (with photo or initials)
- Name, email, employee ID, status badge, email domain badge
- Quick info row: Department, Designation, Reports To (clickable → navigates to manager's profile), Employment Type, Date of Joining

**Personal Information Card:**
- Date of Birth, Gender, Marital Status, Blood Group
- Shows "Not provided" for empty fields

**Emergency Contact Card:**
- Name, Phone, Relationship
- Shows "No emergency contact provided" if all fields are empty

**Address Card:**
- Present Address (formatted multi-line)
- Permanent Address (formatted multi-line or "Same as present address")

**Roles Card:**
- List of assigned roles with badges

**Account Status Card:**
- Status: badge
- Must Reset Password: Yes/No indicator
- Last Login: relative date or "Never logged in"
- Account Created: date

### 7.3 Timeline Tab

Displays the audit history for this employee entity.

**Data Source:** `GET /api/audit-logs/users/{userId}` (Sprint 1G endpoint — entity history for a specific entity)

**Display:** Vertical timeline (newest first). Each entry shows:
- Timestamp (relative)
- Action: "Created", "Updated", "Archived", "Role Assigned", "Role Removed"
- Actor: name of the user who made the change
- Changed fields: for updates, show field name + old value → new value (from `old_value` / `new_value` JSONB)

**Permission:** Timeline tab is only visible to users with Admin or HR Admin roles (these users have `settings:view:audit_logs` permission).

**Empty State:** "No activity recorded yet."

---

## 8. Frontend: Edit Employee Drawer

### 8.1 Trigger

"Edit" button on the detail page opens the same drawer form as "Add Employee" but pre-populated with existing data.

### 8.2 Differences from Add Form

- Employee ID field is editable (but shows current value, warns "Changing employee ID may affect references")
- Email field is editable (shows current value, re-validates uniqueness on change)
- Status field is added: dropdown with "Active" / "Inactive" options. "Archived" is not an option here.
- No temporary password generation — editing does not reset passwords
- No "Send Welcome Email" checkbox
- Role assignment section shows current roles pre-selected

### 8.3 Submit Flow

1. Only send changed fields (diff against original data)
2. Submit to `PUT /api/employees/{id}`
3. On success: close drawer, refresh detail page, show toast "Employee updated"
4. If status changed to "Inactive": show additional info "Employee's active sessions have been terminated."

---

## 9. Frontend: Archive Flow

### 9.1 Trigger

"Archive" button on the detail page.

### 9.2 Flow

1. Click "Archive" → `<ConfirmDialog>`:
   - Title: "Archive Employee"
   - Description: "Are you sure you want to archive **{firstName} {lastName}**? This will:\n• Block their login access\n• Remove them from active employee lists\n• Preserve all their historical data\n\nThis action can be reversed by a system administrator."
   - Confirm button: "Archive Employee" (destructive variant)
2. Call `DELETE /api/employees/{id}`
3. On success: navigate to `/employees`, show toast "Employee archived"

---

## 10. Employee ID Auto-Generation Strategy

### 10.1 Format

Default format: `EMP-{NNNN}` — zero-padded 4-digit sequential number.

Examples: `EMP-0001`, `EMP-0002`, `EMP-0100`

### 10.2 Generation Logic

When `employeeId` is blank or omitted:

1. Query: `SELECT employee_id FROM users WHERE employee_id LIKE 'EMP-%' ORDER BY employee_id DESC LIMIT 1`
2. If found → extract numeric portion, parse as integer, add 1, zero-pad to 4 digits
3. If not found (first employee or all have manual IDs) → start at `EMP-0001`
4. If the generated ID already exists (race condition) → retry with next number, up to 3 retries
5. If 4+ digits needed (e.g., EMP-10000) → expand to 5 digits automatically

### 10.3 Manual Override

If admin provides a custom employee ID (e.g., `"HR-001"`, `"NYC-42"`) → use it directly. Validate uniqueness. No format restriction on manual IDs beyond max length 50.

---

## 11. Welcome Email Template

**Subject:** "Welcome to {orgName} — Your HRMS Account"

**Body structure:**
- Greeting: "Hello {firstName},"
- Message: "Your account at {orgName} has been created. Here are your login details:"
- Login URL: `{slug}.{platformDomain}/login`
- Email (username): `{email}`
- Temporary Password: `{tempPassword}`
- Instruction: "For security, you will be required to change your password on your first login."
- Footer: standard platform footer

**Sent via:** Tenant-level `EmailService` (Sprint 1G). If tenant has no email config → fall back to platform-level SMTP.

---

## 12. Department & Designation Dropdown Data

The "Add Employee" and "Edit Employee" forms need department and designation lists for their dropdowns. Since full Departments/Designations CRUD is Sprint 3B, this sprint adds two lightweight internal endpoints:

**`GET /api/employees/departments/options`**
- Permission: any authenticated user
- Returns: `[ { id, name, code } ]` from `departments` table, ordered by name
- No pagination — typically small list

**`GET /api/employees/designations/options`**
- Permission: any authenticated user
- Returns: `[ { id, name, code } ]` from `designations` table, ordered by name

These are simple SELECT queries. When Sprint 3B builds full Departments/Designations CRUD controllers, these utility endpoints remain (or the forms switch to the full list endpoints).

---

## 13. Tenant Dashboard Widget Update

Sprint 2D created the tenant dashboard with `quickStats.totalEmployees: null`. Now that employees exist, populate it.

**Update `TenantDashboardService`:**
```
SELECT COUNT(*) FROM users WHERE status = 'active'
```

Set `quickStats.totalEmployees` to this count in the `GET /api/dashboard` response.

---

## 14. Scope Boundaries

### In Scope (Sprint 3A)
- Employee list API with search, filter, sort, pagination, data visibility scoping
- Employee create API with user account creation, role assignment, welcome email, seat limit check, email domain detection, employee ID auto-generation
- Employee detail API with full profile, roles, manager info
- Employee update API with email re-detection, role replacement, status change, session invalidation
- Employee archive (soft delete) with seat count decrement and session invalidation
- Employee reportees API
- Employee export API (CSV, XLSX, PDF via ExportService)
- Employee lookup API (lightweight search for select fields)
- Department/Designation options endpoints (for form dropdowns)
- Employee module top tab layout (with 4 placeholder tabs for Sprint 3B/3C)
- Employee list page with DataTable, filters, search, export, URL state sync
- Add Employee drawer (5-section form)
- Employee detail page (Overview + Timeline tabs)
- Edit Employee drawer (pre-populated, diff-based update)
- Archive flow with confirmation dialog
- Dashboard totalEmployees widget populated
- Audit logging on create/update/delete via `@AuditAction()`
- Notification on employee creation (`employee_account_created`)
- `current_user_count` increment/decrement on create/archive/status-change

### Out of Scope
| Feature | Sprint |
|---|---|
| Departments CRUD | 3B |
| Designations CRUD | 3B |
| Reporting Hierarchy visual config | 3B |
| Org Chart endpoint | 3B |
| Groups CRUD + member management | 3C |
| Projects CRUD + tasks | 3C |
| Delegations CRUD | 3C |
| CSV bulk import | 3D |
| Photo upload during employee creation | Future (use profile photo upload from Sprint 2C after creation) |

---

## 15. Verification & Acceptance Criteria

### API Tests

**Test 1: List employees — Admin sees all**
```
GET /api/employees?page=1&limit=10
Headers: Authorization: Bearer <admin_token>
→ 200: All active employees, paginated
```

**Test 2: List employees — Manager sees only reportees**
```
GET /api/employees
Headers: Authorization: Bearer <manager_token>
→ 200: Only employees where reports_to = manager's userId
```

**Test 3: List employees — Employee sees only self**
```
GET /api/employees
Headers: Authorization: Bearer <employee_token>
→ 200: Array with single entry (own record)
```

**Test 4: List with search**
```
GET /api/employees?search=john
→ 200: Employees matching "john" in name, email, or employee ID
```

**Test 5: List with filters**
```
GET /api/employees?departmentId={uuid}&employmentType=contract&status=active
→ 200: Only active contract employees in the specified department
```

**Test 6: Create employee — full flow**
```
POST /api/employees
Body: { firstName: "Jane", lastName: "Doe", email: "jane@acme.com", departmentId: "...", designationId: "...", employmentType: "permanent", dateOfJoining: "2026-03-01" }
→ 201: Employee created with auto-generated employee ID (EMP-0001)

Verify:
- users table has new row with status='active', must_reset_password=true
- employee_profiles table has new row with correct department/designation
- user_roles has entry for "Employee (Basic)" role
- user_preferences has default row
- platform.tenants.current_user_count incremented by 1
- Welcome email sent to jane@acme.com
- Notification created for the new user
- Audit log entry created (action='create', module='employee_management')
```

**Test 7: Create employee — email domain detection**
```
# organization_settings.company_email_domain = 'acme.com'

POST /api/employees { email: "jane@acme.com", ... }
→ email_domain_type = 'company'

POST /api/employees { email: "jane@gmail.com", ... }
→ email_domain_type = 'external'
```

**Test 8: Create employee — seat limit**
```
# Tenant: current_user_count = 10, max_users = 10
POST /api/employees { ... }
→ 403: SEAT_LIMIT_REACHED
```

**Test 9: Create employee — duplicate email**
```
POST /api/employees { email: "existing@acme.com", ... }
→ 409: "An employee with this email already exists"
```

**Test 10: Create employee — auto-gen ID**
```
# No employees exist yet
POST /api/employees { employeeId: "", ... }
→ employeeId: "EMP-0001"

# Next employee
POST /api/employees { employeeId: "", ... }
→ employeeId: "EMP-0002"

# Manual override
POST /api/employees { employeeId: "HR-LEAD-01", ... }
→ employeeId: "HR-LEAD-01"
```

**Test 11: Employee detail**
```
GET /api/employees/{id}
→ 200: Full employee with profile, department, designation, manager, roles
```

**Test 12: Update employee**
```
PUT /api/employees/{id}
Body: { departmentId: "{newDeptId}", phone: "+911234567890" }
→ 200: Updated employee

Verify: Audit log captures old_value and new_value
```

**Test 13: Update status to inactive**
```
PUT /api/employees/{id}
Body: { status: "inactive" }
→ 200: Updated

Verify:
- user_sessions emptied for this user
- platform.tenants.current_user_count decremented
```

**Test 14: Archive employee**
```
DELETE /api/employees/{id}
→ 200: "Employee archived successfully"

Verify:
- users.status = 'archived'
- user_sessions emptied
- platform.tenants.current_user_count decremented
- Employee no longer appears in default list (status=active filter)
- Employee can be found with ?status=archived
```

**Test 15: Cannot archive self**
```
DELETE /api/employees/{own_user_id}
→ 400: "You cannot archive your own account"
```

**Test 16: Cannot archive last admin**
```
# Only 1 user with Admin role
DELETE /api/employees/{admin_id}
→ 400: "Cannot archive the last administrator"
```

**Test 17: Reportees endpoint**
```
GET /api/employees/{managerId}/reportees
→ 200: List of direct reportees (active only)
```

**Test 18: Export**
```
GET /api/employees/export?format=csv
→ 200: CSV file streamed (respects current user's data visibility scope)
```

**Test 19: Lookup**
```
GET /api/employees/lookup?search=jan&limit=5
→ 200: Matching employees (lightweight, for select dropdowns)
```

### Frontend Tests

- [ ] Top tab bar renders with 5 tabs, correct active highlighting
- [ ] Tabs hidden if user lacks corresponding permission
- [ ] Placeholder pages for Departments, Designations, Groups, Delegations
- [ ] Employee list: DataTable renders with all columns from Section 5.1
- [ ] External badge renders in email column for external users
- [ ] Search debounces and filters the list
- [ ] Filter sidebar opens with department, designation, employment type, email type options
- [ ] Export menu: CSV, XLSX, PDF trigger file download
- [ ] Status filter dropdown defaults to "Active", can switch to show Archived
- [ ] URL state synced: refresh page preserves filters, search, page, sort
- [ ] Row click navigates to detail page
- [ ] "Add Employee(s)" button hidden if user lacks create permission
- [ ] Add Employee drawer: all 5 sections render, required field validation
- [ ] Employee ID field shows placeholder "Auto-generated if left blank"
- [ ] Email field: on blur shows external badge preview if domain differs
- [ ] Reports To: searchable dropdown using lookup API
- [ ] Department/Designation: searchable dropdowns populated from options endpoints
- [ ] Role assignment: multi-select with "Employee (Basic)" pre-selected
- [ ] Submit: loading state, success toast, drawer close, list refresh
- [ ] If welcome email suppressed: temporary password dialog with copy button
- [ ] Detail page: back arrow, title with name + badges, Edit/Archive buttons
- [ ] Overview tab: profile card, personal info, emergency contact, address, roles, account status
- [ ] Timeline tab: audit entries in vertical timeline (Admin/HR only)
- [ ] Edit drawer: pre-populated, only sends changed fields
- [ ] Archive: confirm dialog with impact description, navigates to list on success
- [ ] Mobile: drawer becomes full-page, table horizontally scrollable
- [ ] Dashboard: totalEmployees card now shows real count

### Full Checklist

**Backend:**
- [ ] `GET /api/employees` — list with search, filter, sort, pagination, data visibility scoping
- [ ] `POST /api/employees` — create with user + profile + roles + preferences + seat check + email domain detection + ID auto-gen + welcome email + notification + audit
- [ ] `GET /api/employees/:id` — full detail with profile, department, designation, manager, roles
- [ ] `PUT /api/employees/:id` — update user + profile + roles, status change triggers session/seat management
- [ ] `DELETE /api/employees/:id` — archive (soft delete), session invalidation, seat decrement, self/last-admin guard
- [ ] `GET /api/employees/:id/reportees` — direct reportees list
- [ ] `GET /api/employees/export` — CSV/XLSX/PDF via ExportService
- [ ] `GET /api/employees/lookup` — lightweight search for select fields
- [ ] `GET /api/employees/departments/options` — dropdown data
- [ ] `GET /api/employees/designations/options` — dropdown data
- [ ] Data visibility: Admin/HR=ALL, Manager=REPORTEES, Employee=SELF
- [ ] Employee ID auto-gen: `EMP-{NNNN}` pattern with race condition retry
- [ ] Email domain detection against `organization_settings.company_email_domain`
- [ ] Temporary password: 12-char, meets complexity, bcrypt hashed
- [ ] Welcome email via tenant EmailService with login URL + temp password
- [ ] Notification: `employee_account_created` to new user
- [ ] Seat count: increment on create, decrement on archive/inactive, increment on reactivate
- [ ] Session invalidation on archive and inactive status
- [ ] Cannot archive self, cannot archive last Admin
- [ ] Audit logging via `@AuditAction()` on create, update, archive
- [ ] Dashboard `totalEmployees` widget now returns real count
- [ ] All endpoints in Swagger under "Employees" tag

**Frontend:**
- [ ] Top tab layout with 5 tabs (permission-gated) + 4 placeholder pages
- [ ] Employee list page with DataTable, toolbar, filters, export, pagination, URL state
- [ ] Add Employee drawer (5 sections, validation, email domain preview, lookup dropdown)
- [ ] Employee detail page (Overview + Timeline tabs)
- [ ] Edit Employee drawer (pre-populated, diff-based, status change handling)
- [ ] Archive confirmation flow
- [ ] External badge integration in list and detail
- [ ] Dashboard totalEmployees widget populated

---

*Sprint 3A Complete. Next: Sprint 3B — Departments, Designations & Reporting Hierarchy*
