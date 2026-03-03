# Sprint 3B — Departments, Designations & Reporting Hierarchy

## Goal
Build full CRUD for Departments (with parent-child hierarchy and department head assignment), full CRUD for Designations (with hierarchy level), the Reporting Hierarchy configuration UI (admin maps designation-level reporting chains), and the Org Chart API endpoint that renders the actual employee reporting tree. These populate the "Departments" and "Designations" tabs in the employee module layout (replacing Sprint 3A placeholders) and add a new "Reporting Hierarchy" sub-section accessible from the employee module.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `departments` table (id, name, code, mail_alias, head_id, parent_id, created_at, updated_at) | 1A / 1B | ✅ |
| `designations` table (id, name, code, hierarchy_level, created_at, updated_at) | 1A / 1B | ✅ |
| `reporting_hierarchy` table (id, designation_id UNIQUE, reports_to_designation_id, level) | 1A / 1B | ✅ |
| `employee_profiles.reports_to` field (FK → users.id) | 1A | ✅ |
| `employee_profiles.department_id` + `designation_id` FKs | 1A | ✅ |
| Seeded permissions: `employee_management:*:departments` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `employee_management:*:designations` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `employee_management:view/edit:reporting_hierarchy` | 1B | ✅ |
| Employee module top tab layout with Departments + Designations placeholder tabs | 3A | ✅ |
| `GET /api/employees/departments/options` + `GET /api/employees/designations/options` (lightweight dropdowns) | 3A | ✅ |
| `<DataTable>`, `<PageHeader>`, `<ConfirmDialog>`, `<EmptyState>` shared components | 1H | ✅ |
| `AuditInterceptor` + `@AuditAction()` | 1G | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/departments/departments.module.ts` | NestJS module |
| `src/departments/departments.controller.ts` | Department CRUD + members endpoint |
| `src/departments/departments.service.ts` | Department business logic |
| `src/departments/dto/create-department.dto.ts` | Create DTO |
| `src/departments/dto/update-department.dto.ts` | Update DTO |
| `src/departments/dto/index.ts` | Barrel export |
| `src/designations/designations.module.ts` | NestJS module |
| `src/designations/designations.controller.ts` | Designation CRUD |
| `src/designations/designations.service.ts` | Designation business logic |
| `src/designations/dto/create-designation.dto.ts` | Create DTO |
| `src/designations/dto/update-designation.dto.ts` | Update DTO |
| `src/designations/dto/index.ts` | Barrel export |
| `src/reporting-hierarchy/reporting-hierarchy.module.ts` | NestJS module |
| `src/reporting-hierarchy/reporting-hierarchy.controller.ts` | Hierarchy config + Org Chart |
| `src/reporting-hierarchy/reporting-hierarchy.service.ts` | Hierarchy + Org Chart logic |
| `src/reporting-hierarchy/dto/update-hierarchy.dto.ts` | Bulk update DTO |
| `src/reporting-hierarchy/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/employees/departments/page.tsx` | Departments tab page (replaces placeholder) |
| `src/app/(tenant)/employees/designations/page.tsx` | Designations tab page (replaces placeholder) |
| `src/app/(tenant)/employees/reporting-hierarchy/page.tsx` | Reporting hierarchy config page |
| `src/app/(tenant)/employees/org-chart/page.tsx` | Org chart visualization page |
| `src/components/modules/employees/department-form-drawer.tsx` | Department create/edit drawer |
| `src/components/modules/employees/department-detail-drawer.tsx` | Department detail with members |
| `src/components/modules/employees/designation-form-drawer.tsx` | Designation create/edit drawer |
| `src/components/modules/employees/hierarchy-editor.tsx` | Visual hierarchy chain editor |
| `src/components/modules/employees/org-chart-tree.tsx` | Org chart tree renderer |
| `src/services/departments.ts` | Department API helpers |
| `src/services/designations.ts` | Designation API helpers |
| `src/services/reporting-hierarchy.ts` | Hierarchy + org chart API helpers |

### Module Registration
- Import `DepartmentsModule`, `DesignationsModule`, `ReportingHierarchyModule` into `AppModule`

---

## 3. Tab Layout Update

### 3.1 New Tabs

Add two new navigable items to the employee module top tab bar (Sprint 3A layout):

| Label | Route | Permission | Notes |
|---|---|---|---|
| Reporting Hierarchy | `/employees/reporting-hierarchy` | `employee_management:view:reporting_hierarchy` | New tab |
| Org Chart | `/employees/org-chart` | `employee_management:view:employees` | New tab |

**Updated tab order:** Employees | Departments | Designations | Reporting Hierarchy | Org Chart | Groups | Delegations

The last two (Groups, Delegations) remain as placeholders until Sprint 3C.

---

## 4. Department API Specification

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `departments`.

### 4.1 `GET /api/departments` — List All Departments

**Permission:** `@RequirePermission('employee_management', 'view', 'departments')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Records per page |
| `search` | string | — | Search name or code (ILIKE) |
| `sortBy` | string | `name` | Sort column |
| `sortOrder` | string | `asc` | `asc` or `desc` |
| `parentId` | UUID | — | Filter by parent department (use `null` string for root-level) |

**Sortable columns:** `name`, `code`, `mailAlias`, `createdAt`, `updatedAt`

**Service Logic:**
```
SELECT d.id, d.name, d.code, d.mail_alias, d.head_id, d.parent_id,
       d.created_at, d.updated_at,
       pd.name AS parent_name,
       hd.first_name AS head_first_name, hd.last_name AS head_last_name,
       hd.id AS head_user_id,
       (SELECT COUNT(*) FROM employee_profiles ep WHERE ep.department_id = d.id
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
FROM departments d
LEFT JOIN departments pd ON d.parent_id = pd.id
LEFT JOIN users hd ON d.head_id = hd.id
```

Apply search, filters, sort, pagination.

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, code, mailAlias,
      head: { id, firstName, lastName } | null,
      parent: { id, name } | null,
      employeeCount: number,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.2 `POST /api/departments` — Create Department

**Permission:** `@RequirePermission('employee_management', 'create', 'departments')`
**Audit:** `@AuditAction('create', 'employee_management', 'departments')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `code` | string | `@IsNotEmpty()`, `@MaxLength(50)`, regex `^[A-Z0-9_-]+$` (uppercase alphanumeric + underscore/dash) | Yes |
| `mailAlias` | string | `@IsOptional()`, `@IsEmail()` | No |
| `headId` | UUID | `@IsOptional()`, `@IsUUID()` | No |
| `parentId` | UUID | `@IsOptional()`, `@IsUUID()` | No |

**Service Logic:**
1. Validate code uniqueness: `SELECT id FROM departments WHERE code = $code` → `409 "Department code already exists"`
2. Validate name uniqueness (within same parent scope): `SELECT id FROM departments WHERE name = $name AND (parent_id = $parentId OR ($parentId IS NULL AND parent_id IS NULL))` → `409 "A department with this name already exists at this level"`
3. If `headId` provided → validate user exists and is active: `SELECT id FROM users WHERE id = $headId AND status = 'active'` → `400 "Department head not found or inactive"`
4. If `parentId` provided → validate parent department exists: `SELECT id FROM departments WHERE id = $parentId` → `400 "Parent department not found"`
5. Prevent excessive nesting: count depth of parent chain (walk `parent_id` up). If depth > 5 → `400 "Department hierarchy cannot exceed 5 levels"`
6. Insert into `departments`
7. Return created department

---

### 4.3 `GET /api/departments/:id` — Department Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'departments')`

**Path Param:** `id` (UUID)

**Service Logic:**
Same query as list but filtered to `d.id = $1`. Additionally fetch:

- Children: `SELECT id, name, code FROM departments WHERE parent_id = $1 ORDER BY name`
- Recent members (first 10 employees): `SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url, des.name AS designation_name FROM users u JOIN employee_profiles ep ON u.id = ep.user_id LEFT JOIN designations des ON ep.designation_id = des.id WHERE ep.department_id = $1 AND u.status = 'active' ORDER BY u.first_name LIMIT 10`
- Total member count (from the employee_count subquery)

**Response:**
```
{
  success: true,
  data: {
    id, name, code, mailAlias,
    head: { id, firstName, lastName } | null,
    parent: { id, name, code } | null,
    children: [ { id, name, code } ],
    employeeCount: number,
    recentMembers: [ { id, employeeId, firstName, lastName, email, photoUrl, designation } ],
    createdAt, updatedAt
  }
}
```

---

### 4.4 `PUT /api/departments/:id` — Update Department

**Permission:** `@RequirePermission('employee_management', 'edit', 'departments')`
**Audit:** `@AuditAction('update', 'employee_management', 'departments')`

**Path Param:** `id` (UUID)

**Request Body:** Same fields as create DTO, all optional.

**Service Logic:**
1. Fetch existing department. If not found → `404`.
2. If `code` changed → validate uniqueness (exclude self)
3. If `name` changed → validate uniqueness at same parent level (exclude self)
4. If `headId` changed → validate user exists and active
5. If `parentId` changed:
   - Validate parent exists
   - Prevent self-reference: `parentId !== id`
   - Prevent circular reference: walk the parent chain from the new `parentId` upward — if the current department `id` appears anywhere in that chain → `400 "Circular department hierarchy detected"`
   - Validate depth does not exceed 5
6. Update `departments` row
7. Return updated department

---

### 4.5 `DELETE /api/departments/:id` — Delete Department

**Permission:** `@RequirePermission('employee_management', 'delete', 'departments')`
**Audit:** `@AuditAction('delete', 'employee_management', 'departments')`

**Path Param:** `id` (UUID)

**Service Logic:**
1. Fetch department. If not found → `404`.
2. Check for employees: `SELECT COUNT(*) FROM employee_profiles WHERE department_id = $1`. If count > 0 → `400 "Cannot delete department with {count} assigned employees. Reassign them first."`
3. Check for children: `SELECT COUNT(*) FROM departments WHERE parent_id = $1`. If count > 0 → `400 "Cannot delete department with sub-departments. Delete or reassign them first."`
4. Delete department row
5. Return `{ message: "Department deleted" }`

---

### 4.6 `GET /api/departments/:id/members` — Department Members

**Permission:** `@RequirePermission('employee_management', 'view', 'departments')`

**Path Param:** `id` (UUID — department ID)

**Query Parameters:** `page`, `limit`, `search`, `sortBy`, `sortOrder`

**Service Logic:**
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.phone,
       u.photo_url, u.email_domain_type, u.status,
       ep.employment_type, ep.date_of_joining,
       des.name AS designation_name
FROM users u
JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN designations des ON ep.designation_id = des.id
WHERE ep.department_id = $1 AND u.status = 'active'
```

Standard search, sort, pagination. Returns same shape as the employee list (subset of fields).

---

### 4.7 `GET /api/departments/tree` — Department Tree

**Permission:** `@RequirePermission('employee_management', 'view', 'departments')`

Returns the full department hierarchy as a nested tree structure (for use in visual hierarchy displays and parent-department selectors).

**Service Logic:**
1. Fetch all departments: `SELECT id, name, code, parent_id, head_id FROM departments ORDER BY name`
2. Build tree in-memory: root departments (parent_id IS NULL) at top level, each with nested `children` arrays
3. Return recursively nested structure

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, code,
      children: [
        { id, name, code, children: [...] }
      ]
    }
  ]
}
```

---

## 5. Designation API Specification

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `designations`.

### 5.1 `GET /api/designations` — List All Designations

**Permission:** `@RequirePermission('employee_management', 'view', 'designations')`

**Query Parameters:** `page`, `limit`, `search` (name or code), `sortBy` (default: `hierarchyLevel`), `sortOrder` (default: `asc`)

**Sortable columns:** `name`, `code`, `hierarchyLevel`, `createdAt`, `updatedAt`

**Service Logic:**
```
SELECT des.id, des.name, des.code, des.hierarchy_level, des.created_at, des.updated_at,
       (SELECT COUNT(*) FROM employee_profiles ep
        WHERE ep.designation_id = des.id
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id AND u.status = 'active')) AS employee_count
FROM designations des
```

**Response:**
```
{
  success: true,
  data: [
    { id, name, code, hierarchyLevel, employeeCount, createdAt, updatedAt }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 5.2 `POST /api/designations` — Create Designation

**Permission:** `@RequirePermission('employee_management', 'create', 'designations')`
**Audit:** `@AuditAction('create', 'employee_management', 'designations')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `code` | string | `@IsNotEmpty()`, `@MaxLength(50)`, regex `^[A-Z0-9_-]+$` | Yes |
| `hierarchyLevel` | number | `@IsInt()`, `@Min(0)`, `@Max(100)` | Yes |

**Hierarchy Level convention:** 0 = highest (CEO/Owner), larger numbers = lower in hierarchy. This is used by the Reporting Hierarchy editor to suggest logical chains.

**Service Logic:**
1. Validate code uniqueness: `SELECT id FROM designations WHERE code = $code` → `409 "Designation code already exists"`
2. Validate name uniqueness: `SELECT id FROM designations WHERE name = $name` → `409 "A designation with this name already exists"`
3. Insert into `designations`
4. Return created designation

---

### 5.3 `GET /api/designations/:id` — Designation Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'designations')`

**Response:** Designation fields + employee count + list of employees with this designation (paginated).

---

### 5.4 `PUT /api/designations/:id` — Update Designation

**Permission:** `@RequirePermission('employee_management', 'edit', 'designations')`
**Audit:** `@AuditAction('update', 'employee_management', 'designations')`

Same validation as create (uniqueness checks exclude self).

---

### 5.5 `DELETE /api/designations/:id` — Delete Designation

**Permission:** `@RequirePermission('employee_management', 'delete', 'designations')`
**Audit:** `@AuditAction('delete', 'employee_management', 'designations')`

**Service Logic:**
1. Check for employees: `SELECT COUNT(*) FROM employee_profiles WHERE designation_id = $1`. If count > 0 → `400 "Cannot delete designation with {count} assigned employees. Reassign them first."`
2. Check for reporting hierarchy references: `SELECT COUNT(*) FROM reporting_hierarchy WHERE designation_id = $1 OR reports_to_designation_id = $1`. If count > 0 → `400 "Cannot delete designation used in reporting hierarchy. Remove it from the hierarchy first."`
3. Delete designation row
4. Return `{ message: "Designation deleted" }`

---

## 6. Reporting Hierarchy API Specification

The reporting hierarchy defines **designation-level** reporting chains (e.g., "Team Member reports to Assistant Manager, Assistant Manager reports to Manager, Manager reports to CEO"). This is separate from the per-employee `reports_to` field on `employee_profiles`, which represents the actual individual reporting relationship.

The designation-level hierarchy is used as a **template/suggestion** — when creating a new employee with a given designation, the system can auto-suggest who they should report to based on the hierarchy. It's also used to render the Org Chart structure.

Controller prefix: `reporting-hierarchy`.

### 6.1 `GET /api/reporting-hierarchy` — Get Full Hierarchy

**Permission:** `@RequirePermission('employee_management', 'view', 'reporting_hierarchy')`

**Service Logic:**
```
SELECT rh.id, rh.designation_id, rh.reports_to_designation_id, rh.level,
       d.name AS designation_name, d.code AS designation_code,
       pd.name AS reports_to_name, pd.code AS reports_to_code
FROM reporting_hierarchy rh
JOIN designations d ON rh.designation_id = d.id
LEFT JOIN designations pd ON rh.reports_to_designation_id = pd.id
ORDER BY rh.level ASC
```

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      designation: { id, name, code },
      reportsTo: { id, name, code } | null,  // null = top of chain
      level: 0
    },
    {
      designation: { id: "...", name: "VP", code: "VP" },
      reportsTo: { id: "...", name: "CEO", code: "CEO" },
      level: 1
    },
    ...
  ]
}
```

---

### 6.2 `PUT /api/reporting-hierarchy` — Update Full Hierarchy (Bulk)

**Permission:** `@RequirePermission('employee_management', 'edit', 'reporting_hierarchy')`
**Audit:** `@AuditAction('update', 'employee_management', 'reporting_hierarchy')`

This is a **bulk replace** operation — the admin submits the entire hierarchy chain, and the backend replaces the existing `reporting_hierarchy` table contents.

**Request Body (DTO):**

```
{
  entries: [
    { designationId: UUID, reportsToDesignationId: UUID | null, level: number },
    ...
  ]
}
```

| Field | Type | Validation | Required |
|---|---|---|---|
| `entries` | array | `@IsArray()`, `@ValidateNested({ each: true })` | Yes |
| `entries[].designationId` | UUID | `@IsUUID()` | Yes |
| `entries[].reportsToDesignationId` | UUID or null | `@IsOptional()`, `@IsUUID()` | No (null = top of chain) |
| `entries[].level` | number | `@IsInt()`, `@Min(0)` | Yes |

**Service Logic:**

1. Validate all `designationId` values exist in `designations` table
2. Validate all non-null `reportsToDesignationId` values exist in `designations` table
3. Validate no duplicate `designationId` entries (each designation appears at most once)
4. Validate no circular references: build a directed graph from the entries and check for cycles using DFS/topological sort
5. Validate exactly one root node: exactly one entry should have `reportsToDesignationId = null` (the top of the hierarchy)
6. Delete all existing `reporting_hierarchy` rows: `DELETE FROM reporting_hierarchy`
7. Insert all new entries: bulk INSERT
8. Return the updated hierarchy (same shape as GET response)

**Note:** Not every designation needs to be in the hierarchy. Designations not included in the entries array are simply not part of the configured reporting chain. The hierarchy represents the organizational template, not a mandatory mapping of all designations.

---

### 6.3 `GET /api/reporting-hierarchy/suggestions/:designationId` — Suggest Manager

**Permission:** Any authenticated user

A utility endpoint used by the "Add Employee" form. Given a designation, it returns the suggested manager designation (from the hierarchy) and a list of active employees with that manager designation.

**Path Param:** `designationId` (UUID)

**Service Logic:**
1. Look up `reporting_hierarchy` where `designation_id = $designationId`
2. If found and `reports_to_designation_id` is not null → get the parent designation
3. Find active employees with that parent designation:
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url
FROM users u
JOIN employee_profiles ep ON u.id = ep.user_id
WHERE ep.designation_id = $parentDesignationId AND u.status = 'active'
ORDER BY u.first_name
LIMIT 10
```
4. Return suggested managers

**Response:**
```
{
  success: true,
  data: {
    reportsToDesignation: { id, name, code } | null,
    suggestedManagers: [ { id, employeeId, firstName, lastName, email, photoUrl } ]
  }
}
```

If the designation is not in the hierarchy or is the top-level → return `reportsToDesignation: null`, `suggestedManagers: []`.

---

## 7. Org Chart API

### 7.1 `GET /api/employees/org-chart` — Full Org Chart

**Permission:** `@RequirePermission('employee_management', 'view', 'employees')`

Returns the complete employee reporting tree as a nested structure, built from `employee_profiles.reports_to` relationships.

**Service Logic:**

1. Fetch all active employees with their reporting relationships:
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.display_name,
       u.email, u.photo_url, u.email_domain_type,
       ep.reports_to, ep.department_id, ep.designation_id,
       d.name AS department_name, des.name AS designation_name
FROM users u
JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
WHERE u.status = 'active'
```

2. Build tree in-memory:
   - Root nodes: employees where `reports_to IS NULL` (typically the CEO/top admin)
   - Each node has a `directReports` array containing their reportees
   - Walk through all employees, attaching each to their manager's `directReports`
   - Handle orphans (employees whose `reports_to` references an archived/non-existent user): place them at root level with a `isOrphan: true` flag

3. Apply data visibility scoping:
   - Admin/HR roles: see full tree
   - Manager: see only their subtree (themselves as root + all nested reportees)
   - Employee: see only themselves (single node, no tree)

**Response:**
```
{
  success: true,
  data: [
    {
      id, employeeId, firstName, lastName, displayName, email, photoUrl,
      emailDomainType,
      department: { id, name } | null,
      designation: { id, name } | null,
      directReports: [
        {
          id, employeeId, firstName, lastName, ...
          directReports: [ ... ]  // recursively nested
        }
      ],
      isOrphan: false
    }
  ]
}
```

### 7.2 `GET /api/employees/org-chart/:id` — Org Chart Subtree

**Permission:** `@RequirePermission('employee_management', 'view', 'employees')`

**Path Param:** `id` (UUID — root employee for the subtree)

Returns the same tree structure but starting from a specific employee. Useful for rendering a focused view of a manager's team. Same data visibility scoping applies.

---

## 8. Frontend: Departments Page

### 8.1 Route: `/employees/departments`

Reference: `EmployeeManagement_departments.png`

**Page Header:**
- Title: "Departments"
- Right: "Add Department" button (permission-gated: `employee_management:create:departments`)

**Toolbar:**
- Search bar (debounced — searches name, code)
- Sort controls
- Export menu (three-dots → CSV / XLSX) — uses `ExportService` via a `GET /api/departments/export` endpoint (implementation note below)

**Table Columns:**

| Column | Source | Sortable | Notes |
|---|---|---|---|
| Checkbox | — | No | Row selection |
| Department Name | `name` | Yes | Clickable → opens detail drawer |
| Department Code | `code` | Yes | Monospace |
| Mail Alias | `mailAlias` | Yes | |
| Head | `head.firstName head.lastName` | No | Avatar + name. Clickable → navigates to employee detail. |
| Parent Department | `parent.name` | No | |
| Employees | `employeeCount` | No | Badge count |
| Created | `createdAt` | Yes | Relative date |
| Actions | — | No | Edit (pencil icon), Delete (trash icon) — permission-gated |

**Row click:** Opens the department detail drawer (Section 8.3).

### 8.2 Department Form Drawer

Opens for both Create and Edit. Right-side drawer.

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Department Name | text input | Required |
| Department Code | text input | Required. Auto-generated from name (uppercase, spaces → underscores, e.g., "Human Resources" → "HR"). Editable. |
| Mail Alias | email input | Optional |
| Department Head | searchable select | Uses `/api/employees/lookup`. Shows employee name + ID. |
| Parent Department | searchable select | Uses `/api/departments/tree` for hierarchical dropdown. Exclude self (on edit) and descendants (prevent circular). |

**Create flow:** Submit → `POST /api/departments` → close drawer, refresh table, toast "Department created".
**Edit flow:** Pre-populate → submit changed fields → `PUT /api/departments/{id}` → close drawer, refresh table, toast "Department updated".

### 8.3 Department Detail Drawer

Opens when clicking a department row. Right-side drawer, wider than form drawer.

**Content:**

**Header:** Department name + code badge. Edit and Delete action buttons (permission-gated).

**Department Info Card:**
- Name, Code, Mail Alias, Head (with avatar), Parent Department (clickable)
- Created/Updated timestamps

**Sub-departments Card:**
- List of child departments (name + code). Clickable → loads that department's detail.
- If none → "No sub-departments"

**Members Card:**
- First 10 members (from `GET /api/departments/:id/members`)
- Each row: avatar, name, designation, email
- "View All ({count})" link → navigates to `/employees?departmentId={id}` (employee list pre-filtered)

### 8.4 Department Delete

"Delete" button on the detail drawer → `<ConfirmDialog>`:
- Title: "Delete Department"
- Description: "Are you sure you want to delete **{name}** ({code})? This action cannot be undone."
- If department has employees or sub-departments → the API returns an error, shown as a toast.

### 8.5 Department Export

Add a lightweight export endpoint:

**`GET /api/departments/export?format=csv|xlsx`**

**Permission:** `@RequirePermission('employee_management', 'view', 'departments')`

Exports all departments with columns: Name, Code, Mail Alias, Head Name, Parent Department, Employee Count. Uses `ExportService`.

---

## 9. Frontend: Designations Page

### 9.1 Route: `/employees/designations`

Reference: `EmployeeManagement_designations.png`

**Page Header:**
- Title: "Designations"
- Right: "Add Designation" button (permission-gated: `employee_management:create:designations`)

**Table Columns:**

| Column | Source | Sortable | Notes |
|---|---|---|---|
| Checkbox | — | No | |
| Designation Name | `name` | Yes | |
| Designation Code | `code` | Yes | Monospace |
| Hierarchy Level | `hierarchyLevel` | Yes | Numeric badge. Lower = higher rank. |
| Employees | `employeeCount` | No | Badge count |
| Created | `createdAt` | Yes | Relative date |
| Actions | — | No | Edit, Delete — permission-gated |

Default sort: `hierarchyLevel ASC` (highest rank first).

### 9.2 Designation Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Designation Name | text input | Required |
| Designation Code | text input | Required. Auto-generated from name (uppercase). |
| Hierarchy Level | number input | Required. Helper text: "0 = highest (e.g., CEO). Higher numbers = lower in hierarchy." |

**Create/Edit:** Same pattern as department form drawer.

### 9.3 Designation Delete

Same pattern as departments. API returns error if employees are assigned or if the designation is used in the reporting hierarchy.

### 9.4 Designation Export

**`GET /api/designations/export?format=csv|xlsx`**

**Permission:** `@RequirePermission('employee_management', 'view', 'designations')`

Exports: Name, Code, Hierarchy Level, Employee Count.

---

## 10. Frontend: Reporting Hierarchy Page

### 10.1 Route: `/employees/reporting-hierarchy`

**Page Header:**
- Title: "Reporting Hierarchy"
- Subtitle: "Configure the designation-level reporting chain for your organization"
- Right: "Edit Hierarchy" button (permission-gated: `employee_management:edit:reporting_hierarchy`) — toggles edit mode

**Read Mode (default):**

Displays the configured hierarchy as a vertical chain visualization:

```
CEO (Level 0)
  └── VP (Level 1)
       └── Director (Level 2)
            └── Manager (Level 3)
                 └── Assistant Manager (Level 4)
                      └── Team Member (Level 5)
```

Each node is a card showing:
- Designation name + code badge
- Level indicator
- Number of employees currently holding this designation
- Connecting lines/arrows to parent

If no hierarchy is configured → `<EmptyState>` with message "No reporting hierarchy configured yet. Set up the chain to define how designations relate." and "Configure" button.

**Edit Mode:**

The hierarchy editor component (`hierarchy-editor.tsx`) provides:

1. **Left panel:** Available designations (all designations NOT yet in the hierarchy). Drag-and-drop or click "Add" to add to the chain.

2. **Right panel:** The current hierarchy chain. Each node is a card with:
   - Designation name (read-only)
   - "Reports To" dropdown: select parent designation from those already in the chain (or "None" for root)
   - Level number (auto-calculated from position in chain, or manually adjustable)
   - "Remove" button (removes from hierarchy, moves back to available list)

3. **Reorder:** Drag nodes to reorder the chain. Level numbers auto-adjust.

4. **Validation (client-side):**
   - Exactly one root node (reports to nobody)
   - No circular references
   - All entries have a valid designation

5. **Save:** "Save Hierarchy" button → `PUT /api/reporting-hierarchy` with the full entries array → toast "Reporting hierarchy updated"

6. **Cancel:** Reverts to the read mode with the last saved state.

---

## 11. Frontend: Org Chart Page

### 11.1 Route: `/employees/org-chart`

**Page Header:**
- Title: "Organization Chart"
- Controls: zoom in/out, fit to screen, expand all/collapse all

**Visualization:**

Renders a tree diagram using the data from `GET /api/employees/org-chart`.

Each node is a card showing:
- Avatar (photo or initials)
- Employee name
- Designation
- Department
- Direct reports count badge

**Interactions:**
- Click a node → navigates to `/employees/{id}` (employee detail)
- Click expand/collapse toggle on a node → shows/hides direct reports subtree
- Hover → tooltip with full info (email, phone, employment type)

**Implementation approach:** Use a tree layout library. Options:
- CSS-based tree with flexbox (simplest, good for moderate sizes)
- D3.js tree layout (for large orgs, supports pan/zoom)
- React Flow (for interactive node-based diagrams)

For v1, use a CSS-based tree with recursive React components. Add pan/zoom if the tree exceeds viewport. Large orgs (50+ employees) should default to collapsed state with expand-on-click.

**Empty State:** "No employees found" or "No reporting relationships configured" if no `reports_to` data exists.

**Orphan handling:** Employees without a `reports_to` value (besides the natural root/CEO) are shown in a separate "Unassigned" section below the main tree with a visual indicator.

---

## 12. Integration: Sprint 3A "Reports To" Enhancement

Now that the reporting hierarchy exists, enhance the "Add Employee" form's "Reports To" field:

When the user selects a designation in the Add Employee form, call `GET /api/reporting-hierarchy/suggestions/{designationId}`. If a suggestion is returned, pre-populate the "Reports To" dropdown with the suggested managers and show a hint: "Suggested based on reporting hierarchy: {managerDesignationName}".

The user can still override and select any active employee as the manager.

This is a frontend-only change to the existing Add Employee drawer (Sprint 3A) — no new APIs needed beyond the suggestion endpoint already defined in Section 6.3.

---

## 13. Scope Boundaries

### In Scope (Sprint 3B)
- Department CRUD (5 endpoints: list, create, detail, update, delete)
- Department members endpoint
- Department tree endpoint (nested hierarchy for selectors)
- Department export
- Designation CRUD (5 endpoints: list, create, detail, update, delete)
- Designation export
- Reporting Hierarchy GET + PUT (bulk replace)
- Manager suggestion endpoint for Add Employee form
- Org Chart API (full tree + subtree)
- Departments page with DataTable, form drawer, detail drawer, delete
- Designations page with DataTable, form drawer, delete
- Reporting Hierarchy page with visual chain editor
- Org Chart page with tree visualization
- Tab layout updated with 2 new tabs (Reporting Hierarchy, Org Chart)
- "Reports To" suggestion integration in Add Employee form
- Audit logging on all CUD operations

### Out of Scope
| Feature | Sprint |
|---|---|
| Department import (CSV) | 3D |
| Designation import (CSV) | 3D |
| Groups CRUD + members | 3C |
| Delegations CRUD | 3C |
| Projects + Tasks | 3C |
| Advanced org chart (D3.js, pan/zoom, large-scale rendering) | Future enhancement |

---

## 14. Verification & Acceptance Criteria

### Department Tests

**Test 1: List departments**
```
GET /api/departments?page=1&limit=10
→ 200: Departments with head info, parent info, employee count
```

**Test 2: Create department**
```
POST /api/departments
Body: { name: "Engineering", code: "ENG", mailAlias: "eng@acme.com", headId: "{userId}" }
→ 201: Department created

POST /api/departments
Body: { name: "Frontend", code: "FE", parentId: "{engineeringId}" }
→ 201: Sub-department created under Engineering
```

**Test 3: Duplicate code**
```
POST /api/departments { code: "ENG" }
→ 409: "Department code already exists"
```

**Test 4: Circular parent**
```
# Engineering → Frontend → Backend (as children)
PUT /api/departments/{engineeringId}
Body: { parentId: "{backendId}" }
→ 400: "Circular department hierarchy detected"
```

**Test 5: Delete department with employees**
```
DELETE /api/departments/{id}  # Has employees assigned
→ 400: "Cannot delete department with N assigned employees"
```

**Test 6: Department members**
```
GET /api/departments/{id}/members?page=1&limit=10
→ 200: Paginated list of active employees in this department
```

**Test 7: Department tree**
```
GET /api/departments/tree
→ 200: Nested tree of all departments
```

### Designation Tests

**Test 8: Create designation**
```
POST /api/designations
Body: { name: "Senior Engineer", code: "SR-ENG", hierarchyLevel: 4 }
→ 201
```

**Test 9: Delete designation used in hierarchy**
```
DELETE /api/designations/{id}  # Used in reporting_hierarchy
→ 400: "Cannot delete designation used in reporting hierarchy"
```

### Reporting Hierarchy Tests

**Test 10: Get hierarchy**
```
GET /api/reporting-hierarchy
→ 200: Ordered list of designation chains with levels
```

**Test 11: Update hierarchy**
```
PUT /api/reporting-hierarchy
Body: {
  entries: [
    { designationId: "{ceoId}", reportsToDesignationId: null, level: 0 },
    { designationId: "{vpId}", reportsToDesignationId: "{ceoId}", level: 1 },
    { designationId: "{mgrId}", reportsToDesignationId: "{vpId}", level: 2 }
  ]
}
→ 200: Updated hierarchy

Verify: reporting_hierarchy table has exactly 3 rows
```

**Test 12: Circular hierarchy rejected**
```
PUT /api/reporting-hierarchy
Body: {
  entries: [
    { designationId: "A", reportsToDesignationId: "B", level: 0 },
    { designationId: "B", reportsToDesignationId: "A", level: 1 }
  ]
}
→ 400: "Circular reference detected in hierarchy"
```

**Test 13: Manager suggestion**
```
GET /api/reporting-hierarchy/suggestions/{teamMemberDesignationId}
→ 200: { reportsToDesignation: { name: "Manager" }, suggestedManagers: [...] }
```

### Org Chart Tests

**Test 14: Full org chart**
```
GET /api/employees/org-chart
→ 200: Nested tree starting from root employees (reports_to IS NULL)
```

**Test 15: Subtree**
```
GET /api/employees/org-chart/{managerId}
→ 200: Tree starting from the specified manager
```

**Test 16: Data visibility — Manager**
```
GET /api/employees/org-chart
Headers: Authorization: Bearer <manager_token>
→ 200: Tree showing only the manager's own subtree
```

### Frontend Tests

- [ ] Departments tab active when on `/employees/departments`
- [ ] Departments table: all columns render, sortable, searchable
- [ ] "Add Department" drawer: name, code (auto-gen), mail alias, head (lookup), parent (tree dropdown)
- [ ] Code auto-generates from name on create (uppercase, spaces to underscores)
- [ ] Department detail drawer: info card, sub-departments, members with "View All" link
- [ ] Department edit: circular parent prevention in dropdown (exclude self + descendants)
- [ ] Department delete: confirm dialog, error toast if employees or children exist
- [ ] Designations tab active when on `/employees/designations`
- [ ] Designations table: hierarchy level column sorts correctly (0 = top)
- [ ] Designation form: hierarchy level helper text explains convention
- [ ] Designation delete: error toast if employees assigned or used in hierarchy
- [ ] Reporting Hierarchy page: read mode shows visual chain
- [ ] Reporting Hierarchy edit mode: drag/add designations, set parent, save bulk
- [ ] Hierarchy editor: validates single root, no cycles, all valid designations
- [ ] Empty state when no hierarchy configured
- [ ] Org Chart page: tree visualization with employee cards
- [ ] Org Chart: click node → navigate to employee detail
- [ ] Org Chart: expand/collapse subtrees
- [ ] Org Chart: orphan employees shown in separate section
- [ ] Org Chart: Manager sees only own subtree
- [ ] "Reports To" field in Add Employee form shows suggestions from hierarchy
- [ ] Mobile: tables horizontally scrollable, org chart vertically scrollable
- [ ] Export buttons on departments and designations pages

### Full Checklist

**Backend:**
- [ ] `GET /api/departments` — list with search, sort, pagination, employee count, head + parent info
- [ ] `POST /api/departments` — create with code/name uniqueness, head validation, parent validation, depth limit (5)
- [ ] `GET /api/departments/:id` — detail with children, recent members, employee count
- [ ] `PUT /api/departments/:id` — update with circular parent prevention
- [ ] `DELETE /api/departments/:id` — delete guarded by employee/children checks
- [ ] `GET /api/departments/:id/members` — paginated member list
- [ ] `GET /api/departments/tree` — nested tree structure
- [ ] `GET /api/departments/export` — CSV/XLSX export
- [ ] `GET /api/designations` — list with search, sort, pagination, employee count
- [ ] `POST /api/designations` — create with code/name uniqueness
- [ ] `GET /api/designations/:id` — detail with employee count
- [ ] `PUT /api/designations/:id` — update with uniqueness checks
- [ ] `DELETE /api/designations/:id` — delete guarded by employee + hierarchy checks
- [ ] `GET /api/designations/export` — CSV/XLSX export
- [ ] `GET /api/reporting-hierarchy` — full hierarchy with designation names
- [ ] `PUT /api/reporting-hierarchy` — bulk replace with cycle detection, single-root validation
- [ ] `GET /api/reporting-hierarchy/suggestions/:designationId` — manager suggestion
- [ ] `GET /api/employees/org-chart` — full tree from reports_to, data visibility scoped
- [ ] `GET /api/employees/org-chart/:id` — subtree from a specific employee
- [ ] Audit logging on all CUD operations
- [ ] All endpoints in Swagger under "Departments", "Designations", "Reporting Hierarchy" tags

**Frontend:**
- [ ] Departments page with DataTable, form drawer, detail drawer, delete, export
- [ ] Designations page with DataTable, form drawer, delete, export
- [ ] Reporting Hierarchy page with read mode chain visualization + edit mode editor
- [ ] Org Chart page with tree visualization, expand/collapse, orphan handling
- [ ] 2 new tabs in employee layout (Reporting Hierarchy, Org Chart)
- [ ] Add Employee "Reports To" suggestion from hierarchy
- [ ] Department code auto-generation from name

---

*Sprint 3B Complete. Next: Sprint 3C — Groups, Projects, Tasks & Delegations*
