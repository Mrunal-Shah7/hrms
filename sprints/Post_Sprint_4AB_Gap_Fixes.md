# Post Sprint 4A/4B Gap Fixes

Three fixes identified during integration audit of Sprints 4A and 4B against the PRD.

---

## Fix 1: Align Employee Cancel to PRD (Pending Only)

**Problem:** Sprint 4B Section 4.5 allows employees to cancel both pending AND approved leave requests. PRD 11.2 and 11.5 explicitly state: "Employee: Cancel (pending only)." The intent is that once HR approves a leave, the employee cannot unilaterally undo it — they must ask HR/Admin to cancel on their behalf.

**Change in `PUT /api/leave/requests/:id/cancel` (Sprint 4B Section 4.5):**

Replace the current access + status logic with:

**Access rules:**
- **Employee (request owner):** Can cancel only if `status === 'pending'`. If status is `'approved'` → `400 "Approved leave can only be cancelled by HR or an administrator"`
- **Admin/HR (has `leave:approve:leave_requests`):** Can cancel both `'pending'` and `'approved'` requests for any employee

**Updated service logic:**

1. Validate request exists
2. Determine caller role:
   - `isAdmin = req.user has leave:approve:leave_requests permission`
   - `isOwner = req.user.userId === request.userId`
3. Access check:
   - If not `isOwner` and not `isAdmin` → `403 "You can only cancel your own leave requests"`
4. Status check:
   - If `status === 'pending'`:
     - Both owner and admin can cancel
     - No balance impact
   - If `status === 'approved'`:
     - Only `isAdmin` can cancel → if `isOwner && !isAdmin` → `400 "Approved leave can only be cancelled by HR or an administrator"`
     - Restore balance: `UPDATE leave_balances SET used = used - $totalDays ...` (with floor at 0)
   - If `status === 'rejected'` or `'cancelled'` → `400 "Cannot cancel a {status} request"`
5. Update `status = 'cancelled'`
6. Send notification (same as before)

**Frontend change (Sprint 4B Section 10.2 detail drawer):**

Update the bottom actions:
- **For the requester (pending):** "Close" + "Cancel Leave"
- **For the requester (approved):** "Close" only (no cancel button). Show info text: "To cancel an approved leave, please contact your HR administrator."
- **For HR/Admin (pending):** "Close" + "Reject" + "Approve"
- **For HR/Admin (approved):** "Close" + "Cancel Leave"

**Test updates:**

Replace Sprint 4B Test 19 with:

**Test 19a: Employee cannot cancel approved leave**
```
PUT /api/leave/requests/{approvedId}/cancel
Headers: Bearer <employee_token>  # the request owner
→ 400: "Approved leave can only be cancelled by HR or an administrator"
```

**Test 19b: Admin can cancel approved leave**
```
PUT /api/leave/requests/{approvedId}/cancel
Headers: Bearer <admin_token>
→ 200: status = "cancelled"

Verify: leave_balances.used decremented by totalDays
```

Update the verification checklist bullet:
- [ ] `PUT /api/leave/requests/:id/cancel` — employee: pending only; Admin/HR: pending + approved with balance restore

---

## Fix 2: Add Leave Policies Export Endpoint

**Problem:** Sprint 4A defines exports for leave types and holidays, but the Leave Policies page — a data-table page — has no export endpoint. PRD 24.2 requires every data-table page to have an export menu.

**Add to Sprint 4A Section 6 (after Section 6.6):**

### 6.8 `GET /api/leave/policies/export` — Export Policies

**Permission:** `@RequirePermission('leave', 'view', 'leave_policies')`
**Rate Limit:** 5 req/min/user

**Query Parameters:** Same filters as `GET /api/leave/policies` + `format` (csv, xlsx)

**Export Columns:**

| Header | Source |
|---|---|
| Leave Type | `leaveType.name` |
| Leave Type Code | `leaveType.code` |
| Designation | `designation.name` or "All" |
| Department | `department.name` or "All" |
| Employment Type | `employmentType` or "All" |
| Annual Allocation | `annualAllocation` |
| Accrual Type | `accrualType` |
| Carry Forward | "Yes" / "No" |
| Max Carry Forward | `maxCarryForward` or "—" |

File name: `leave_policies_{YYYY-MM-DD}.{format}`

**Frontend change:** Add three-dots export menu (CSV / XLSX) to the Leave Policies page toolbar (`/leave/admin/policies`).

**Add to Sprint 4A verification checklist:**
- [ ] `GET /api/leave/policies/export` — CSV/XLSX with scope display
- [ ] Leave Policies page: export menu in toolbar

---

## Fix 3: Holidays Controller Prefix Correction

**Problem:** Sprint 4A declares `Controller prefix: leave/holidays` which would generate routes at `/api/leave/holidays/*`. However, all documented endpoints say `/api/holidays` (matching PRD 11.5), and holidays are cross-module — the Attendance module (Sprint 5A) also needs them. The controller prefix and the actual endpoint paths are inconsistent.

**Change in Sprint 4A Section 7:**

Replace:
```
Controller prefix: leave/holidays.
```

With:
```
Controller prefix: holidays.
```

The controller file remains at `src/leave/holidays/holidays.controller.ts` (code organization stays within the leave module folder), but the NestJS `@Controller()` decorator uses `'holidays'` as the prefix, producing routes at `/api/holidays/*`.

This means the actual routes are:
- `GET /api/holidays` (list)
- `POST /api/holidays` (create)
- `PUT /api/holidays/:id` (update)
- `DELETE /api/holidays/:id` (delete)
- `GET /api/holidays/export` (export)
- `GET /api/holidays/import/template` (template)
- `POST /api/holidays/import` (import)

All endpoint headings in Sprint 4A Sections 7.1–7.7 already use these paths — no changes needed to the endpoint documentation, only to the controller prefix declaration.

The `HolidaysController` is still registered inside `LeaveModule`, and `LeaveModule` is imported into `AppModule`. NestJS will mount the `holidays` prefix at the app root regardless of which module it belongs to.

**Verification:** Ensure Sprint 4B references to holidays (day calculator fetching holidays, team view) use `GET /api/holidays` — confirmed, Sprint 4B Section 3 fetches holidays via query and Sprint 6.1 uses the holidays table directly, no endpoint path issues.

---

## Summary

| Fix | Issue | Severity | Change Scope |
|---|---|---|---|
| 1 | Employee cancel allows approved (PRD says pending only) | Medium — behavioral deviation | Sprint 4B: service logic + frontend + tests |
| 2 | Leave policies page missing export | Low — consistency gap | Sprint 4A: new endpoint + frontend menu |
| 3 | Holidays controller prefix mismatch | Low — would cause wrong route paths | Sprint 4A: single line change |
