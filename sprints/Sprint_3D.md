# Sprint 3D — CSV Import/Export & Module Integration

## Goal
Build CSV import functionality for Employees (with template download, per-row validation, and detailed error reporting), CSV import for Departments and Designations, add the remaining export endpoints for Groups, Projects, and Delegations, and perform a full integration audit across all Sprint 3 modules to verify that audit logging, notification events, permission checks, and data visibility scoping are consistently wired. This is the final sprint of the Employee Management module.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `ExportService` (toCsv, toXlsx, toPdf) with ColumnDef, BOM, styled XLSX headers, landscape PDF | 1G | ✅ |
| `GET /api/employees/export` — employee list export (CSV/XLSX/PDF) | 3A | ✅ |
| `GET /api/departments/export` — department export (CSV/XLSX) | 3B | ✅ |
| `GET /api/designations/export` — designation export (CSV/XLSX) | 3B | ✅ |
| `SeatLimitGuard` + `@CheckSeatLimit()` with pre-flight bulk import logic defined | 2D | ✅ |
| `POST /api/employees` — single employee creation (full pipeline) | 3A | ✅ |
| `EmailService` (tenant-level) | 1G | ✅ |
| `NotificationService` + WebSocket | 1G | ✅ |
| `AuditInterceptor` + `@AuditAction()` | 1G | ✅ |
| Seeded permissions: `employee_management:import:employees` | 1B | ✅ |
| `company_email_domain` in `organization_settings` | Gap Fix 2 | ✅ |
| Employee ID auto-generation (`EMP-{NNNN}`) | 3A | ✅ |
| Groups CRUD, Projects CRUD + Tasks, Delegations CRUD | 3C | ✅ |
| All 30 notification types seeded | Gap Fix 3 | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/employees/import/import.controller.ts` | Template download + bulk import endpoint |
| `src/employees/import/import.service.ts` | CSV parsing, per-row validation, batch creation |
| `src/employees/import/import-validator.ts` | Row-level validation logic |
| `src/departments/import/import.controller.ts` | Department template + import |
| `src/departments/import/import.service.ts` | Department import logic |
| `src/designations/import/import.controller.ts` | Designation template + import |
| `src/designations/import/import.service.ts` | Designation import logic |

### Frontend
| File | Purpose |
|---|---|
| `src/components/modules/employees/import-dialog.tsx` | Employee import wizard dialog |
| `src/components/modules/employees/import-results.tsx` | Import results display (successes + errors) |
| `src/components/modules/employees/department-import-dialog.tsx` | Department import dialog |
| `src/components/modules/employees/designation-import-dialog.tsx` | Designation import dialog |

---

## 3. Employee CSV Import

### 3.1 `GET /api/employees/import/template` — Download Template

**Permission:** `@RequirePermission('employee_management', 'import', 'employees')`
**Rate Limit:** 5 req/min/user (export rate limit)

Returns a CSV file with header row, one sample data row, and a comment row with format instructions.

**Template Columns (from PRD 24.1):**

| Column Header | Maps To | Required | Format / Notes |
|---|---|---|---|
| `employee_id` | `users.employee_id` | No | Auto-generated if blank. Max 50 chars. |
| `first_name` | `users.first_name` | Yes | Max 100 chars |
| `last_name` | `users.last_name` | Yes | Max 100 chars |
| `email` | `users.email` | Yes | Valid email, unique within tenant |
| `phone` | `users.phone` | No | Max 20 chars |
| `department_code` | lookup → `departments.code` | Yes | Must match existing department code |
| `designation_code` | lookup → `designations.code` | Yes | Must match existing designation code |
| `employment_type` | `employee_profiles.employment_type` | Yes | One of: permanent, contract, intern, freelance |
| `date_of_joining` | `employee_profiles.date_of_joining` | Yes | `YYYY-MM-DD` format |
| `date_of_birth` | `employee_profiles.date_of_birth` | No | `YYYY-MM-DD` format |
| `reports_to_email` | lookup → `users.email` → `employee_profiles.reports_to` | No | Email of existing active employee |
| `emergency_contact_name` | `employee_profiles.emergency_contact_name` | No | Max 255 chars |
| `emergency_contact_phone` | `employee_profiles.emergency_contact_phone` | No | Max 20 chars |
| `role` | lookup → `roles.name` → `user_roles` | No | Role name. Default: "Employee" if blank. Multiple roles separated by semicolons (`;`). |

**Sample Row:**
```
,John,Doe,john@acme.com,+911234567890,ENG,SR-ENG,permanent,2026-03-01,1990-05-15,manager@acme.com,Jane Doe,+919876543210,Employee
```

**Comment Row (row 3):**
```
# employee_id is auto-generated if blank. department_code and designation_code must match existing records. employment_type: permanent|contract|intern|freelance. Dates: YYYY-MM-DD. role: role name (default Employee). Multiple roles separated by semicolons.
```

**Response:** `StreamableFile` with:
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="employee_import_template.csv"`
- Encoding: UTF-8 with BOM

---

### 3.2 `POST /api/employees/import` — Bulk Import Employees

**Permission:** `@RequirePermission('employee_management', 'import', 'employees')`
**Guards:** `TenantAuthGuard`, `PermissionGuard`, `SeatLimitGuard` with `@CheckSeatLimit()`
**Audit:** `@AuditAction('import', 'employee_management', 'employees')`
**Rate Limit:** 5 req/min/user

**Request:** `multipart/form-data`
- Field: `file` — CSV file upload. Max size: 5MB.
- Field: `sendWelcomeEmails` — boolean string (`"true"` or `"false"`). Default: `"true"`.
- Field: `dryRun` — boolean string. Default: `"false"`. If true, validates everything but does not persist. Returns what would happen.

**Processing Pipeline:**

**Step 1 — File Validation**

1. Verify file exists and has `.csv` extension
2. Verify file size ≤ 5MB
3. Parse CSV using a streaming parser (e.g., `csv-parse`)
4. Verify header row is present and matches expected columns (case-insensitive, trimmed). Unknown columns are ignored, but all required column headers must be present. If missing required headers → return `400`:
   ```
   { success: false, error: "INVALID_TEMPLATE", message: "Missing required columns: first_name, email" }
   ```
5. Count data rows (excluding header and comment rows starting with `#`)

**Step 2 — Seat Limit Pre-flight (Sprint 2D Section 3.6)**

1. Fetch tenant's `current_user_count` and `max_users` from `platform.tenants`
2. Calculate `availableSeats = max_users - current_user_count`
3. If `rowCount > availableSeats` → return `400`:
   ```
   {
     success: false,
     error: "SEAT_LIMIT_EXCEEDED",
     message: "Import would exceed seat limit. You have {availableSeats} seats remaining but the file contains {rowCount} employees."
   }
   ```

**Step 3 — Pre-load Lookup Data**

Before iterating rows, pre-load all lookup tables into memory maps for efficient validation:

| Lookup | Query | Map Key | Map Value |
|---|---|---|---|
| Departments | `SELECT id, code FROM departments` | `code` (uppercase) | `id` |
| Designations | `SELECT id, code FROM designations` | `code` (uppercase) | `id` |
| Existing emails | `SELECT email FROM users` | `email` (lowercase) | `true` |
| Existing employee IDs | `SELECT employee_id FROM users WHERE employee_id IS NOT NULL` | `employee_id` | `true` |
| Users by email (for reports_to) | `SELECT id, email FROM users WHERE status = 'active'` | `email` (lowercase) | `id` |
| Roles | `SELECT id, name FROM roles` | `name` (lowercase) | `id` |
| Organization settings | `SELECT company_email_domain FROM organization_settings LIMIT 1` | — | domain string |

**Step 4 — Row-by-Row Validation**

For each data row (1-indexed from after the header), run all validations and collect errors. A row can have multiple errors. All rows are validated even if earlier rows have errors (report everything in one pass).

**Validation Rules per Row:**

| Field | Validations | Error Message |
|---|---|---|
| `first_name` | Required, non-empty, ≤100 chars | "First name is required" / "First name exceeds 100 characters" |
| `last_name` | Required, non-empty, ≤100 chars | "Last name is required" |
| `email` | Required, valid email format, unique within file (no duplicates in CSV), unique within tenant (against pre-loaded map) | "Email is required" / "Invalid email format" / "Duplicate email in file (row {otherRow})" / "Email already exists in the system" |
| `phone` | If present: ≤20 chars | "Phone exceeds 20 characters" |
| `department_code` | Required, must match pre-loaded departments map (case-insensitive) | "Department code is required" / "Department code '{code}' not found" |
| `designation_code` | Required, must match pre-loaded designations map (case-insensitive) | "Designation code is required" / "Designation code '{code}' not found" |
| `employment_type` | Required, must be one of: permanent, contract, intern, freelance (case-insensitive) | "Employment type is required" / "Invalid employment type. Must be: permanent, contract, intern, or freelance" |
| `date_of_joining` | Required, valid `YYYY-MM-DD` format, parseable date | "Date of joining is required" / "Invalid date format. Use YYYY-MM-DD" |
| `date_of_birth` | If present: valid `YYYY-MM-DD`, must be in the past | "Invalid date format" / "Date of birth must be in the past" |
| `reports_to_email` | If present: must match an active user's email in the pre-loaded map | "Manager with email '{email}' not found or inactive" |
| `emergency_contact_name` | If present: ≤255 chars | "Emergency contact name exceeds 255 characters" |
| `emergency_contact_phone` | If present: ≤20 chars | "Emergency contact phone exceeds 20 characters" |
| `employee_id` | If present: ≤50 chars, unique within file, unique within tenant | "Employee ID exceeds 50 characters" / "Duplicate employee ID in file (row {otherRow})" / "Employee ID already exists in the system" |
| `role` | If present: each role name (split by `;`) must match pre-loaded roles map (case-insensitive) | "Role '{name}' not found" |

**Duplicate tracking within file:** Maintain a `Set<string>` for emails and employee IDs seen so far in the file. If a duplicate is found, reference the first row number where that value appeared.

**Step 5 — Error Reporting (if any validation errors exist)**

If any row has errors AND `dryRun` is false → still proceed to import valid rows and skip invalid rows (partial import). The response reports both successes and failures.

If `dryRun` is true → return the full validation report without persisting anything.

**Step 6 — Batch Creation (for valid rows only)**

Process valid rows in a single database transaction:

For each valid row:
1. Generate employee ID if blank (same `EMP-{NNNN}` auto-generation as Sprint 3A, incrementing sequentially for each import row)
2. Detect email domain type (compare email domain against `company_email_domain`)
3. Generate temporary password (12-char random, complexity rules)
4. Hash password with bcrypt (12 rounds)
5. Insert `users` row (status: `active`, must_reset_password: `true`)
6. Insert `employee_profiles` row (map department_code → department_id, designation_code → designation_id, reports_to_email → reports_to user id)
7. Insert `user_preferences` default row
8. Insert `user_roles` rows (map role names → role IDs; default: "Employee" role)

After all valid rows inserted:
9. Increment seat count in bulk: `UPDATE platform.tenants SET current_user_count = current_user_count + {validRowCount} WHERE id = $tenantId`
10. If `sendWelcomeEmails` is true → queue welcome emails for all created employees (use the same template as Sprint 3A Section 11; batch send — not blocking the response)
11. Send `employee_account_created` notification for each new employee
12. Create a single audit log entry for the import action: `action: 'import'`, `module: 'employee_management'`, `entityType: 'employees'`, `new_value: { importedCount, skippedCount, fileName }`

**Step 7 — Response**

```
{
  success: true,
  data: {
    summary: {
      totalRows: number,
      imported: number,
      skipped: number,
      errors: number
    },
    imported: [
      {
        row: 2,
        employeeId: "EMP-0005",
        email: "john@acme.com",
        name: "John Doe"
      }
    ],
    errors: [
      {
        row: 3,
        field: "email",
        value: "invalid-email",
        message: "Invalid email format"
      },
      {
        row: 3,
        field: "department_code",
        value: "NONEXIST",
        message: "Department code 'NONEXIST' not found"
      },
      {
        row: 5,
        field: "email",
        value: "john@acme.com",
        message: "Duplicate email in file (row 2)"
      }
    ]
  }
}
```

If `dryRun` is true:
```
{
  success: true,
  data: {
    dryRun: true,
    summary: { totalRows: 10, wouldImport: 8, wouldSkip: 2, errors: 3 },
    errors: [ ... ]
  }
}
```

---

## 4. Department CSV Import

### 4.1 `GET /api/departments/import/template` — Download Template

**Permission:** `@RequirePermission('employee_management', 'import', 'employees')` (reuse employee import permission since there's no specific department import permission seeded; alternatively we can gate on `employee_management:create:departments`)

**Template Columns:**

| Column Header | Maps To | Required | Notes |
|---|---|---|---|
| `name` | `departments.name` | Yes | Max 255 chars |
| `code` | `departments.code` | Yes | Max 50 chars, uppercase alphanumeric + underscore/dash |
| `mail_alias` | `departments.mail_alias` | No | Valid email |
| `parent_code` | lookup → `departments.code` → `departments.parent_id` | No | Must match existing department code. Leave blank for root. |
| `head_email` | lookup → `users.email` → `departments.head_id` | No | Email of existing active employee |

**Sample Row:**
```
Engineering,ENG,eng@acme.com,,cto@acme.com
```

---

### 4.2 `POST /api/departments/import` — Bulk Import Departments

**Permission:** `@RequirePermission('employee_management', 'create', 'departments')`
**Audit:** `@AuditAction('import', 'employee_management', 'departments')`

**Request:** `multipart/form-data` with `file` (CSV, max 2MB) and `dryRun` (boolean string).

**Processing:**

1. Parse and validate headers
2. Pre-load lookup data: existing department codes, users by email
3. Row-by-row validation:
   - `name`: required, ≤255 chars, unique within file
   - `code`: required, ≤50 chars, regex `^[A-Z0-9_-]+$`, unique within file, unique within tenant
   - `mail_alias`: if present, valid email format
   - `parent_code`: if present, must match an existing department code OR a code from an earlier row in the same file (supports importing a hierarchy in order)
   - `head_email`: if present, must match an active user's email
4. **Row ordering matters:** Process rows top-to-bottom. A parent department defined earlier in the file can be referenced by a child row later in the file. Track newly inserted departments in a running map.
5. Validate depth does not exceed 5 levels
6. Batch insert valid rows in transaction
7. Return same response shape as employee import: `{ summary, imported, errors }`

---

## 5. Designation CSV Import

### 5.1 `GET /api/designations/import/template` — Download Template

**Permission:** `@RequirePermission('employee_management', 'create', 'designations')`

**Template Columns:**

| Column Header | Maps To | Required | Notes |
|---|---|---|---|
| `name` | `designations.name` | Yes | Max 255 chars |
| `code` | `designations.code` | Yes | Max 50 chars, uppercase |
| `hierarchy_level` | `designations.hierarchy_level` | Yes | Integer ≥ 0. 0 = highest rank. |

**Sample Row:**
```
Senior Engineer,SR-ENG,4
```

---

### 5.2 `POST /api/designations/import` — Bulk Import Designations

**Permission:** `@RequirePermission('employee_management', 'create', 'designations')`
**Audit:** `@AuditAction('import', 'employee_management', 'designations')`

**Request:** `multipart/form-data` with `file` (CSV, max 2MB) and `dryRun`.

**Processing:**
1. Parse and validate headers
2. Pre-load existing designation codes and names
3. Row-by-row validation:
   - `name`: required, ≤255 chars, unique within file, unique within tenant
   - `code`: required, ≤50 chars, regex match, unique within file, unique within tenant
   - `hierarchy_level`: required, integer ≥ 0, ≤ 100
4. Batch insert valid rows
5. Return same response shape

---

## 6. Missing Export Endpoints

The following export endpoints were deferred from Sprint 3C. Add them now.

### 6.1 `GET /api/groups/export` — Export Groups

**Permission:** `@RequirePermission('employee_management', 'view', 'groups')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as `GET /api/groups` + `format` (`csv`, `xlsx`, `pdf`)

**Export Columns:**

| Header | Source |
|---|---|
| Group Name | `name` |
| Description | `description` |
| Member Count | computed |
| Created By | `createdBy.firstName lastName` |
| Created Date | `createdAt` formatted |

File name: `groups_{YYYY-MM-DD}.{format}`

---

### 6.2 `GET /api/projects/export` — Export Projects

**Permission:** `@RequirePermission('employee_management', 'view', 'projects')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as `GET /api/projects` + `format`

**Export Columns:**

| Header | Source | Notes |
|---|---|---|
| Project Name | `name` | |
| Description | `description` | Truncated to 200 chars in export |
| Manager | `manager.firstName lastName` | |
| Budget | `budget` | **Only included if exporter is Admin or project manager.** Otherwise column omitted entirely. |
| Status | `status` | |
| Members | `memberCount` | |
| Tasks (Total) | `taskCount` | |
| Tasks (Completed) | `completedTaskCount` | |
| Start Date | `startDate` | |
| End Date | `endDate` | |

**Data visibility:** Same scoping as the list endpoint — non-admin users only export projects they manage or are members of.

File name: `projects_{YYYY-MM-DD}.{format}`

---

### 6.3 `GET /api/delegations/export` — Export Delegations

**Permission:** `@RequirePermission('employee_management', 'view', 'delegations')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as `GET /api/delegations` + `format`

**Export Columns:**

| Header | Source |
|---|---|
| Delegator | `delegator.firstName lastName` |
| Delegator Employee ID | `delegator.employeeId` |
| Delegatee | `delegatee.firstName lastName` |
| Delegatee Employee ID | `delegatee.employeeId` |
| Type | `type` |
| Description | `description` |
| Start Date | `startDate` |
| End Date | `endDate` |
| Status | `status` |
| Created Date | `createdAt` |

**Data visibility:** Same scoping as list — managers see only their delegations, employees see only delegations assigned to them.

File name: `delegations_{YYYY-MM-DD}.{format}`

---

### 6.4 `GET /api/projects/:projectId/tasks/export` — Export Project Tasks

**Permission:** `@RequirePermission('employee_management', 'view', 'projects')`
**Rate Limit:** 5 req/min/user

**Access:** Must be Admin, or manager/member of the project.

**Query Parameters:** Same filters as `GET /api/projects/:projectId/tasks` + `format`

**Export Columns:**

| Header | Source |
|---|---|
| Title | `title` |
| Description | `description` |
| Assignee | `assignee.firstName lastName` |
| Status | `status` |
| Priority | `priority` |
| Due Date | `dueDate` |
| Created Date | `createdAt` |

File name: `{projectName}_tasks_{YYYY-MM-DD}.{format}`

---

## 7. Frontend: Employee Import Dialog

### 7.1 Trigger

"Add Employee(s)" button on the employee list page becomes a dropdown with two options:
- "Add Employee" → opens the existing Add Employee drawer (Sprint 3A)
- "Import from CSV" → opens the import dialog

Permission: `employee_management:import:employees`

### 7.2 Import Dialog — 3-Step Wizard

**Step 1: Upload**

- Title: "Import Employees from CSV"
- Description: "Upload a CSV file with employee data. Download the template for the correct format."
- "Download Template" link → calls `GET /api/employees/import/template`, triggers browser download
- File dropzone: drag-and-drop or click to browse. Accept: `.csv` only. Max 5MB.
- Checkbox: "Send welcome emails to imported employees" (default: checked)
- "Validate" button → proceeds to Step 2 with `dryRun=true`

**Step 2: Review**

Calls `POST /api/employees/import` with `dryRun=true`.

Shows validation results:

- Summary card: "{totalRows} rows found. {wouldImport} valid, {wouldSkip} with errors."
- If all valid → green banner: "All rows are valid and ready to import."
- If errors exist → error table:

| Row | Field | Value | Error |
|---|---|---|---|
| 3 | email | invalid-email | Invalid email format |
| 3 | department_code | NONEXIST | Department code 'NONEXIST' not found |
| 5 | email | john@acme.com | Duplicate email in file (row 2) |

- Warning: "Rows with errors will be skipped. Only valid rows will be imported."
- Two buttons: "Import {wouldImport} Employees" (primary), "Cancel" (secondary)
- If `wouldImport === 0` → disable import button, show "Fix the errors and re-upload."

**Step 3: Results**

Calls `POST /api/employees/import` with `dryRun=false`.

Shows final results:

- Success banner: "{imported} employees imported successfully."
- If any were skipped → warning: "{skipped} rows were skipped due to errors."
- Imported list: table showing row, employee ID, name, email for each imported employee
- If welcome emails were sent → note: "Welcome emails have been sent to all imported employees."
- "Close" button → closes dialog, refreshes employee list

### 7.3 Loading States

- Step 1 → Step 2: "Validating {totalRows} rows..." progress indicator
- Step 2 → Step 3: "Importing {wouldImport} employees..." progress indicator
- Both calls may take 5-30 seconds for large files. Show animated spinner with elapsed time.

---

## 8. Frontend: Department & Designation Import Dialogs

### 8.1 Department Import

Same 3-step wizard pattern as employee import but simpler (fewer columns, no welcome emails).

**Trigger:** "Add Department" button on departments page becomes a dropdown: "Add Department" (opens form drawer) + "Import from CSV" (opens import dialog).

**Permission:** `employee_management:create:departments`

**Template download:** `GET /api/departments/import/template`
**Dry run:** `POST /api/departments/import` with `dryRun=true`
**Import:** `POST /api/departments/import` with `dryRun=false`

### 8.2 Designation Import

Same pattern.

**Trigger:** "Add Designation" button dropdown + "Import from CSV"

**Permission:** `employee_management:create:designations`

**Template download:** `GET /api/designations/import/template`

---

## 9. Export Consistency Audit

Verify that all data-table pages across Sprint 3 modules have a working export menu (three-dots → CSV / XLSX / PDF or CSV / XLSX).

| Page | Export Endpoint | Formats | Sprint Defined | Sprint Implemented |
|---|---|---|---|---|
| Employees | `GET /api/employees/export` | CSV, XLSX, PDF | 3A | 3A ✅ |
| Departments | `GET /api/departments/export` | CSV, XLSX | 3B | 3B ✅ |
| Designations | `GET /api/designations/export` | CSV, XLSX | 3B | 3B ✅ |
| Groups | `GET /api/groups/export` | CSV, XLSX, PDF | 3D | This sprint |
| Projects | `GET /api/projects/export` | CSV, XLSX, PDF | 3D | This sprint |
| Project Tasks | `GET /api/projects/:id/tasks/export` | CSV, XLSX, PDF | 3D | This sprint |
| Delegations | `GET /api/delegations/export` | CSV, XLSX, PDF | 3D | This sprint |

All export endpoints share the pattern: same filters as the list endpoint, `format` query param, `StreamableFile` response with correct Content-Type and Content-Disposition headers, rate limited to 5 req/min/user.

Wire the export menu on the Groups, Projects, and Delegations frontend pages to call these new endpoints.

---

## 10. Audit Logging Integration Audit

Verify that all CUD (Create, Update, Delete) operations across the Employee Management module have `@AuditAction()` decorators producing audit_log entries.

| Operation | Module | Entity Type | Action | Sprint |
|---|---|---|---|---|
| Create employee | employee_management | employees | create | 3A ✅ |
| Update employee | employee_management | employees | update | 3A ✅ |
| Archive employee | employee_management | employees | delete | 3A ✅ |
| Import employees | employee_management | employees | import | **3D (this sprint)** |
| Create department | employee_management | departments | create | 3B ✅ |
| Update department | employee_management | departments | update | 3B ✅ |
| Delete department | employee_management | departments | delete | 3B ✅ |
| Import departments | employee_management | departments | import | **3D (this sprint)** |
| Create designation | employee_management | designations | create | 3B ✅ |
| Update designation | employee_management | designations | update | 3B ✅ |
| Delete designation | employee_management | designations | delete | 3B ✅ |
| Import designations | employee_management | designations | import | **3D (this sprint)** |
| Update reporting hierarchy | employee_management | reporting_hierarchy | update | 3B ✅ |
| Create group | employee_management | groups | create | 3C ✅ |
| Update group | employee_management | groups | update | 3C ✅ |
| Delete group | employee_management | groups | delete | 3C ✅ |
| Add/remove group members | employee_management | groups | update | 3C ✅ |
| Create project | employee_management | projects | create | 3C ✅ |
| Update project | employee_management | projects | update | 3C ✅ |
| Delete project | employee_management | projects | delete | 3C ✅ |
| Create task | employee_management | projects | create | 3C ✅ |
| Update task | employee_management | projects | update | 3C ✅ |
| Delete task | employee_management | projects | delete | 3C ✅ |
| Create delegation | employee_management | delegations | create | 3C ✅ |
| Update delegation | employee_management | delegations | update | 3C ✅ |
| Delete delegation | employee_management | delegations | delete | 3C ✅ |

**Import audit entries** should store:
- `action`: `'import'`
- `entity_type`: `'employees'` / `'departments'` / `'designations'`
- `new_value` (JSONB): `{ importedCount, skippedCount, totalRows, fileName }`
- `entity_id`: null (bulk operation, not tied to a single entity)

---

## 11. Notification Events Integration Audit

Verify that all Employee Management notification events are properly wired to the `NotificationService`.

| Event | Notification Type | Recipient | In-App | Email | Sprint |
|---|---|---|---|---|---|
| New employee created | `employee_account_created` | The new employee | ✅ | ✅ | 3A ✅ |
| Task assigned | `task_assigned` | Task assignee | ✅ | ✅ | 3C ✅ |
| Task status updated | `task_status_updated` | Project manager | ✅ | ❌ | 3C ✅ |
| Delegation created | `delegation_created` | Delegatee | ✅ | ✅ | 3C ✅ |
| Bulk import completed | `employee_account_created` | Each imported employee | ✅ | ✅ | **3D (this sprint)** |

**Notification dispatch pattern:** Each notification call checks `notification_settings` for the relevant type to respect admin-configured in_app/email toggles. If the admin has disabled email for `employee_account_created`, the welcome email still sends (it's a separate mechanism from notifications — the welcome email is a direct `EmailService` call with credentials, not a notification-triggered email). The notification email is a separate "your account has been created" message without credentials.

For bulk imports: queue notifications asynchronously (e.g., using `setImmediate` or a simple in-process queue) to avoid blocking the import response. Welcome emails are also queued in batch.

---

## 12. Permission Check Integration Audit

Verify all Sprint 3 endpoints use the correct permission guards.

| Endpoint | Required Permission | Guard Stack |
|---|---|---|
| `GET /api/employees` | `employee_management:view:employees` | TenantAuth + Permission |
| `POST /api/employees` | `employee_management:create:employees` | TenantAuth + Permission + SeatLimit |
| `GET /api/employees/:id` | `employee_management:view:employees` | TenantAuth + Permission |
| `PUT /api/employees/:id` | `employee_management:edit:employees` | TenantAuth + Permission |
| `DELETE /api/employees/:id` | `employee_management:delete:employees` | TenantAuth + Permission |
| `GET /api/employees/:id/reportees` | `employee_management:view:employees` | TenantAuth + Permission |
| `GET /api/employees/export` | `employee_management:export:employees` | TenantAuth + Permission |
| `GET /api/employees/import/template` | `employee_management:import:employees` | TenantAuth + Permission |
| `POST /api/employees/import` | `employee_management:import:employees` | TenantAuth + Permission + SeatLimit |
| `GET /api/employees/lookup` | (any authenticated user) | TenantAuth only |
| `GET /api/employees/org-chart` | `employee_management:view:employees` | TenantAuth + Permission |
| `GET /api/departments` | `employee_management:view:departments` | TenantAuth + Permission |
| `POST /api/departments` | `employee_management:create:departments` | TenantAuth + Permission |
| `PUT /api/departments/:id` | `employee_management:edit:departments` | TenantAuth + Permission |
| `DELETE /api/departments/:id` | `employee_management:delete:departments` | TenantAuth + Permission |
| `POST /api/departments/import` | `employee_management:create:departments` | TenantAuth + Permission |
| `GET /api/designations` | `employee_management:view:designations` | TenantAuth + Permission |
| `POST /api/designations` | `employee_management:create:designations` | TenantAuth + Permission |
| `PUT /api/designations/:id` | `employee_management:edit:designations` | TenantAuth + Permission |
| `DELETE /api/designations/:id` | `employee_management:delete:designations` | TenantAuth + Permission |
| `POST /api/designations/import` | `employee_management:create:designations` | TenantAuth + Permission |
| `GET /api/reporting-hierarchy` | `employee_management:view:reporting_hierarchy` | TenantAuth + Permission |
| `PUT /api/reporting-hierarchy` | `employee_management:edit:reporting_hierarchy` | TenantAuth + Permission |
| `GET /api/groups` | `employee_management:view:groups` | TenantAuth + Permission |
| `POST /api/groups` | `employee_management:create:groups` | TenantAuth + Permission |
| `PUT /api/groups/:id` | `employee_management:edit:groups` | TenantAuth + Permission |
| `DELETE /api/groups/:id` | `employee_management:delete:groups` | TenantAuth + Permission |
| `GET /api/projects` | `employee_management:view:projects` | TenantAuth + Permission |
| `POST /api/projects` | `employee_management:create:projects` | TenantAuth + Permission |
| `PUT /api/projects/:id` | `employee_management:edit:projects` | TenantAuth + Permission |
| `DELETE /api/projects/:id` | `employee_management:delete:projects` | TenantAuth + Permission |
| `GET /api/projects/:id/tasks` | `employee_management:view:projects` | TenantAuth + Permission |
| `POST /api/projects/:id/tasks` | `employee_management:edit:projects` | TenantAuth + Permission |
| `PUT /api/projects/:id/tasks/:taskId` | `employee_management:edit:projects` | TenantAuth + Permission |
| `DELETE /api/projects/:id/tasks/:taskId` | `employee_management:edit:projects` | TenantAuth + Permission |
| `GET /api/delegations` | `employee_management:view:delegations` | TenantAuth + Permission |
| `POST /api/delegations` | `employee_management:create:delegations` | TenantAuth + Permission |
| `PUT /api/delegations/:id` | `employee_management:edit:delegations` | TenantAuth + Permission |
| `DELETE /api/delegations/:id` | `employee_management:delete:delegations` | TenantAuth + Permission |

All export endpoints: corresponding `view` permission + rate limit 5 req/min/user.

---

## 13. Data Visibility Scoping Integration Audit

Verify that role-based data visibility is consistently applied:

| Endpoint Category | Admin/HR | Manager/Team Lead | Employee |
|---|---|---|---|
| Employee list/detail | All employees | Direct reportees only | Own record only |
| Employee export | All employees | Own reportees only | Own record only |
| Employee import | Can import | Cannot import (no permission) | Cannot import |
| Org chart | Full tree | Own subtree | Own node |
| Departments | All | All (read-only) | All (read-only) |
| Designations | All | All (read-only) | All (read-only) |
| Groups | All | All (read-only for most) | All (read-only) |
| Projects list | All projects | Own + member projects | Member projects only |
| Project budget | Visible | Visible (if manager) | Hidden |
| Project tasks | All | Own projects' tasks | Own projects' tasks |
| Delegations | All | Own (as delegator/delegatee) | Own (as delegatee only) |

---

## 14. Scope Boundaries

### In Scope (Sprint 3D)
- Employee CSV import: template download + bulk import with per-row validation + dry run + partial import
- Department CSV import: template + bulk import
- Designation CSV import: template + bulk import
- Seat limit pre-flight check for bulk import
- Groups export endpoint (CSV/XLSX/PDF)
- Projects export endpoint (CSV/XLSX/PDF, budget visibility respected)
- Project tasks export endpoint (CSV/XLSX/PDF)
- Delegations export endpoint (CSV/XLSX/PDF, data visibility respected)
- Export menu wired on Groups, Projects, Delegations frontend pages
- Employee import 3-step wizard dialog (upload → review/dry-run → import/results)
- Department + Designation import dialogs
- "Add Employee(s)" button converted to dropdown (Add / Import)
- Integration audit: audit logging on all CUD + import operations
- Integration audit: notification events wired for employee creation + task assignment + delegation
- Integration audit: permission guards on all endpoints
- Integration audit: data visibility scoping on all list/detail/export endpoints

### Out of Scope
| Feature | Target |
|---|---|
| Holiday import | Sprint 4 (Leave Management) |
| Leave balance import | Sprint 4 (Leave Management) |
| Export templates for other modules | Respective module sprints |
| Async import processing (job queue) | Future — current sync approach handles files up to ~500 rows. For larger imports, a background job system would be needed. |
| Import history/log page | Future |
| Undo/rollback import | Future |

---

## 15. Verification & Acceptance Criteria

### Employee Import Tests

**Test 1: Download template**
```
GET /api/employees/import/template
→ 200: CSV file with header row, sample row, comment row
Verify: File has UTF-8 BOM, 14 column headers match PRD spec
```

**Test 2: Dry run — all valid**
```
POST /api/employees/import
Form: file=valid.csv, dryRun=true
→ 200: { dryRun: true, summary: { totalRows: 3, wouldImport: 3, wouldSkip: 0, errors: 0 } }
Verify: No records created in DB
```

**Test 3: Dry run — mixed valid/invalid**
```
POST /api/employees/import
Form: file=mixed.csv, dryRun=true
→ 200: { dryRun: true, summary: { totalRows: 5, wouldImport: 3, wouldSkip: 2, errors: 4 }, errors: [...] }
Verify: No records created. Error array contains per-row/per-field detail.
```

**Test 4: Actual import — all valid**
```
POST /api/employees/import
Form: file=valid.csv, sendWelcomeEmails=true, dryRun=false
→ 200: { summary: { totalRows: 3, imported: 3, skipped: 0 }, imported: [...] }

Verify:
- 3 new users in DB with status='active', must_reset_password=true
- 3 employee_profiles created with correct department/designation
- 3 user_roles entries (default Employee role)
- 3 user_preferences default rows
- platform.tenants.current_user_count incremented by 3
- 3 welcome emails queued/sent
- 3 employee_account_created notifications created
- 1 audit log entry (action: 'import', new_value: { importedCount: 3, ... })
- Employee IDs auto-generated sequentially (EMP-0001, EMP-0002, EMP-0003)
```

**Test 5: Actual import — partial (some rows invalid)**
```
POST /api/employees/import
Form: file=mixed.csv, dryRun=false
→ 200: { summary: { totalRows: 5, imported: 3, skipped: 2, errors: 4 }, imported: [...], errors: [...] }

Verify: Only 3 valid rows created. Seat count incremented by 3 (not 5).
```

**Test 6: Seat limit pre-flight**
```
# Tenant: current=8, max=10, CSV has 5 rows
POST /api/employees/import
Form: file=5rows.csv
→ 400: SEAT_LIMIT_EXCEEDED "You have 2 seats remaining but the file contains 5 employees."
Verify: No records created
```

**Test 7: Missing required headers**
```
POST /api/employees/import
Form: file=bad_headers.csv  # missing email column
→ 400: INVALID_TEMPLATE "Missing required columns: email"
```

**Test 8: Duplicate emails within file**
```
# Row 2: john@acme.com, Row 4: john@acme.com
POST /api/employees/import
Form: file=dupes.csv, dryRun=true
→ 200: errors includes { row: 4, field: "email", message: "Duplicate email in file (row 2)" }
```

**Test 9: Email already exists in tenant**
```
# existing@acme.com already in users table
POST /api/employees/import
Form: file=existing.csv, dryRun=true
→ 200: errors includes { row: 2, field: "email", message: "Email already exists in the system" }
```

**Test 10: Department code not found**
```
POST /api/employees/import
Form: file=bad_dept.csv  # department_code: NONEXIST
→ errors includes { field: "department_code", message: "Department code 'NONEXIST' not found" }
```

**Test 11: Reports-to resolution**
```
# reports_to_email: manager@acme.com (exists and active)
POST /api/employees/import
Form: file=with_manager.csv, dryRun=false
→ employee_profiles.reports_to = manager's user ID
```

**Test 12: Multiple roles via semicolons**
```
# role column: "Manager;Employee"
POST /api/employees/import
→ user_roles has entries for both Manager and Employee roles
```

**Test 13: Employee ID auto-generation across import**
```
# 3 rows, all with blank employee_id. Last existing: EMP-0010
POST /api/employees/import
→ imported employees have IDs: EMP-0011, EMP-0012, EMP-0013
```

**Test 14: Email domain detection**
```
# org company_email_domain = acme.com
# Row 2: john@acme.com, Row 3: jane@gmail.com
→ Row 2: email_domain_type = 'company'
→ Row 3: email_domain_type = 'external'
```

### Department Import Tests

**Test 15: Department import with parent reference within file**
```
# Row 2: Engineering,ENG,,,  (root dept)
# Row 3: Frontend,FE,,,ENG   (parent = ENG from row 2)
POST /api/departments/import { dryRun: false }
→ Both imported. Frontend dept has parent_id = Engineering's ID
```

**Test 16: Department duplicate code**
```
# ENG already exists in tenant
→ error: "Department code 'ENG' already exists in the system"
```

### Designation Import Tests

**Test 17: Designation import**
```
POST /api/designations/import
Form: file with 3 designations
→ 3 designations created with correct hierarchy levels
```

### Export Tests

**Test 18: Groups export**
```
GET /api/groups/export?format=csv
→ 200: CSV file with group data
```

**Test 19: Projects export — budget visibility**
```
GET /api/projects/export?format=xlsx
Headers: Bearer <employee_token>
→ XLSX file does NOT contain Budget column

GET /api/projects/export?format=xlsx
Headers: Bearer <admin_token>
→ XLSX file contains Budget column
```

**Test 20: Delegations export — data visibility**
```
GET /api/delegations/export?format=csv
Headers: Bearer <manager_token>
→ CSV contains only delegations where manager is delegator or delegatee
```

**Test 21: Project tasks export**
```
GET /api/projects/{projectId}/tasks/export?format=pdf
→ PDF with tasks for that project
```

### Frontend Tests

- [ ] "Add Employee(s)" button is now a dropdown: "Add Employee" + "Import from CSV"
- [ ] Import dialog: Step 1 — file upload dropzone, template download link, send welcome email checkbox
- [ ] Import dialog: Step 1 → Step 2 — "Validating..." loading state
- [ ] Import dialog: Step 2 — summary card shows valid/error counts, error table with row/field/value/message
- [ ] Import dialog: Step 2 — if all valid, green banner and enabled import button
- [ ] Import dialog: Step 2 — if no valid rows, disabled import button with fix message
- [ ] Import dialog: Step 2 → Step 3 — "Importing..." loading state
- [ ] Import dialog: Step 3 — success banner with imported count, skipped count, imported employee list
- [ ] Import dialog: Close → refreshes employee list
- [ ] Department "Add Department" button is now dropdown with "Import from CSV" option
- [ ] Designation "Add Designation" button is now dropdown with "Import from CSV" option
- [ ] Groups page: export menu (three-dots) with CSV / XLSX / PDF options
- [ ] Projects page: export menu with CSV / XLSX / PDF options
- [ ] Delegations page: export menu with CSV / XLSX / PDF options
- [ ] Project detail tasks section: export menu
- [ ] All export menus trigger file download with correct filename and format

### Full Checklist

**Backend — Import:**
- [ ] `GET /api/employees/import/template` — CSV template with 14 columns, sample row, comment row, UTF-8 BOM
- [ ] `POST /api/employees/import` — multipart CSV upload, dryRun support, seat limit pre-flight
- [ ] Import validator: 14-field validation per row, duplicate detection within file and against DB
- [ ] Pre-load lookup maps for departments, designations, emails, employee IDs, users, roles, org settings
- [ ] Partial import: valid rows inserted, invalid rows skipped, both reported
- [ ] Auto-gen employee IDs sequentially for blank entries
- [ ] Email domain detection per row
- [ ] Temporary password generation per row
- [ ] Role assignment from CSV (semicolon-separated, default Employee)
- [ ] Reports-to resolution from email to user ID
- [ ] Seat count incremented by valid-row count
- [ ] Welcome emails batched for all imported employees
- [ ] Notifications queued for all imported employees
- [ ] Single audit log entry for import operation
- [ ] `GET /api/departments/import/template` — 5-column template
- [ ] `POST /api/departments/import` — with parent reference resolution within file, depth validation
- [ ] `GET /api/designations/import/template` — 3-column template
- [ ] `POST /api/designations/import` — with code/name uniqueness

**Backend — Export:**
- [ ] `GET /api/groups/export` — CSV/XLSX/PDF
- [ ] `GET /api/projects/export` — CSV/XLSX/PDF with budget visibility
- [ ] `GET /api/delegations/export` — CSV/XLSX/PDF with data visibility scoping
- [ ] `GET /api/projects/:projectId/tasks/export` — CSV/XLSX/PDF
- [ ] All exports: rate limited 5 req/min, StreamableFile, correct Content-Type/Disposition

**Backend — Integration Verification:**
- [ ] All 26 CUD operations across Sprint 3 have `@AuditAction()` producing audit_log entries
- [ ] All 3 import operations produce audit_log entries
- [ ] 5 notification types wired: employee_account_created, task_assigned, task_status_updated, delegation_created, (+ bulk import employee_account_created)
- [ ] All 39 endpoints have correct permission guards
- [ ] Data visibility scoping applied on all list/detail/export endpoints per role

**Frontend:**
- [ ] Employee import 3-step wizard dialog (upload → dry-run review → import results)
- [ ] Department import dialog
- [ ] Designation import dialog
- [ ] "Add Employee(s)" dropdown conversion
- [ ] Export menus on Groups, Projects, Delegations, Project Tasks pages

---

*Sprint 3D Complete. Employee Management module fully built across Sprints 3A–3D.*

*Next: Sprint 4A — Leave Types, Policies & Balance Engine (Leave Management module begins)*
