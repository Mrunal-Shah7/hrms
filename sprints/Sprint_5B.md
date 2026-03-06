# Sprint 5B — Performance & Goals

## Goal
Build the Performance module: Goals CRUD (assignable to individual users, groups, or projects), goal progress tracking with history, time-based filtering (this week/month/last week/month), performance review cycles CRUD (quarterly/annual), manager submits reviews for direct reports, employee acknowledges reviews, goal export, and five notification events (goal assigned, progress updated, goal completed, review cycle started, review submitted). By the end, managers can set goals, employees can track progress, and formal review cycles can be run.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `goals` table (id, title, description, assigned_to_id, assigned_to_type, created_by_id, priority, status, progress, start_date, due_date, completed_at, created_at, updated_at) | 1A / 1B | ✅ |
| `goal_progress_history` table (id, goal_id, user_id, old_progress, new_progress, note, created_at) | 1A / 1B | ✅ |
| `performance_review_cycles` table (id, name, type, start_date, end_date, status, created_at, updated_at) | 1A / 1B | ✅ |
| `performance_reviews` table (id, cycle_id, subject_id, reviewer_id, rating, comments, strengths, improvements, status, submitted_at, acknowledged_at, created_at, updated_at) | 1A / 1B | ✅ |
| Seeded permissions: `performance:view:goals`, `performance:create:goals`, `performance:edit:goals`, `performance:delete:goals`, `performance:export:goals`, `performance:view:review_cycles`, `performance:create:review_cycles`, `performance:edit:review_cycles`, `performance:view:reviews`, `performance:create:reviews` | 1B | ✅ |
| Admin/HR Admin: full goal CRUD + export, review cycle CRU, view + create reviews | 1B | ✅ |
| HR Manager: full goal CRUD + export, view review cycles, view + create reviews | 1B | ✅ |
| Manager: full goal CRUD (no export), view review cycles, view + create reviews | 1B | ✅ |
| Employee: view goals (own) + edit goals (progress only), view reviews (own) | 1B | ✅ |
| Notification types seeded: `goal_assigned` (in-app + email), `goal_progress_updated` (in-app + email), `goal_completed` (in-app + email), `review_cycle_started` (in-app + email), `review_submitted` (in-app + email) | Gap Fix 3 | ✅ |
| Groups (id, name, members) — Sprint 3C | 3C | ✅ |
| Projects (id, name, manager, members) — Sprint 3C | 3C | ✅ |
| `/performance` placeholder page in sidebar | 1H | ✅ |
| Dashboard `activeGoals` quick stat placeholder | 2D | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/performance/performance.module.ts` | NestJS module |
| `src/performance/goals/goals.controller.ts` | Goals CRUD + progress + export |
| `src/performance/goals/goals.service.ts` | Goal business logic |
| `src/performance/goals/dto/create-goal.dto.ts` | Create DTO |
| `src/performance/goals/dto/update-goal.dto.ts` | Update DTO |
| `src/performance/goals/dto/update-progress.dto.ts` | Progress update DTO |
| `src/performance/goals/dto/index.ts` | Barrel |
| `src/performance/reviews/review-cycles.controller.ts` | Review cycle CRUD |
| `src/performance/reviews/review-cycles.service.ts` | Cycle business logic |
| `src/performance/reviews/reviews.controller.ts` | Review create + submit + acknowledge |
| `src/performance/reviews/reviews.service.ts` | Review business logic |
| `src/performance/reviews/dto/create-cycle.dto.ts` | Create cycle DTO |
| `src/performance/reviews/dto/update-cycle.dto.ts` | Update cycle DTO |
| `src/performance/reviews/dto/create-review.dto.ts` | Create review DTO |
| `src/performance/reviews/dto/submit-review.dto.ts` | Submit review DTO |
| `src/performance/reviews/dto/index.ts` | Barrel |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/performance/page.tsx` | Performance page (replaces placeholder) |
| `src/app/(tenant)/performance/layout.tsx` | Layout with My Data / Team tabs + sub-tabs |
| `src/app/(tenant)/performance/goals/page.tsx` | Goals sub-tab |
| `src/app/(tenant)/performance/reviews/page.tsx` | Reviews sub-tab |
| `src/app/(tenant)/performance/reviews/cycles/page.tsx` | Review cycles admin page |
| `src/components/modules/performance/goal-card.tsx` | Goal card component |
| `src/components/modules/performance/goal-form-drawer.tsx` | Goal create/edit drawer |
| `src/components/modules/performance/goal-detail-drawer.tsx` | Goal detail with progress history |
| `src/components/modules/performance/progress-update-modal.tsx` | Update progress modal |
| `src/components/modules/performance/review-cycle-form-drawer.tsx` | Cycle create/edit drawer |
| `src/components/modules/performance/review-form-drawer.tsx` | Submit review drawer |
| `src/components/modules/performance/review-detail-drawer.tsx` | Review detail + acknowledge |
| `src/services/goals.ts` | Goals API helpers |
| `src/services/review-cycles.ts` | Review cycle API helpers |
| `src/services/reviews.ts` | Reviews API helpers |

### Module Registration
- Import `PerformanceModule` into `AppModule`

---

## 3. Performance Module Layout

### 3.1 Top Tabs

**Primary tabs:** My Data | Team

**Sub-tabs under My Data:** Goals | Reviews

Reference: `goals.png` — shows "My Data | Team | Skill Set Matrix" top bar and "KRA | Skill Set | Goals | Competency | Feedback" sub-tabs. Our PRD scopes this down to Goals only for the "My Data" view — the KRA/Skill Set/Competency/Feedback tabs are reference-product features not in our PRD. We implement Goals as the primary sub-tab.

**Sub-tabs under Team (visible to Manager/Admin/HR):** Team Goals | Team Reviews

### 3.2 Admin Pages

Review cycle management is accessible via an admin gear dropdown (same pattern as Leave):
- Review Cycles → `/performance/reviews/cycles`

---

## 4. Goals API Specification

Goals are flat-structure work items that can be assigned to individual users, groups, or projects. Each goal has a title, description, priority, status, progress percentage (0–100), and optional date range.

Controller prefix: `goals`.

### 4.1 Assignment Types

| `assigned_to_type` | `assigned_to_id` references | Behavior |
|---|---|---|
| `user` | `users.id` | Individual goal — one assignee |
| `group` | `groups.id` | Group goal — visible to all group members |
| `project` | `projects.id` | Project goal — visible to all project members |

When a goal is assigned to a group or project, all members can view it, but progress updates are tracked per-update (each update records who made it). The progress reflects the overall goal state, not per-member.

### 4.2 `GET /api/goals` — List Goals

**Permission:** `@RequirePermission('performance', 'view', 'goals')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `assignedToType` | string | — | Filter: `user`, `group`, `project` |
| `status` | string | — | Filter: `not_started`, `in_progress`, `completed`, `cancelled` |
| `priority` | string | — | Filter: `low`, `medium`, `high`, `critical` |
| `filter` | string | `all` | Time filter: `all`, `this_week`, `last_week`, `this_month`, `last_month` |
| `sortBy` | string | `createdAt` | |
| `sortOrder` | string | `desc` | |

**Time Filter Logic:**
- `this_week`: goals where `created_at >= start of current week (Monday)` OR `due_date` falls within current week
- `last_week`: same but for previous week
- `this_month`: goals where `created_at >= start of current month` OR `due_date` falls within current month
- `last_month`: same but for previous month
- `all`: no time filter

**Data Visibility:**
- **Admin/HR Admin/HR Manager:** All goals in the organization
- **Manager:** Goals they created + goals assigned to them + goals assigned to their direct reportees + goals assigned to groups/projects they manage or are members of
- **Employee:** Goals assigned to them directly + goals assigned to groups they belong to + goals assigned to projects they are members of

**Service Logic:**

For user-type goals:
```
SELECT g.id, g.title, g.description, g.assigned_to_id, g.assigned_to_type,
       g.created_by_id, g.priority, g.status, g.progress,
       g.start_date, g.due_date, g.completed_at, g.created_at, g.updated_at,
       u.first_name AS assignee_first_name, u.last_name AS assignee_last_name, u.photo_url,
       cu.first_name AS creator_first_name, cu.last_name AS creator_last_name
FROM goals g
LEFT JOIN users u ON g.assigned_to_id = u.id AND g.assigned_to_type = 'user'
LEFT JOIN users cu ON g.created_by_id = cu.id
```

For group-type goals, join `groups` + `group_members` to resolve visibility.
For project-type goals, join `projects` + `project_members`.

**Response:**
```
{
  success: true,
  data: [
    {
      id, title, description,
      assignedTo: {
        type: "user" | "group" | "project",
        id: UUID,
        name: "John Doe" | "Engineering Team" | "Website Redesign"
      },
      createdBy: { id, firstName, lastName },
      priority: "high",
      status: "in_progress",
      progress: 30,
      startDate, dueDate, completedAt,
      isOverdue: boolean,  // dueDate < today AND status !== 'completed'
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.3 `POST /api/goals` — Create Goal

**Permission:** `@RequirePermission('performance', 'create', 'goals')`
**Audit:** `@AuditAction('create', 'performance', 'goals')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `title` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `description` | string | `@IsOptional()`, `@MaxLength(2000)` | No |
| `assignedToId` | UUID | `@IsUUID()` | Yes |
| `assignedToType` | string | `@IsIn(['user', 'group', 'project'])`, default `'user'` | No |
| `priority` | string | `@IsIn(['low', 'medium', 'high', 'critical'])`, default `'medium'` | No |
| `startDate` | string | `@IsOptional()`, `@IsDateString()` | No |
| `dueDate` | string | `@IsOptional()`, `@IsDateString()` | No |

**Service Logic:**
1. Validate `assignedToId` based on `assignedToType`:
   - `user` → `SELECT id FROM users WHERE id = $id AND status = 'active'` → `404 "User not found"`
   - `group` → `SELECT id FROM groups WHERE id = $id` → `404 "Group not found"`
   - `project` → `SELECT id FROM projects WHERE id = $id` → `404 "Project not found"`
2. If both dates provided → validate `dueDate >= startDate`
3. Insert into `goals` with `created_by_id = req.user.userId`, `status = 'not_started'`, `progress = 0`
4. **Notification (PRD 23.1):**
   - Type: `goal_assigned`
   - Recipients:
     - `user` type → the assigned user
     - `group` type → all members of the group
     - `project` type → all members of the project
   - Title: "New goal assigned"
   - Message: "You have been assigned a new goal: '{title}'"
   - Data: `{ goalId, assignedToType, assignedToId }`
   - In-app + email per notification_settings
5. Return created goal

---

### 4.4 `GET /api/goals/:id` — Goal Detail

**Permission:** `@RequirePermission('performance', 'view', 'goals')`

**Access:** Same visibility rules as list — must be the assignee, creator, admin/HR, or a member of the assigned group/project.

Returns full goal details + progress history:

```
{
  success: true,
  data: {
    id, title, description,
    assignedTo: { type, id, name },
    createdBy: { id, firstName, lastName },
    priority, status, progress,
    startDate, dueDate, completedAt, isOverdue,
    progressHistory: [
      {
        id,
        user: { id, firstName, lastName, photoUrl },
        oldProgress: 0,
        newProgress: 30,
        note: "Completed initial research phase",
        createdAt
      }
    ],
    createdAt, updatedAt
  }
}
```

---

### 4.5 `PUT /api/goals/:id` — Update Goal

**Permission:** `@RequirePermission('performance', 'edit', 'goals')`
**Audit:** `@AuditAction('update', 'performance', 'goals')`

**Access:** Admin/HR can update any goal. Manager can update goals they created. Employee cannot use this endpoint for general updates — they use the progress endpoint (Section 4.6).

**Request Body:** Same fields as create, all optional. Plus:
- `status` — `@IsOptional()`, `@IsIn(['not_started', 'in_progress', 'completed', 'cancelled'])`

**Service Logic:**
1. Validate access: `req.user.userId === goal.createdById` OR admin/HR
2. If `status` changed to `'completed'` → set `completedAt = NOW()`
3. If `status` changed from `'completed'` to something else → set `completedAt = null`
4. Cannot change `assignedToId` or `assignedToType` after creation (reassign by creating a new goal)
5. Date validation if applicable

---

### 4.6 `PUT /api/goals/:id/progress` — Update Progress

**Permission:** `@RequirePermission('performance', 'edit', 'goals')`
**Audit:** `@AuditAction('update', 'performance', 'goals')`

**Access:** The goal assignee (or any group/project member for group/project goals), the goal creator, or admin/HR.

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `progress` | number | `@IsInt()`, `@Min(0)`, `@Max(100)` | Yes |
| `note` | string | `@IsOptional()`, `@MaxLength(500)` | No |

**Service Logic:**
1. Fetch current goal
2. If `progress === goal.progress` → `400 "Progress value is unchanged"`
3. Insert into `goal_progress_history`:
   - `goal_id`, `user_id = req.user.userId`, `old_progress = goal.progress`, `new_progress = progress`, `note`
4. Update `goals.progress = progress`
5. Auto-status transitions:
   - If `progress > 0` AND `goal.status === 'not_started'` → auto-set `status = 'in_progress'`
   - If `progress === 100` → auto-set `status = 'completed'`, `completedAt = NOW()`
6. **Notification (PRD 23.1):**
   - Type: `goal_progress_updated`
   - Recipient: the goal creator (`goal.createdById`)
   - Title: "Goal progress updated"
   - Message: "'{goalTitle}' progress updated from {old}% to {new}%"
   - Data: `{ goalId, oldProgress, newProgress }`
   - In-app + email per notification_settings
7. If `progress === 100` (goal completed):
   - **Notification:**
     - Type: `goal_completed`
     - Recipient: the goal creator
     - Title: "Goal completed"
     - Message: "'{goalTitle}' has been marked as completed"
     - Data: `{ goalId }`

---

### 4.7 `DELETE /api/goals/:id` — Delete Goal

**Permission:** `@RequirePermission('performance', 'delete', 'goals')`
**Audit:** `@AuditAction('delete', 'performance', 'goals')`

**Access:** Admin/HR or the goal creator.

Deletes goal + cascades to `goal_progress_history`. Return `{ message: "Goal deleted" }`.

---

### 4.8 `GET /api/goals/export` — Export Goals

**Permission:** `@RequirePermission('performance', 'export', 'goals')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as list + `format` (csv, xlsx, pdf)

**Export Columns:**

| Header | Source |
|---|---|
| Title | `title` |
| Description | `description` (truncated to 200 chars) |
| Assigned To | name (user/group/project) |
| Assignment Type | `assignedToType` |
| Created By | `createdBy.firstName lastName` |
| Priority | `priority` |
| Status | `status` |
| Progress | `progress`% |
| Start Date | `startDate` |
| Due Date | `dueDate` |
| Completed At | `completedAt` |
| Overdue | "Yes" / "No" |

File name: `goals_{YYYY-MM-DD}.{format}`

---

## 5. Review Cycles API Specification

Review cycles are admin-configured periods during which managers submit formal performance reviews for their direct reports. A cycle has a type (quarterly, annual, or custom), a date range, and a status lifecycle (draft → active → completed).

Controller prefix: `performance/review-cycles`.

### 5.1 `GET /api/performance/review-cycles` — List Cycles

**Permission:** `@RequirePermission('performance', 'view', 'review_cycles')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `status` | string | — | Filter: `draft`, `active`, `completed` |
| `sortBy` | string | `startDate` | |
| `sortOrder` | string | `desc` | |

**Service Logic:**
```
SELECT rc.id, rc.name, rc.type, rc.start_date, rc.end_date, rc.status,
       rc.created_at, rc.updated_at,
       (SELECT COUNT(*) FROM performance_reviews pr WHERE pr.cycle_id = rc.id) AS review_count,
       (SELECT COUNT(*) FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'submitted') AS submitted_count,
       (SELECT COUNT(*) FROM performance_reviews pr WHERE pr.cycle_id = rc.id AND pr.status = 'acknowledged') AS acknowledged_count
FROM performance_review_cycles rc
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, type, startDate, endDate, status,
      reviewCount, submittedCount, acknowledgedCount,
      createdAt, updatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 5.2 `POST /api/performance/review-cycles` — Create Cycle

**Permission:** `@RequirePermission('performance', 'create', 'review_cycles')`
**Audit:** `@AuditAction('create', 'performance', 'review_cycles')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `type` | string | `@IsIn(['quarterly', 'annual', 'custom'])` | Yes |
| `startDate` | string | `@IsDateString()` | Yes |
| `endDate` | string | `@IsDateString()` | Yes |

**Service Logic:**
1. Validate `endDate > startDate`
2. Validate name uniqueness → `409`
3. Check for overlapping active cycles:
   ```
   SELECT id FROM performance_review_cycles
   WHERE status = 'active'
     AND start_date <= $endDate AND end_date >= $startDate
   ```
   If found → `409 "An active review cycle already overlaps with this date range"`
4. Insert with `status = 'draft'`
5. Return created cycle

---

### 5.3 `GET /api/performance/review-cycles/:id` — Cycle Detail

**Permission:** `@RequirePermission('performance', 'view', 'review_cycles')`

Returns cycle details + review breakdown by status + list of reviews in this cycle.

---

### 5.4 `PUT /api/performance/review-cycles/:id` — Update Cycle

**Permission:** `@RequirePermission('performance', 'edit', 'review_cycles')`
**Audit:** `@AuditAction('update', 'performance', 'review_cycles')`

**Request Body:** Same fields as create, all optional. Plus:
- `status` — `@IsOptional()`, `@IsIn(['draft', 'active', 'completed'])`

**Status Transitions:**
- `draft` → `active` (activating the cycle)
- `active` → `completed` (closing the cycle)
- `completed` → no transitions (terminal)
- Cannot go backwards (`active` → `draft` is not allowed)

**On Activate (`status` changed to `'active'`):**
1. Auto-create review records for all manager-reportee pairs:
   - Find all employees who have a `reports_to` value (i.e., they have a manager)
   - For each such employee, create a `performance_reviews` row:
     - `cycle_id = cycleId`
     - `subject_id = employee.userId`
     - `reviewer_id = employee.reportsTo`
     - `status = 'pending'`
   - Skip if a review already exists for this cycle + subject
2. **Notification (PRD 23.1):**
   - Type: `review_cycle_started`
   - Recipients: All users who are reviewers in this cycle (all managers with reportees)
   - Title: "Performance review cycle started"
   - Message: "Review cycle '{cycleName}' is now active. Please submit reviews for your team by {endDate}."
   - Data: `{ cycleId, cycleName, endDate }`
   - In-app + email

---

### 5.5 `DELETE /api/performance/review-cycles/:id` — Delete Cycle

**Permission:** `@RequirePermission('performance', 'edit', 'review_cycles')`
**Audit:** `@AuditAction('delete', 'performance', 'review_cycles')`

**Validation:**
- Can only delete `draft` cycles → `400 "Cannot delete an active or completed review cycle"`

Deletes cycle + cascades to reviews. Return `{ message: "Review cycle deleted" }`.

---

## 6. Reviews API Specification

Reviews are created automatically when a cycle is activated (Section 5.4). Managers fill them in and submit. Employees then acknowledge.

Controller prefix: `performance/reviews`.

### 6.1 `GET /api/performance/reviews` — List Reviews

**Permission:** `@RequirePermission('performance', 'view', 'reviews')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `cycleId` | UUID | — | Filter by cycle |
| `status` | string | — | Filter: `pending`, `submitted`, `acknowledged` |
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `sortBy` | string | `createdAt` | |
| `sortOrder` | string | `desc` | |

**Data Visibility:**
- **Admin/HR:** All reviews
- **Manager:** Reviews where they are the reviewer
- **Employee:** Reviews where they are the subject

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      cycle: { id, name, type },
      subject: { id, employeeId, firstName, lastName, photoUrl, department, designation },
      reviewer: { id, firstName, lastName },
      rating: number | null,
      status: "pending" | "submitted" | "acknowledged",
      submittedAt, acknowledgedAt, createdAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 6.2 `POST /api/performance/reviews` — Create Review (Manual)

**Permission:** `@RequirePermission('performance', 'create', 'reviews')`
**Audit:** `@AuditAction('create', 'performance', 'reviews')`

This allows Admin/HR to manually create a review outside of the auto-generation flow (e.g., adding a review for a newly hired employee who was missed during cycle activation).

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `cycleId` | UUID | `@IsUUID()` | Yes |
| `subjectId` | UUID | `@IsUUID()` | Yes |
| `reviewerId` | UUID | `@IsUUID()` | Yes |

**Service Logic:**
1. Validate cycle exists and is `'active'` → `400 "Can only add reviews to an active cycle"`
2. Validate subject and reviewer exist and are active
3. Check for duplicate: `SELECT id FROM performance_reviews WHERE cycle_id = $cycleId AND subject_id = $subjectId` → `409 "A review already exists for this employee in this cycle"`
4. Insert with `status = 'pending'`

---

### 6.3 `PUT /api/performance/reviews/:id/submit` — Submit Review

**Permission:** `@RequirePermission('performance', 'create', 'reviews')`
**Audit:** `@AuditAction('update', 'performance', 'reviews')`

**Access:** Only the reviewer can submit their own review. Admin can submit on behalf.

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `rating` | number | `@IsInt()`, `@Min(1)`, `@Max(5)` | Yes |
| `comments` | string | `@IsOptional()`, `@MaxLength(2000)` | No |
| `strengths` | string | `@IsOptional()`, `@MaxLength(1000)` | No |
| `improvements` | string | `@IsOptional()`, `@MaxLength(1000)` | No |

**Service Logic:**
1. Validate review exists and status is `'pending'` → `400 "Can only submit pending reviews"`
2. Validate `req.user.userId === review.reviewerId` OR admin → `403`
3. Update review: `rating`, `comments`, `strengths`, `improvements`, `status = 'submitted'`, `submittedAt = NOW()`
4. **Notification (PRD 23.1):**
   - Type: `review_submitted`
   - Recipient: `review.subjectId` (the reviewed employee)
   - Title: "Performance review submitted"
   - Message: "Your performance review for cycle '{cycleName}' has been submitted by {reviewerName}. Please review and acknowledge."
   - Data: `{ reviewId, cycleId, reviewerId }`
   - In-app + email

---

### 6.4 `PUT /api/performance/reviews/:id/acknowledge` — Employee Acknowledges Review

**Permission:** `@RequirePermission('performance', 'view', 'reviews')`
**Audit:** `@AuditAction('update', 'performance', 'reviews')`

**Access:** Only the subject (reviewed employee) can acknowledge.

**Service Logic:**
1. Validate review exists and status is `'submitted'` → `400 "Can only acknowledge submitted reviews"`
2. Validate `req.user.userId === review.subjectId` → `403 "Only the reviewed employee can acknowledge"`
3. Update review: `status = 'acknowledged'`, `acknowledgedAt = NOW()`

No notification on acknowledge (PRD doesn't define one).

---

### 6.5 `GET /api/performance/reviews/:id` — Review Detail

**Permission:** `@RequirePermission('performance', 'view', 'reviews')`

**Access:** Admin/HR, the reviewer, or the subject.

Returns full review details including all text fields (comments, strengths, improvements). The subject can see the full review only after it's been submitted.

**Response:**
```
{
  success: true,
  data: {
    id,
    cycle: { id, name, type, startDate, endDate },
    subject: { id, employeeId, firstName, lastName, photoUrl, department, designation },
    reviewer: { id, firstName, lastName },
    rating: 4,
    comments: "...",
    strengths: "...",
    improvements: "...",
    status, submittedAt, acknowledgedAt, createdAt, updatedAt
  }
}
```

**Visibility restriction for subject:** If `status === 'pending'` and the requester is the subject → return `403 "Review has not yet been submitted"` (employee should not see an unfinished review).

---

## 7. Frontend: Goals Page

### 7.1 Route: `/performance/goals`

Reference: `goals.png`

**Time filter tabs (horizontal):** All Goals (count) | This Week (count) | Last Week (count) | This Month (count) | Last Month (count)

Active tab shows count of matching goals.

**Right toolbar:** "Add Goals" button (permission-gated: `performance:create:goals`), filter icon, three-dots export menu.

### 7.2 Goal Cards

Each goal as a card (not a table row):

**Card layout:**
- Checkbox (left) for multi-select actions
- Goal icon (target icon)
- Title (bold) + Priority badge (Low / Medium / High / Critical with colors)
- Description (truncated to 2 lines)
- Progress bar (colored: green 60%+, amber 30–59%, red <30%) + percentage text + Status text (e.g., "In-Progress")
- Right side: "Map Job" link (out of scope — placeholder text), comment icon, three-dots menu

**Card actions (three-dots menu):**
- Edit Goal (creator/admin)
- Update Progress (assignee/creator)
- Delete Goal (creator/admin)

**Click card** → opens goal detail drawer.

### 7.3 Goal Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Title | text | Required |
| Description | textarea | Optional |
| Assign To Type | radio | User / Group / Project. Default: User. |
| Assign To | searchable select | Required. Options change based on type: User → `/api/employees/lookup`, Group → `/api/groups` (name list), Project → `/api/projects` (name list). |
| Priority | select | Low / Medium / High / Critical. Default: Medium. |
| Start Date | date picker | Optional |
| Due Date | date picker | Optional. Validated >= start date client-side. |

### 7.4 Goal Detail Drawer

**Header:** Title + priority badge + status badge

**Info section:** Assigned to (name + type badge), Created by, Start date – Due date, Overdue indicator (red text if applicable)

**Progress section:** Large progress bar + percentage + "Update Progress" button

**Progress History Timeline:** Vertical timeline of all updates:
```
John Doe updated progress from 0% to 30%
"Completed initial research phase"
2 days ago

Jane Smith updated progress from 30% to 60%
"Design mockups approved"
1 day ago
```

### 7.5 Progress Update Modal

Triggered by "Update Progress" button on card or detail drawer.

**Fields:**
- Progress slider (0–100) — shows current value as starting point
- Note (textarea, optional) — "What did you accomplish?"

Submit → `PUT /api/goals/:id/progress` → refreshes card + history.

---

## 8. Frontend: Team Goals

### 8.1 Route: `/performance` with Team tab active

Visible to Manager/Admin/HR.

Shows all goals visible to the user (based on data visibility rules). Same card layout as My Data but includes an additional column showing the assignee name/avatar on each card.

**Additional filters:** Assignee dropdown (search), status dropdown, priority dropdown.

---

## 9. Frontend: Reviews Pages

### 9.1 My Reviews — Route: `/performance/reviews`

**For Employee (subject):** Shows reviews where they are the subject.

Table columns:

| Column | Notes |
|---|---|
| Cycle | Cycle name + type badge |
| Reviewer | Avatar + name |
| Rating | Stars (1–5) or "—" if pending |
| Status | Badge: pending / submitted / acknowledged |
| Submitted At | Date |
| Actions | "View" (if submitted), "Acknowledge" (if submitted + not yet acknowledged) |

Click → opens review detail drawer.

**For Manager (reviewer):** Shows reviews where they are the reviewer.

Table adds "Subject" column (the employee being reviewed).

Actions: "Submit Review" (if pending), "View" (if submitted).

### 9.2 Review Detail Drawer

**For Employee viewing submitted review:**
- Cycle info (name, type, date range)
- Reviewer name
- Rating: star display (1–5)
- Comments (read-only)
- Strengths (read-only)
- Areas for Improvement (read-only)
- "Acknowledge" button (if status = submitted and viewer is the subject)

**For Manager viewing/submitting:**
- Subject info (employee name, department, designation)
- Cycle info
- If pending → editable form (rating stars, comments textarea, strengths textarea, improvements textarea) + "Submit Review" button
- If submitted → read-only view of their own submission

### 9.3 Review Cycles Admin Page

Route: `/performance/reviews/cycles`

Permission-gated: `performance:create:review_cycles`

**Page Header:** "Review Cycles" + "Create Cycle" button

**Table Columns:**

| Column | Notes |
|---|---|
| Cycle Name | |
| Type | Badge: Quarterly / Annual / Custom |
| Date Range | startDate – endDate |
| Status | Badge: draft (gray), active (green), completed (blue) |
| Reviews | Total / Submitted / Acknowledged |
| Actions | Edit, Activate (draft only), Complete (active only), Delete (draft only) |

**Review Cycle Form Drawer:**
- Name (text, required)
- Type (select: Quarterly / Annual / Custom)
- Start Date (date picker, required)
- End Date (date picker, required, must be after start)

**Activate Cycle:** Confirm dialog: "Activating this cycle will create review records for all manager-reportee pairs ({N} reviews). Continue?" → calls PUT with `{ status: 'active' }`.

---

## 10. Dashboard Widget Integration

Wire the `activeGoals` quick stat on the tenant dashboard (Sprint 2D):

For all roles: count goals where `assigned_to_id` matches the user (or group/project membership) AND `status IN ('not_started', 'in_progress')`.

Update the dashboard service to populate this value.

---

## 11. Scope Boundaries

### In Scope (Sprint 5B)
- Goals CRUD (6 endpoints: list, create, detail, update, progress, delete)
- Goal assignment to users, groups, and projects
- Goal progress tracking with history timeline
- Time-based goal filtering (this week/month/last week/month)
- Goals export (CSV/XLSX/PDF)
- Review cycles CRUD (4 endpoints: list, create, detail, update/status-change)
- Review cycle activation auto-creates review records for all manager-reportee pairs
- Review cycle deletion (draft only)
- Reviews list + detail + manual create (3 endpoints)
- Review submission by manager (rating 1–5, comments, strengths, improvements)
- Review acknowledgement by employee
- 5 notification events: goal_assigned, goal_progress_updated, goal_completed, review_cycle_started, review_submitted
- Goals page with card layout + time filter tabs
- Goal form drawer + detail drawer with progress history timeline
- Progress update modal
- Team goals view
- Reviews page (employee + manager views)
- Review detail drawer (read-only for employee, form for manager)
- Review cycles admin page
- Dashboard `activeGoals` widget wired
- Audit logging on all CUD operations

### Out of Scope
| Feature | Sprint |
|---|---|
| KRA / Skill Set / Competency / Feedback sub-tabs | N/A (reference-product features not in PRD) |
| 360-degree reviews / peer reviews | Future |
| Goal weightage / scoring | Future |
| Goal templates | Future |
| Review templates with custom fields | Future |
| Goal cascading (parent-child goals) | Future |
| OKR framework | Future |
| Performance improvement plans (PIP) | Future |

---

## 12. Verification & Acceptance Criteria

### Goal Tests

**Test 1: Create goal assigned to user**
```
POST /api/goals
Body: { title: "Complete Q1 report", assignedToId: "{userId}", priority: "high", dueDate: "2026-03-31" }
→ 201: status = "not_started", progress = 0

Verify: goal_assigned notification sent to assignee
```

**Test 2: Create goal assigned to group**
```
POST /api/goals
Body: { title: "Improve team collaboration", assignedToId: "{groupId}", assignedToType: "group" }
→ 201

Verify: goal_assigned notification sent to ALL group members
```

**Test 3: Create goal assigned to project**
```
POST /api/goals
Body: { title: "Launch MVP", assignedToId: "{projectId}", assignedToType: "project" }
→ 201

Verify: goal_assigned notification sent to all project members
```

**Test 4: Update progress**
```
PUT /api/goals/{id}/progress
Body: { progress: 30, note: "Completed research" }
→ 200: progress = 30, status auto-changed to "in_progress"

Verify:
- goal_progress_history row created (old: 0, new: 30, note: "Completed research")
- goal_progress_updated notification sent to goal creator
```

**Test 5: Complete goal (progress 100)**
```
PUT /api/goals/{id}/progress
Body: { progress: 100, note: "All deliverables shipped" }
→ 200: progress = 100, status = "completed", completedAt set

Verify: goal_completed notification sent to goal creator
```

**Test 6: Unchanged progress rejected**
```
PUT /api/goals/{id}/progress  # current progress is 30
Body: { progress: 30 }
→ 400: "Progress value is unchanged"
```

**Test 7: Employee can update own goal progress**
```
PUT /api/goals/{id}/progress
Headers: Bearer <employee_token>  # employee is the assignee
Body: { progress: 50 }
→ 200
```

**Test 8: Employee cannot delete goals**
```
DELETE /api/goals/{id}
Headers: Bearer <employee_token>
→ 403
```

**Test 9: Time filter — this week**
```
GET /api/goals?filter=this_week
→ 200: Only goals created this week or due this week
```

**Test 10: Data visibility — employee sees own + group + project goals**
```
GET /api/goals
Headers: Bearer <employee_token>
→ Goals directly assigned + group membership goals + project membership goals
```

**Test 11: Overdue flag**
```
# Goal with dueDate = yesterday, status = "in_progress"
GET /api/goals
→ isOverdue = true
```

**Test 12: Export goals**
```
GET /api/goals/export?format=xlsx
→ XLSX with 12 columns
```

### Review Cycle Tests

**Test 13: Create cycle**
```
POST /api/performance/review-cycles
Body: { name: "Q1 2026 Review", type: "quarterly", startDate: "2026-01-01", endDate: "2026-03-31" }
→ 201: status = "draft"
```

**Test 14: Overlapping active cycle rejected**
```
# Active cycle exists: Jan–Mar 2026
POST /api/performance/review-cycles
Body: { name: "Mid-Q1", type: "custom", startDate: "2026-02-01", endDate: "2026-02-28" }
# Then activate it
PUT /api/performance/review-cycles/{id} { status: "active" }
→ 409: "An active review cycle already overlaps"
```

**Test 15: Activate cycle creates reviews**
```
# 8 employees have reports_to set
PUT /api/performance/review-cycles/{id}
Body: { status: "active" }
→ 200

Verify:
- 8 performance_reviews rows created (one per employee with a manager)
- review_cycle_started notification sent to all reviewers (managers)
```

**Test 16: Cannot delete active cycle**
```
DELETE /api/performance/review-cycles/{activeId}
→ 400: "Cannot delete an active or completed review cycle"
```

### Review Tests

**Test 17: Submit review**
```
PUT /api/performance/reviews/{id}/submit
Headers: Bearer <manager_token>  # the reviewer
Body: { rating: 4, comments: "Strong performer", strengths: "Technical depth", improvements: "Communication" }
→ 200: status = "submitted"

Verify: review_submitted notification sent to the subject employee
```

**Test 18: Employee views submitted review**
```
GET /api/performance/reviews/{id}
Headers: Bearer <employee_token>  # the subject
→ 200: Full review content visible (rating, comments, strengths, improvements)
```

**Test 19: Employee cannot view pending review**
```
GET /api/performance/reviews/{pendingId}
Headers: Bearer <employee_token>  # the subject
→ 403: "Review has not yet been submitted"
```

**Test 20: Employee acknowledges review**
```
PUT /api/performance/reviews/{id}/acknowledge
Headers: Bearer <employee_token>
→ 200: status = "acknowledged", acknowledgedAt set
```

**Test 21: Only subject can acknowledge**
```
PUT /api/performance/reviews/{id}/acknowledge
Headers: Bearer <manager_token>
→ 403: "Only the reviewed employee can acknowledge"
```

**Test 22: Manager cannot acknowledge**
```
PUT /api/performance/reviews/{id}/acknowledge
Headers: Bearer <manager_token>
→ 403
```

### Frontend Tests

- [ ] Goals page: card layout with title, priority badge, description, progress bar, status
- [ ] Time filter tabs: All Goals / This Week / Last Week / This Month / Last Month with counts
- [ ] Goal form drawer: assign-to type radio toggles searchable select options
- [ ] Group assignment: dropdown shows groups from `/api/groups`
- [ ] Project assignment: dropdown shows projects from `/api/projects`
- [ ] Goal detail drawer: info section + progress bar + progress history timeline
- [ ] Progress update modal: slider 0–100, note textarea
- [ ] Auto-status: card updates to "In Progress" after first progress update
- [ ] Auto-status: card updates to "Completed" when progress hits 100%
- [ ] Team tab: all visible goals with assignee shown on each card
- [ ] Team tab: assignee/status/priority filters
- [ ] Reviews page (employee): table with cycle, reviewer, rating stars, status
- [ ] Reviews page (manager): table with subject column, "Submit Review" action
- [ ] Review submit form: rating stars (1–5), comments, strengths, improvements textareas
- [ ] Review detail drawer: read-only for employee, "Acknowledge" button
- [ ] Review cycles admin: table with status badges, activate/complete/delete actions
- [ ] Activate cycle: confirmation dialog with expected review count
- [ ] Dashboard: `activeGoals` quick stat populated
- [ ] Notifications: toasts for goal_assigned, progress_updated, goal_completed, review_cycle_started, review_submitted
- [ ] Export menu on goals page (CSV/XLSX/PDF)
- [ ] Mobile: goal cards stack vertically, drawers become full-page

### Full Checklist

**Backend:**
- [ ] `GET /api/goals` — list with time filters, assignment type, status, priority, data visibility
- [ ] `POST /api/goals` — create with assignment validation (user/group/project) + notification
- [ ] `GET /api/goals/:id` — detail with progress history
- [ ] `PUT /api/goals/:id` — update (creator/admin only)
- [ ] `PUT /api/goals/:id/progress` — progress update with history + auto-status + notifications
- [ ] `DELETE /api/goals/:id` — delete (creator/admin)
- [ ] `GET /api/goals/export` — CSV/XLSX/PDF
- [ ] `GET /api/performance/review-cycles` — list with review counts
- [ ] `POST /api/performance/review-cycles` — create with overlap check
- [ ] `GET /api/performance/review-cycles/:id` — detail with review breakdown
- [ ] `PUT /api/performance/review-cycles/:id` — update + status transitions + auto-create reviews on activate
- [ ] `DELETE /api/performance/review-cycles/:id` — draft only
- [ ] `GET /api/performance/reviews` — list with data visibility
- [ ] `POST /api/performance/reviews` — manual create (admin)
- [ ] `GET /api/performance/reviews/:id` — detail with subject visibility restriction
- [ ] `PUT /api/performance/reviews/:id/submit` — reviewer submits + notification
- [ ] `PUT /api/performance/reviews/:id/acknowledge` — subject only
- [ ] Goal assignment to users, groups, projects validated
- [ ] Progress history tracked in goal_progress_history
- [ ] Auto-status transitions (not_started → in_progress → completed)
- [ ] Notifications: 5 events wired
- [ ] Dashboard `activeGoals` populated
- [ ] Audit logging on all CUD operations

**Frontend:**
- [ ] Goals page with card layout + time filter tabs
- [ ] Goal form with assignment type toggle
- [ ] Goal detail with progress history timeline
- [ ] Progress update modal
- [ ] Team goals view with filters
- [ ] Reviews page (employee + manager views)
- [ ] Review submit form + acknowledge action
- [ ] Review cycles admin page
- [ ] Export on goals page

---

*Sprint 5B Complete. Performance & Goals module fully built.*

*Next: Sprint 5C — Files Module*
