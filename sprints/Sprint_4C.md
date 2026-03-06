# Sprint 4C — Time Tracker Module

## Goal
Build the Time Tracker integration module: admin configuration page for managing external time tracking integrations, the adapter architecture (a pluggable interface for fetching punch-in/out data from external systems), a fully functional MockAdapter that generates realistic test data, the sync engine (cron-based scheduled sync + manual sync trigger), time log and daily summary viewing endpoints for all users, and the daily summary computation service that aggregates raw punch events into per-employee-per-day summaries. By the end of this sprint, the `time_tracker_config`, `time_logs`, and `daily_time_summary` tables are populated with data — providing the foundation that the Attendance module (Sprint 5A) depends on.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `time_tracker_config` table (id, name, provider, config JSONB, is_active, sync_frequency, last_sync_at, created_at, updated_at) | 1A / 1B | ✅ |
| `time_logs` table (id, user_id, punch_type, punch_time, source, raw_data JSONB, created_at) | 1A / 1B | ✅ |
| `daily_time_summary` table (id, user_id, date, first_punch_in, last_punch_out, total_hours, effective_hours, overtime_hours, status, is_late, is_early_departure, created_at, updated_at; UNIQUE user_id+date) | 1A / 1B | ✅ |
| `work_schedule` table (id, name, start_time, end_time, working_days, grace_period_minutes, min_hours_full_day, min_hours_half_day, overtime_threshold_hours, is_default, created_at, updated_at) | 1A / 1B | ✅ |
| Default work schedule seeded: General (09:00–18:00, Mon–Fri, 15min grace, 8h full day, 9h overtime threshold) | 1B | ✅ |
| Seeded permissions: `time_tracker:view:time_logs`, `time_tracker:view:config`, `time_tracker:create:config`, `time_tracker:edit:config`, `time_tracker:delete:config`, `time_tracker:execute:sync` | 1B | ✅ |
| Admin role: full config CRUD + sync execute + view logs | 1B | ✅ |
| HR Admin/HR Manager: view config + view logs + sync | 1B | ✅ |
| Manager/Employee: view time_logs only | 1B | ✅ |
| `/time-tracker` placeholder page in sidebar | 1H | ✅ |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/time-tracker/time-tracker.module.ts` | NestJS module |
| `src/time-tracker/config/config.controller.ts` | Integration config CRUD + test + sync |
| `src/time-tracker/config/config.service.ts` | Config business logic |
| `src/time-tracker/config/dto/create-config.dto.ts` | Create DTO |
| `src/time-tracker/config/dto/update-config.dto.ts` | Update DTO |
| `src/time-tracker/config/dto/index.ts` | Barrel |
| `src/time-tracker/logs/logs.controller.ts` | Time log + daily summary viewing |
| `src/time-tracker/logs/logs.service.ts` | Log queries |
| `src/time-tracker/sync/sync.service.ts` | Sync orchestrator — coordinates adapter fetch + log insert + summary compute |
| `src/time-tracker/sync/sync.cron.ts` | Cron job for scheduled sync |
| `src/time-tracker/adapters/adapter.interface.ts` | `TimeTrackerAdapter` interface |
| `src/time-tracker/adapters/adapter.factory.ts` | Factory: provider string → adapter instance |
| `src/time-tracker/adapters/mock.adapter.ts` | MockAdapter — generates realistic test data |
| `src/time-tracker/adapters/essl.adapter.ts` | eSSL biometric adapter (skeleton) |
| `src/time-tracker/adapters/hubstaff.adapter.ts` | Hubstaff adapter (skeleton) |
| `src/time-tracker/adapters/custom-api.adapter.ts` | Custom API adapter (skeleton) |
| `src/time-tracker/summary/summary.service.ts` | Daily summary computation from raw logs |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/time-tracker/page.tsx` | Time Tracker page (replaces placeholder) |
| `src/app/(tenant)/time-tracker/layout.tsx` | Layout with admin/user view toggle |
| `src/app/(tenant)/time-tracker/admin/page.tsx` | Admin config page |
| `src/components/modules/time-tracker/config-form-drawer.tsx` | Integration config create/edit drawer |
| `src/components/modules/time-tracker/time-log-table.tsx` | Time log table component |
| `src/components/modules/time-tracker/daily-summary-table.tsx` | Daily summary table component |
| `src/components/modules/time-tracker/sync-status-card.tsx` | Sync status indicator |
| `src/services/time-tracker.ts` | Time tracker API helpers |

### Module Registration
- Import `TimeTrackerModule` into `AppModule`

---

## 3. Adapter Architecture

### 3.1 Interface

`src/time-tracker/adapters/adapter.interface.ts`

```
TimeTrackerAdapter {
  fetchLogs(since: Date): Promise<RawPunchEvent[]>
  mapToStandardFormat(raw: any[]): StandardPunchEvent[]
  testConnection(): Promise<{ success: boolean, message: string }>
}
```

**`RawPunchEvent`** — the raw format returned by each external system. Varies per provider.

**`StandardPunchEvent`** — the normalized format inserted into `time_logs`:

| Field | Type | Description |
|---|---|---|
| `employeeIdentifier` | string | The external identifier for the employee (may be email, employee ID, or biometric ID) |
| `punchType` | `'in'` or `'out'` | Direction of punch |
| `punchTime` | Date | Timestamp of the event |
| `rawData` | object or null | Original raw event data preserved for debugging |

### 3.2 Adapter Factory

`src/time-tracker/adapters/adapter.factory.ts`

**`AdapterFactory.create(provider: string, config: object): TimeTrackerAdapter`**

| Provider String | Adapter Class | Status |
|---|---|---|
| `mock` | `MockAdapter` | Fully implemented |
| `essl` | `EsslAdapter` | Skeleton (throws "Not implemented") |
| `hubstaff` | `HubstaffAdapter` | Skeleton |
| `custom_api` | `CustomApiAdapter` | Skeleton |

Unknown provider → throws `400 "Unknown time tracker provider: {provider}"`

### 3.3 Employee Matching

When the adapter returns events with `employeeIdentifier`, the sync service must match them to `users` in the tenant. The matching strategy depends on the provider config.

**Config field `employeeMatchField`** — part of the integration config JSONB:
- `"email"` → match `employeeIdentifier` against `users.email`
- `"employee_id"` → match against `users.employee_id`
- `"external_id"` → match against a custom mapping (future — for biometric systems that use a separate ID)

Default: `"employee_id"`

Unmatched events are logged in the sync result as warnings but not inserted.

---

## 4. MockAdapter

The MockAdapter generates realistic punch data for development and testing. It does NOT call any external API — it produces deterministic-looking data based on employee list and configuration.

### 4.1 Configuration Schema

The `config` JSONB for a mock integration:

| Field | Type | Default | Description |
|---|---|---|---|
| `daysToGenerate` | number | 30 | How many past days of data to generate per sync |
| `punchVarianceMinutes` | number | 30 | Random variance applied to punch times (±minutes) |
| `missedPunchRate` | number | 0.05 | Probability (0–1) that an employee misses a punch on any given day |
| `absentRate` | number | 0.03 | Probability of no punches at all (absent day) |
| `overtimeRate` | number | 0.10 | Probability of overtime (late punch-out) |
| `lateArrivalRate` | number | 0.15 | Probability of late arrival (beyond grace period) |
| `employeeMatchField` | string | `"employee_id"` | How to match events to users |

### 4.2 Generation Algorithm

**`fetchLogs(since: Date)`:**

1. Fetch all active employees: `SELECT id, employee_id, email FROM users WHERE status = 'active'`
2. Fetch default work schedule: `SELECT * FROM work_schedule WHERE is_default = true`
3. For each employee, for each working day between `since` and yesterday (not today — today's data is "incomplete"):
   a. Roll a random number against `absentRate` — if absent, skip this day entirely
   b. Generate punch-in time: `workSchedule.startTime` + random variance (`-punchVarianceMinutes` to `+punchVarianceMinutes`). Apply `lateArrivalRate` — if triggered, add 20–45 extra minutes.
   c. Generate punch-out time: `workSchedule.endTime` + random variance. Apply `overtimeRate` — if triggered, add 30–120 extra minutes.
   d. Roll against `missedPunchRate` — if triggered, omit the punch-out (simulates forgotten clock-out)
   e. Skip weekends (check against `workSchedule.workingDays`)
4. Return array of `RawPunchEvent[]`

**`mapToStandardFormat(raw)`:** Direct mapping (mock data is already in a usable shape).

**`testConnection()`:** Always returns `{ success: true, message: "Mock adapter is always available" }`.

---

## 5. Sync Engine

### 5.1 `SyncService`

The sync service orchestrates the full sync pipeline: fetch from adapter → match employees → insert logs → compute daily summaries.

**`sync(configId: UUID): Promise<SyncResult>`**

**Pipeline:**

**Step 1 — Load Config**
1. Fetch `time_tracker_config` row by ID → `404 "Integration not found"`
2. Validate `is_active = true` → `400 "Integration is inactive"`
3. Create adapter instance via `AdapterFactory.create(config.provider, config.config)`

**Step 2 — Determine Sync Window**
1. `since = config.lastSyncAt || 30 days ago` (first sync goes back 30 days)
2. Cap at a maximum lookback of 90 days to avoid massive data pulls

**Step 3 — Fetch & Map**
1. Call `adapter.fetchLogs(since)` → raw events
2. Call `adapter.mapToStandardFormat(raw)` → standard events
3. Log: `"Fetched {count} events from {provider}"`

**Step 4 — Match Employees**
1. Load employee lookup map based on `config.employeeMatchField`:
   - If `"email"` → `SELECT id, email FROM users WHERE status = 'active'` → map email → userId
   - If `"employee_id"` → `SELECT id, employee_id FROM users WHERE status = 'active'` → map
2. For each standard event:
   - Look up `employeeIdentifier` in the map
   - If not found → add to `unmatchedEvents` array, skip
   - If found → map to `userId`

**Step 5 — Deduplicate**
Before inserting, check for existing events to avoid duplicates:
```
For each event:
  SELECT id FROM time_logs
  WHERE user_id = $userId AND punch_type = $punchType
    AND punch_time = $punchTime
  LIMIT 1
```
If found → skip (already synced). This handles re-syncs over overlapping windows.

**Step 6 — Insert Logs**
Batch insert new events into `time_logs`:
- `user_id`: matched userId
- `punch_type`: `'in'` or `'out'`
- `punch_time`: event timestamp
- `source`: `config.name` (the integration name, e.g., "Office Biometric" or "Mock Tracker")
- `raw_data`: original raw event data

**Step 7 — Compute Daily Summaries**
Determine which dates were affected (dates that had new logs inserted). For each affected date + user combination, invoke `SummaryService.computeDailySummary(userId, date)`.

**Step 8 — Update Config**
Update `time_tracker_config`:
- `last_sync_at = NOW()`
- Save the sync

**Step 9 — Return Result**
```
SyncResult {
  configId: UUID,
  configName: string,
  provider: string,
  syncWindow: { from: Date, to: Date },
  eventsFetched: number,
  eventsInserted: number,
  eventsDuplicate: number,
  unmatchedEvents: number,
  summariesComputed: number,
  warnings: string[],
  duration: number  // milliseconds
}
```

### 5.2 Sync Cron Job

`src/time-tracker/sync/sync.cron.ts`

Runs based on each integration's `sync_frequency`:

| Frequency | Cron Schedule | Description |
|---|---|---|
| `hourly` | Every hour at :05 | `0 5 * * * *` |
| `daily` | Every day at 00:10 | `0 10 0 * * *` |
| `manual` | Never auto-runs | Admin triggers only |

**Cron Logic:**
1. For each tenant (iterate all active tenant schemas):
   a. Set `search_path` to the tenant's schema
   b. Fetch all active integrations: `SELECT * FROM time_tracker_config WHERE is_active = true`
   c. For each integration where `sync_frequency` matches the current cron window:
      - Call `SyncService.sync(config.id)`
      - Log result
      - On error: log error, continue to next integration (don't abort)

**Multi-tenant consideration:** The cron iterates all tenants. For MVP scale this is fine (sequential). For larger scale, a job queue would be needed (out of scope).

---

## 6. Daily Summary Computation

### 6.1 `SummaryService.computeDailySummary(userId: string, date: Date): Promise<DailySummary>`

This service takes all raw `time_logs` for a given user on a given date and computes the aggregated `daily_time_summary` row.

**Algorithm:**

1. Fetch all logs for the user on this date:
   ```
   SELECT punch_type, punch_time FROM time_logs
   WHERE user_id = $userId AND DATE(punch_time) = $date
   ORDER BY punch_time ASC
   ```

2. Fetch the default work schedule: `SELECT * FROM work_schedule WHERE is_default = true`

3. Determine day type:
   - Is it a working day? Check `date.dayOfWeek` against `workSchedule.workingDays`
   - If not a working day → status = `'weekend'`, skip computations
   - Is it a holiday? `SELECT id FROM holidays WHERE date = $date`
   - If holiday → status = `'holiday'`, skip computations
   - Is the employee on approved leave? `SELECT id, duration_type FROM leave_requests WHERE user_id = $userId AND status = 'approved' AND $date BETWEEN start_date AND end_date`
   - If on full-day leave → status = `'on_leave'`, skip computations
   - If on half-day leave → note this for effective hours computation

4. Extract punch events:
   - `firstPunchIn`: earliest event with `punch_type = 'in'`
   - `lastPunchOut`: latest event with `punch_type = 'out'`
   - If no events at all and it's a working day → status = `'absent'`

5. Compute hours:
   - `totalHours`: difference between `lastPunchOut` and `firstPunchIn` in hours (decimal). If `lastPunchOut` is null (missed punch) → `totalHours = 0` and flag as missing data.
   - `effectiveHours`: For v1, same as `totalHours`. In future, could deduct break times.
   - `overtimeHours`: `MAX(0, totalHours - workSchedule.overtimeThresholdHours)`

6. Compute flags:
   - `isLate`: `firstPunchIn > parseTime(workSchedule.startTime) + workSchedule.gracePeriodMinutes` (on that date)
   - `isEarlyDeparture`: `lastPunchOut < parseTime(workSchedule.endTime)` (on that date). Only applies if `lastPunchOut` exists.

7. Determine status:
   - If no punches → `'absent'`
   - If half-day leave → `'half_day'`
   - If `totalHours >= workSchedule.minHoursFullDay` → `'present'`
   - If `totalHours >= workSchedule.minHoursHalfDay` → `'half_day'`
   - Else → `'absent'` (present but below minimum threshold)

8. UPSERT into `daily_time_summary`:
   ```
   INSERT INTO daily_time_summary (user_id, date, first_punch_in, last_punch_out, total_hours, effective_hours, overtime_hours, status, is_late, is_early_departure)
   VALUES (...)
   ON CONFLICT (user_id, date)
   DO UPDATE SET first_punch_in = $1, last_punch_out = $2, total_hours = $3, effective_hours = $4, overtime_hours = $5, status = $6, is_late = $7, is_early_departure = $8, updated_at = NOW()
   ```

---

## 7. Integration Config API

Controller prefix: `time-tracker/config`.

### 7.1 `GET /api/time-tracker/config` — List Integrations

**Permission:** `@RequirePermission('time_tracker', 'view', 'config')`

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, provider, isActive,
      syncFrequency: "hourly" | "daily" | "manual",
      lastSyncAt: string | null,
      config: { ... },  // JSONB config (sanitized — no secrets in response)
      createdAt, updatedAt
    }
  ]
}
```

**Config sanitization:** The `config` JSONB may contain API keys or credentials. When returning to the frontend, mask sensitive fields. Convention: any key containing `key`, `secret`, `password`, or `token` (case-insensitive) has its value replaced with `"***"`.

---

### 7.2 `POST /api/time-tracker/config` — Create Integration

**Permission:** `@RequirePermission('time_tracker', 'create', 'config')`
**Audit:** `@AuditAction('create', 'time_tracker', 'config')`

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(100)` | Yes |
| `provider` | string | `@IsIn(['mock', 'essl', 'hubstaff', 'custom_api'])` | Yes |
| `config` | object | `@IsObject()` | Yes |
| `isActive` | boolean | `@IsOptional()`, `@IsBoolean()`, default `true` | No |
| `syncFrequency` | string | `@IsIn(['hourly', 'daily', 'manual'])`, default `'hourly'` | No |

**Service Logic:**
1. Validate name uniqueness: `SELECT id FROM time_tracker_config WHERE name = $name` → `409`
2. Validate provider-specific config (see Section 7.6)
3. Insert into `time_tracker_config`
4. Return created config (sanitized)

---

### 7.3 `GET /api/time-tracker/config/:id` — Config Detail

**Permission:** `@RequirePermission('time_tracker', 'view', 'config')`

Returns full config detail (sanitized) + last sync result summary (if tracked).

---

### 7.4 `PUT /api/time-tracker/config/:id` — Update Integration

**Permission:** `@RequirePermission('time_tracker', 'edit', 'config')`
**Audit:** `@AuditAction('update', 'time_tracker', 'config')`

Same fields as create, all optional. Name uniqueness check (exclude self).

**Special handling for `config` updates:** The request may include partial config updates (not the full JSONB). Deep-merge the submitted config with the existing config. If a field is set to `"***"` (the masked value), preserve the existing value (don't overwrite secrets with the mask).

---

### 7.5 `DELETE /api/time-tracker/config/:id` — Delete Integration

**Permission:** `@RequirePermission('time_tracker', 'delete', 'config')`
**Audit:** `@AuditAction('delete', 'time_tracker', 'config')`

**Service Logic:**
1. Check for existing time_logs from this integration: `SELECT COUNT(*) FROM time_logs WHERE source = $configName`
2. If logs exist → `400 "Cannot delete integration with existing time logs. Deactivate it instead."`
   - The admin can set `isActive = false` via PUT to stop future syncs
3. If no logs → delete the config row
4. Return `{ message: "Integration deleted" }`

---

### 7.6 Provider-Specific Config Schemas

**Mock:**
```
{
  daysToGenerate: 30,
  punchVarianceMinutes: 30,
  missedPunchRate: 0.05,
  absentRate: 0.03,
  overtimeRate: 0.10,
  lateArrivalRate: 0.15,
  employeeMatchField: "employee_id"
}
```
All fields optional (defaults apply).

**eSSL (skeleton):**
```
{
  host: "192.168.1.100",
  port: 4370,
  protocol: "tcp" | "udp",
  deviceSerialNumber: "ABC123",
  employeeMatchField: "external_id"
}
```

**Hubstaff (skeleton):**
```
{
  apiToken: "***",
  organizationId: "12345",
  employeeMatchField: "email"
}
```

**Custom API (skeleton):**
```
{
  baseUrl: "https://api.example.com/time",
  authType: "bearer" | "api_key" | "basic",
  authCredential: "***",
  logsEndpoint: "/logs",
  employeeMatchField: "employee_id"
}
```

Skeleton adapters validate config structure but throw `501 "Not Implemented"` when `fetchLogs()` or `testConnection()` is called.

---

## 8. Sync API

### 8.1 `POST /api/time-tracker/config/:id/test` — Test Connection

**Permission:** `@RequirePermission('time_tracker', 'execute', 'sync')`

**Service Logic:**
1. Load config
2. Create adapter via factory
3. Call `adapter.testConnection()`
4. Return result: `{ success: true/false, message: "..." }`

---

### 8.2 `POST /api/time-tracker/sync` — Manual Sync

**Permission:** `@RequirePermission('time_tracker', 'execute', 'sync')`
**Audit:** `@AuditAction('execute', 'time_tracker', 'sync')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `configId` | UUID | `@IsUUID()` | Yes |
| `since` | string | `@IsOptional()`, `@IsDateString()` | No (defaults to lastSyncAt or 30 days ago) |

**Service Logic:**
1. Call `SyncService.sync(configId)` with optional override `since`
2. Return `SyncResult`

**Rate limiting:** 2 req/min/user (syncs can be expensive).

---

## 9. Time Log & Summary View API

Controller prefix: `time-tracker/logs`.

### 9.1 `GET /api/time-tracker/logs` — View Punch Logs

**Permission:** `@RequirePermission('time_tracker', 'view', 'time_logs')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `userId` | UUID | Own user ID | Employee to view (Admin/HR can specify; others see own) |
| `from` | string | 7 days ago | Start date (YYYY-MM-DD) |
| `to` | string | Today | End date (YYYY-MM-DD) |
| `page` | number | 1 | |
| `limit` | number | 50 | |

**Data Visibility:**
- Admin/HR: Any userId
- Manager: Own + direct reportees
- Employee: Own only

**Service Logic:**
```
SELECT tl.id, tl.user_id, tl.punch_type, tl.punch_time, tl.source, tl.created_at,
       u.employee_id, u.first_name, u.last_name
FROM time_logs tl
JOIN users u ON tl.user_id = u.id
WHERE tl.user_id = $userId
  AND DATE(tl.punch_time) BETWEEN $from AND $to
ORDER BY tl.punch_time DESC
```

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      employee: { id, employeeId, firstName, lastName },
      punchType: "in" | "out",
      punchTime: "2026-03-10T09:03:00Z",
      source: "Office Biometric",
      createdAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

### 9.2 `GET /api/time-tracker/daily-summary` — View Daily Summaries

**Permission:** `@RequirePermission('time_tracker', 'view', 'time_logs')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `userId` | UUID | Own user ID | |
| `from` | string | 7 days ago | Start date |
| `to` | string | Today | End date |
| `page` | number | 1 | |
| `limit` | number | 31 | |

**Data Visibility:** Same as logs.

**Service Logic:**
```
SELECT dts.id, dts.user_id, dts.date, dts.first_punch_in, dts.last_punch_out,
       dts.total_hours, dts.effective_hours, dts.overtime_hours,
       dts.status, dts.is_late, dts.is_early_departure,
       u.employee_id, u.first_name, u.last_name
FROM daily_time_summary dts
JOIN users u ON dts.user_id = u.id
WHERE dts.user_id = $userId
  AND dts.date BETWEEN $from AND $to
ORDER BY dts.date DESC
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, date: "2026-03-10",
      employee: { id, employeeId, firstName, lastName },
      firstPunchIn: "2026-03-10T09:03:00Z" | null,
      lastPunchOut: "2026-03-10T18:15:00Z" | null,
      totalHours: 9.2,
      effectiveHours: 9.2,
      overtimeHours: 0.2,
      status: "present" | "absent" | "half_day" | "on_leave" | "holiday" | "weekend",
      isLate: false,
      isEarlyDeparture: false
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

## 10. Frontend: Time Tracker Page

### 10.1 Route: `/time-tracker`

The page has two views based on role:

**For Admin/HR:** Shows both the admin config section and the time log view.

**For Manager/Employee:** Shows only the time log view for their own data.

### 10.2 Layout

`src/app/(tenant)/time-tracker/layout.tsx`

Two tabs (Admin/HR only see both):
- **Time Logs** — default view for all users
- **Integrations** — admin config (permission-gated: `time_tracker:view:config`)

### 10.3 Admin Config Page (`/time-tracker/admin`)

Reference: PRD 12.2 — "List integrations, add/edit/delete, test connection, sync now."

**Page Header:**
- Title: "Time Tracker Integrations"
- Right: "Add Integration" button (permission-gated: `time_tracker:create:config`)

**Integration Cards (not a table — use a card layout):**

Each integration as a card:
- **Header:** Integration name + provider badge (Mock / eSSL / Hubstaff / Custom API) + active/inactive badge
- **Body:**
  - Sync frequency: "Hourly" / "Daily" / "Manual"
  - Last synced: relative time (e.g., "2 hours ago") or "Never"
- **Actions:**
  - "Test Connection" button → calls POST test → shows success/failure toast
  - "Sync Now" button → calls POST sync → shows progress spinner → shows result summary toast
  - Edit icon → opens config form drawer
  - Delete icon → confirm dialog → delete (if no logs) or error toast

**Empty state:** "No integrations configured. Add one to start tracking employee time." + "Add Integration" button.

### 10.4 Config Form Drawer

**Fields:**

| Field | Type | Notes |
|---|---|---|
| Integration Name | text | Required. e.g., "Office Biometric", "Mock Tracker" |
| Provider | select | Required. Options: Mock, eSSL (Beta), Hubstaff (Beta), Custom API (Beta). Non-mock options show "(Beta)" tag. |
| Active | toggle | Default: on |
| Sync Frequency | select | Hourly / Daily / Manual. Default: Hourly. |
| Employee Match Field | select | Employee ID / Email. Default: Employee ID. |

**Provider-specific config fields** shown dynamically below based on selected provider:

**Mock:** All fields optional with defaults.
- Days to Generate (number, default 30)
- Punch Variance Minutes (number, default 30)
- Missed Punch Rate (slider 0–100%, default 5%)
- Absent Rate (slider 0–100%, default 3%)
- Overtime Rate (slider 0–100%, default 10%)
- Late Arrival Rate (slider 0–100%, default 15%)

**eSSL:** Host, Port, Protocol (TCP/UDP), Device Serial Number — all marked "(Not yet implemented)".

**Hubstaff:** API Token (password field), Organization ID — all marked "(Not yet implemented)".

**Custom API:** Base URL, Auth Type (Bearer/API Key/Basic), Auth Credential (password field), Logs Endpoint.

### 10.5 Time Log View (`/time-tracker`)

**Toolbar:**
- Date range picker (default: last 7 days)
- Employee selector (Admin/HR only — searchable select using `/api/employees/lookup`)
- View toggle: "Punch Log" / "Daily Summary"

**Punch Log View:**

Table columns:

| Column | Notes |
|---|---|
| Date & Time | `punchTime` formatted |
| Type | Badge: "IN" (green) / "OUT" (red) |
| Source | Integration name |

Grouped by date. Within each date group, sorted chronologically.

**Daily Summary View (default):**

Table columns:

| Column | Notes |
|---|---|
| Date | Formatted, with day of week |
| First In | `firstPunchIn` time or "—" |
| Last Out | `lastPunchOut` time or "—" |
| Total Hours | `totalHours` formatted as "Xh Ym" |
| Effective Hours | `effectiveHours` |
| Overtime | `overtimeHours` or "—" |
| Status | Colored badge: green=present, red=absent, amber=half_day, blue=on_leave, gray=holiday/weekend |
| Late | 🔴 dot if `isLate` |
| Early Out | 🔴 dot if `isEarlyDeparture` |

Clicking a date row expands to show individual punch events for that date (inline accordion).

**Empty state:** "No time data available for the selected period. Make sure a time tracker integration is configured and synced."

---

## 11. Seed Data: Auto-Create Mock Integration

During tenant provisioning (Sprint 1B), after seeding all other data, automatically create a Mock integration so new tenants have time data available immediately.

**Add to provisioning pipeline:**

```
INSERT INTO time_tracker_config (id, name, provider, config, is_active, sync_frequency, last_sync_at, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'Mock Tracker (Development)',
  'mock',
  '{"daysToGenerate": 30, "punchVarianceMinutes": 30, "missedPunchRate": 0.05, "absentRate": 0.03, "overtimeRate": 0.10, "lateArrivalRate": 0.15, "employeeMatchField": "employee_id"}',
  true,
  'daily',
  NULL,
  NOW(), NOW()
)
```

The first sync populates data when the admin clicks "Sync Now" or when the cron runs.

**Backfill for existing tenants:** Run the same INSERT with `ON CONFLICT DO NOTHING` (the config table has no unique constraint on name in the DDL, so just check `WHERE name = 'Mock Tracker (Development)'` before inserting).

---

## 12. Scope Boundaries

### In Scope (Sprint 4C)
- Integration config CRUD (4 endpoints: list, create, update, delete)
- Test connection endpoint
- Manual sync trigger endpoint
- Time log viewing endpoint (punch events)
- Daily summary viewing endpoint
- Adapter interface + factory pattern
- MockAdapter — fully functional data generation with configurable rates
- eSSL / Hubstaff / Custom API adapters — skeleton only (interface implemented, throws 501)
- Sync engine (fetch → match → deduplicate → insert → summarize → update lastSyncAt)
- Daily summary computation (first in, last out, hours, overtime, late, early departure, status)
- Summary cross-references: work schedule for hours/late/overtime, holidays for day status, leave requests for on_leave status
- Cron job for hourly/daily scheduled sync across all tenants
- Config sanitization (mask secrets in responses)
- Config form drawer with provider-specific dynamic fields
- Time log page with punch view + daily summary view
- Admin config page with integration cards
- Mock integration auto-seeded during provisioning
- Audit logging on config CUD + sync operations

### Out of Scope
| Feature | Sprint |
|---|---|
| Work schedule CRUD (admin manages schedules) | 5A (Attendance) |
| Attendance calculations (late/early badges in context of attendance page) | 5A |
| Attendance regularization requests | 5A |
| Team attendance view | 5A |
| Attendance export | 5A |
| Attendance notifications (anomaly, overtime) | 5A |
| Real eSSL / Hubstaff / Custom API adapter implementations | Future (when clients need them) |
| Multiple work schedules per employee (shift-based) | Future |
| Bulk time log manual entry | Future |
| Time log export | Future (simple addition when needed) |

---

## 13. Verification & Acceptance Criteria

### Config Tests

**Test 1: Create mock integration**
```
POST /api/time-tracker/config
Body: { name: "Office Mock", provider: "mock", config: { daysToGenerate: 14 }, syncFrequency: "manual" }
→ 201: Integration created
```

**Test 2: Duplicate name rejected**
```
POST /api/time-tracker/config { name: "Office Mock" }
→ 409: Name already exists
```

**Test 3: Config secrets masked in response**
```
POST /api/time-tracker/config
Body: { name: "Hubstaff", provider: "hubstaff", config: { apiToken: "real-secret-123", organizationId: "456" } }
→ 201: config.apiToken = "***", config.organizationId = "456"
```

**Test 4: Update preserves masked secrets**
```
PUT /api/time-tracker/config/{id}
Body: { config: { organizationId: "789" } }
→ 200: config.apiToken still "real-secret-123" in DB (not overwritten with "***")
```

**Test 5: Delete with existing logs rejected**
```
DELETE /api/time-tracker/config/{id}  # has time_logs
→ 400: "Cannot delete integration with existing time logs. Deactivate it instead."
```

**Test 6: Delete without logs succeeds**
```
DELETE /api/time-tracker/config/{newId}  # no logs yet
→ 200: Deleted
```

### Adapter Tests

**Test 7: Test mock connection**
```
POST /api/time-tracker/config/{mockId}/test
→ 200: { success: true, message: "Mock adapter is always available" }
```

**Test 8: Test skeleton adapter**
```
POST /api/time-tracker/config/{esslId}/test
→ 501: "Not Implemented"
```

### Sync Tests

**Test 9: Manual sync with mock adapter**
```
POST /api/time-tracker/sync
Body: { configId: "{mockId}" }
→ 200: {
  eventsFetched: 420,  // ~30 days × 14 employees × ~1 in/out per day
  eventsInserted: 420,
  eventsDuplicate: 0,
  unmatchedEvents: 0,
  summariesComputed: 210
}

Verify:
- time_logs table has ~420 rows
- daily_time_summary table has ~210 rows (one per employee per working day)
- time_tracker_config.last_sync_at updated
```

**Test 10: Re-sync deduplicates**
```
POST /api/time-tracker/sync  # run again immediately
Body: { configId: "{mockId}" }
→ 200: {
  eventsFetched: 420,
  eventsInserted: 0,  // all duplicates
  eventsDuplicate: 420,
  summariesComputed: 0  // no new data
}
```

**Test 11: Sync inactive integration rejected**
```
PUT /api/time-tracker/config/{mockId} { isActive: false }
POST /api/time-tracker/sync { configId: "{mockId}" }
→ 400: "Integration is inactive"
```

**Test 12: Unmatched employees logged**
```
# Mock adapter generates events for employee IDs that don't exist
POST /api/time-tracker/sync
→ 200: unmatchedEvents > 0, warnings includes "N events could not be matched to employees"
```

### Summary Computation Tests

**Test 13: Present day summary**
```
# Employee punches in at 09:03, out at 18:15
→ daily_time_summary: firstPunchIn=09:03, lastPunchOut=18:15, totalHours=9.2, status="present", isLate=false (within grace)
```

**Test 14: Late arrival**
```
# Employee punches in at 09:20 (grace = 15 min, so 09:15 is the threshold)
→ daily_time_summary: isLate=true
```

**Test 15: Early departure**
```
# Employee punches out at 17:30 (end time = 18:00)
→ daily_time_summary: isEarlyDeparture=true
```

**Test 16: Overtime computed**
```
# Employee punches in at 09:00, out at 19:30 (threshold = 9h, total = 10.5h)
→ daily_time_summary: overtimeHours=1.5
```

**Test 17: Absent day (no punches)**
```
# No time_logs for employee on a working day
→ daily_time_summary: status="absent", totalHours=0
```

**Test 18: Weekend status**
```
# Saturday
→ daily_time_summary: status="weekend", all hours=0
```

**Test 19: Holiday status**
```
# Holiday exists for this date
→ daily_time_summary: status="holiday"
```

**Test 20: On-leave status**
```
# Approved full-day leave exists for this date
→ daily_time_summary: status="on_leave"
```

**Test 21: Missing punch-out**
```
# Employee punches in at 09:00, no punch-out
→ daily_time_summary: firstPunchIn=09:00, lastPunchOut=null, totalHours=0
```

### Time Log View Tests

**Test 22: View own logs**
```
GET /api/time-tracker/logs?from=2026-03-01&to=2026-03-10
→ 200: Punch events for current user in date range
```

**Test 23: Admin views other user**
```
GET /api/time-tracker/logs?userId={otherId}&from=2026-03-01&to=2026-03-10
Headers: Bearer <admin_token>
→ 200: Punch events for specified user
```

**Test 24: Employee cannot view others**
```
GET /api/time-tracker/logs?userId={otherId}
Headers: Bearer <employee_token>
→ 403: Forbidden (or silently returns own data)
```

**Test 25: View daily summary**
```
GET /api/time-tracker/daily-summary?from=2026-03-01&to=2026-03-10
→ 200: Daily summaries with status, hours, late/early flags
```

### Frontend Tests

- [ ] Admin config page: integration cards with provider badge, status, last sync time
- [ ] "Add Integration" drawer: provider select, dynamic config fields per provider
- [ ] Mock provider: slider fields for rates (absent, late, overtime, missed punch)
- [ ] Skeleton providers show "(Beta)" / "(Not yet implemented)" labels
- [ ] "Test Connection" button on card → toast success/failure
- [ ] "Sync Now" button → spinner → result summary toast
- [ ] Delete integration: blocked if logs exist (error toast), succeeds if no logs
- [ ] Config secrets masked in UI (password fields for tokens/keys)
- [ ] Time log page: date range picker, default last 7 days
- [ ] Admin/HR: employee selector dropdown visible
- [ ] Employee: no employee selector, sees own data
- [ ] Punch Log view: events grouped by date, IN/OUT badges
- [ ] Daily Summary view (default): table with hours, status badges, late/early dots
- [ ] Click date row → accordion expands showing punch events
- [ ] Empty state when no data available
- [ ] Integrations tab only visible to admin/HR
- [ ] Mobile: cards stack vertically, tables horizontally scrollable

### Full Checklist

**Backend:**
- [ ] `GET /api/time-tracker/config` — list integrations (secrets masked)
- [ ] `POST /api/time-tracker/config` — create with name uniqueness, provider validation
- [ ] `PUT /api/time-tracker/config/:id` — update with secret preservation
- [ ] `DELETE /api/time-tracker/config/:id` — guarded by existing logs
- [ ] `POST /api/time-tracker/config/:id/test` — test adapter connection
- [ ] `POST /api/time-tracker/sync` — manual sync with full pipeline
- [ ] `GET /api/time-tracker/logs` — punch events with data visibility
- [ ] `GET /api/time-tracker/daily-summary` — aggregated summaries with data visibility
- [ ] Adapter interface: `fetchLogs`, `mapToStandardFormat`, `testConnection`
- [ ] AdapterFactory: maps provider string to adapter instance
- [ ] MockAdapter: generates realistic data with configurable rates
- [ ] eSSL / Hubstaff / Custom API: skeleton adapters (501 on execution)
- [ ] SyncService: fetch → match → dedup → insert → summarize → update lastSyncAt
- [ ] SummaryService: computes daily aggregates from raw logs
- [ ] Summary cross-references: work schedule, holidays, approved leaves
- [ ] Sync cron: hourly/daily schedule, iterates all tenants
- [ ] Employee matching by email or employee_id (configurable)
- [ ] Config sanitization (mask sensitive fields)
- [ ] Mock integration auto-seeded during provisioning
- [ ] Audit logging on config CUD + sync operations

**Frontend:**
- [ ] Admin config page with integration cards
- [ ] Config form drawer with dynamic provider fields
- [ ] Test connection + sync now actions on cards
- [ ] Time log page with date picker + employee selector
- [ ] Punch Log view (grouped by date)
- [ ] Daily Summary view (table with status/hours/flags)
- [ ] Date row accordion expansion

---

*Sprint 4C Complete. Time Tracker module built.*

*Next: Sprint 5A — Attendance Module*
