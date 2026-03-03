# Sprint 1A–1E — Gap Fixes

Apply these fixes in order. Each fix references the sprint and file it targets.

---

## Fix 1 — CRITICAL: Remove UNIQUE Constraint on `registration_requests.slug`

**Problem:** `registration_requests.slug` is `UNIQUE` in both the Prisma schema and the raw SQL. This prevents re-registration with the same slug after a failed attempt, since the old `status = 'failed'` row still holds the slug. The UNIQUE constraint only belongs on `platform.tenants.slug`, not on the requests table.

**Targets:**
- `backend/prisma/schema.prisma` — `PlatformRegistrationRequest` model
- `backend/prisma/setup-platform.sql` — `platform.registration_requests` table

**Prisma Schema Change:**
On the `PlatformRegistrationRequest` model, remove `@unique` from the `slug` field. It should become a plain `@db.VarChar(100)` with no uniqueness constraint.

**Raw SQL Change:**
In `setup-platform.sql`, change the `slug` column on `platform.registration_requests` from `VARCHAR(100) UNIQUE NOT NULL` to `VARCHAR(100) NOT NULL` (drop `UNIQUE`).

**Migration:**
If the database already exists with the constraint applied, run:
```sql
ALTER TABLE platform.registration_requests DROP CONSTRAINT IF EXISTS registration_requests_slug_key;
```

**Verification:**
After applying, confirm:
1. `platform.tenants.slug` still has a UNIQUE constraint ✅
2. `platform.registration_requests.slug` does NOT have a UNIQUE constraint ✅
3. Two registration requests with the same slug (one `failed`, one `pending`) can coexist in the table

---

## Fix 2 — MEDIUM: Add Registration Rate Limits to Sprint 1E

**Problem:** PRD Section 5.6 requires rate limits on registration endpoints. Sprint 1D deferred this to Sprint 1E with a TODO, but Sprint 1E's rate limit table (Section 6.2) only covers auth endpoints and never picks up the registration limits.

**Target:** Sprint 1E — Section 6.2 rate limit table + `RegistrationController`

**Add these rows to the rate limit table:**

| Endpoint | Limit | Window | Purpose |
|---|---|---|---|
| `POST /api/public/register` | 5 requests | 60 minutes per IP | PRD 5.6: prevent registration spam |
| `POST /api/public/register/resend-verification` | 3 requests | 60 minutes per IP | PRD 5.6: prevent resend abuse |

**Implementation note:** These endpoints are in `RegistrationController` (Sprint 1D), which is under `/api/public/*` and bypasses `TenantMiddleware`. The `ThrottlerModule` registered globally in `AppModule` (Sprint 1E) will still apply to these routes since throttling is an application-level concern, not a tenant-level one. Apply `@Throttle()` decorator overrides on the two controller methods.

**Verification:**
- Send 6 rapid `POST /api/public/register` requests from the same IP → 6th should return `429`
- Send 4 rapid `POST /api/public/register/resend-verification` requests → 4th should return `429`

---

## Fix 3 — MEDIUM: Add "Change Email" Feature to Sprint 1D

**Problem:** PRD Section 5.4 specifies a "Change Email" link on the `/register/pending` page that allows editing the admin email before verification. Sprint 1D's spec omits both the backend endpoint and the frontend UI for this.

### Backend Addition

**New endpoint:** `PUT /api/public/register/update-email`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `registrationId` | string | `@IsUUID()` | Yes |
| `currentEmail` | string | `@IsEmail()` | Yes |
| `newEmail` | string | `@IsEmail()` | Yes |

**New DTO:** Create `update-registration-email.dto.ts` in `src/registration/dto/` with the above fields. Add to the barrel export.

**Service Logic:**
1. Find registration request: `SELECT * FROM platform.registration_requests WHERE id = $1 AND admin_email = $2 AND status = 'pending'`
2. If not found → `404 "Registration not found or already verified"`
3. If `newEmail === currentEmail` → `400 "New email must be different"`
4. Check new email availability using the existing `checkEmail()` method (cross-tenant scan)
5. If not available → `409 "This email address is already in use"`
6. Generate new `email_verification_token` (UUID)
7. Update registration request: set `admin_email = newEmail`, `email_verification_token = newToken`, `created_at = NOW()` (restarts 24h expiry window)
8. Send verification email to the **new** email address using the new token
9. Return `{ success: true, data: { message: "Verification email sent to new address." } }`

**Security considerations:**
- Requires `registrationId` AND `currentEmail` to prevent unauthorized email changes
- Only works on `status = 'pending'` registrations (not verified/provisioned/failed)
- Resets the verification token (old token becomes orphaned and won't match any record after email update)

### Frontend Addition

**Target:** `/register/pending` page spec (Sprint 1D Section 3.2)

Add to the pending page UI:
- Below the resend button, add a "Change Email" text link
- Clicking "Change Email" shows an inline form: new email input + "Update & Resend" button
- On submit: call `PUT /api/public/register/update-email` with `{ registrationId, currentEmail, newEmail }`
- On success: update the displayed email on the page, show success toast "Verification email sent to {newEmail}"
- On error (409 email taken): show inline error under the new email input
- The `registrationId` and `currentEmail` come from the URL query params (`/register/pending?email={email}&regId={registrationId}`)

### API Helper Addition

**Target:** `frontend/src/services/registration.ts`

Add export:
- `updateEmail(registrationId, currentEmail, newEmail)` → `PUT /api/public/register/update-email`

### Swagger

The new endpoint should appear under the "Public Registration" tag in Swagger docs at `/api/docs`.

**Verification:**
```
PUT /api/public/register/update-email
Body: { "registrationId": "<uuid>", "currentEmail": "old@test.com", "newEmail": "new@test.com" }
→ 200: { message: "Verification email sent to new address." }
→ Check that old verification token no longer works
→ Check that new email received the verification email
→ Check DB: admin_email updated to new@test.com
```

---

## Fix 4 — LOW: Remove Unused Generic JWT Secrets from `.env`

**Problem:** Sprint 1A defines `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (generic), but no sprint ever uses them. Sprint 1C uses `PLATFORM_JWT_*` secrets and Sprint 1E uses `TENANT_JWT_*` secrets. The generic ones cause confusion.

**Target:** `backend/.env` and `backend/.env.example`

**Remove these two lines:**
```
JWT_ACCESS_SECRET=hrms-access-secret-change-in-production
JWT_REFRESH_SECRET=hrms-refresh-secret-change-in-production
```

**Keep these (Sprint 1A defined, Sprint 1C uses):**
```
PLATFORM_JWT_ACCESS_SECRET=platform-access-secret-change-in-production
PLATFORM_JWT_REFRESH_SECRET=platform-refresh-secret-change-in-production
```

**Keep these (Sprint 1E adds):**
```
TENANT_JWT_ACCESS_SECRET=tenant-access-secret-min-32-chars-change-in-production
TENANT_JWT_REFRESH_SECRET=tenant-refresh-secret-min-32-chars-change-in-production
```

**Keep these (shared config, Sprint 1A defined, used by both platform and tenant auth):**
```
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

**Verification:** `grep -r "JWT_ACCESS_SECRET\|JWT_REFRESH_SECRET" backend/src/` should only return references to `PLATFORM_JWT_*` or `TENANT_JWT_*` prefixed versions, never the bare `JWT_ACCESS_SECRET`.

---

## Post-Fix Verification Summary

| Fix | How to Verify |
|---|---|
| Fix 1 (slug uniqueness) | Insert two `registration_requests` rows with same slug, different statuses → no constraint error |
| Fix 2 (registration rate limits) | Rapid-fire 6 POST `/api/public/register` → 429 on 6th |
| Fix 3 (change email) | Call update-email endpoint → old token invalid, new email receives verification |
| Fix 4 (env cleanup) | `grep` confirms no references to bare `JWT_ACCESS_SECRET` in source code |
