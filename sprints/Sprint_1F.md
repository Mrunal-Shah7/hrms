# Sprint 1F — RBAC Engine

## Goal
Build the runtime permission enforcement layer and RBAC management APIs. The data foundation (permissions, roles, role_permissions, user_roles tables + seed data) was already created during tenant provisioning in Sprint 1B, and permissions are already loaded into the JWT payload at login in Sprint 1E. This sprint adds the `@RequirePermission()` decorator + `PermissionGuard` for backend enforcement, the `usePermission()` frontend hook, custom role CRUD APIs, user-role assignment APIs, and a permissions listing API. By the end, every tenant API route can be gated by a permission check, and admins can create/modify custom roles.

---

## 1. What Already Exists (From Previous Sprints)

| Component | Sprint | Status |
|---|---|---|
| `permissions` table with 100+ rows | 1B (provisioning seed) | ✅ Exists in every tenant schema |
| `roles` table with 5 system roles | 1B (provisioning seed) | ✅ Exists |
| `role_permissions` mapping table | 1B (provisioning seed) | ✅ Populated |
| `user_roles` table | 1B (provisioning seed) | ✅ Admin user has Admin role assigned |
| Permissions loaded into JWT at login | 1E (login service) | ✅ `req.user.permissions` = `["module:action:resource", ...]` |
| Roles loaded into JWT at login | 1E (login service) | ✅ `req.user.roles` = `["Admin", ...]` |
| `TenantAuthGuard` | 1E | ✅ Validates tenant JWT, attaches `req.user` |

**This sprint does NOT re-seed data.** It builds the enforcement and management layers on top of the existing data.

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/rbac/rbac.module.ts` | NestJS module |
| `src/rbac/rbac.controller.ts` | 9 RBAC API endpoints |
| `src/rbac/rbac.service.ts` | Role/permission CRUD + query logic |
| `src/rbac/dto/create-role.dto.ts` | DTO for creating custom role |
| `src/rbac/dto/update-role.dto.ts` | DTO for updating role |
| `src/rbac/dto/assign-roles.dto.ts` | DTO for assigning roles to a user |
| `src/rbac/dto/index.ts` | Barrel export |
| `src/common/decorators/require-permission.decorator.ts` | `@RequirePermission()` metadata decorator |
| `src/common/guards/permission.guard.ts` | `PermissionGuard` that reads metadata + checks `req.user.permissions` |

### Frontend
| File | Purpose |
|---|---|
| `src/hooks/usePermission.ts` | `usePermission(module, action, resource)` hook |
| `src/components/shared/PermissionGate.tsx` | `<PermissionGate>` wrapper component for conditional rendering |
| `src/components/shared/NoPermission.tsx` | "You don't have permission" placeholder page |

### Module Registration
- Import `RbacModule` into `AppModule`
- All RBAC routes are tenant-scoped → pass through `TenantMiddleware` + require `TenantAuthGuard`

---

## 3. Backend: `@RequirePermission()` Decorator

### 3.1 Purpose

A method-level decorator that attaches permission metadata to a route handler. Used in combination with `PermissionGuard`.

### 3.2 Signature

```
@RequirePermission(module: string, action: string, resource: string)
```

### 3.3 Examples of Usage (on future sprint controllers)

```
@RequirePermission('leave', 'approve', 'leave_requests')
@RequirePermission('employee_management', 'create', 'employees')
@RequirePermission('settings', 'edit', 'rbac')
```

### 3.4 Implementation Approach

- Use `@SetMetadata()` from `@nestjs/common` to store `{ module, action, resource }` on the handler
- Use a constant key like `PERMISSION_KEY` for the metadata key
- The decorator stores a single permission requirement per route. If a route needs to allow multiple permission combinations (OR logic), use multiple decorators or a separate `@RequireAnyPermission()` variant — but for v1, single permission per route is sufficient

---

## 4. Backend: `PermissionGuard`

### 4.1 Purpose

A NestJS guard that runs AFTER `TenantAuthGuard`. It reads the `@RequirePermission()` metadata from the handler and checks whether `req.user.permissions` (loaded into the JWT at login in Sprint 1E) contains the required permission string.

### 4.2 Execution Flow

1. Extract metadata `{ module, action, resource }` from handler using `Reflector`
2. If no metadata → allow (route has no permission requirement)
3. Build the permission key string: `"${module}:${action}:${resource}"`
4. Check if `req.user.permissions` array includes this key
5. If yes → allow
6. If no → throw `ForbiddenException` with structured response:

```
{
  success: false,
  error: {
    code: "PERMISSION_DENIED",
    message: "You do not have permission to perform this action.",
    details: {
      required: "leave:approve:leave_requests",
      module: "leave",
      action: "approve",
      resource: "leave_requests"
    }
  }
}
```

HTTP status: `403 Forbidden`

### 4.3 Guard Ordering

When applied to a route, guards execute in order:
1. `TenantAuthGuard` → validates JWT, populates `req.user`
2. `PermissionGuard` → reads `req.user.permissions`, checks metadata

Both guards must be applied. The typical usage pattern on a controller method:

```
@UseGuards(TenantAuthGuard, PermissionGuard)
@RequirePermission('leave', 'approve', 'leave_requests')
```

### 4.4 Admin Shortcut

The Admin role has ALL permissions assigned via `role_permissions` in Sprint 1B. Since the JWT already contains the union of all permissions, Admin users will naturally pass every `PermissionGuard` check — no special "is admin" bypass logic needed.

---

## 5. API Specification

All endpoints are tenant-scoped (pass through `TenantMiddleware` + require `TenantAuthGuard`). Controller prefix: `roles` or `permissions` as specified.

### 5.1 `GET /api/roles` — List All Roles

**Auth:** `TenantAuthGuard` (any authenticated user)

**Service Logic:**
1. Set `search_path` to tenant schema
2. Query: `SELECT id, name, description, is_system_role, is_custom, created_at, updated_at FROM roles ORDER BY is_system_role DESC, name ASC`
3. Return array of roles

**Response:**
```
{
  success: true,
  data: [
    { id, name: "Admin", description, isSystemRole: true, isCustom: false, createdAt, updatedAt },
    { id, name: "HR Admin", ... },
    ...
    { id, name: "CEO", description, isSystemRole: false, isCustom: true, ... }
  ]
}
```

---

### 5.2 `POST /api/roles` — Create Custom Role

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'edit', 'rbac')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `description` | string | `@IsOptional()` | No |
| `permissionIds` | string[] (UUID[]) | `@IsArray()`, `@IsUUID('4', { each: true })` | Yes |

**Service Logic:**
1. Validate role name uniqueness within tenant: `SELECT id FROM roles WHERE name = $1`
2. If exists → `409 "A role with this name already exists"`
3. Insert new role: `is_system_role = FALSE`, `is_custom = TRUE`
4. Insert `role_permissions` rows for each provided `permissionId`
5. Validate all `permissionIds` exist: `SELECT id FROM permissions WHERE id IN (...)`. If any don't exist → `400 "One or more permission IDs are invalid"`
6. Return the created role with its permissions

**Response:**
```
{
  success: true,
  data: {
    id, name, description, isSystemRole: false, isCustom: true,
    permissions: [ { id, module, action, resource, description }, ... ]
  }
}
```

---

### 5.3 `PUT /api/roles/:id` — Update Role

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'edit', 'rbac')`

**Path Param:** `id` (UUID)

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsOptional()`, `@MaxLength(100)` | No |
| `description` | string | `@IsOptional()` | No |
| `permissionIds` | string[] (UUID[]) | `@IsOptional()`, `@IsArray()`, `@IsUUID('4', { each: true })` | No |

**Service Logic:**
1. Find role by ID. If not found → `404`
2. If name is being changed, check uniqueness (excluding current role)
3. If `is_system_role = TRUE`: allow updating `description` and `permissionIds` (admin can customize system role permissions), but do NOT allow changing `name` or `is_system_role` flag → `400 "Cannot rename system roles"`
4. If `permissionIds` provided: delete all existing `role_permissions` for this role, re-insert with new set (full replacement strategy)
5. Update role fields
6. Return updated role with permissions

**Important — Immediate Effect (PRD 8.5):**
Updating a role's permissions changes what `role_permissions` rows exist in the database. However, users who are currently logged in still have the OLD permissions in their JWT. The new permissions take effect:
- On next token refresh (within 15 minutes max, since access token TTL is 15 min)
- On next login

This is acceptable for v1. Document this behavior. For real-time enforcement, a future enhancement could check permissions against the DB on each request instead of trusting the JWT, but that adds latency.

---

### 5.4 `DELETE /api/roles/:id` — Delete Custom Role

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'edit', 'rbac')`

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find role by ID. If not found → `404`
2. If `is_system_role = TRUE` → `400 "System roles cannot be deleted"` (PRD 8.5)
3. Check if any users have this role assigned: `SELECT COUNT(*) FROM user_roles WHERE role_id = $1`
4. If count > 0 → `400 "Cannot delete role — it is assigned to {count} user(s). Remove the role from all users first."`
5. Delete `role_permissions` where `role_id = $1` (cascade should handle this if FK has ON DELETE CASCADE, but explicit delete is safer)
6. Delete the role
7. Return `{ success: true, data: { message: "Role deleted successfully" } }`

---

### 5.5 `GET /api/roles/:id/permissions` — Get Permissions for a Role

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'view', 'rbac')`

**Path Param:** `id` (UUID)

**Service Logic:**
1. Find role by ID. If not found → `404`
2. Query: `SELECT p.id, p.module, p.action, p.resource, p.description FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.module, p.action, p.resource`
3. Return role info + permissions array

**Response:**
```
{
  success: true,
  data: {
    role: { id, name, description, isSystemRole, isCustom },
    permissions: [
      { id, module: "employee_management", action: "view", resource: "employees", description: "..." },
      ...
    ]
  }
}
```

---

### 5.6 `GET /api/permissions` — List All Permissions Grouped by Module

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'view', 'rbac')`

**Service Logic:**
1. Query: `SELECT id, module, action, resource, description FROM permissions ORDER BY module, action, resource`
2. Group by `module` in the service layer (not SQL)
3. Return grouped structure

**Response:**
```
{
  success: true,
  data: {
    "employee_management": [
      { id, action: "view", resource: "employees", description: "View employees" },
      { id, action: "create", resource: "employees", description: "Create employees" },
      ...
    ],
    "leave": [
      { id, action: "view", resource: "leave_requests", description: "View leave requests" },
      { id, action: "approve", resource: "leave_requests", description: "Approve/reject leave" },
      ...
    ],
    ...
  }
}
```

This grouped format is what the frontend needs for the role creation/editing UI — display permissions as checkboxes grouped by module.

---

### 5.7 `GET /api/users/:id/roles` — Get User's Roles

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'view', 'rbac')` OR self (user can view own roles)

**Path Param:** `id` (UUID — user ID)

**Service Logic:**
1. Check authorization: if `req.user.userId !== id`, require `settings:view:rbac` permission. If self → allow regardless.
2. Query: `SELECT r.id, r.name, r.description, r.is_system_role, r.is_custom, ur.assigned_by, ur.assigned_at FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name`
3. If user not found → `404`
4. Return roles array

**Response:**
```
{
  success: true,
  data: [
    { id, name: "Admin", description, isSystemRole: true, assignedBy: "<uuid>", assignedAt: "..." },
    { id, name: "CEO", description, isSystemRole: false, assignedBy: "<uuid>", assignedAt: "..." }
  ]
}
```

---

### 5.8 `POST /api/users/:id/roles` — Assign Roles to User

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'edit', 'rbac')`

**Path Param:** `id` (UUID — user ID)

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `roleIds` | string[] (UUID[]) | `@IsArray()`, `@IsUUID('4', { each: true })`, `@ArrayMinSize(1)` | Yes |

**Service Logic:**
1. Verify target user exists: `SELECT id FROM users WHERE id = $1`. If not → `404`
2. Validate all `roleIds` exist: `SELECT id FROM roles WHERE id IN (...)`. If any missing → `400 "One or more role IDs are invalid"`
3. For each roleId: insert into `user_roles` with `assigned_by = req.user.userId`, `assigned_at = NOW()`. Use `ON CONFLICT (user_id, role_id) DO NOTHING` to handle idempotent assignment (re-assigning an already-assigned role is a no-op, not an error).
4. Return updated list of user's roles

**Note on immediate effect:** The newly assigned roles won't appear in the user's JWT until their next token refresh or re-login (same caveat as role permission updates in Section 5.3).

---

### 5.9 `DELETE /api/users/:userId/roles/:roleId` — Remove Role from User

**Auth:** `TenantAuthGuard` + `PermissionGuard`
**Permission:** `@RequirePermission('settings', 'edit', 'rbac')`

**Path Params:** `userId` (UUID), `roleId` (UUID)

**Service Logic:**
1. Verify the assignment exists: `SELECT id FROM user_roles WHERE user_id = $1 AND role_id = $2`. If not found → `404 "This role is not assigned to this user"`
2. Safety check: if removing the last role from a user, allow it but log a warning (user will have zero permissions until a role is re-assigned)
3. Delete the `user_roles` row
4. Return `{ success: true, data: { message: "Role removed from user" } }`

---

## 6. Frontend: `usePermission()` Hook

### 6.1 Purpose

A React hook that checks whether the currently authenticated user has a specific permission. Used throughout the UI to conditionally render buttons, menu items, entire page sections, or redirect unauthorized users.

### 6.2 Signature & Behavior

```
usePermission(module: string, action: string, resource: string): boolean
```

**Implementation approach:**
1. Read the user's permissions from `useAuthStore` (populated at login in Sprint 1E)
2. Build the permission key: `"${module}:${action}:${resource}"`
3. Return `permissions.includes(key)`

### 6.3 Overloaded Variants

Also provide these convenience functions in the same file:

**`useHasAnyPermission(checks: Array<{module, action, resource}>): boolean`**
Returns `true` if the user has ANY of the specified permissions (OR logic). Useful for sidebar items that should show if the user has view access to any resource in a module.

**`useHasAllPermissions(checks: Array<{module, action, resource}>): boolean`**
Returns `true` only if the user has ALL specified permissions (AND logic). Useful for composite actions.

### 6.4 Usage Examples (for future sprints)

```
// Single check: show "Approve" button only if user can approve leave
const canApproveLeave = usePermission('leave', 'approve', 'leave_requests');

// Any check: show "Leave" sidebar item if user can view anything leave-related
const canAccessLeave = useHasAnyPermission([
  { module: 'leave', action: 'view', resource: 'leave_requests' },
  { module: 'leave', action: 'view', resource: 'leave_types' },
]);

// All check: show "Delete Employee" only if user has both view and delete
const canDeleteEmployee = useHasAllPermissions([
  { module: 'employee_management', action: 'view', resource: 'employees' },
  { module: 'employee_management', action: 'delete', resource: 'employees' },
]);
```

---

## 7. Frontend: `<PermissionGate>` Component

### 7.1 Purpose

A wrapper component that conditionally renders its children based on permission checks. Alternative to using the hook directly in JSX.

### 7.2 Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `module` | string | Yes | Permission module |
| `action` | string | Yes | Permission action |
| `resource` | string | Yes | Permission resource |
| `fallback` | ReactNode | No | What to render if permission denied (default: `null`) |
| `children` | ReactNode | Yes | Content to render if permitted |

### 7.3 Behavior

- If user has the permission → render `children`
- If user lacks the permission → render `fallback` (or nothing)

### 7.4 Usage Example

```
<PermissionGate module="leave" action="approve" resource="leave_requests">
  <Button onClick={handleApprove}>Approve</Button>
</PermissionGate>

<PermissionGate
  module="settings" action="edit" resource="rbac"
  fallback={<p className="text-muted-foreground">You don't have permission to manage roles.</p>}
>
  <RoleManagementPanel />
</PermissionGate>
```

---

## 8. Frontend: `<NoPermission>` Page Component

### 8.1 Purpose

A full-page component shown when a user navigates to a URL they don't have permission to access (PRD 8.3: "Unauthorized URL navigation shows 'You don't have permission to access this page.'").

### 8.2 Content

- Icon: Lock or ShieldAlert from `lucide-react`
- Heading: "Access Denied"
- Message: "You don't have permission to access this page. If you believe this is an error, please contact your administrator."
- "Go to Dashboard" button → navigates to `/dashboard`

### 8.3 Usage

Used by page-level permission checks in future sprints. Example pattern:

```
// In a page component:
const canView = usePermission('recruitment', 'view', 'job_openings');
if (!canView) return <NoPermission />;

// ... rest of page
```

---

## 9. Permission String Format Convention

Establish a consistent convention used across backend (JWT, guard) and frontend (hook, gate):

**Format:** `module:action:resource`

**Examples:**
- `employee_management:view:employees`
- `leave:approve:leave_requests`
- `settings:edit:rbac`
- `compensation:view:salary`
- `recruitment:create:job_openings`

**This format is:**
- Set during login (Sprint 1E) when loading permissions into the JWT
- Checked by `PermissionGuard` (this sprint) on the backend
- Checked by `usePermission()` (this sprint) on the frontend
- Stored as individual columns (`module`, `action`, `resource`) in the `permissions` table, concatenated at runtime

---

## 10. Scope Boundaries

### In Scope (Sprint 1F)
- `@RequirePermission()` decorator
- `PermissionGuard`
- All 9 RBAC API endpoints
- `usePermission()` hook + variants
- `<PermissionGate>` component
- `<NoPermission>` page component

### Out of Scope (future sprints)
| Feature | Sprint |
|---|---|
| Actually applying `@RequirePermission()` + `PermissionGuard` to module controllers | Each module sprint (3A, 4A, etc.) |
| Sidebar permission-based visibility | 1H |
| Role management UI pages (frontend CRUD for roles) | 2C or Settings sprint |
| Real-time permission revocation (DB check per request instead of JWT) | Future enhancement |

---

## 11. Verification & Acceptance Criteria

### API Tests

**Test 1: List roles**
```
GET /api/roles
Headers: Authorization: Bearer <tenant_token>, X-Tenant-Slug: acme-corp
→ 200: Array of 5 system roles (Admin, HR Admin, HR Manager, Manager / Team Lead, Employee)
```

**Test 2: Create custom role**
```
POST /api/roles
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
Body: {
  "name": "CEO",
  "description": "Chief Executive Officer — read-only access to everything",
  "permissionIds": ["<uuid-view-employees>", "<uuid-view-dashboard>", ...]
}
→ 201: { id, name: "CEO", isSystemRole: false, isCustom: true, permissions: [...] }
```

**Test 3: System role cannot be deleted**
```
DELETE /api/roles/<admin-role-id>
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
→ 400: "System roles cannot be deleted"
```

**Test 4: Custom role can be deleted (if unassigned)**
```
DELETE /api/roles/<ceo-role-id>
→ 200: "Role deleted successfully"
```

**Test 5: Cannot delete role assigned to users**
```
POST /api/users/<userId>/roles
Body: { "roleIds": ["<ceo-role-id>"] }
→ 200

DELETE /api/roles/<ceo-role-id>
→ 400: "Cannot delete role — it is assigned to 1 user(s)..."
```

**Test 6: List permissions grouped by module**
```
GET /api/permissions
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
→ 200: { "employee_management": [...], "leave": [...], "attendance": [...], ... }
```

**Test 7: Permission guard enforcement**
```
# Use a user with Employee role (no settings:edit:rbac permission)
POST /api/roles
Headers: Authorization: Bearer <employee_token>, X-Tenant-Slug: acme-corp
Body: { "name": "Test", "permissionIds": [] }
→ 403: { code: "PERMISSION_DENIED", message: "You do not have permission..." }
```

**Test 8: Assign multiple roles to user**
```
POST /api/users/<userId>/roles
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
Body: { "roleIds": ["<hr-admin-role-id>", "<manager-role-id>"] }
→ 200: Updated roles list

# Verify union of permissions on next login
POST /api/auth/login
→ permissions array should contain union of HR Admin + Manager permissions
```

**Test 9: Remove role from user**
```
DELETE /api/users/<userId>/roles/<manager-role-id>
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
→ 200: "Role removed from user"
```

**Test 10: User can view own roles without RBAC permission**
```
GET /api/users/<own-user-id>/roles
Headers: Authorization: Bearer <employee_token>
→ 200: [ { name: "Employee", ... } ]

GET /api/users/<other-user-id>/roles
Headers: Authorization: Bearer <employee_token>
→ 403 (employee doesn't have settings:view:rbac)
```

**Test 11: Update system role permissions (allowed, name change blocked)**
```
PUT /api/roles/<hr-manager-role-id>
Body: { "name": "Renamed", "permissionIds": [...] }
→ 400: "Cannot rename system roles"

PUT /api/roles/<hr-manager-role-id>
Body: { "permissionIds": ["<new-set-of-permission-ids>"] }
→ 200: Updated (permissions changed, name preserved)
```

### Frontend Tests

- [ ] `usePermission('settings', 'edit', 'rbac')` returns `true` for Admin user
- [ ] `usePermission('settings', 'edit', 'rbac')` returns `false` for Employee user
- [ ] `<PermissionGate>` renders children when permitted, renders nothing (or fallback) when not
- [ ] `<NoPermission>` page renders with "Access Denied" and "Go to Dashboard" button

### Full Checklist

- [ ] `@RequirePermission()` decorator sets metadata on route handler
- [ ] `PermissionGuard` reads metadata, checks `req.user.permissions`, returns 403 on failure
- [ ] 403 response includes structured error with `code: "PERMISSION_DENIED"` and required permission details
- [ ] `GET /api/roles` — lists all roles, any authenticated user
- [ ] `POST /api/roles` — creates custom role with selected permissions, Admin only
- [ ] `PUT /api/roles/:id` — updates role (name change blocked for system roles)
- [ ] `DELETE /api/roles/:id` — deletes custom role (system roles protected, assigned roles blocked)
- [ ] `GET /api/roles/:id/permissions` — returns permissions for a role
- [ ] `GET /api/permissions` — returns all permissions grouped by module
- [ ] `GET /api/users/:id/roles` — returns user's roles (self or Admin)
- [ ] `POST /api/users/:id/roles` — assigns roles (idempotent, Admin only)
- [ ] `DELETE /api/users/:userId/roles/:roleId` — removes role from user (Admin only)
- [ ] Users can hold multiple roles; effective permissions = union across all roles
- [ ] Admin can create custom roles (e.g., "CEO") with specific permissions
- [ ] System roles (`is_system_role = true`) cannot be deleted
- [ ] System roles can have their permissions modified but not their name
- [ ] Permissions are stored as data in the DB, not hardcoded
- [ ] `usePermission()` hook correctly reads from auth store
- [ ] `useHasAnyPermission()` returns true if ANY specified permission exists
- [ ] `useHasAllPermissions()` returns true only if ALL specified permissions exist
- [ ] `<PermissionGate>` conditionally renders based on permission
- [ ] `<NoPermission>` page shows "Access Denied" with dashboard redirect
- [ ] All 9 RBAC endpoints appear in Swagger docs under "RBAC" tag

---

*Sprint 1F Complete. Next: Sprint 1G — Core Shared Services*
