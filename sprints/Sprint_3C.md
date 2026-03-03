# Sprint 3C — Groups, Projects, Tasks & Delegations

## Goal
Build full CRUD for Groups (informal cross-department employee collections with member management), full CRUD for Projects (with budget visibility restrictions, member management, and Tasks as a sub-resource), and full CRUD for Delegations (manager-to-reportee work assignment with date ranges and status tracking). Wire up notification events for task assignment, task status updates, and delegation creation. Replace the two remaining placeholder tabs in the employee module layout with functional pages.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `groups` table (id, name, description, created_by, created_at, updated_at) | 1A / 1B | ✅ |
| `group_members` table (id, group_id, user_id, added_at; UNIQUE group_id+user_id) | 1A / 1B | ✅ |
| `projects` table (id, name, description, manager_id, budget, start_date, end_date, status, created_at, updated_at) | 1A / 1B | ✅ |
| `project_members` table (id, project_id, user_id, role, added_at; UNIQUE project_id+user_id) | 1A / 1B | ✅ |
| `project_tasks` table (id, project_id, title, description, assignee_id, status, priority, due_date, created_at, updated_at) | 1A / 1B | ✅ |
| `delegations` table (id, delegator_id, delegatee_id, type, description, start_date, end_date, status, created_at, updated_at) | 1A / 1B | ✅ |
| Seeded permissions: `employee_management:*:groups` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `employee_management:*:projects` (view, create, edit, delete) | 1B | ✅ |
| Seeded permissions: `employee_management:*:delegations` (view, create, edit, delete) | 1B | ✅ |
| Notification types seeded: `task_assigned`, `task_status_updated`, `delegation_created` | Gap Fix 3 | ✅ |
| Manager role: full delegation CRUD, project view/create/edit, group view | 1B | ✅ |
| Employee module top tab layout with Groups + Delegations placeholder tabs | 3A | ✅ |
| `GET /api/employees/lookup` (lightweight employee search for select fields) | 3A | ✅ |
| `NotificationService` + WebSocket | 1G | ✅ |
| `AuditInterceptor` + `@AuditAction()` | 1G | ✅ |
| `ExportService` (CSV, XLSX, PDF) | 1G | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/groups/groups.module.ts` | NestJS module |
| `src/groups/groups.controller.ts` | Group CRUD + member management |
| `src/groups/groups.service.ts` | Group business logic |
| `src/groups/dto/create-group.dto.ts` | Create DTO |
| `src/groups/dto/update-group.dto.ts` | Update DTO |
| `src/groups/dto/manage-members.dto.ts` | Add/remove members DTO |
| `src/groups/dto/index.ts` | Barrel export |
| `src/projects/projects.module.ts` | NestJS module |
| `src/projects/projects.controller.ts` | Project CRUD + members |
| `src/projects/projects.service.ts` | Project business logic |
| `src/projects/dto/create-project.dto.ts` | Create DTO |
| `src/projects/dto/update-project.dto.ts` | Update DTO |
| `src/projects/dto/manage-project-members.dto.ts` | Add/remove members DTO |
| `src/projects/dto/index.ts` | Barrel export |
| `src/projects/tasks/tasks.controller.ts` | Task CRUD (nested under projects) |
| `src/projects/tasks/tasks.service.ts` | Task business logic |
| `src/projects/tasks/dto/create-task.dto.ts` | Create task DTO |
| `src/projects/tasks/dto/update-task.dto.ts` | Update task DTO |
| `src/projects/tasks/dto/index.ts` | Barrel export |
| `src/delegations/delegations.module.ts` | NestJS module |
| `src/delegations/delegations.controller.ts` | Delegation CRUD |
| `src/delegations/delegations.service.ts` | Delegation business logic |
| `src/delegations/dto/create-delegation.dto.ts` | Create DTO |
| `src/delegations/dto/update-delegation.dto.ts` | Update DTO |
| `src/delegations/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/employees/groups/page.tsx` | Groups page (replaces placeholder) |
| `src/app/(tenant)/employees/projects/page.tsx` | Projects list page |
| `src/app/(tenant)/employees/projects/[id]/page.tsx` | Project detail page with tasks |
| `src/app/(tenant)/employees/delegations/page.tsx` | Delegations page (replaces placeholder) |
| `src/components/modules/employees/group-form-drawer.tsx` | Group create/edit form |
| `src/components/modules/employees/group-members-drawer.tsx` | Group member management |
| `src/components/modules/employees/project-form-drawer.tsx` | Project create/edit form |
| `src/components/modules/employees/project-members-drawer.tsx` | Project member management |
| `src/components/modules/employees/task-form-modal.tsx` | Task create/edit modal |
| `src/components/modules/employees/task-board.tsx` | Kanban-style task board |
| `src/components/modules/employees/delegation-form-drawer.tsx` | Delegation create/edit form |
| `src/services/groups.ts` | Group API helpers |
| `src/services/projects.ts` | Project + task API helpers |
| `src/services/delegations.ts` | Delegation API helpers |

### Module Registration
- Import `GroupsModule`, `ProjectsModule`, `DelegationsModule` into `AppModule`

---

## 3. Tab Layout Update

Replace the remaining placeholder pages:

| Tab | Route | Status |
|---|---|---|
| Groups | `/employees/groups` | Now functional (was placeholder) |
| Delegations | `/employees/delegations` | Now functional (was placeholder) |

Add one new tab for Projects:

| Label | Route | Permission |
|---|---|---|
| Projects | `/employees/projects` | `employee_management:view:projects` |

**Final tab order:** Employees | Departments | Designations | Reporting Hierarchy | Org Chart | Groups | Projects | Delegations

---

## 4. Groups API Specification

Groups are informal, cross-department collections of employees (e.g., "Social Committee", "Fire Wardens", "Q2 Launch Team"). They have no hierarchy or reporting implications.

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `groups`.

### 4.1 `GET /api/groups` — List All Groups

**Permission:** `@RequirePermission('employee_management', 'view', 'groups')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Records per page |
| `search` | string | — | Search name or description (ILIKE) |
| `sortBy` | string | `name` | Sort column |
| `sortOrder` | string | `asc` | `asc` or `desc` |

**Sortable columns:** `name`, `memberCount`, `createdAt`

**Service Logic:**
```
SELECT g.id, g.name, g.description, g.created_by, g.created_at, g.updated_at,
       u.first_name AS creator_first_name, u.last_name AS creator_last_name,
       (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
FROM groups g
LEFT JOIN users u ON g.created_by = u.id
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, description,
      createdBy: { id, firstName, lastName },
      memberCount: number,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.2 `POST /api/groups` — Create Group

**Permission:** `@RequirePermission('employee_management', 'create', 'groups')`
**Audit:** `@AuditAction('create', 'employee_management', 'groups')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `description` | string | `@IsOptional()`, `@MaxLength(1000)` | No |
| `memberIds` | UUID[] | `@IsOptional()`, `@IsArray()`, `@IsUUID('4', { each: true })` | No |

**Service Logic:**
1. Validate name uniqueness: `SELECT id FROM groups WHERE name = $name` → `409 "A group with this name already exists"`
2. Insert into `groups` with `created_by = req.user.userId`
3. If `memberIds` provided → validate each user exists and is active, then bulk insert into `group_members`
4. Return created group with member count

---

### 4.3 `GET /api/groups/:id` — Group Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'groups')`

**Response:** Group fields + full member list:
```
{
  success: true,
  data: {
    id, name, description,
    createdBy: { id, firstName, lastName },
    memberCount: number,
    members: [
      {
        id,  // group_members.id
        user: { id, employeeId, firstName, lastName, email, photoUrl, department: { name }, designation: { name } },
        addedAt
      }
    ],
    createdAt, updatedAt
  }
}
```

Members are fetched with:
```
SELECT gm.id, gm.added_at,
       u.id AS user_id, u.employee_id, u.first_name, u.last_name, u.email, u.photo_url,
       d.name AS department_name, des.name AS designation_name
FROM group_members gm
JOIN users u ON gm.user_id = u.id
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
WHERE gm.group_id = $1 AND u.status = 'active'
ORDER BY u.first_name ASC
```

---

### 4.4 `PUT /api/groups/:id` — Update Group

**Permission:** `@RequirePermission('employee_management', 'edit', 'groups')`
**Audit:** `@AuditAction('update', 'employee_management', 'groups')`

**Request Body:** `name` (optional), `description` (optional). Does NOT update members — use dedicated member endpoints.

Validate name uniqueness (exclude self) if changed.

---

### 4.5 `DELETE /api/groups/:id` — Delete Group

**Permission:** `@RequirePermission('employee_management', 'delete', 'groups')`
**Audit:** `@AuditAction('delete', 'employee_management', 'groups')`

Deletes the group and all `group_members` rows (CASCADE). No blocking conditions — groups are informal. Returns `{ message: "Group deleted" }`.

---

### 4.6 `POST /api/groups/:id/members` — Add Members to Group

**Permission:** `@RequirePermission('employee_management', 'edit', 'groups')`
**Audit:** `@AuditAction('update', 'employee_management', 'groups')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `userIds` | UUID[] | `@IsArray()`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` | Yes |

**Service Logic:**
1. Validate group exists → `404`
2. Validate each user exists and is active
3. Skip duplicates: `INSERT INTO group_members ... ON CONFLICT (group_id, user_id) DO NOTHING`
4. Return updated member count and list of newly added members

---

### 4.7 `DELETE /api/groups/:id/members` — Remove Members from Group

**Permission:** `@RequirePermission('employee_management', 'edit', 'groups')`
**Audit:** `@AuditAction('update', 'employee_management', 'groups')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `userIds` | UUID[] | `@IsArray()`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` | Yes |

**Service Logic:**
`DELETE FROM group_members WHERE group_id = $groupId AND user_id = ANY($userIds)`

Return updated member count.

---

## 5. Projects API Specification

Projects have a manager, budget, date range, members, and tasks. Budget is sensitive — only visible to the project manager and admin.

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `projects`.

### 5.1 `GET /api/projects` — List All Projects

**Permission:** `@RequirePermission('employee_management', 'view', 'projects')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `search` | string | — | Search name (ILIKE) |
| `sortBy` | string | `name` | Sort column |
| `sortOrder` | string | `asc` | |
| `status` | string | — | Filter: `active`, `completed`, `on_hold` |
| `managerId` | UUID | — | Filter by project manager |

**Data visibility:**
- Admin/HR Admin/HR Manager → see all projects
- Manager/Team Lead → see projects they manage or are a member of
- Employee → see only projects they are a member of

**Service Logic:**
```
SELECT p.id, p.name, p.description, p.manager_id, p.start_date, p.end_date, p.status,
       p.created_at, p.updated_at,
       mgr.first_name AS manager_first_name, mgr.last_name AS manager_last_name,
       (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
       (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id) AS task_count,
       (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id = p.id AND pt.status = 'done') AS completed_task_count
FROM projects p
LEFT JOIN users mgr ON p.manager_id = mgr.id
```

For non-admin roles, add:
```
WHERE (p.manager_id = $currentUserId
   OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = $currentUserId))
```

**Budget handling in list:** Budget is NOT included in the list response — it's only available in the detail endpoint with access checks.

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, description, status, startDate, endDate,
      manager: { id, firstName, lastName },
      memberCount, taskCount, completedTaskCount,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 5.2 `POST /api/projects` — Create Project

**Permission:** `@RequirePermission('employee_management', 'create', 'projects')`
**Audit:** `@AuditAction('create', 'employee_management', 'projects')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `description` | string | `@IsOptional()`, `@MaxLength(2000)` | No |
| `managerId` | UUID | `@IsUUID()` | Yes |
| `budget` | number | `@IsOptional()`, `@IsNumber()`, `@Min(0)` | No |
| `startDate` | string | `@IsOptional()`, `@IsDateString()` | No |
| `endDate` | string | `@IsOptional()`, `@IsDateString()` | No |
| `memberIds` | UUID[] | `@IsOptional()`, `@IsArray()`, `@IsUUID('4', { each: true })` | No |

**Service Logic:**
1. Validate `managerId` → user exists and active
2. If both `startDate` and `endDate` provided → validate `endDate >= startDate`
3. Insert into `projects` with `status = 'active'`
4. Auto-add the manager as a project member with `role = 'manager'`: insert into `project_members`
5. If `memberIds` provided → validate each user, insert into `project_members` with `role = 'member'`. Skip duplicates (ON CONFLICT DO NOTHING).
6. Return created project

---

### 5.3 `GET /api/projects/:id` — Project Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'projects')`

**Data visibility:** Same as list — non-admin users must be the manager or a member.

**Budget visibility (PRD 10.5):**
- If `req.user` has Admin role → include `budget` in response
- If `req.user.userId === project.managerId` → include `budget`
- Otherwise → `budget` field is omitted from the response (not even `null` — the field is absent)

**Response:**
```
{
  success: true,
  data: {
    id, name, description, status, startDate, endDate,
    budget: 50000.00,  // ONLY for admin or project manager
    manager: { id, employeeId, firstName, lastName, email, photoUrl },
    members: [
      {
        id,  // project_members.id
        user: { id, employeeId, firstName, lastName, email, photoUrl, department: { name } },
        role: "manager" | "member" | "lead",
        addedAt
      }
    ],
    taskSummary: {
      total: number,
      todo: number,
      inProgress: number,
      done: number
    },
    createdAt, updatedAt
  }
}
```

---

### 5.4 `PUT /api/projects/:id` — Update Project

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`
**Audit:** `@AuditAction('update', 'employee_management', 'projects')`

**Additional access check:** Only Admin or the project manager can edit the project. Other members with `edit:projects` permission can only edit if they are the manager.

**Request Body:** Same fields as create, all optional. Plus:
- `status` — `@IsOptional()`, `@IsIn(['active', 'completed', 'on_hold'])`

**Budget edit check:** Only Admin can change the budget. If a non-admin project manager tries to set `budget` → `403 "Only administrators can modify project budgets"`

**Date validation:** Same as create (endDate >= startDate if both present).

---

### 5.5 `DELETE /api/projects/:id` — Delete Project

**Permission:** `@RequirePermission('employee_management', 'delete', 'projects')`
**Audit:** `@AuditAction('delete', 'employee_management', 'projects')`

Deletes the project, all `project_members`, and all `project_tasks` (CASCADE).

**Access:** Admin only. Project managers cannot delete projects.

Returns `{ message: "Project deleted" }`.

---

### 5.6 `POST /api/projects/:id/members` — Add Project Members

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`

**Access:** Admin or project manager only.

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `members` | array | `@IsArray()`, `@ArrayMinSize(1)`, `@ValidateNested({ each: true })` | Yes |
| `members[].userId` | UUID | `@IsUUID()` | Yes |
| `members[].role` | string | `@IsOptional()`, `@IsIn(['member', 'lead'])` | No (default: `'member'`) |

**Service Logic:**
1. Validate project exists
2. Validate access (Admin or manager)
3. Validate each user exists and active
4. Insert with ON CONFLICT DO NOTHING
5. Return updated member list

---

### 5.7 `DELETE /api/projects/:id/members` — Remove Project Members

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`

**Access:** Admin or project manager only.

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `userIds` | UUID[] | `@IsArray()`, `@ArrayMinSize(1)`, `@IsUUID('4', { each: true })` | Yes |

**Service Logic:**
- Cannot remove the project manager: if `userIds` includes `project.managerId` → `400 "Cannot remove the project manager. Transfer management first."`
- Delete from `project_members` where `project_id = $id AND user_id = ANY($userIds)`

---

## 6. Tasks API Specification

Tasks are a sub-resource of Projects. They represent work items within a project.

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Nested controller: routes are under `/api/projects/:projectId/tasks`.

### 6.1 `GET /api/projects/:projectId/tasks` — List Tasks

**Permission:** `@RequirePermission('employee_management', 'view', 'projects')`

**Access:** Must be Admin, or manager/member of the project.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 20 | |
| `status` | string | — | Filter: `todo`, `in_progress`, `done` |
| `priority` | string | — | Filter: `low`, `medium`, `high`, `urgent` |
| `assigneeId` | UUID | — | Filter by assignee |
| `sortBy` | string | `createdAt` | Sort column |
| `sortOrder` | string | `desc` | |

**Service Logic:**
```
SELECT pt.id, pt.title, pt.description, pt.status, pt.priority, pt.due_date,
       pt.created_at, pt.updated_at,
       u.id AS assignee_id, u.first_name AS assignee_first_name,
       u.last_name AS assignee_last_name, u.photo_url AS assignee_photo_url
FROM project_tasks pt
LEFT JOIN users u ON pt.assignee_id = u.id
WHERE pt.project_id = $projectId
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, title, description, status, priority, dueDate,
      assignee: { id, firstName, lastName, photoUrl } | null,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 6.2 `POST /api/projects/:projectId/tasks` — Create Task

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`
**Audit:** `@AuditAction('create', 'employee_management', 'projects')`

**Access:** Admin, project manager, or project lead.

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `title` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `description` | string | `@IsOptional()`, `@MaxLength(2000)` | No |
| `assigneeId` | UUID | `@IsOptional()`, `@IsUUID()` | No |
| `status` | string | `@IsOptional()`, `@IsIn(['todo', 'in_progress', 'done'])`, default `'todo'` | No |
| `priority` | string | `@IsOptional()`, `@IsIn(['low', 'medium', 'high', 'urgent'])`, default `'medium'` | No |
| `dueDate` | string | `@IsOptional()`, `@IsDateString()` | No |

**Service Logic:**
1. Validate project exists
2. If `assigneeId` provided:
   - Validate user exists and active
   - Validate user is a member of this project (or the manager): `SELECT id FROM project_members WHERE project_id = $projectId AND user_id = $assigneeId`. If not found → `400 "Assignee must be a member of this project"`
3. Insert into `project_tasks`
4. **Notification (PRD 23.1):** If `assigneeId` is provided → `NotificationService.create()`:
   - Type: `task_assigned`
   - Recipient: `assigneeId`
   - Title: "New task assigned"
   - Message: "You have been assigned the task '{title}' in project '{projectName}'"
   - Data: `{ projectId, taskId, projectName, taskTitle }`
   - Also send email if `notification_settings.task_assigned.email_enabled` is true
5. Return created task

---

### 6.3 `PUT /api/projects/:projectId/tasks/:taskId` — Update Task

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`
**Audit:** `@AuditAction('update', 'employee_management', 'projects')`

**Access:** Admin, project manager, project lead, or the task assignee (assignee can only update `status`).

**Request Body:** Same fields as create, all optional.

**Service Logic:**
1. Fetch existing task. If not found or wrong project → `404`
2. If caller is the assignee (not manager/admin/lead) → only allow `status` field updates. If they try to change other fields → `403 "You can only update the task status"`
3. If `assigneeId` changed → validate new assignee is a project member. Send `task_assigned` notification to the new assignee.
4. If `status` changed:
   - **Notification (PRD 23.1):** Send `task_status_updated` notification:
     - Recipient: project manager (`project.managerId`)
     - Type: `task_status_updated`
     - Title: "Task status updated"
     - Message: "Task '{title}' in project '{projectName}' changed to '{newStatus}'"
     - In-app only (email_enabled = false per PRD)
5. Update task

---

### 6.4 `DELETE /api/projects/:projectId/tasks/:taskId` — Delete Task

**Permission:** `@RequirePermission('employee_management', 'edit', 'projects')`

**Access:** Admin, project manager, or project lead only. Assignees cannot delete tasks.

Delete task row. Return `{ message: "Task deleted" }`.

---

## 7. Delegations API Specification

Delegations are formal work assignments from a manager/team lead to their direct reportees. Per PRD: "Manager/team lead assigns work to reportees."

All endpoints: `TenantAuthGuard` + `PermissionGuard`. Controller prefix: `delegations`.

### 7.1 Data Visibility & Access Rules

**Key constraint:** A user can only create delegations where they are the delegator AND the delegatee is one of their direct reportees (from `employee_profiles.reports_to`).

- **Admin/HR Admin:** Can view all delegations across the organization. Can create delegations on behalf of any manager (by specifying `delegatorId`).
- **Manager/Team Lead:** Can view and create delegations where they are the delegator. Can only delegate to their own reportees. See their own delegations (as delegator) plus delegations assigned to them (as delegatee).
- **Employee:** Can view delegations where they are the delegatee (assigned to them). Cannot create delegations.

### 7.2 `GET /api/delegations` — List Delegations

**Permission:** `@RequirePermission('employee_management', 'view', 'delegations')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `status` | string | — | Filter: `active`, `completed`, `cancelled` |
| `type` | string | — | Filter by delegation type |
| `sortBy` | string | `createdAt` | Sort column |
| `sortOrder` | string | `desc` | |

**Service Logic:**
```
SELECT del.id, del.type, del.description, del.start_date, del.end_date, del.status,
       del.created_at, del.updated_at,
       dlor.id AS delegator_id, dlor.employee_id AS delegator_emp_id,
       dlor.first_name AS delegator_first_name, dlor.last_name AS delegator_last_name,
       dlor.photo_url AS delegator_photo_url,
       dlee.id AS delegatee_id, dlee.employee_id AS delegatee_emp_id,
       dlee.first_name AS delegatee_first_name, dlee.last_name AS delegatee_last_name,
       dlee.photo_url AS delegatee_photo_url
FROM delegations del
JOIN users dlor ON del.delegator_id = dlor.id
JOIN users dlee ON del.delegatee_id = dlee.id
```

**Data scoping:**
- Admin/HR → no additional WHERE
- Manager → `WHERE (del.delegator_id = $userId OR del.delegatee_id = $userId)`
- Employee → `WHERE del.delegatee_id = $userId`

**Response:**
```
{
  success: true,
  data: [
    {
      id, type, description, startDate, endDate, status,
      delegator: { id, employeeId, firstName, lastName, photoUrl },
      delegatee: { id, employeeId, firstName, lastName, photoUrl },
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 7.3 `POST /api/delegations` — Create Delegation

**Permission:** `@RequirePermission('employee_management', 'create', 'delegations')`
**Audit:** `@AuditAction('create', 'employee_management', 'delegations')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `delegatorId` | UUID | `@IsOptional()`, `@IsUUID()`. If omitted → defaults to `req.user.userId` (the caller is delegating) | No |
| `delegateeId` | UUID | `@IsUUID()` | Yes |
| `type` | string | `@IsNotEmpty()`, `@IsIn(['permanent', 'temporary', 'leave_coverage', 'project_based', 'training'])` | Yes |
| `description` | string | `@IsOptional()`, `@MaxLength(1000)` | No |
| `startDate` | string | `@IsDateString()` | Yes |
| `endDate` | string | `@IsOptional()`, `@IsDateString()` | No |

**Delegation Types:**
| Type | Description |
|---|---|
| `permanent` | Ongoing delegation with no end date |
| `temporary` | Time-bound delegation for a specific period |
| `leave_coverage` | Covering for someone on leave |
| `project_based` | Delegation tied to a specific project |
| `training` | Delegation as part of training/mentoring |

**Service Logic:**
1. Determine delegator:
   - If `delegatorId` not provided → use `req.user.userId`
   - If `delegatorId` provided and differs from `req.user.userId` → only Admin/HR can create on behalf of others. Non-admin → `403 "You can only create delegations for yourself"`
2. Validate delegator exists and active
3. Validate delegatee exists and active
4. Validate delegatee is a direct reportee of the delegator:
   ```
   SELECT id FROM employee_profiles WHERE user_id = $delegateeId AND reports_to = $delegatorId
   ```
   If not found → `400 "Delegatee must be a direct reportee of the delegator"`
   **Exception:** Admin/HR can bypass this check (they can create any delegation).
5. Prevent self-delegation: `delegatorId !== delegateeId` → `400 "Cannot delegate to yourself"`
6. If both `startDate` and `endDate` → validate `endDate >= startDate`
7. If `type === 'permanent'` and `endDate` is provided → `400 "Permanent delegations should not have an end date"` (warning, not blocking — set `endDate = null` silently)
8. Check for conflicting active delegations: same delegator + delegatee + overlapping date range + status = 'active':
   ```
   SELECT id FROM delegations
   WHERE delegator_id = $delegatorId AND delegatee_id = $delegateeId
     AND status = 'active'
     AND (start_date <= COALESCE($endDate, '9999-12-31') AND COALESCE(end_date, '9999-12-31') >= $startDate)
   ```
   If found → `409 "An active delegation already exists between these users for the specified period"`
9. Insert into `delegations` with `status = 'active'`
10. **Notification (PRD 23.1):**
    - Type: `delegation_created`
    - Recipient: `delegateeId`
    - Title: "New delegation assigned"
    - Message: "A {type} delegation has been assigned to you by {delegatorName}, starting {startDate}"
    - Data: `{ delegationId, delegatorId, type, startDate, endDate }`
    - Send both in-app and email (per notification_settings defaults)
11. Return created delegation

---

### 7.4 `GET /api/delegations/:id` — Delegation Detail

**Permission:** `@RequirePermission('employee_management', 'view', 'delegations')`

**Data visibility:** Admin can view any. Others must be the delegator or delegatee.

Same response shape as list item but with full user details for delegator and delegatee (including department, designation).

---

### 7.5 `PUT /api/delegations/:id` — Update Delegation

**Permission:** `@RequirePermission('employee_management', 'edit', 'delegations')`
**Audit:** `@AuditAction('update', 'employee_management', 'delegations')`

**Access:** Admin, or the delegator (the user who created it).

**Request Body:** Optional fields: `type`, `description`, `startDate`, `endDate`, `status`.

**Status transitions:**
- `active` → `completed` (delegation finished)
- `active` → `cancelled` (delegation revoked)
- `completed` → no transitions (terminal)
- `cancelled` → no transitions (terminal)

If `status` is changed to `completed` or `cancelled` → this is effectively closing the delegation.

Cannot change `delegatorId` or `delegateeId` — create a new delegation instead.

---

### 7.6 `DELETE /api/delegations/:id` — Delete Delegation

**Permission:** `@RequirePermission('employee_management', 'delete', 'delegations')`
**Audit:** `@AuditAction('delete', 'employee_management', 'delegations')`

**Access:** Admin only. Managers should use status change (`cancelled`) instead of hard delete.

Hard deletes the delegation row. Return `{ message: "Delegation deleted" }`.

---

## 8. Frontend: Groups Page

### 8.1 Route: `/employees/groups`

**Page Header:**
- Title: "Groups"
- Right: "Create Group" button (permission-gated: `employee_management:create:groups`)

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Group Name | `name` | Clickable → opens detail drawer |
| Description | `description` | Truncated to 60 chars |
| Members | `memberCount` | Badge |
| Created By | `createdBy.firstName lastName` | |
| Created | `createdAt` | Relative date |
| Actions | — | Edit, Delete (permission-gated) |

### 8.2 Group Form Drawer

**Fields:**
- Group Name (text, required)
- Description (textarea, optional)
- Initial Members (multi-select using `/api/employees/lookup`, optional) — only shown on create, not edit

**Create/Edit:** Standard drawer pattern with toast feedback.

### 8.3 Group Detail / Members Drawer

Opens on row click. Shows group info and full member list.

**Member List:** Each row: avatar, name, employee ID, department, designation. "Remove" button per member (permission-gated).

**Add Members:** "Add Members" button → opens a searchable employee picker (multi-select, uses `/api/employees/lookup`). Submit → `POST /api/groups/:id/members`.

**Remove Members:** Click "Remove" → inline confirm → `DELETE /api/groups/:id/members` with single userId.

---

## 9. Frontend: Projects Page

### 9.1 Route: `/employees/projects`

**Page Header:**
- Title: "Projects"
- Right: "Create Project" button (permission-gated: `employee_management:create:projects`)

**Toolbar:** Search, status filter dropdown (All / Active / Completed / On Hold)

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Project Name | `name` | Clickable → `/employees/projects/{id}` |
| Manager | `manager.firstName lastName` | Avatar + name |
| Status | `status` | Colored badge: green=active, blue=completed, amber=on_hold |
| Members | `memberCount` | Badge |
| Tasks | `completedTaskCount / taskCount` | Progress indicator (e.g., "5/12") |
| Start Date | `startDate` | Formatted date |
| End Date | `endDate` | Formatted date or "—" |
| Actions | — | Edit, Delete (Admin only for delete) |

Row click → navigates to project detail page.

### 9.2 Project Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Project Name | text | Required |
| Description | textarea | Optional |
| Manager | searchable select | Required. Uses `/api/employees/lookup`. |
| Budget | number input with currency prefix (₹) | Optional. Only shown to Admin. Hidden for non-admin users. |
| Start Date | date picker | Optional |
| End Date | date picker | Optional. Validated >= start date client-side. |
| Members | multi-select | Optional. Uses `/api/employees/lookup`. |

### 9.3 Project Detail Page

Route: `/employees/projects/[id]`

**Page Header:**
- Back arrow → `/employees/projects`
- Title: project name
- Status badge
- Right: "Edit" button, "Delete" button (Admin only), "Manage Members" button

**Layout — Two sections:**

**Top Section: Project Info Card**
- Description
- Manager (avatar + name, clickable)
- Budget: only shown if user is Admin or project manager. Otherwise the entire row is absent.
- Date range: start → end (or "No end date")
- Status

**Members Section:**
- Grid of member cards: avatar, name, role badge (Manager / Lead / Member), department
- "Add Members" and "Remove" actions (manager/admin only)

**Bottom Section: Tasks**

Two view modes (toggle):

**List View (default):**

| Column | Notes |
|---|---|
| Title | Clickable → opens task modal |
| Assignee | Avatar + name |
| Status | Badge: gray=todo, blue=in_progress, green=done |
| Priority | Badge: low=gray, medium=blue, high=amber, urgent=red |
| Due Date | Formatted, red if overdue |
| Actions | Edit, Delete |

Toolbar: "Add Task" button, filter by status, filter by priority, filter by assignee.

**Board View (Kanban):**

Three columns: To Do | In Progress | Done

Each task as a card showing: title, assignee avatar, priority badge, due date.

Drag-and-drop between columns → calls `PUT /api/projects/:projectId/tasks/:taskId` with the new status.

### 9.4 Task Form Modal

Opens for create and edit. Compact modal (not drawer).

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Title | text | Required |
| Description | textarea | Optional |
| Assignee | searchable select | Optional. Options: project members only (from the project's member list). |
| Status | select | To Do / In Progress / Done. Default: To Do. |
| Priority | select | Low / Medium / High / Urgent. Default: Medium. |
| Due Date | date picker | Optional |

---

## 10. Frontend: Delegations Page

### 10.1 Route: `/employees/delegations`

Reference: `EmployeeManagement_delegations.png`

**Page Header:**
- Title: "Delegations"
- Right: "Add Delegation" button (permission-gated: `employee_management:create:delegations`)

**Toolbar:** Status filter (All / Active / Completed / Cancelled), type filter dropdown

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Delegator | `delegator.firstName lastName` | Avatar + name. Shows "You" if current user. |
| Delegatee | `delegatee.employeeId — firstName lastName` | Avatar + employee ID + name |
| Type | `type` | Capitalized badge |
| Date Range | `startDate — endDate` | Formatted range. "Ongoing" if no end date. |
| Status | `status` | Colored badge: green=active, gray=completed, red=cancelled |
| Actions | — | Edit, Cancel, Delete (Admin only for delete) |

### 10.2 Delegation Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Delegator | searchable select | Pre-filled with current user. Only Admin/HR can change to another user. |
| Delegatee | searchable select | Required. When delegator is selected, dropdown is filtered to show only that delegator's direct reportees (fetched via `GET /api/employees/{delegatorId}/reportees`). Admin/HR bypass: shows all employees. |
| Type | select | Required. Options: Permanent, Temporary, Leave Coverage, Project Based, Training. |
| Description | textarea | Optional |
| Start Date | date picker | Required |
| End Date | date picker | Optional. Hidden if type is "Permanent". Required if type is "Temporary" or "Leave Coverage". |

**Dynamic behavior:**
- When the user selects a Delegator (or it auto-fills with themselves), the Delegatee dropdown refreshes to show only that person's reportees.
- When "Permanent" type is selected, End Date field hides.
- When "Temporary" or "Leave Coverage" type is selected, End Date becomes required.

### 10.3 Delegation Status Actions

Instead of an edit form for status changes, provide inline actions on the table row:

- **Complete:** Available when status is `active`. Confirm dialog → `PUT /api/delegations/:id` with `{ status: 'completed' }`.
- **Cancel:** Available when status is `active`. Confirm dialog → `PUT /api/delegations/:id` with `{ status: 'cancelled' }`.

Full edit (changing type, dates, description) via the "Edit" action in the actions column.

---

## 11. Dashboard Widget Update

Update the tenant dashboard (Sprint 2D) to populate the `activeGoals` placeholder.

While goals are Sprint 5, the `openJobOpenings` quick stat can be wired later. For now, as a project-related stat, add a small active-projects indicator inside the dashboard service if useful. However, per the original Sprint 2D definition, the quick stats are: `totalEmployees` (done in 3A), `pendingLeaveRequests`, `activeGoals`, `openJobOpenings`. None of these map directly to projects, so no dashboard change is needed in this sprint.

---

## 12. Scope Boundaries

### In Scope (Sprint 3C)
- Groups CRUD (5 endpoints) + member add/remove (2 endpoints)
- Projects CRUD (5 endpoints) + member add/remove (2 endpoints) with budget visibility restriction
- Tasks CRUD (4 endpoints) nested under projects with assignee validation
- Delegations CRUD (5 endpoints) with reportee-only constraint
- Task assignment notification (`task_assigned` — in-app + email)
- Task status update notification (`task_status_updated` — in-app only)
- Delegation creation notification (`delegation_created` — in-app + email)
- Groups page with DataTable, form drawer, member management drawer
- Projects list page with status/manager filters
- Project detail page with members section + tasks section (list + kanban board views)
- Task form modal with assignee restricted to project members
- Delegations page with DataTable, form drawer, inline status actions
- Delegation form with reportee-filtered delegatee dropdown
- Tab layout updated: Groups and Delegations are now functional, Projects tab added
- Audit logging on all CUD operations

### Out of Scope
| Feature | Sprint |
|---|---|
| CSV import for any of these entities | 3D |
| Export for groups/projects/delegations | 3D |
| Task comments or attachments | Future |
| Task time tracking integration | Future |
| Delegation auto-expiry cron | Future |
| Project Gantt chart | Future |
| Drag-and-drop task reordering within a column | Future |

---

## 13. Verification & Acceptance Criteria

### Group Tests

**Test 1: Create group with initial members**
```
POST /api/groups
Body: { name: "Social Committee", description: "Office events and culture", memberIds: ["{userId1}", "{userId2}"] }
→ 201: Group created with memberCount: 2
```

**Test 2: Duplicate group name**
```
POST /api/groups { name: "Social Committee" }
→ 409: "A group with this name already exists"
```

**Test 3: Add members**
```
POST /api/groups/{id}/members
Body: { userIds: ["{userId3}"] }
→ 200: Member added, memberCount: 3
```

**Test 4: Add duplicate member (idempotent)**
```
POST /api/groups/{id}/members
Body: { userIds: ["{userId1}"] }  # already a member
→ 200: No error, memberCount stays the same
```

**Test 5: Remove member**
```
DELETE /api/groups/{id}/members
Body: { userIds: ["{userId2}"] }
→ 200: Member removed, memberCount: 2
```

**Test 6: Delete group**
```
DELETE /api/groups/{id}
→ 200: Group and all members deleted
```

### Project Tests

**Test 7: Create project**
```
POST /api/projects
Body: { name: "Website Redesign", managerId: "{mgrId}", budget: 50000, startDate: "2026-03-01", memberIds: ["{userId1}"] }
→ 201: Project created, manager auto-added as member with role 'manager'
```

**Test 8: Budget visibility — non-admin non-manager**
```
GET /api/projects/{id}
Headers: Authorization: Bearer <employee_token>  # employee is a member but not manager
→ 200: Response has NO budget field
```

**Test 9: Budget visibility — admin**
```
GET /api/projects/{id}
Headers: Authorization: Bearer <admin_token>
→ 200: Response includes budget: 50000
```

**Test 10: Budget visibility — project manager**
```
GET /api/projects/{id}
Headers: Authorization: Bearer <manager_token>  # this user is the project manager
→ 200: Response includes budget: 50000
```

**Test 11: Project data visibility — employee sees only their projects**
```
GET /api/projects
Headers: Authorization: Bearer <employee_token>
→ 200: Only projects where user is a member
```

**Test 12: Cannot remove project manager**
```
DELETE /api/projects/{id}/members
Body: { userIds: ["{managerId}"] }
→ 400: "Cannot remove the project manager"
```

### Task Tests

**Test 13: Create task with assignee**
```
POST /api/projects/{projectId}/tasks
Body: { title: "Design homepage mockup", assigneeId: "{memberId}", priority: "high", dueDate: "2026-03-15" }
→ 201: Task created

Verify: Notification sent to assignee (type: task_assigned, in-app + email)
```

**Test 14: Assign to non-member rejected**
```
POST /api/projects/{projectId}/tasks
Body: { title: "Some task", assigneeId: "{nonMemberId}" }
→ 400: "Assignee must be a member of this project"
```

**Test 15: Assignee updates status**
```
PUT /api/projects/{projectId}/tasks/{taskId}
Headers: Authorization: Bearer <assignee_token>
Body: { status: "in_progress" }
→ 200: Status updated

Verify: Notification sent to project manager (type: task_status_updated, in-app only)
```

**Test 16: Assignee cannot change other fields**
```
PUT /api/projects/{projectId}/tasks/{taskId}
Headers: Authorization: Bearer <assignee_token>
Body: { title: "Changed title" }
→ 403: "You can only update the task status"
```

### Delegation Tests

**Test 17: Create delegation**
```
POST /api/delegations
Body: { delegateeId: "{reporteeId}", type: "temporary", startDate: "2026-03-01", endDate: "2026-03-31" }
→ 201: Delegation created (delegator = current user)

Verify:
- delegations table has row with delegator_id = current user
- Notification sent to reportee (type: delegation_created, in-app + email)
```

**Test 18: Delegatee not a reportee (non-admin)**
```
POST /api/delegations
Body: { delegateeId: "{nonReporteeId}", type: "permanent", startDate: "2026-03-01" }
→ 400: "Delegatee must be a direct reportee of the delegator"
```

**Test 19: Admin can bypass reportee check**
```
POST /api/delegations
Headers: Authorization: Bearer <admin_token>
Body: { delegatorId: "{mgrId}", delegateeId: "{anyUserId}", type: "temporary", startDate: "2026-03-01", endDate: "2026-03-31" }
→ 201: Created (admin bypasses reportee check)
```

**Test 20: Self-delegation blocked**
```
POST /api/delegations
Body: { delegateeId: "{ownUserId}", type: "permanent", startDate: "2026-03-01" }
→ 400: "Cannot delegate to yourself"
```

**Test 21: Overlapping delegation conflict**
```
# Active delegation exists: 2026-03-01 to 2026-03-31
POST /api/delegations
Body: { delegateeId: "{sameReporteeId}", type: "temporary", startDate: "2026-03-15", endDate: "2026-04-15" }
→ 409: "An active delegation already exists between these users for the specified period"
```

**Test 22: Complete delegation**
```
PUT /api/delegations/{id}
Body: { status: "completed" }
→ 200: Status changed to completed
```

**Test 23: Manager data scoping**
```
GET /api/delegations
Headers: Authorization: Bearer <manager_token>
→ 200: Only delegations where user is delegator or delegatee
```

**Test 24: Employee data scoping**
```
GET /api/delegations
Headers: Authorization: Bearer <employee_token>
→ 200: Only delegations where user is the delegatee
```

### Frontend Tests

- [ ] Groups tab now functional (no longer placeholder)
- [ ] Groups table with name, description, member count, creator, actions
- [ ] Group create drawer with name, description, initial member picker
- [ ] Group detail drawer with member list, add/remove member controls
- [ ] Projects tab visible in top tab bar
- [ ] Projects table with name, manager, status badge, task progress, dates
- [ ] Project create drawer with budget field hidden for non-admins
- [ ] Project detail page: info card (budget visible per access rules), members grid, tasks section
- [ ] Task list view with status/priority/assignee filters
- [ ] Task board (kanban) view with drag-and-drop status change
- [ ] "Add Task" modal: assignee dropdown restricted to project members
- [ ] Task assignee can update status only; cannot edit title/description/priority
- [ ] Delegations tab now functional (no longer placeholder)
- [ ] Delegations table matches reference screenshot: Delegator, Delegatee, Type, Date Range, Status
- [ ] Delegation form: delegatee dropdown filtered to delegator's reportees
- [ ] "You" label shown when current user is the delegator
- [ ] Inline Complete/Cancel actions on active delegations
- [ ] Delegation type "Permanent" hides End Date field
- [ ] Delegation type "Temporary"/"Leave Coverage" makes End Date required
- [ ] Notifications: task_assigned toast + in-app for assignee
- [ ] Notifications: task_status_updated in-app for project manager
- [ ] Notifications: delegation_created toast + in-app + email for delegatee
- [ ] Mobile: all drawers become full-page, tables horizontally scrollable, kanban scrollable

### Full Checklist

**Backend:**
- [ ] `GET /api/groups` — list with search, sort, pagination, member count
- [ ] `POST /api/groups` — create with name uniqueness, optional initial members
- [ ] `GET /api/groups/:id` — detail with full member list
- [ ] `PUT /api/groups/:id` — update name/description
- [ ] `DELETE /api/groups/:id` — hard delete with CASCADE
- [ ] `POST /api/groups/:id/members` — add members (ON CONFLICT DO NOTHING)
- [ ] `DELETE /api/groups/:id/members` — remove members
- [ ] `GET /api/projects` — list with data visibility, status filter, manager filter
- [ ] `POST /api/projects` — create with manager auto-added, member validation
- [ ] `GET /api/projects/:id` — detail with budget visibility restriction
- [ ] `PUT /api/projects/:id` — update with budget-edit admin-only guard
- [ ] `DELETE /api/projects/:id` — admin only, CASCADE members+tasks
- [ ] `POST /api/projects/:id/members` — add members (admin/manager only)
- [ ] `DELETE /api/projects/:id/members` — remove members (cannot remove manager)
- [ ] `GET /api/projects/:projectId/tasks` — list with status/priority/assignee filters
- [ ] `POST /api/projects/:projectId/tasks` — create with assignee-must-be-member validation + notification
- [ ] `PUT /api/projects/:projectId/tasks/:taskId` — update with assignee-status-only restriction + notification
- [ ] `DELETE /api/projects/:projectId/tasks/:taskId` — delete (admin/manager/lead only)
- [ ] `GET /api/delegations` — list with data visibility scoping
- [ ] `POST /api/delegations` — create with reportee check, overlap check, notification
- [ ] `GET /api/delegations/:id` — detail with access check
- [ ] `PUT /api/delegations/:id` — update with status transition validation
- [ ] `DELETE /api/delegations/:id` — admin-only hard delete
- [ ] Budget hidden from API unless admin or project manager
- [ ] Task assignee validated against project members
- [ ] Delegatee validated against delegator's reportees (admin bypass)
- [ ] Notifications: task_assigned, task_status_updated, delegation_created
- [ ] Audit logging on all CUD operations

**Frontend:**
- [ ] Groups page with table, form drawer, member management
- [ ] Projects list page with status filter, data visibility
- [ ] Project detail page with info card, members, tasks (list + kanban)
- [ ] Task form modal with project-member-only assignee dropdown
- [ ] Kanban drag-and-drop status change
- [ ] Delegations page matching reference screenshot
- [ ] Delegation form with reportee-filtered delegatee dropdown
- [ ] Inline status actions (Complete, Cancel) on delegations
- [ ] Tab layout: Groups + Delegations functional, Projects tab added

---

*Sprint 3C Complete. Next: Sprint 3D — CSV Import/Export & Module Integration*
