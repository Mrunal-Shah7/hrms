# Sprint 5A — Attendance Module

## Goal
Build the Attendance module — an entirely **derived** module that reads from the `daily_time_summary` data produced by the Time Tracker (Sprint 4C) and presents it through attendance-specific views, calculations, and workflows. Includes: My Attendance page (week navigator with timeline/list/calendar views), Team Attendance (HR sees all with department filter; Manager sees reportees), Work Schedule CRUD (admin configures shift timings, working days, grace periods, overtime thresholds), Attendance Regularization request-and-review flow (employees correct missing or incorrect punches), attendance export, and four notification events (attendance anomaly, overtime logged, regularization requested, regularization approved/rejected). By the end, attendance data is viewable, exportable, and correctable.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `work_schedule` table (id, name, start_time, end_time, working_days JSONB, grace_period_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at) | 1A / 1B | ✅ |
| `attendance_regularizations` table (id, user_id, date, reason, punch_in, punch_out, status, reviewed_by, reviewed_at, created_at, updated_at) | 1A / 1B | ✅ |
| `daily_time_summary` table — populated by Time Tracker sync | 1A / 1B / 4C | ✅ |
| `time_logs` table — raw punch events | 1A / 1B / 4C | ✅ |
| `holidays` table | 1A / 1B / 4A | ✅ |
| `leave_requests` table — approved leaves | 1A / 1B / 4B | ✅ |
| Default work schedule seeded: General (09:00–18:00, Mon–Fri, 15min grace, 8h full, 4h half, 9h overtime) | 1B | ✅ |
| `SummaryService.computeDailySummary()` — computes daily aggregates cross-referencing work schedule, holidays, leaves | 4C | ✅ |
| Seeded permissions: `attendance:view:attendance`, `attendance:view:team_attendance`, `attendance:create:regularizations`, `attendance:approve:regularizations`, `attendance:export:attendance`, `attendance:view:work_schedule`, `attendance:create:work_schedule`, `attendance:edit:work_schedule`, `attendance:delete:work_schedule` | 1B | ✅ |
| Admin role: full work schedule CRUD + all attendance permissions | 1B | ✅ |
| HR Admin/HR Manager: view + export attendance, view team, create + approve regularizations, view/CRUD work schedule | 1B | ✅ |
| Manager: view attendance + team, create regularizations, view work schedule | 1B | ✅ |
| Employee: view attendance (own), create regularizations, view work schedule | 1B | ✅ |
| Notification types seeded: `attendance_anomaly` (in-app only), `overtime_logged` (in-app only), `regularization_requested` (in-app + email), `regularization_approved_rejected` (in-app + email) | Gap Fix 3 | ✅ |
| `/attendance` placeholder page in sidebar | 1H | ✅ |
| Leave module "Shift" sub-tab placeholder | 4A | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/attendance/attendance.module.ts` | NestJS module |
| `src/attendance/summary/attendance-summary.controller.ts` | My attendance + team + reportees |
| `src/attendance/summary/attendance-summary.service.ts` | Attendance query logic |
| `src/attendance/work-schedule/work-schedule.controller.ts` | Work schedule CRUD |
| `src/attendance/work-schedule/work-schedule.service.ts` | Work schedule business logic |
| `src/attendance/work-schedule/dto/create-work-schedule.dto.ts` | Create DTO |
| `src/attendance/work-schedule/dto/update-work-schedule.dto.ts` | Update DTO |
| `src/attendance/work-schedule/dto/index.ts` | Barrel |
| `src/attendance/regularization/regularization.controller.ts` | Regularization request + review |
| `src/attendance/regularization/regularization.service.ts` | Regularization business logic |
| `src/attendance/regularization/dto/create-regularization.dto.ts` | Request DTO |
| `src/attendance/regularization/dto/review-regularization.dto.ts` | Review DTO |
| `src/attendance/regularization/dto/index.ts` | Barrel |
| `src/attendance/attendance-notification.service.ts` | Anomaly + overtime notification dispatch |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/attendance/page.tsx` | Attendance page (replaces placeholder) |
| `src/app/(tenant)/attendance/layout.tsx` | Layout with My Data / Team tabs + Shift sub-tab |
| `src/app/(tenant)/attendance/team/page.tsx` | Team attendance page |
| `src/app/(tenant)/attendance/shift/page.tsx` | Work schedule config page (also linked from Leave Shift tab) |
| `src/app/(tenant)/attendance/regularizations/page.tsx` | Regularizations list (Admin/HR view) |
| `src/components/modules/attendance/attendance-timeline.tsx` | Timeline view row component |
| `src/components/modules/attendance/attendance-list-view.tsx` | List/table view |
| `src/components/modules/attendance/attendance-calendar-view.tsx` | Calendar grid view |
| `src/components/modules/attendance/week-navigator.tsx` | Week prev/next + date range picker |
| `src/components/modules/attendance/regularization-form-modal.tsx` | Request regularization modal |
| `src/components/modules/attendance/regularization-review-drawer.tsx` | Review regularization drawer |
| `src/components/modules/attendance/work-schedule-form-drawer.tsx` | Work schedule create/edit drawer |
| `src/services/attendance.ts` | Attendance API helpers |
| `src/services/work-schedule.ts` | Work schedule API helpers |
| `src/services/regularizations.ts` | Regularization API helpers |

### Module Registration
- Import `AttendanceModule` into `AppModule`

---

## 3. Attendance Module Layout

### 3.1 Top Tabs

**Primary tabs:** My Data | Team

**Sub-tabs under My Data:** Attendance Summary | Shift

Reference: `attendance.png` — shows "My Data | Team" top bar and "Attendance Summary | Shift" sub-tabs.

### 3.2 Shift Tab

The "Shift" sub-tab shows the work schedule(s) applied to the current user. For Admin, it's also the work schedule management page. This is the same page referenced by the Leave module's "Shift" placeholder (Sprint 4A).

Route: `/attendance/shift` — also accessible from `/leave` Shift tab (renders same component or redirects).

---

## 4. Work Schedule API

Work schedules define the expected working hours, grace periods, and overtime thresholds. For v1, the system supports multiple named schedules but employees are all assigned to the default schedule. Per-employee schedule assignment is a future enhancement.

Controller prefix: `attendance/work-schedule`.

### 4.1 `GET /api/attendance/work-schedule` — List Work Schedules

**Permission:** `@RequirePermission('attendance', 'view', 'work_schedule')`

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, startTime, endTime,
      workingDays: ["mon", "tue", "wed", "thu", "fri"],
      gracePeriodMinutes: 15,
      minHoursFullDay: 8,
      minHoursHalfDay: 4,
      overtimeThresholdHours: 9,
      isDefault: true,
      createdAt, updatedAt
    }
  ]
}
```

No pagination needed — typically 1–5 schedules per org.

---

### 4.2 `POST /api/attendance/work-schedule` — Create Work Schedule

**Permission:** `@RequirePermission('attendance', 'create', 'work_schedule')`
**Audit:** `@AuditAction('create', 'attendance', 'work_schedule')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `startTime` | string | `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)` (HH:MM format) | Yes |
| `endTime` | string | `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)` | Yes |
| `workingDays` | string[] | `@IsArray()`, each `@IsIn(['mon','tue','wed','thu','fri','sat','sun'])`, `@ArrayMinSize(1)` | Yes |
| `gracePeriodMinutes` | number | `@IsInt()`, `@Min(0)`, `@Max(60)` | Yes |
| `minHoursFullDay` | number | `@IsNumber()`, `@Min(1)`, `@Max(24)` | Yes |
| `minHoursHalfDay` | number | `@IsNumber()`, `@Min(0.5)`, `@Max(12)` | Yes |
| `overtimeThresholdHours` | number | `@IsNumber()`, `@Min(1)`, `@Max(24)` | Yes |
| `isDefault` | boolean | `@IsOptional()`, `@IsBoolean()`, default `false` | No |

**Service Logic:**
1. Validate name uniqueness → `409`
2. Validate `endTime > startTime` (simple string comparison works for HH:MM) → `400 "End time must be after start time"`
3. Validate `minHoursHalfDay < minHoursFullDay` → `400`
4. If `isDefault = true` → set all other schedules' `isDefault = false` (only one default)
5. Insert
6. Return created schedule

---

### 4.3 `GET /api/attendance/work-schedule/:id` — Schedule Detail

**Permission:** `@RequirePermission('attendance', 'view', 'work_schedule')`

Returns schedule details plus employee count assigned (for v1, if `isDefault = true`, count = total active employees; otherwise 0).

---

### 4.4 `PUT /api/attendance/work-schedule/:id` — Update Schedule

**Permission:** `@RequirePermission('attendance', 'edit', 'work_schedule')`
**Audit:** `@AuditAction('update', 'attendance', 'work_schedule')`

Same fields as create, all optional. Same validations.

**Important:** Changing a work schedule does NOT retroactively recompute past daily_time_summary rows. It only affects future sync computations. If the admin needs retroactive recalculation, they can trigger a manual re-sync (Sprint 4C).

---

### 4.5 `DELETE /api/attendance/work-schedule/:id` — Delete Schedule

**Permission:** `@RequirePermission('attendance', 'delete', 'work_schedule')`
**Audit:** `@AuditAction('delete', 'attendance', 'work_schedule')`

**Validation:**
- Cannot delete the default schedule → `400 "Cannot delete the default work schedule. Set another schedule as default first."`

---

## 5. Attendance Summary API

The attendance module reads from `daily_time_summary` (populated by Sprint 4C) and presents it with attendance-specific context (work schedule info, badge labels, weekly/monthly aggregation).

Controller prefix: `attendance`.

### 5.1 `GET /api/attendance/my-summary` — My Attendance

**Permission:** `@RequirePermission('attendance', 'view', 'attendance')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | string | Start of current week (Monday) | Start date (YYYY-MM-DD) |
| `to` | string | End of current week (Sunday) | End date (YYYY-MM-DD) |
| `view` | string | `timeline` | Display mode hint: `timeline`, `list`, `calendar` (no backend behavior difference — all return same data) |

**Service Logic:**

1. Fetch work schedule: `SELECT * FROM work_schedule WHERE is_default = true LIMIT 1`
2. Fetch daily summaries:
   ```
   SELECT dts.* FROM daily_time_summary dts
   WHERE dts.user_id = $currentUserId AND dts.date BETWEEN $from AND $to
   ORDER BY dts.date ASC
   ```
3. Fetch holidays in range: `SELECT date, name, is_optional FROM holidays WHERE date BETWEEN $from AND $to`
4. Fetch approved leaves in range:
   ```
   SELECT lr.start_date, lr.end_date, lr.duration_type, lt.name AS leave_type_name, lt.color AS leave_type_color
   FROM leave_requests lr
   JOIN leave_types lt ON lr.leave_type_id = lt.id
   WHERE lr.user_id = $currentUserId AND lr.status = 'approved'
     AND lr.start_date <= $to AND lr.end_date >= $from
   ```
5. Build a complete day-by-day response from `$from` to `$to` (including days without summary rows — fill gaps with computed status):

For each calendar day in range:
- If `daily_time_summary` row exists → use it
- If no row exists:
  - Check if weekend → status = `'weekend'`
  - Check if holiday → status = `'holiday'`
  - Check if on leave → status = `'on_leave'`
  - Otherwise → status = `'no_data'` (no sync data yet — different from `'absent'` which means sync ran but no punches)

6. Compute week/period aggregates:
   - `totalWorkingDays`: count of days in range where day of week is in workingDays and is not a holiday
   - `daysPresent`: count of summaries with status `'present'` or `'half_day'`
   - `daysAbsent`: count with status `'absent'`
   - `daysOnLeave`: count with status `'on_leave'`
   - `totalHoursWorked`: sum of `total_hours` across all summaries
   - `totalOvertimeHours`: sum of `overtime_hours`
   - `lateCount`: count where `is_late = true`
   - `earlyDepartureCount`: count where `is_early_departure = true`

**Response:**
```
{
  success: true,
  data: {
    workSchedule: {
      name: "General",
      startTime: "09:00",
      endTime: "18:00",
      workingDays: ["mon","tue","wed","thu","fri"],
      gracePeriodMinutes: 15
    },
    dateRange: { from: "2026-02-22", to: "2026-02-28" },
    aggregates: {
      totalWorkingDays: 5,
      daysPresent: 4,
      daysAbsent: 0,
      daysOnLeave: 1,
      totalHoursWorked: 36.5,
      totalOvertimeHours: 1.2,
      lateCount: 1,
      earlyDepartureCount: 0
    },
    days: [
      {
        date: "2026-02-22",
        dayOfWeek: "Sunday",
        status: "weekend",
        firstPunchIn: null,
        lastPunchOut: null,
        totalHours: 0,
        effectiveHours: 0,
        overtimeHours: 0,
        isLate: false,
        isEarlyDeparture: false,
        holiday: null,
        leave: null,
        regularization: null,
        punchEvents: []
      },
      {
        date: "2026-02-23",
        dayOfWeek: "Monday",
        status: "present",
        firstPunchIn: "2026-02-23T02:57:00Z",
        lastPunchOut: "2026-02-23T12:15:00Z",
        totalHours: 9.3,
        effectiveHours: 9.3,
        overtimeHours: 0.3,
        isLate: false,
        isEarlyDeparture: false,
        earlyByMinutes: null,
        lateByMinutes: null,
        holiday: null,
        leave: null,
        regularization: null,
        punchEvents: [
          { type: "in", time: "2026-02-23T02:57:00Z" },
          { type: "out", time: "2026-02-23T12:15:00Z" }
        ]
      }
    ]
  }
}
```

**Enrichments per day:**
- `earlyByMinutes`: if `isEarlyDeparture`, compute difference between `endTime` and `lastPunchOut` in minutes (shown as "Early by 15:03" in the screenshot)
- `lateByMinutes`: if `isLate`, compute difference between `firstPunchIn` and (`startTime + gracePeriod`)
- `leave`: `{ typeName, typeColor, durationType }` if employee has an approved leave covering this date
- `holiday`: `{ name, isOptional }` if this date is a holiday
- `punchEvents`: raw punch events from `time_logs` for this user+date
- `regularization`: if an approved regularization exists for this date, include `{ punchIn, punchOut, status }`

---

### 5.2 `GET /api/attendance/team` — Team Attendance

**Permission:** `@RequirePermission('attendance', 'view', 'team_attendance')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | string | Start of current week | Start date |
| `to` | string | End of current week | End date |
| `departmentId` | UUID | — | Filter by department |
| `page` | number | 1 | |
| `limit` | number | 20 | |

**Data Visibility:**
- Admin/HR: All active employees
- Manager: Direct reportees only (add `WHERE ep.reports_to = $currentUserId`)

**Service Logic:**

Fetch paginated employees matching scope, then for each employee fetch their daily summaries for the date range:

1. Fetch employee page (filtered by department if provided, scoped by role)
2. For each employee, query `daily_time_summary` for the date range
3. Compute per-employee aggregates (same as my-summary aggregates)

**Response:**
```
{
  success: true,
  data: [
    {
      employee: { id, employeeId, firstName, lastName, photoUrl, department, designation },
      aggregates: { daysPresent, daysAbsent, daysOnLeave, totalHoursWorked, lateCount, earlyDepartureCount },
      days: [
        { date, status, totalHours, isLate, isEarlyDeparture }
      ]
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

Note: The `days` array per employee is a compact version — it omits punchEvents and detailed fields to keep the response size manageable for team views with many employees.

---

### 5.3 `GET /api/attendance/reportees` — Reportees Attendance

**Permission:** `@RequirePermission('attendance', 'view', 'team_attendance')`

Same as team endpoint but always filtered to direct reportees of the current user. No `departmentId` filter needed.

Identical response shape to team endpoint.

---

## 6. Regularization API

Regularizations allow employees to correct attendance records when punch data is missing or incorrect (e.g., forgot to punch out, biometric failure).

Controller prefix: `attendance/regularizations`.

### 6.1 `POST /api/attendance/regularize` — Request Regularization

**Permission:** `@RequirePermission('attendance', 'create', 'regularizations')`
**Audit:** `@AuditAction('create', 'attendance', 'regularizations')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `date` | string | `@IsDateString()` | Yes |
| `punchIn` | string | `@IsOptional()`, `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)` (HH:MM) | No |
| `punchOut` | string | `@IsOptional()`, `@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)` | No |
| `reason` | string | `@IsNotEmpty()`, `@MaxLength(500)` | Yes |

**Service Logic:**
1. At least one of `punchIn` or `punchOut` must be provided → `400 "At least one punch time (in or out) is required"`
2. If both provided → validate `punchOut > punchIn` → `400 "Punch out must be after punch in"`
3. Validate `date` is not in the future → `400 "Cannot regularize for a future date"`
4. Validate `date` is within the last 30 days → `400 "Regularization can only be requested for the last 30 days"`
5. Check for existing pending regularization for the same user + date:
   ```
   SELECT id FROM attendance_regularizations
   WHERE user_id = $userId AND date = $date AND status = 'pending'
   ```
   If found → `409 "A pending regularization already exists for this date"`
6. Insert into `attendance_regularizations` with `status = 'pending'`, `user_id = req.user.userId`
7. **Notification:**
   - Type: `regularization_requested`
   - Recipients: All users with `attendance:approve:regularizations` permission (HR/Admin)
   - Title: "Attendance regularization requested"
   - Message: "{employeeName} has requested an attendance regularization for {date}"
   - Data: `{ regularizationId, userId, date }`
   - In-app + email per notification_settings
8. Return created regularization

---

### 6.2 `GET /api/attendance/regularizations` — List Regularizations

**Permission:** `@RequirePermission('attendance', 'create', 'regularizations')` (employee sees own) OR `@RequirePermission('attendance', 'approve', 'regularizations')` (HR/Admin sees all)

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 10 | |
| `status` | string | — | Filter: `pending`, `approved`, `rejected` |
| `userId` | UUID | — | Admin/HR: filter by user |
| `sortBy` | string | `createdAt` | |
| `sortOrder` | string | `desc` | |

**Data Visibility:**
- Admin/HR (has `approve` permission): All regularizations
- Others: Own regularizations only

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      employee: { id, employeeId, firstName, lastName, photoUrl, department },
      date,
      punchIn: "09:00" | null,
      punchOut: "18:00" | null,
      reason,
      status: "pending" | "approved" | "rejected",
      reviewer: { firstName, lastName } | null,
      reviewedAt: string | null,
      createdAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 6.3 `GET /api/attendance/regularizations/:id` — Regularization Detail

**Permission:** Same as list (own or approve).

Returns full regularization details + the existing attendance data for that date (so the reviewer can compare what's recorded vs what the employee claims).

**Additional data:**
```
{
  ...regularization,
  existingAttendance: {
    firstPunchIn: "2026-03-10T09:15:00Z" | null,
    lastPunchOut: null,  // missing — that's why the employee is regularizing
    totalHours: 0,
    status: "absent"
  }
}
```

---

### 6.4 `PUT /api/attendance/regularizations/:id/review` — Approve or Reject

**Permission:** `@RequirePermission('attendance', 'approve', 'regularizations')`
**Audit:** `@AuditAction('update', 'attendance', 'regularizations')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `action` | string | `@IsIn(['approve', 'reject'])` | Yes |

**Service Logic:**

**On Approve:**
1. Validate status is `'pending'` → `400 "Can only review pending regularizations"`
2. Update `attendance_regularizations`: `status = 'approved'`, `reviewed_by`, `reviewed_at`
3. **Recompute daily summary:** Create or update `time_logs` based on the regularization's `punchIn`/`punchOut`:
   - If `punchIn` provided → insert a time_log: `punch_type = 'in'`, `punch_time = date + punchIn`, `source = 'regularization'`
   - If `punchOut` provided → insert a time_log: `punch_type = 'out'`, `punch_time = date + punchOut`, `source = 'regularization'`
   - Then call `SummaryService.computeDailySummary(userId, date)` to recompute the day's totals
4. **Notification:**
   - Type: `regularization_approved_rejected`
   - Recipient: the employee
   - Title: "Regularization approved"
   - Message: "Your attendance regularization for {date} has been approved"

**On Reject:**
1. Validate status is `'pending'`
2. Update `attendance_regularizations`: `status = 'rejected'`, `reviewed_by`, `reviewed_at`
3. No time_log changes. No summary recomputation.
4. **Notification:**
   - Type: `regularization_approved_rejected`
   - Recipient: the employee
   - Title: "Regularization rejected"
   - Message: "Your attendance regularization for {date} has been rejected"

---

## 7. Attendance Export

### 7.1 `GET /api/attendance/export` — Export Attendance

**Permission:** `@RequirePermission('attendance', 'export', 'attendance')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** `from`, `to`, `departmentId`, `format` (csv, xlsx, pdf)

**Export Columns:**

| Header | Source |
|---|---|
| Employee ID | `employeeId` |
| Employee Name | `firstName lastName` |
| Department | `department` |
| Date | `date` |
| Day | day of week |
| First In | `firstPunchIn` time |
| Last Out | `lastPunchOut` time |
| Total Hours | `totalHours` |
| Overtime Hours | `overtimeHours` |
| Status | `status` |
| Late | "Yes" / "No" |
| Early Departure | "Yes" / "No" |

One row per employee per date within the range. File name: `attendance_{from}_to_{to}.{format}`

---

## 8. Attendance Notifications

### 8.1 Anomaly Detection

Anomalies are detected during the daily summary computation (Sprint 4C `SummaryService`). Add a notification hook at the end of `computeDailySummary()`:

**After computing a daily summary, check for anomalies:**

1. **Missing punch-out:** `firstPunchIn` exists but `lastPunchOut` is null → send `attendance_anomaly` notification to the employee. Message: "Missing punch-out detected for {date}. Please submit a regularization if needed."

2. **Insufficient hours:** Working day, employee has punches, but `totalHours < minHoursHalfDay` → send `attendance_anomaly` notification. Message: "Low work hours ({totalHours}h) detected for {date}."

3. **Absent on working day:** No punches on a working day that isn't a holiday or leave → send `attendance_anomaly` notification. Message: "No attendance recorded for {date}."

All anomaly notifications are in-app only (email_enabled = false per PRD 23.1).

### 8.2 Overtime Detection

After computing a daily summary where `overtimeHours > 0`:

- Send `overtime_logged` notification:
  - Recipient: The employee + all users with `attendance:approve:regularizations` (HR/Admin)
  - Title: "Overtime logged"
  - Message: "{employeeName} worked {overtimeHours}h overtime on {date}"
  - In-app only

### 8.3 Integration Point

These notifications fire inside `SummaryService.computeDailySummary()` (Sprint 4C). The `AttendanceNotificationService` is injected into `SummaryService` and called at the end of computation. This is a cross-module import: `TimeTrackerModule` imports `AttendanceNotificationService` from `AttendanceModule`.

Alternative: `AttendanceModule` exports the notification service and `TimeTrackerModule` imports `AttendanceModule`. Either way, the dependency is: Time Tracker computation → triggers Attendance notifications.

---

## 9. Frontend: My Attendance Page

### 9.1 Route: `/attendance`

Reference: `attendance.png`

**Sub-tab bar:** Attendance Summary | Shift

**Work schedule banner:** Shows the current schedule: "General [ 9:00 AM - 6:00 PM ]" + "Add notes for check-in" text field (display only for v1, no backend). Right side: "Check-in 00:00:00 Hrs" timer badge (display only — no manual check-in per PRD 13.1).

**Note:** The screenshot shows a "Check-in" button and live timer. Since the PRD explicitly states "No manual check-in/check-out button" and attendance is "entirely derived from Time Tracker", this Check-in element is rendered as an **informational display** — it shows whether the employee has punched in today (from time_logs) and displays elapsed time since first punch-in. It is NOT an interactive button. Label: "Checked in at {firstPunchIn}" or "Not checked in" if no punch today.

### 9.2 Week Navigator

Centered date range: "22-Feb-2026 - 28-Feb-2026" with left/right arrows to navigate weeks. Calendar icon to jump to a specific week.

### 9.3 View Switcher

Top-right icons (reference: screenshot shows 4 icons): Timeline | List | Calendar | Filter

### 9.4 Timeline View (Default)

Each day is a horizontal row:

| Day Label | Punch In | Timeline Bar | Punch Out / Badge | Hours |
|---|---|---|---|---|
| Sun 22 | | —— Weekend —— (yellow bar) | | 00:00 Hrs worked |
| Today 23 | 02:57 AM | 🟢🔴 ——————— | 02:57 AM, Early by 15:03 | 00:00 Hrs worked |
| Tue 24 | | ○ ————————— ○ | | 00:00 Hrs worked |

**Timeline bar elements:**
- Green dot (🟢): punch-in marker
- Red dot (🔴): late indicator (only if `isLate`)
- Yellow bar: weekend/holiday
- Endpoint dots: work schedule start/end boundaries
- The bar between punch-in and punch-out shows the worked duration visually

**Day label styling:**
- Today: highlighted with blue background circle on date number
- Weekend: yellow background
- Holiday: purple/blue background
- On leave: blue text with leave type label

**Right side per row:**
- Punch-in time (first) and punch-out time (last)
- Badge: "Early by {minutes}" (red text) if early departure, "Late by {minutes}" if late arrival
- "Hrs worked" with hour count

### 9.5 List View

Standard table:

| Date | Day | First In | Last Out | Total Hours | Overtime | Status | Late | Early |
|---|---|---|---|---|---|---|---|---|
| 23-Feb-2026 | Mon | 09:03 | 18:15 | 9h 12m | 12m | Present | No | No |

### 9.6 Calendar View

Month-grid calendar where each date cell shows:
- Color-coded status (green=present, red=absent, blue=leave, gray=weekend/holiday)
- Hours worked as small text
- Late/early dots

### 9.7 Filter Panel

Slide-out filter panel (accessible via filter icon):
- Status filter: checkboxes (Present, Absent, Half Day, Late, On Leave, Holiday, Weekend)
- Applied filters shown as chips above the data

---

## 10. Frontend: Team Attendance Page

### 10.1 Route: `/attendance/team`

**Toolbar:** Date range picker (default: current week), department filter (Admin/HR only), search (employee name)

**Layout:** Table with one row per employee, columns showing daily attendance for the selected week.

| Employee | Mon | Tue | Wed | Thu | Fri | Present | Absent | Hours |
|---|---|---|---|---|---|---|---|---|
| John Doe (avatar) | 🟢 9h | 🟢 8.5h | 🔴 Absent | 🔵 Leave | 🟢 9h | 3 | 1 | 26.5 |

**Cell color coding:**
- 🟢 Green: present
- 🔴 Red: absent
- 🟡 Amber: half-day or late
- 🔵 Blue: on leave
- ⚪ Gray: weekend / holiday

**Click a cell** → shows tooltip with: punch in, punch out, total hours, late/early flags

**Click employee name** → navigates to `/attendance?userId={id}` (Admin/HR) or shows limited detail

### 10.2 Manager View

Managers see the same layout but filtered to only their direct reportees. No department filter needed.

---

## 11. Frontend: Shift / Work Schedule Page

### 11.1 Route: `/attendance/shift`

**For all users:** Shows the current work schedule(s) as read-only cards:
- Schedule name + "(Default)" badge
- Start time – End time
- Working days badges (Mon, Tue, Wed, Thu, Fri)
- Grace period, min hours, overtime threshold

**For Admin (has `attendance:create:work_schedule`):** Additional controls:
- "Add Schedule" button
- Edit/Delete icons on each card
- Default toggle

### 11.2 Work Schedule Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Name | text | Required. e.g., "General", "Night Shift", "Half Day Friday" |
| Start Time | time picker | Required. HH:MM. |
| End Time | time picker | Required. Must be after start. |
| Working Days | multi-select checkboxes | Required. Mon–Sun. Default: Mon–Fri. |
| Grace Period | number (minutes) | Required. Helper: "Minutes after start time before marking late." |
| Min Hours Full Day | number | Required. Default: 8. |
| Min Hours Half Day | number | Required. Default: 4. Must be < full day. |
| Overtime Threshold | number | Required. Default: 9. Helper: "Hours beyond which overtime is calculated." |
| Set as Default | toggle | If on, this becomes the default schedule. |

---

## 12. Frontend: Regularization Flow

### 12.1 Request Regularization

Accessible from:
- "Request Regularization" link/button on a specific day row in My Attendance (shown when status is `'absent'` or when punch data is incomplete)
- Quick action in the attendance timeline

Opens `regularization-form-modal.tsx`:

**Fields:**
- Date (pre-filled from clicked row, editable — date picker limited to last 30 days)
- Punch In (time picker, optional)
- Punch Out (time picker, optional)
- Reason (textarea, required)

**Existing data display:** Shows current recorded punch-in/out for context: "Current record: In — 09:15, Out — Not recorded"

Submit → `POST /api/attendance/regularize` → toast success → refresh.

### 12.2 Regularizations Admin Page

Route: `/attendance/regularizations`

Accessible from Team tab or admin dropdown. Permission-gated: `attendance:approve:regularizations`.

**Toolbar:** Status filter tabs (All | Pending | Approved | Rejected)

**Table Columns:**

| Column | Notes |
|---|---|
| Employee | Avatar + name |
| Date | Formatted |
| Requested In | `punchIn` or "—" |
| Requested Out | `punchOut` or "—" |
| Reason | Truncated |
| Status | Badge |
| Actions | Review (pending only) |

**Click row / Review action** → opens review drawer showing:
- Employee info
- Date + day of week
- Existing attendance data (current first in / last out / hours / status)
- Requested changes (punch in / out)
- Reason
- Approve / Reject buttons

---

## 13. Cross-Module: Leave "Shift" Tab Link

The Leave module (Sprint 4A) has a "Shift" sub-tab placeholder. Wire it to render the same Work Schedule view from `/attendance/shift`.

Implementation: The `/leave` layout's "Shift" tab navigates to `/attendance/shift`, or the Shift page component is shared between both routes.

---

## 14. Scope Boundaries

### In Scope (Sprint 5A)
- Work schedule CRUD (4 endpoints: list, create, update, delete)
- My Attendance summary endpoint (day-by-day with punch events, aggregates, status enrichment)
- Team Attendance endpoint (per-employee weekly attendance grid)
- Reportees Attendance endpoint (manager-only)
- Regularization request endpoint with 30-day limit + duplicate check
- Regularization list endpoint with data visibility
- Regularization detail with existing attendance comparison
- Regularization review (approve inserts corrective time_logs + recomputes summary; reject is no-op)
- Attendance export (CSV/XLSX/PDF)
- 4 notification events: attendance_anomaly, overtime_logged, regularization_requested, regularization_approved_rejected
- Anomaly + overtime detection hooks in SummaryService
- My Attendance page (timeline/list/calendar views + week navigator + work schedule banner)
- Team Attendance page (weekly grid with per-employee rows)
- Shift/Work Schedule page (read-only for employees, CRUD for admin)
- Regularization form modal + admin review drawer
- Leave "Shift" tab wired to attendance shift page
- Audit logging on work schedule CUD + regularization CUD

### Out of Scope
| Feature | Sprint |
|---|---|
| Manual check-in/check-out button | N/A (PRD explicitly excludes) |
| Per-employee schedule assignment (multiple shifts) | Future |
| Geo-fenced attendance / IP-based validation | Future |
| Attendance auto-regularization rules | Future |
| Break time tracking (deducting lunch from hours) | Future |
| Attendance policy rules engine (auto-mark half-day, auto-LWP) | Future |
| Regularization comment from reviewer | Future (minor — add if needed) |

---

## 15. Verification & Acceptance Criteria

### Work Schedule Tests

**Test 1: List default schedule**
```
GET /api/attendance/work-schedule
→ 200: 1 schedule (General, 09:00–18:00, Mon–Fri, default)
```

**Test 2: Create schedule**
```
POST /api/attendance/work-schedule
Body: { name: "Night Shift", startTime: "22:00", endTime: "06:00", workingDays: ["mon","tue","wed","thu","fri"], gracePeriodMinutes: 10, minHoursFullDay: 8, minHoursHalfDay: 4, overtimeThresholdHours: 9 }
→ 201
```

**Test 3: Set new default**
```
POST /api/attendance/work-schedule
Body: { name: "Flexible", ..., isDefault: true }
→ 201: Previous default schedule's isDefault = false
```

**Test 4: Cannot delete default**
```
DELETE /api/attendance/work-schedule/{defaultId}
→ 400: "Cannot delete the default work schedule"
```

**Test 5: End time validation**
```
POST /api/attendance/work-schedule
Body: { startTime: "18:00", endTime: "09:00" }
→ 400: "End time must be after start time"
```

### My Attendance Tests

**Test 6: Weekly attendance**
```
GET /api/attendance/my-summary?from=2026-02-22&to=2026-02-28
→ 200: 7 days, Sun+Sat = weekend, Mon–Fri with punch data + status + aggregates
```

**Test 7: Day with leave shows on_leave**
```
# Approved leave on 2026-02-25
GET /api/attendance/my-summary?from=2026-02-22&to=2026-02-28
→ day 2026-02-25: status = "on_leave", leave: { typeName: "Casual Leave", typeColor: "#4CAF50" }
```

**Test 8: Holiday enrichment**
```
# Holiday "Republic Day" on 2026-01-26
GET /api/attendance/my-summary?from=2026-01-25&to=2026-01-31
→ day 2026-01-26: status = "holiday", holiday: { name: "Republic Day" }
```

**Test 9: Aggregates correct**
```
→ aggregates.daysPresent + aggregates.daysAbsent + aggregates.daysOnLeave ≤ aggregates.totalWorkingDays
```

### Team Attendance Tests

**Test 10: HR sees all employees**
```
GET /api/attendance/team?from=2026-02-22&to=2026-02-28
Headers: Bearer <hr_token>
→ 200: All active employees with weekly attendance
```

**Test 11: Manager sees reportees only**
```
GET /api/attendance/reportees?from=2026-02-22&to=2026-02-28
Headers: Bearer <manager_token>
→ 200: Only direct reportees
```

**Test 12: Department filter**
```
GET /api/attendance/team?from=2026-02-22&to=2026-02-28&departmentId={engId}
→ 200: Only Engineering department employees
```

### Regularization Tests

**Test 13: Request regularization**
```
POST /api/attendance/regularize
Body: { date: "2026-02-23", punchIn: "09:00", punchOut: "18:00", reason: "Biometric failure" }
→ 201: status = "pending"

Verify: Notification sent to HR (regularization_requested)
```

**Test 14: Duplicate pending rejected**
```
POST /api/attendance/regularize
Body: { date: "2026-02-23", punchOut: "18:00", reason: "Another request" }
→ 409: "A pending regularization already exists for this date"
```

**Test 15: Future date rejected**
```
POST /api/attendance/regularize { date: "2026-12-01" }
→ 400: "Cannot regularize for a future date"
```

**Test 16: Old date rejected (>30 days)**
```
POST /api/attendance/regularize { date: "2026-01-01" }
→ 400: "Regularization can only be requested for the last 30 days"
```

**Test 17: Must provide at least one punch time**
```
POST /api/attendance/regularize { date: "2026-02-23", reason: "Fix" }
→ 400: "At least one punch time (in or out) is required"
```

**Test 18: Approve regularization**
```
PUT /api/attendance/regularizations/{id}/review
Body: { action: "approve" }
→ 200: status = "approved"

Verify:
- 1-2 new time_logs inserted (source: "regularization")
- daily_time_summary recomputed for that date
- Notification sent to employee (regularization_approved_rejected)
```

**Test 19: Reject regularization**
```
PUT /api/attendance/regularizations/{id}/review
Body: { action: "reject" }
→ 200: status = "rejected"

Verify: No time_logs or summary changes
```

**Test 20: Regularization detail shows existing data**
```
GET /api/attendance/regularizations/{id}
→ 200: includes existingAttendance: { firstPunchIn, lastPunchOut, totalHours, status }
```

### Notification Tests

**Test 21: Missing punch-out anomaly**
```
# After sync, employee has punch-in but no punch-out
→ attendance_anomaly notification sent to employee (in-app only)
```

**Test 22: Overtime notification**
```
# After sync, employee has 10.5 total hours (threshold = 9)
→ overtime_logged notification sent to employee + HR (in-app only)
```

### Export Tests

**Test 23: Export attendance**
```
GET /api/attendance/export?from=2026-02-01&to=2026-02-28&format=xlsx
→ XLSX with one row per employee per date, 12 columns
```

### Frontend Tests

- [ ] My Attendance page: week navigator with prev/next arrows
- [ ] Work schedule banner: "General [ 9:00 AM - 6:00 PM ]"
- [ ] "Checked in at {time}" display (not a button)
- [ ] Timeline view: horizontal bars per day, punch dots, weekend yellow bars
- [ ] Timeline: late badge (red dot), early departure text, hours worked
- [ ] Timeline: today highlighted with blue date circle
- [ ] List view: table with all columns sortable
- [ ] Calendar view: month grid with color-coded cells
- [ ] Filter panel: status checkboxes
- [ ] Team page: weekly grid with employee rows and day columns
- [ ] Team page: cell color coding (green/red/amber/blue/gray)
- [ ] Team page: click cell → tooltip with punch details
- [ ] Team page: department filter for Admin/HR
- [ ] Manager: reportees only in team view
- [ ] Shift page: work schedule cards (read-only for employees)
- [ ] Shift page: CRUD actions for Admin
- [ ] Work schedule form: time pickers, working day checkboxes, default toggle
- [ ] Leave module "Shift" tab navigates to /attendance/shift
- [ ] Regularization: "Request Regularization" link on absent/incomplete day rows
- [ ] Regularization modal: date picker (30-day limit), time pickers, reason
- [ ] Regularization modal: shows existing record for context
- [ ] Regularizations admin page: status filter tabs, review drawer
- [ ] Review drawer: shows existing vs requested data, approve/reject buttons
- [ ] Export menu on team attendance page (CSV/XLSX/PDF)
- [ ] Notifications: anomaly toast, overtime toast, regularization toasts
- [ ] Mobile: timeline scrolls horizontally, team grid scrolls both ways

### Full Checklist

**Backend:**
- [ ] `GET /api/attendance/work-schedule` — list schedules
- [ ] `POST /api/attendance/work-schedule` — create with time/day validation
- [ ] `PUT /api/attendance/work-schedule/:id` — update
- [ ] `DELETE /api/attendance/work-schedule/:id` — guarded (cannot delete default)
- [ ] `GET /api/attendance/my-summary` — day-by-day with punch events, aggregates, status enrichment
- [ ] `GET /api/attendance/team` — team weekly attendance with department filter + data scoping
- [ ] `GET /api/attendance/reportees` — manager reportees attendance
- [ ] `POST /api/attendance/regularize` — request with 30-day limit, duplicate check
- [ ] `GET /api/attendance/regularizations` — list with data visibility
- [ ] `GET /api/attendance/regularizations/:id` — detail with existing attendance comparison
- [ ] `PUT /api/attendance/regularizations/:id/review` — approve (insert time_logs + recompute) / reject
- [ ] `GET /api/attendance/export` — CSV/XLSX/PDF
- [ ] Anomaly detection: missing punch-out, insufficient hours, absent on working day
- [ ] Overtime detection: overtimeHours > 0
- [ ] Notifications: attendance_anomaly, overtime_logged, regularization_requested, regularization_approved_rejected
- [ ] Audit logging on work schedule CUD + regularization create/review

**Frontend:**
- [ ] My Attendance page (timeline/list/calendar views + week navigator)
- [ ] Team Attendance page (weekly grid + department filter)
- [ ] Shift/Work Schedule page (read + admin CRUD)
- [ ] Regularization form modal + admin review page/drawer
- [ ] Leave "Shift" tab linked to attendance shift page
- [ ] Export on team attendance

---

*Sprint 5A Complete. Attendance module fully built.*

*Next: Sprint 5B — Performance & Goals*
