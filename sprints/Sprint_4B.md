# Sprint 4B — Leave Requests, Approvals & Balances

## Goal
Build the complete employee-facing leave experience: Leave Summary page (balance cards + upcoming/past leaves), Leave Balance page, Leave Requests list and detail, Apply Leave modal with balance validation, HR approval/rejection flow with comments, employee self-cancellation, team view (who's on leave today), manager reportee view, all four leave notification events, leave request export, and leave balance CSV import for initial setup. By the end of this sprint, the full leave lifecycle is operational — employees apply, HR approves/rejects, balances are deducted/restored, and everyone has visibility into the leave calendar.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `leave_requests` table (id, user_id, leave_type_id, start_date, end_date, duration_type, total_days, reason, status, reviewed_by, review_comment, reviewed_at, created_at, updated_at) | 1A / 1B | ✅ |
| `leave_balances` table (user_id, leave_type_id, year, total_allocated, carried_forward, used; UNIQUE user+type+year) | 1A / 1B | ✅ |
| Leave Types CRUD + Leave Policies CRUD + Holidays CRUD | 4A | ✅ |
| Balance Engine (generateBalancesForYear, prorating, carry-forward, accrual cron) | 4A | ✅ |
| Financial year utility (getLeaveYear, getLeaveYearRange, getLeaveYearLabel) | 4A | ✅ |
| Leave module layout (My Data / Team / Holidays tabs + admin dropdown) | 4A | ✅ |
| Placeholder pages for summary, balance, requests, team | 4A | ✅ |
| Seeded permissions: `leave:view:leave_requests`, `leave:create:leave_requests`, `leave:approve:leave_requests`, `leave:cancel:leave_requests`, `leave:export:leave_requests` | 1B | ✅ |
| Notification types seeded: `leave_request_submitted` (in-app + email), `leave_request_approved` (in-app + email), `leave_request_rejected` (in-app + email), `leave_request_cancelled` (in-app + email) | Gap Fix 3 | ✅ |
| Admin/HR Admin/HR Manager: view + create + approve + cancel + export leave_requests | 1B | ✅ |
| Manager: view + create + cancel leave_requests (NO approve) | 1B | ✅ |
| Employee: view + create + cancel leave_requests | 1B | ✅ |
| `NotificationService` + WebSocket | 1G | ✅ |
| `ExportService` | 1G | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/leave/requests/leave-requests.controller.ts` | Leave request CRUD + approval + cancel |
| `src/leave/requests/leave-requests.service.ts` | Request business logic, balance validation, day calculation |
| `src/leave/requests/dto/apply-leave.dto.ts` | Apply leave DTO |
| `src/leave/requests/dto/review-leave.dto.ts` | Approve/reject DTO |
| `src/leave/requests/dto/index.ts` | Barrel |
| `src/leave/summary/leave-summary.controller.ts` | Summary + balance endpoints |
| `src/leave/summary/leave-summary.service.ts` | Summary aggregation |
| `src/leave/team/leave-team.controller.ts` | Team + reportees endpoints |
| `src/leave/team/leave-team.service.ts` | Team leave queries |
| `src/leave/balances/balance-import.controller.ts` | Balance CSV import |
| `src/leave/balances/balance-import.service.ts` | Balance import logic |
| `src/leave/utils/day-calculator.util.ts` | Business day calculation (excludes weekends + holidays) |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/leave/summary/page.tsx` | Leave Summary sub-tab (replaces placeholder) |
| `src/app/(tenant)/leave/balance/page.tsx` | Leave Balance sub-tab (replaces placeholder) |
| `src/app/(tenant)/leave/requests/page.tsx` | Leave Requests sub-tab (replaces placeholder) |
| `src/app/(tenant)/leave/team/page.tsx` | Team view tab (replaces placeholder) |
| `src/app/(tenant)/leave/holidays/page.tsx` | Holidays tab — public holiday list (employee-facing, read-only) |
| `src/components/modules/leave/apply-leave-modal.tsx` | Apply Leave modal |
| `src/components/modules/leave/leave-request-detail-drawer.tsx` | Request detail + review actions |
| `src/components/modules/leave/leave-balance-cards.tsx` | Balance card grid component |
| `src/components/modules/leave/leave-calendar-strip.tsx` | Date breakdown mini-table in apply modal |
| `src/components/modules/leave/team-leave-list.tsx` | Team on-leave list |
| `src/components/modules/leave/balance-import-dialog.tsx` | Balance CSV import dialog |
| `src/services/leave-requests.ts` | Leave request API helpers |
| `src/services/leave-summary.ts` | Summary + team API helpers |

---

## 3. Day Calculation Utility

`src/leave/utils/day-calculator.util.ts`

**`calculateLeaveDays(startDate, endDate, durationType, holidays, workSchedule): { totalDays, breakdown }`**

This utility computes the actual leave days between two dates, accounting for weekends and holidays.

**Algorithm:**
1. Iterate each calendar day from `startDate` to `endDate` (inclusive)
2. For each day:
   - Check if it's a working day (day of week is in `workSchedule.workingDays`)
   - Check if it's a holiday (date exists in `holidays` list)
   - If it's a weekend OR a mandatory holiday → skip (0 days)
   - If it's a working day → count as 1 day (or 0.5 for half-day)
3. Half-day logic:
   - `duration_type = 'first_half'` or `'second_half'` is only valid for **single-day** requests (`startDate === endDate`)
   - For multi-day requests, `duration_type` must be `'full_day'`
   - Half-day counts as 0.5
4. Return:
   ```
   {
     totalDays: number,  // e.g., 3.0, 0.5, 5.0
     breakdown: [
       { date: "2026-03-10", day: "Monday", type: "full" | "first_half" | "second_half", days: 1.0 | 0.5 },
       { date: "2026-03-11", day: "Tuesday", type: "full", days: 1.0 },
       { date: "2026-03-12", day: "Wednesday", type: "holiday", holiday: "Holi", days: 0 },
       { date: "2026-03-13", day: "Thursday", type: "full", days: 1.0 },
       { date: "2026-03-14", day: "Friday", type: "full", days: 1.0 },
       { date: "2026-03-15", day: "Saturday", type: "weekend", days: 0 }
     ],
     holidaysInRange: [{ date: "2026-03-12", name: "Holi" }],
     weekendsInRange: 2
   }
   ```

**The breakdown is shown in the Apply Leave modal** (reference: `Leave_requests.png` — the mini-table with Date / Duration columns) so the employee sees exactly which days are counted.

---

## 4. Leave Request API Specification

Controller prefix: `leave/requests`.

### 4.1 `POST /api/leave/requests` — Apply Leave

**Permission:** `@RequirePermission('leave', 'create', 'leave_requests')`
**Audit:** `@AuditAction('create', 'leave', 'leave_requests')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `leaveTypeId` | UUID | `@IsUUID()` | Yes |
| `startDate` | string | `@IsDateString()` | Yes |
| `endDate` | string | `@IsDateString()` | Yes |
| `durationType` | string | `@IsIn(['full_day', 'first_half', 'second_half'])`, default `'full_day'` | No |
| `teamEmail` | string | `@IsOptional()`, `@IsEmail()` | No |
| `reason` | string | `@IsOptional()`, `@MaxLength(1000)` | No |

**Service Logic:**

**Step 1 — Basic Validation**
1. Validate `leaveTypeId` exists → `404 "Leave type not found"`
2. Validate `endDate >= startDate` → `400 "End date must be on or after start date"`
3. If `durationType` is `'first_half'` or `'second_half'` AND `startDate !== endDate` → `400 "Half-day leave can only be applied for a single day"`
4. Validate `startDate` is not in the past (allow today) → `400 "Cannot apply leave for past dates"`. Exception: Admin/HR can apply for past dates.

**Step 2 — Day Calculation**
1. Fetch the default work schedule: `SELECT working_days FROM work_schedule WHERE is_default = true LIMIT 1`
2. Fetch holidays in the date range: `SELECT date, name, is_optional FROM holidays WHERE date BETWEEN $startDate AND $endDate`
3. Call `calculateLeaveDays(startDate, endDate, durationType, holidays, workSchedule)`
4. If `totalDays === 0` → `400 "No working days in the selected date range"`

**Step 3 — Max Consecutive Days Check**
1. If `leaveType.maxConsecutiveDays` is set AND `totalDays > maxConsecutiveDays` → `400 "Maximum consecutive days for {leaveTypeName} is {max}. You requested {totalDays} days."`

**Step 4 — Overlap Check (PRD 11.4 Rule 4)**
1. Check for overlapping approved or pending leave:
   ```
   SELECT id, start_date, end_date, status FROM leave_requests
   WHERE user_id = $userId
     AND status IN ('pending', 'approved')
     AND start_date <= $endDate
     AND end_date >= $startDate
   ```
2. If found → `409 "You already have a {status} leave request ({startDate} to {endDate}) overlapping with this period"`

**Step 5 — Balance Validation (PRD 11.4 Rule 6)**
1. Determine the leave year for the request using `getLeaveYear(startDate, financialYearStartMonth)`
2. Fetch balance: `SELECT * FROM leave_balances WHERE user_id = $userId AND leave_type_id = $leaveTypeId AND year = $leaveYear`
3. Compute `available = total_allocated + carried_forward - used`
4. Compute `pendingDays`: sum of `total_days` from all pending requests for this user + type + year:
   ```
   SELECT COALESCE(SUM(total_days), 0) FROM leave_requests
   WHERE user_id = $userId AND leave_type_id = $leaveTypeId AND status = 'pending'
     AND start_date >= $yearStart AND end_date <= $yearEnd
   ```
5. `effectiveAvailable = available - pendingDays`
6. **LWP exception:** If `leaveType.code === 'LWP'` OR `leaveType.isPaid === false` → skip balance check entirely (no cap)
7. If `totalDays > effectiveAvailable` → `400 "Insufficient leave balance. Available: {effectiveAvailable} days, Requested: {totalDays} days"`

**Step 6 — Holiday Warning (PRD 11.4 Rule 5)**
This is a **warning, not a block**. If the date range includes holidays:
- Include in the response: `warnings: ["Your leave period includes {N} holiday(s): {names}. These days are not deducted from your balance."]`
- The request still proceeds.

**Step 7 — Create Request**
1. Insert into `leave_requests`:
   - `user_id = req.user.userId`
   - `leave_type_id = leaveTypeId`
   - `start_date`, `end_date`, `duration_type = durationType`
   - `total_days = calculatedTotalDays`
   - `reason`
   - `status = 'pending'`
2. If `teamEmail` provided → send a courtesy email to that address (informational only, not an approval request)

**Step 8 — Notification (PRD 23.1)**
- Type: `leave_request_submitted`
- Recipients: All users with `leave:approve:leave_requests` permission (HR Admin, HR Manager, Admin)
- Title: "Leave request submitted"
- Message: "{employeeName} has applied for {totalDays} day(s) of {leaveTypeName} from {startDate} to {endDate}"
- Data: `{ requestId, userId, leaveTypeId, startDate, endDate, totalDays }`
- In-app + email per notification_settings

**Response:**
```
{
  success: true,
  data: {
    id, leaveType: { id, name, code, color },
    startDate, endDate, durationType, totalDays,
    reason, status: "pending", createdAt,
    breakdown: [ ... ],  // day-by-day breakdown
    balanceImpact: {
      currentAvailable: 11,
      afterApproval: 10,
      estimatedYearEnd: 10
    },
    warnings: ["Your leave period includes 1 holiday(s): Holi"]
  }
}
```

---

### 4.2 `GET /api/leave/requests` — List Leave Requests

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `status` | string | — | Filter: `pending`, `approved`, `rejected`, `cancelled` |
| `leaveTypeId` | UUID | — | Filter by leave type |
| `year` | number | Current leave year | Filter by leave year |
| `userId` | UUID | — | Admin/HR: filter by specific user |
| `sortBy` | string | `createdAt` | |
| `sortOrder` | string | `desc` | |

**Data Visibility:**
- **Admin/HR Admin/HR Manager:** All requests across the organization. Can use `userId` filter.
- **Manager/Team Lead:** Own requests + requests from direct reportees. Cannot see other employees.
- **Employee:** Own requests only.

**Service Logic:**
```
SELECT lr.id, lr.start_date, lr.end_date, lr.duration_type, lr.total_days,
       lr.reason, lr.status, lr.reviewed_by, lr.review_comment, lr.reviewed_at,
       lr.created_at, lr.updated_at,
       lt.id AS type_id, lt.name AS type_name, lt.code AS type_code, lt.color AS type_color,
       u.id AS user_id, u.employee_id, u.first_name, u.last_name, u.photo_url,
       d.name AS department_name, des.name AS designation_name,
       rv.first_name AS reviewer_first_name, rv.last_name AS reviewer_last_name
FROM leave_requests lr
JOIN leave_types lt ON lr.leave_type_id = lt.id
JOIN users u ON lr.user_id = u.id
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
LEFT JOIN users rv ON lr.reviewed_by = rv.id
```

Apply data visibility scoping (WHERE clause based on role).

Year filter: `WHERE lr.start_date >= $yearStart AND lr.start_date <= $yearEnd`

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      employee: { id, employeeId, firstName, lastName, photoUrl, department, designation },
      leaveType: { id, name, code, color },
      startDate, endDate, durationType, totalDays,
      reason, status,
      reviewer: { firstName, lastName } | null,
      reviewComment: string | null,
      reviewedAt: string | null,
      createdAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 4.3 `GET /api/leave/requests/:id` — Request Detail

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Access:** Admin/HR can view any. Others must be the requester or the requester's manager.

Returns full request details including:
- All fields from list
- Day-by-day breakdown (recomputed from dates + holidays + work schedule)
- Balance impact card (reference: `Leave_requests.png` right sidebar):
  ```
  balanceImpact: {
    asOnDate: "2026-02-16",
    availableBalance: 11,
    currentBooking: 1,
    balanceAfterBooking: 10,
    asOnYearEnd: "2026-12-31",
    estimatedBalance: 10
  }
  ```
- `teamEmail` if provided
- `dateOfRequest`: `createdAt` formatted

---

### 4.4 `PUT /api/leave/requests/:id/review` — Approve or Reject

**Permission:** `@RequirePermission('leave', 'approve', 'leave_requests')`
**Audit:** `@AuditAction('update', 'leave', 'leave_requests')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `action` | string | `@IsIn(['approve', 'reject'])` | Yes |
| `comment` | string | `@IsOptional()`, `@MaxLength(500)` | No |

**Service Logic:**

**On Approve:**
1. Validate request exists and status is `'pending'` → `400 "Can only review pending requests"`
2. Validate reviewer is not the requester → `400 "Cannot approve your own leave request"`
3. Re-run balance check (balance may have changed since submission):
   - Compute current available (excluding this request's pending days)
   - If `totalDays > currentAvailable` AND leave type is paid → `400 "Insufficient balance to approve. Employee has {available} days available but this request requires {totalDays} days."`
   - LWP exception: skip balance check
4. Re-run overlap check against other approved leaves (a different request may have been approved since)
5. Update request:
   - `status = 'approved'`
   - `reviewed_by = req.user.userId`
   - `review_comment = comment`
   - `reviewed_at = NOW()`
6. **Deduct balance:** Update `leave_balances`:
   ```
   UPDATE leave_balances
   SET used = used + $totalDays
   WHERE user_id = $requestUserId AND leave_type_id = $leaveTypeId AND year = $leaveYear
   ```
   If no balance row exists (edge case) → create one with `used = totalDays` and `total_allocated = 0`.
7. **Notification:**
   - Type: `leave_request_approved`
   - Recipient: the employee who applied
   - Title: "Leave request approved"
   - Message: "Your {leaveTypeName} request for {startDate} to {endDate} ({totalDays} day(s)) has been approved"
   - Data: `{ requestId, leaveTypeId, startDate, endDate, totalDays, reviewerName }`

**On Reject:**
1. Validate request exists and status is `'pending'`
2. Update request:
   - `status = 'rejected'`
   - `reviewed_by`, `review_comment`, `reviewed_at`
3. No balance deduction.
4. **Notification:**
   - Type: `leave_request_rejected`
   - Recipient: the employee
   - Title: "Leave request rejected"
   - Message: "Your {leaveTypeName} request for {startDate} to {endDate} has been rejected{commentSuffix}"
   - `commentSuffix`: `. Reason: {comment}` if comment provided, empty string otherwise.

**Response:** Updated request object.

---

### 4.5 `PUT /api/leave/requests/:id/cancel` — Cancel Leave

**Permission:** `@RequirePermission('leave', 'cancel', 'leave_requests')`
**Audit:** `@AuditAction('update', 'leave', 'leave_requests')`

**Access:** Only the request owner can cancel. Admin/HR can also cancel on behalf.

**Service Logic:**
1. Validate request exists
2. Access check: `req.user.userId === request.userId` OR user has `leave:approve:leave_requests` (admin/HR)
3. Status check:
   - If `status === 'pending'` → cancel directly (no balance impact)
   - If `status === 'approved'` → cancel AND **restore balance**:
     ```
     UPDATE leave_balances
     SET used = used - $totalDays
     WHERE user_id = $requestUserId AND leave_type_id = $leaveTypeId AND year = $leaveYear
     ```
     Guard: if `used - totalDays < 0` → set `used = 0` (safety floor)
   - If `status === 'rejected'` or `'cancelled'` → `400 "Cannot cancel a {status} request"`
4. Update request:
   - `status = 'cancelled'`
5. **Notification:**
   - Type: `leave_request_cancelled`
   - Recipients: All users with `leave:approve:leave_requests` permission (same as submitted notification)
   - Title: "Leave request cancelled"
   - Message: "{employeeName} has cancelled their {leaveTypeName} request for {startDate} to {endDate}"

**Response:** Updated request object.

---

### 4.6 `GET /api/leave/requests/export` — Export Leave Requests

**Permission:** `@RequirePermission('leave', 'export', 'leave_requests')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as list + `format` (csv, xlsx, pdf)

**Export Columns:**

| Header | Source |
|---|---|
| Employee ID | `employee.employeeId` |
| Employee Name | `employee.firstName lastName` |
| Department | `department` |
| Leave Type | `leaveType.name` |
| Start Date | `startDate` |
| End Date | `endDate` |
| Duration Type | `durationType` |
| Total Days | `totalDays` |
| Status | `status` |
| Reason | `reason` |
| Reviewer | `reviewer.firstName lastName` |
| Review Comment | `reviewComment` |
| Reviewed At | `reviewedAt` |
| Applied On | `createdAt` |

File name: `leave_requests_{YYYY-MM-DD}.{format}`

---

## 5. Leave Summary API

Controller prefix: `leave/summary`.

### 5.1 `GET /api/leave/summary` — Leave Summary

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Query Parameters:**
- `year` (number, default: current leave year)
- `userId` (UUID, optional — Admin/HR can view other users)

**Data Visibility:** Employee sees own. Admin/HR can specify userId. Manager can specify a reportee's userId.

**Service Logic:**

For the specified user and year:
1. Fetch all leave balances: `SELECT * FROM leave_balances WHERE user_id = $userId AND year = $year`
2. Fetch all leave types (to include types with 0 allocation)
3. Fetch the financial year range using utility
4. Fetch year stats:
   - Total booked this year: `SELECT COALESCE(SUM(total_days), 0) FROM leave_requests WHERE user_id = $userId AND status = 'approved' AND start_date >= $yearStart AND end_date <= $yearEnd`
   - Total absent (same but potentially cross-referenced with attendance later)
5. Fetch upcoming leaves: `SELECT * FROM leave_requests WHERE user_id = $userId AND status IN ('pending', 'approved') AND start_date >= CURRENT_DATE ORDER BY start_date ASC LIMIT 10`
6. Fetch past leaves: `SELECT * FROM leave_requests WHERE user_id = $userId AND status IN ('approved', 'cancelled') AND end_date < CURRENT_DATE ORDER BY start_date DESC LIMIT 10`
7. Fetch upcoming holidays: `SELECT * FROM holidays WHERE date >= CURRENT_DATE AND year = $year ORDER BY date ASC LIMIT 5`

**Response:**
```
{
  success: true,
  data: {
    year: 2026,
    leaveYearLabel: "01-Jan-2026 - 31-Dec-2026",
    yearStats: {
      totalBooked: 1,
      totalAbsent: 0
    },
    balances: [
      {
        leaveType: { id, name, code, color, icon, isPaid },
        available: 11,
        booked: 1,
        totalAllocated: 12,
        carriedForward: 0
      }
    ],
    upcomingLeaves: [
      { id, leaveType: { name, color }, startDate, endDate, totalDays, status }
    ],
    pastLeaves: [
      { id, leaveType: { name, color }, startDate, endDate, totalDays, status, reason }
    ],
    upcomingHolidays: [
      { name, date, isOptional }
    ]
  }
}
```

---

### 5.2 `GET /api/leave/balance` — Leave Balances

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Query Parameters:**
- `year` (default: current leave year)
- `userId` (optional — Admin/HR can view other users)

Returns a detailed per-type balance breakdown. This is the data source for the Leave Balance page (reference: `Leave_balance.png`).

**Response:**
```
{
  success: true,
  data: [
    {
      leaveType: { id, name, code, color, icon, isPaid, maxConsecutiveDays },
      totalAllocated: 12,
      carriedForward: 0,
      used: 1,
      pending: 0,   // sum of pending requests for this type
      available: 11  // totalAllocated + carriedForward - used
    }
  ]
}
```

The `pending` field is computed: `SELECT COALESCE(SUM(total_days), 0) FROM leave_requests WHERE user_id = $userId AND leave_type_id = $typeId AND status = 'pending' AND ...year filter...`

---

## 6. Team & Reportees API

Controller prefix: `leave/team`.

### 6.1 `GET /api/leave/team` — Team On Leave Today

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Query Parameters:**
- `date` (string, default: today) — which day to check
- `departmentId` (UUID, optional) — filter by department

Returns employees who have an approved leave covering the specified date.

**Service Logic:**
```
SELECT u.id, u.employee_id, u.first_name, u.last_name, u.photo_url,
       d.name AS department_name, des.name AS designation_name,
       lt.name AS leave_type_name, lt.color AS leave_type_color,
       lr.start_date, lr.end_date, lr.duration_type, lr.total_days
FROM leave_requests lr
JOIN users u ON lr.user_id = u.id
JOIN leave_types lt ON lr.leave_type_id = lt.id
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN departments d ON ep.department_id = d.id
LEFT JOIN designations des ON ep.designation_id = des.id
WHERE lr.status = 'approved'
  AND $date BETWEEN lr.start_date AND lr.end_date
  AND u.status = 'active'
```

If `departmentId` provided, add: `AND ep.department_id = $departmentId`

**Response:**
```
{
  success: true,
  data: [
    {
      employee: { id, employeeId, firstName, lastName, photoUrl, department, designation },
      leaveType: { name, color },
      startDate, endDate, durationType, totalDays
    }
  ]
}
```

---

### 6.2 `GET /api/leave/reportees` — Manager's Reportees On Leave

**Permission:** `@RequirePermission('leave', 'view', 'leave_requests')`

**Access:** Managers only. Returns only direct reportees of the current user.

**Query Parameters:**
- `date` (string, default: today)

**Service Logic:**
Same as team query, but with additional filter:
```
AND ep.reports_to = $currentUserId
```

---

## 7. Leave Balance Import

For initial system setup, admins may need to import historical leave balances (e.g., migrating from another HR system mid-year with existing usage data).

### 7.1 `GET /api/leave/balances/import/template` — Template Download

**Permission:** `@RequirePermission('leave', 'create', 'leave_policies')`

**Template Columns:**

| Column | Required | Notes |
|---|---|---|
| `email` | Yes | Employee email (used for user lookup) |
| `leave_type_code` | Yes | Must match existing leave type code |
| `year` | Yes | Integer (the leave year these balances are for) |
| `total_allocated` | Yes | Number (can be decimal, e.g., 12, 7.5) |
| `carried_forward` | No | Number. Default: 0. |
| `used` | No | Number. Default: 0. |

**Sample Row:**
```
john@acme.com,CL,2026,12,0,3
```

---

### 7.2 `POST /api/leave/balances/import` — Bulk Import Balances

**Permission:** `@RequirePermission('leave', 'create', 'leave_policies')`
**Audit:** `@AuditAction('import', 'leave', 'leave_balances')`

**Request:** `multipart/form-data` with `file` (CSV, max 2MB) and `dryRun`.

**Processing:**
1. Parse CSV, validate headers
2. Pre-load lookup data: users by email, leave types by code
3. Row-by-row validation:
   - `email`: required, must match active user
   - `leave_type_code`: required, must match existing leave type
   - `year`: required, integer, reasonable range (2020–2099)
   - `total_allocated`: required, number ≥ 0
   - `carried_forward`: number ≥ 0, default 0
   - `used`: number ≥ 0, default 0. Validate `used <= total_allocated + carried_forward`
4. UPSERT into `leave_balances`:
   ```
   INSERT INTO leave_balances (user_id, leave_type_id, year, total_allocated, carried_forward, used)
   VALUES ($userId, $typeId, $year, $allocated, $carried, $used)
   ON CONFLICT (user_id, leave_type_id, year)
   DO UPDATE SET total_allocated = $allocated, carried_forward = $carried, used = $used
   ```
5. Return standard import response shape

**Warning:** This overwrites existing balances. Show a confirmation warning in the UI.

---

## 8. Frontend: Leave Summary Page

### 8.1 Route: `/leave/summary`

Reference: `Leave_summary.png`

**Sub-tab bar:** Leave Summary | Leave Balance | Leave Requests (+ Shift placeholder)

**Year selector:** Centered date range with left/right arrows (e.g., "01-Jan-2026 - 31-Dec-2026")

**Header bar right:** "Apply Leave" button (primary, blue) + three-dots export menu

### 8.2 Balance Cards Grid

Horizontal scrollable card row, one card per leave type:

Each card:
- Leave type icon (colored background matching `color`)
- Leave type name
- Available count (large, colored number)
- Booked count (smaller, with clock icon)

Cards for types with 0 allocation AND 0 usage still appear (dimmed).

### 8.3 Upcoming Leaves & Holidays Section

Collapsible section with dropdown: "Upcoming Leaves & Holidays"

Each row: Date (formatted with day of week), Leave Type color dot + name + duration, Reason text

Empty state: Illustration + "No Data Found"

### 8.4 Past Leaves & Holidays Section

Collapsible section with dropdown: "Past Leaves & Holidays"

Each row: Date, Leave type + duration, Reason. Shows status badge (approved, cancelled).

---

## 9. Frontend: Leave Balance Page

### 9.1 Route: `/leave/balance`

Reference: `Leave_balance.png`

**Full-width card list** — one row per leave type:

Each row:
- Left: Leave type icon (circular, colored) + leave type name
- Middle: "Available" count (colored) + "Booked" count
- Right: "Apply Leave" button (only on LWP row where balance is 0 but you can still apply, per PRD rule)

The "Apply Leave" button per row pre-selects that leave type in the Apply Leave modal.

---

## 10. Frontend: Leave Requests Page

### 10.1 Route: `/leave/requests`

**Toolbar:** Status filter tabs (All | Pending | Approved | Rejected | Cancelled), year filter, search (employee name — for Admin/HR)

**For Admin/HR:** Shows all employees' requests. Clicking a pending request opens the detail drawer with Approve/Reject actions.

**For Employee/Manager:** Shows only own requests (+ reportee requests for Manager).

**Table Columns:**

| Column | Source | Notes |
|---|---|---|
| Employee | `employee.firstName lastName` | Avatar + name. Only shown for Admin/HR/Manager. |
| Leave Type | `leaveType.name` | Color badge |
| Start Date | `startDate` | Formatted |
| End Date | `endDate` | Formatted |
| Days | `totalDays` | Number (e.g., 0.5, 1, 5) |
| Duration Type | `durationType` | Badge: Full Day / First Half / Second Half |
| Status | `status` | Colored badge: amber=pending, green=approved, red=rejected, gray=cancelled |
| Applied On | `createdAt` | Relative date |
| Actions | — | View details, Cancel (owner + pending/approved) |

### 10.2 Leave Request Detail Drawer

Opens on row click. Reference: `Leave_requests.png`.

**Layout — two panels:**

**Left panel (main content):**
- Header: Employee ID + name (avatar)
- Leave type name
- Date range with day-by-day breakdown table:
  | Date | | Duration |
  |---|---|---|
  | Mon 16-Feb-2026 | [progress bar visual] | 1 Day(s) |
  | **Total** | | **1 Day(s)** |
- Team Email ID (if provided)
- Date of request
- Reason for leave

**Right panel (balance sidebar):**
- "As on {startDate}" section:
  - Available balance: N (green)
  - Current booking: N
  - Balance after current booking: N (blue link)
- "As on {yearEndDate}" section:
  - Estimated balance: N
- "View Leave Report" link (navigates to reports module, future)

**Bottom actions (context-dependent):**
- **For the requester (pending):** "Close" + "Cancel Leave" (red outline button)
- **For the requester (approved):** "Close" + "Cancel Leave"
- **For HR/Admin (pending):** "Close" + "Reject" (red) + "Approve" (green)
  - Reject/Approve → shows comment textarea (optional) → confirm → calls `PUT /api/leave/requests/:id/review`
- **For others / non-actionable statuses:** "Close" only

---

## 11. Frontend: Team View

### 11.1 Route: `/leave/team`

**Top of page:** Date picker (default: today). Department filter (dropdown, Admin/HR only).

**Layout:** Grid of employee cards showing who's on leave.

Each card:
- Avatar + name
- Department + designation
- Leave type (color badge)
- Date range
- Duration type badge (Full / Half)

**Empty state:** "No one is on leave on {date}"

### 11.2 Reportees Section (Manager only)

If the current user is a Manager, show a separate "My Reportees" section at the top before the general team view. Fetched from `GET /api/leave/reportees?date=`.

---

## 12. Frontend: Holidays Page (Employee-Facing)

### 12.1 Route: `/leave/holidays`

This is the **Holidays tab** in the top-level leave navigation. Different from the admin `/leave/admin/holidays` page — this is read-only for all users.

**Year selector** (same as summary page).

**Table Columns:**

| Column | Notes |
|---|---|
| Date | Formatted |
| Day | Day of week |
| Holiday Name | |
| Type | Badge: "Mandatory" or "Optional" |

No create/edit/delete actions. Styled as a clean calendar-like list.

**Highlight:** Upcoming holidays shown with a subtle background color. Past holidays dimmed.

---

## 13. Frontend: Apply Leave Modal

Reference: `Leave_summary_apply.png`

Triggered by: "Apply Leave" button on summary/balance pages, or from the Quick-Create (+) dropdown.

### 13.1 Fields

| Field | Type | Notes |
|---|---|---|
| Leave Type | select | Required. Shows leave type name + color swatch + available balance hint (e.g., "Casual Leave — 11 available"). |
| Date Range | start + end date pickers | Required. Side by side. |
| Duration Type | radio group | "Full Day" / "First Half" / "Second Half". Only shown when start === end (single day). Hidden for multi-day. Default: Full Day. |
| Team Email ID | text (email) | Optional. Helper: "Notify your team about this leave." |
| Reason for leave | textarea | Optional. |

### 13.2 Dynamic Behavior

When dates and leave type are selected:

1. **Day breakdown table** appears (same as Leave_requests.png mini-table):
   - Shows each date in range, day of week, whether it's counted or skipped (weekend/holiday), duration
   - Total row at bottom

2. **Balance impact** shown inline:
   - "Available: 11 days → After this request: 10 days"
   - If insufficient → red warning text: "Insufficient balance. You have X days available."
   - If LWP → info text: "Leave Without Pay has no balance limit."

3. **Holiday warning** if dates include holidays:
   - Yellow banner: "Your leave period includes 1 holiday (Holi) which will not be deducted."

4. **Max consecutive warning** if applicable:
   - Red text under date fields if totalDays > maxConsecutiveDays

### 13.3 Submit

"Submit" button → calls `POST /api/leave/requests`. On success → toast "Leave request submitted successfully" → close modal → refresh page. On error → show error message inline.

---

## 14. Frontend: Balance Import Dialog

Accessible from the Balance Management admin page (Sprint 4A) via an "Import Balances" button.

Same 3-step wizard pattern: template download → dry-run validation → import.

**Warning banner on Step 1:** "Importing balances will overwrite existing balances for the matched employee + leave type + year combinations. Proceed with caution."

---

## 15. Dashboard Widget Integration

Wire the `pendingLeaveRequests` quick stat on the tenant dashboard (Sprint 2D):

For Admin/HR roles: `SELECT COUNT(*) FROM leave_requests WHERE status = 'pending'`

Update the dashboard service to populate this value.

---

## 16. Scope Boundaries

### In Scope (Sprint 4B)
- Apply Leave endpoint with day calculation, balance validation, overlap check, holiday warning, max consecutive check
- Leave requests list with data visibility scoping (Admin=all, Manager=own+reportees, Employee=own)
- Leave request detail with day breakdown + balance impact sidebar
- HR approval/rejection with comment, balance deduction on approve, re-validation before approve
- Employee cancel (pending → cancel no balance impact, approved → cancel + balance restore)
- Leave summary endpoint (balance cards + upcoming/past leaves + holidays)
- Leave balance endpoint (per-type detailed breakdown)
- Team on-leave endpoint (by date + department filter)
- Reportees on-leave endpoint (manager view)
- Leave request export (CSV/XLSX/PDF)
- Leave balance CSV import (initial setup)
- Day calculation utility (exclude weekends + holidays, half-day support)
- 4 leave notification events wired (submitted, approved, rejected, cancelled)
- Leave Summary page (balance cards, upcoming/past sections)
- Leave Balance page (card list per type)
- Leave Requests page (table + detail drawer + review actions)
- Team view page (on-leave cards with date picker + department filter)
- Holidays page (employee-facing read-only list)
- Apply Leave modal (type, dates, duration, breakdown, balance impact, warnings)
- Balance import dialog
- Dashboard `pendingLeaveRequests` widget wired
- Audit logging on all CUD operations

### Out of Scope
| Feature | Sprint |
|---|---|
| Shift/Work Schedule tab | 5A (Attendance) |
| Leave encashment | Future |
| Compensatory off (comp-off) | Future |
| Leave calendar (month-view visualization) | Future |
| Bulk approve/reject | Future |
| Automated leave approval rules | Future |
| Manager approval flow (PRD explicitly excludes — HR only) | N/A |

---

## 17. Verification & Acceptance Criteria

### Apply Leave Tests

**Test 1: Apply full-day leave**
```
POST /api/leave/requests
Body: { leaveTypeId: "{clId}", startDate: "2026-03-16", endDate: "2026-03-18", durationType: "full_day", reason: "Family event" }
→ 201: totalDays = 3 (Mon-Wed, all working days), status = "pending"

Verify:
- Breakdown shows 3 rows (Mon, Tue, Wed) each 1.0 day
- Notification sent to HR admins (leave_request_submitted)
```

**Test 2: Apply half-day leave**
```
POST /api/leave/requests
Body: { leaveTypeId: "{clId}", startDate: "2026-03-16", endDate: "2026-03-16", durationType: "first_half" }
→ 201: totalDays = 0.5
```

**Test 3: Half-day on multi-day range rejected**
```
POST /api/leave/requests
Body: { leaveTypeId: "{clId}", startDate: "2026-03-16", endDate: "2026-03-17", durationType: "first_half" }
→ 400: "Half-day leave can only be applied for a single day"
```

**Test 4: Weekend exclusion**
```
POST /api/leave/requests
Body: { startDate: "2026-03-13", endDate: "2026-03-16" }  # Fri-Mon (Sat+Sun are weekends)
→ 201: totalDays = 2 (Friday + Monday, weekends skipped)
Verify: Breakdown shows Sat/Sun with type "weekend", 0 days
```

**Test 5: Holiday exclusion + warning**
```
# Holiday "Holi" exists on 2026-03-12
POST /api/leave/requests
Body: { startDate: "2026-03-11", endDate: "2026-03-13" }
→ 201: totalDays = 2 (Wed, Fri counted; Thu=Holi skipped)
Verify: warnings array includes "Your leave period includes 1 holiday(s): Holi"
Verify: Breakdown shows holiday row with 0 days
```

**Test 6: Insufficient balance blocked**
```
# CL available = 2 days
POST /api/leave/requests
Body: { leaveTypeId: "{clId}", startDate: "2026-03-16", endDate: "2026-03-20" }  # 5 working days
→ 400: "Insufficient leave balance. Available: 2 days, Requested: 5 days"
```

**Test 7: LWP bypasses balance check**
```
# LWP balance = 0 allocated
POST /api/leave/requests
Body: { leaveTypeId: "{lwpId}", startDate: "2026-03-16", endDate: "2026-03-20" }
→ 201: totalDays = 5 (no balance check for LWP)
```

**Test 8: Max consecutive days enforced**
```
# CL maxConsecutiveDays = 3
POST /api/leave/requests
Body: { leaveTypeId: "{clId}", startDate: "2026-03-16", endDate: "2026-03-20" }  # 5 working days
→ 400: "Maximum consecutive days for Casual Leave is 3. You requested 5 days."
```

**Test 9: Overlap rejected**
```
# Approved CL exists: Mar 16-18
POST /api/leave/requests
Body: { leaveTypeId: "{elId}", startDate: "2026-03-17", endDate: "2026-03-19" }
→ 409: "You already have a approved leave request (2026-03-16 to 2026-03-18) overlapping with this period"
```

**Test 10: No working days in range**
```
POST /api/leave/requests
Body: { startDate: "2026-03-14", endDate: "2026-03-15" }  # Sat-Sun
→ 400: "No working days in the selected date range"
```

**Test 11: Past date blocked for employee**
```
POST /api/leave/requests
Body: { startDate: "2026-02-01", endDate: "2026-02-01" }
Headers: Bearer <employee_token>
→ 400: "Cannot apply leave for past dates"
```

**Test 12: Past date allowed for Admin**
```
POST /api/leave/requests
Body: { startDate: "2026-02-01", endDate: "2026-02-01" }
Headers: Bearer <admin_token>
→ 201: Created (admin can backdate)
```

### Approval Tests

**Test 13: HR approves leave**
```
PUT /api/leave/requests/{id}/review
Body: { action: "approve", comment: "Enjoy your leave!" }
→ 200: status = "approved", reviewedBy = HR user

Verify:
- leave_balances.used incremented by totalDays
- Notification sent to employee (leave_request_approved)
```

**Test 14: HR rejects leave**
```
PUT /api/leave/requests/{id}/review
Body: { action: "reject", comment: "Team deadline this week" }
→ 200: status = "rejected"

Verify:
- No balance change
- Notification sent to employee (leave_request_rejected)
```

**Test 15: Cannot approve own leave**
```
# HR user applies for leave, then tries to approve it themselves
PUT /api/leave/requests/{ownRequestId}/review
Body: { action: "approve" }
→ 400: "Cannot approve your own leave request"
```

**Test 16: Manager cannot approve**
```
PUT /api/leave/requests/{id}/review
Headers: Bearer <manager_token>  # manager has no approve permission
→ 403: Forbidden
```

**Test 17: Approve with insufficient balance (balance changed since submission)**
```
# Employee had 5 days when they applied, but another request was approved reducing to 2
PUT /api/leave/requests/{id}/review  # request for 3 days
Body: { action: "approve" }
→ 400: "Insufficient balance to approve. Employee has 2 days available but this request requires 3 days."
```

### Cancel Tests

**Test 18: Cancel pending leave**
```
PUT /api/leave/requests/{pendingId}/cancel
→ 200: status = "cancelled"

Verify: No balance change (was never deducted)
Verify: Notification sent (leave_request_cancelled)
```

**Test 19: Cancel approved leave**
```
PUT /api/leave/requests/{approvedId}/cancel
→ 200: status = "cancelled"

Verify: leave_balances.used decremented by totalDays
```

**Test 20: Cannot cancel rejected leave**
```
PUT /api/leave/requests/{rejectedId}/cancel
→ 400: "Cannot cancel a rejected request"
```

### Data Visibility Tests

**Test 21: Employee sees only own requests**
```
GET /api/leave/requests
Headers: Bearer <employee_token>
→ 200: Only own leave requests
```

**Test 22: Manager sees own + reportees**
```
GET /api/leave/requests
Headers: Bearer <manager_token>
→ 200: Own requests + direct reportees' requests
```

**Test 23: Admin sees all**
```
GET /api/leave/requests
Headers: Bearer <admin_token>
→ 200: All requests across organization
```

### Summary & Balance Tests

**Test 24: Leave summary**
```
GET /api/leave/summary?year=2026
→ 200: balances for all leave types, upcoming leaves, past leaves, upcoming holidays
```

**Test 25: Leave balance**
```
GET /api/leave/balance?year=2026
→ 200: per-type breakdown with available = allocated + carried - used
```

**Test 26: Pending counted in balance**
```
# CL: allocated=12, used=3, pending request for 2 days
GET /api/leave/balance?year=2026
→ CL: available=9, pending=2
```

### Team Tests

**Test 27: Team on leave**
```
GET /api/leave/team?date=2026-03-16
→ 200: List of employees with approved leave on that date
```

**Test 28: Team filtered by department**
```
GET /api/leave/team?date=2026-03-16&departmentId={engId}
→ 200: Only engineering dept employees on leave
```

**Test 29: Manager reportees**
```
GET /api/leave/reportees?date=2026-03-16
Headers: Bearer <manager_token>
→ 200: Only direct reportees on leave
```

### Balance Import Tests

**Test 30: Import balances**
```
POST /api/leave/balances/import
File: balances.csv (3 rows), dryRun=false
→ 200: { imported: 3 }

Verify: leave_balances rows upserted with correct values
```

### Frontend Tests

- [ ] Leave Summary page: year selector, balance cards grid, upcoming/past sections
- [ ] Balance cards show icon + color + available + booked per leave type
- [ ] Leave Balance page: card list per type with Available + Booked
- [ ] LWP row shows "Apply Leave" button despite 0 balance
- [ ] Leave Requests page: status filter tabs, table with employee/type/dates/days/status
- [ ] Admin/HR see all requests; Employee sees own; Manager sees own + reportees
- [ ] Request detail drawer: left panel (info + breakdown table) + right panel (balance sidebar)
- [ ] Approve/Reject actions visible only for HR/Admin on pending requests
- [ ] Comment textarea appears on Approve/Reject confirmation
- [ ] Cancel button visible for owner on pending + approved requests
- [ ] Apply Leave modal: type selector with balance hint, date pickers, duration type radio
- [ ] Duration type radio only visible for single-day requests
- [ ] Day breakdown table appears when dates are selected
- [ ] Balance impact shown: "Available: N → After: N"
- [ ] Holiday warning yellow banner when holidays in range
- [ ] Max consecutive warning red text
- [ ] Insufficient balance error (non-LWP types)
- [ ] Team page: date picker, department filter, employee cards showing leave info
- [ ] Manager sees "My Reportees" section above general team view
- [ ] Holidays tab: read-only list, year selector, upcoming highlighted
- [ ] Balance import dialog: 3-step wizard with overwrite warning
- [ ] Dashboard: `pendingLeaveRequests` quick stat populated
- [ ] Notifications: toast on submission, in-app bell for all 4 events
- [ ] Export menu on Leave Requests page (CSV/XLSX/PDF)
- [ ] Mobile: modal becomes full-page, tables scrollable

### Full Checklist

**Backend:**
- [ ] Day calculation utility: weekend exclusion, holiday exclusion, half-day support, breakdown
- [ ] `POST /api/leave/requests` — apply with 8-step validation pipeline
- [ ] `GET /api/leave/requests` — list with data visibility scoping
- [ ] `GET /api/leave/requests/:id` — detail with breakdown + balance impact
- [ ] `PUT /api/leave/requests/:id/review` — approve (balance deduct + re-validate) / reject
- [ ] `PUT /api/leave/requests/:id/cancel` — cancel (restore balance if was approved)
- [ ] `GET /api/leave/requests/export` — CSV/XLSX/PDF
- [ ] `GET /api/leave/summary` — summary with balances, upcoming, past, holidays
- [ ] `GET /api/leave/balance` — per-type breakdown with pending count
- [ ] `GET /api/leave/team` — employees on leave by date + department
- [ ] `GET /api/leave/reportees` — manager's reportees on leave
- [ ] `GET /api/leave/balances/import/template` — CSV template
- [ ] `POST /api/leave/balances/import` — bulk upsert with dry-run
- [ ] Balance deduction on approve, restoration on cancel
- [ ] LWP bypass on balance check
- [ ] Overlap detection (pending + approved)
- [ ] Holiday warning (non-blocking)
- [ ] Max consecutive days enforcement
- [ ] Past date restriction for non-admin
- [ ] Self-approval prevention
- [ ] Notifications: 4 leave events wired to correct recipients
- [ ] Dashboard `pendingLeaveRequests` populated
- [ ] Audit logging on all CUD operations

**Frontend:**
- [ ] Leave Summary page with balance cards + upcoming/past
- [ ] Leave Balance page with per-type cards
- [ ] Leave Requests page with status filters + detail drawer
- [ ] Apply Leave modal with validation + breakdown + warnings
- [ ] Team view with date picker + department filter
- [ ] Holidays tab (read-only employee view)
- [ ] Balance import dialog
- [ ] Approval/rejection flow in detail drawer
- [ ] Cancel flow with balance restore feedback

---

*Sprint 4B Complete. Leave Management module fully operational.*

*Next: Sprint 4C — Time Tracker Module*
