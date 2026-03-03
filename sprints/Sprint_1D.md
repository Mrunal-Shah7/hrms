# Sprint 1D — Self-Service Tenant Registration

## Goal
Build the complete public self-service registration flow: registration form page, backend APIs for registration + email verification + slug/email uniqueness checks, automatic tenant provisioning on email verification, welcome email, and post-registration pages. No authentication required for any of these routes.

---

## 1. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/registration/registration.module.ts` | NestJS module |
| `src/registration/registration.controller.ts` | 5 API endpoints under `/api/public/register` |
| `src/registration/registration.service.ts` | All registration + verification + provisioning logic |
| `src/registration/dto/create-registration.dto.ts` | Validation DTO for registration form |
| `src/registration/dto/resend-verification.dto.ts` | Validation DTO for resend |
| `src/registration/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(public)/register/page.tsx` | Registration form page |
| `src/app/(public)/register/pending/page.tsx` | "Check your email" page |
| `src/app/(public)/register/verify/page.tsx` | Email verification + provisioning status page |
| `src/app/(public)/register/layout.tsx` | Blank layout (no shell, no sidebar) |
| `src/services/registration.ts` | API helper functions |

### Module Registration
- Import `RegistrationModule` into `AppModule`
- All routes are under `/api/public/register/*` — these are already excluded from `TenantMiddleware` via the `api/public/(.*)` exclude rule set up in Sprint 1B

---

## 2. API Specification

All endpoints are **public** — no authentication required. Controller prefix: `public/register`.

### 2.1 `POST /api/public/register` — Submit Registration

**Request Body (DTO validation):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `organizationName` | string | `@IsNotEmpty()` | Yes |
| `slug` | string | `@IsNotEmpty()`, regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Yes |
| `adminName` | string | `@IsNotEmpty()` | Yes |
| `adminEmail` | string | `@IsEmail()` | Yes |
| `password` | string | Min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char | Yes |
| `subscriptionTier` | string | `@IsIn(['standard', 'with_recruitment'])` | Yes |
| `maxUsers` | int | `@Min(1)`, `@Max(10000)` | Yes |

**Service Logic:**
1. Validate slug availability — check `platform.tenants` AND `platform.registration_requests` (status `pending` or `verified`)
2. Validate email availability — check `platform.super_admins`, `platform.registration_requests` (status `pending`/`verified`), and ALL existing tenant schemas' `users` table
3. Hash the password with bcrypt (salt rounds: 12)
4. Generate `email_verification_token` using `crypto.randomUUID()`
5. Insert row into `platform.registration_requests` with `status = 'pending'`, `email_verified = FALSE`
6. Send verification email (direct nodemailer — same pattern as Sprint 1C OTP email, will be refactored to EmailService in Sprint 1G)

**Verification Email Content:**
- From: Platform email (env `MAIL_FROM`)
- Subject: `"Verify your email — HRMS Platform"`
- Body: Branded HTML with a button linking to `{FRONTEND_URL}/register/verify?token={token}`
- Include org name and admin name in the greeting

**Response:** `{ success: true, data: { message: "Verification email sent...", registrationId: "<uuid>" } }`

**Error Responses:**
- `409 Conflict` — slug already taken
- `409 Conflict` — email already in use
- `400 Bad Request` — validation errors

---

### 2.2 `GET /api/public/register/verify?token=` — Verify Email + Provision

**Query Param:** `token` (string, the UUID verification token)

**Service Logic:**
1. Look up `platform.registration_requests` by `email_verification_token`
2. If not found → `404 Not Found` with message "Invalid verification token"
3. If `status === 'provisioned'` → return `{ status: 'already_provisioned', message: '...' }`
4. If `status === 'verified'` → return `{ status: 'already_verified', message: '...' }`
5. Check token expiry: if `created_at + 24 hours < now()` → `400 Bad Request` with "Token expired" message
6. Update record: `email_verified = TRUE`, `status = 'verified'`, `verified_at = NOW()`
7. Handle slug race condition: re-check slug availability in `platform.tenants`. If taken, append `-{6 random hex chars}` suffix
8. Call `TenantProvisioningService.provision()` with all fields from the registration request
9. On success:
   - Update record: `status = 'provisioned'`, `tenant_id = <result.tenantId>`, `provisioned_at = NOW()`
   - Send welcome email to the admin
   - Return `{ status: 'provisioned', message: '...', slug: '<final_slug>', tenantId: '<id>' }`
10. On failure:
    - Update record: `status = 'failed'`
    - Log error
    - Return `{ status: 'failed', message: 'Something went wrong...' }`

**Welcome Email Content:**
- Subject: `"Welcome to HRMS Platform — Your organization is ready!"`
- Body: Branded HTML containing:
  - Organization name
  - Login URL: `{FRONTEND_URL}/login` (for localhost dev) — in production this would be `{slug}.{PLATFORM_DOMAIN}/login`
  - Admin email (as username)
  - Note that they'll need to change their password on first login (`must_reset_password = TRUE`)

---

### 2.3 `POST /api/public/register/resend-verification` — Resend Verification Email

**Request Body:**

| Field | Type | Required |
|---|---|---|
| `email` | string (email) | Yes |

**Service Logic:**
1. Find the most recent `platform.registration_requests` where `admin_email = <email>` AND `status = 'pending'`
2. If not found → still return success (no user enumeration)
3. Generate a NEW `email_verification_token` (UUID), update the record, also reset `created_at = NOW()` to restart the 24h expiry window
4. Send new verification email with the new token
5. Return `{ success: true, data: { message: "If a pending registration exists, a new verification email has been sent." } }`

**Rate limit note:** Rate limiting is specified in PRD (3 resends/registration/hour) but full rate limiter is built in Sprint 1E. For now, just implement the logic without enforced rate limiting. Add a `// TODO: Rate limit — Sprint 1E` comment.

---

### 2.4 `GET /api/public/register/check-slug?slug=` — Slug Availability Check

**Query Param:** `slug` (string)

**Service Logic:**
1. Check `platform.tenants` for matching `slug`
2. Check `platform.registration_requests` for matching `slug` where `status IN ('pending', 'verified')`
3. Return `{ success: true, data: { available: true/false } }`

---

### 2.5 `GET /api/public/register/check-email?email=` — Email Availability Check

**Query Param:** `email` (string)

**Service Logic:**
1. Check `platform.super_admins` for matching `email`
2. Check `platform.registration_requests` for matching `admin_email` where `status IN ('pending', 'verified')`
3. Loop through ALL `platform.tenants` (non-cancelled), set `search_path` to each schema, check `users` table for matching `email`
4. Return `{ success: true, data: { available: true/false } }`

**Performance note:** The cross-tenant email scan is expensive for large numbers of tenants. For now this is acceptable. Add a `// TODO: Optimize — consider a platform.global_emails lookup table for O(1) checks` comment.

---

## 3. Frontend Specification

### 3.1 Registration Page — `/register`

**Layout:** Use `(public)` route group. Blank layout — no sidebar, no header. Centered card form on light background (same visual pattern as the platform login page from Sprint 1C).

**Form Fields & Behavior:**

| Field | Type | Behavior |
|---|---|---|
| Organization Name | text input | On change: auto-generate slug (kebab-case: lowercase, replace spaces with hyphens, strip special chars) |
| Organization Slug | text input, pre-filled | Editable. On blur: debounced call to `check-slug` API (300ms debounce). Show green checkmark if available, red "already taken" error if not. |
| Admin Full Name | text input | Standard validation |
| Admin Email | email input | On blur: debounced call to `check-email` API. Show red error if taken. |
| Password | password input | Show password strength meter below (visual bar: weak/medium/strong). Validation: min 8 chars, 1 upper, 1 lower, 1 number, 1 special. |
| Confirm Password | password input | Must match Password field. Show mismatch error inline. |
| Subscription Tier | radio card selector (2 options) | **Standard**: "All modules except Recruitment" — display as a selectable card. **Standard + Recruitment**: "All modules including Recruitment" — display as a selectable card. Default: Standard selected. |
| Number of Users | number input | Min 1. Default: 10. |
| Terms & Conditions | checkbox | Required. Text: "I agree to the Terms of Service and Privacy Policy" (links can be # placeholders for now). |

**Submit Behavior:**
1. Disable button, show spinner
2. Call `POST /api/public/register`
3. On success: redirect to `/register/pending?email={adminEmail}&regId={registrationId}`
4. On error: show error alert at top of form (slug taken, email taken, validation errors)

**Slug Auto-Generation Function:**
- Input: `"Acme Corporation Ltd."` → Output: `"acme-corporation-ltd"`
- Lowercase, replace spaces & underscores with hyphens, strip non-alphanumeric except hyphens, collapse consecutive hyphens, trim leading/trailing hyphens

---

### 3.2 Pending Page — `/register/pending`

**URL:** `/register/pending?email={email}&regId={registrationId}`

**Content:**
- Branded header/logo (same as login page)
- Mail icon (use `lucide-react` Mail or MailCheck icon)
- Heading: "Check your email"
- Message: "We've sent a verification email to **{email}**. Please click the link to activate your organization."
- Subtext: "Didn't receive the email? Check your spam folder or click below to resend."
- **"Resend Verification Email" button**: Calls `POST /api/public/register/resend-verification` with `{ email }`. After clicking, disable button for 60 seconds with a countdown timer ("Resend available in 45s"). Show success toast on resend.
- "Back to Registration" link → navigates to `/register`

---

### 3.3 Verify Page — `/register/verify`

**URL:** `/register/verify?token={token}`

**On Page Load (useEffect):**
1. Extract `token` from URL query params
2. If no token → show "Invalid link" error state
3. Call `GET /api/public/register/verify?token={token}`
4. Show loading state during the call: spinning indicator + "Verifying your email and setting up your organization..."

**Result States:**

| API `status` | UI |
|---|---|
| `provisioned` | ✅ Success: "Your organization is ready!" + "Go to Login" button. The button links to `/login`. Display the organization slug. |
| `already_provisioned` | ✅ "Your organization was already set up." + "Go to Login" button |
| `already_verified` | ⏳ "Email already verified. Setup may still be in progress." + auto-retry after 3 seconds (poll up to 5 times) |
| `failed` | ❌ "Something went wrong while setting up your organization. Our team has been notified." + "Contact Support" link (placeholder href). |
| 400 (token expired) | ⏰ "Your verification link has expired." + "Resend Verification Email" button (navigates to `/register/pending?email=...` or inline resend) |
| 404 (invalid token) | ❌ "Invalid verification link. Please check the URL or register again." + "Register" button |

---

### 3.4 Frontend API Helper

**File:** `frontend/src/services/registration.ts`

Export functions:
- `register(data)` → `POST /api/public/register`
- `verifyEmail(token)` → `GET /api/public/register/verify?token=`
- `resendVerification(email)` → `POST /api/public/register/resend-verification`
- `checkSlug(slug)` → `GET /api/public/register/check-slug?slug=`
- `checkEmail(email)` → `GET /api/public/register/check-email?email=`

All use the existing `api` Axios instance from `services/api.ts`.

---

## 4. Email Templates

Two emails are sent during this flow. Both use direct nodemailer (same approach as Sprint 1C OTP email — will be refactored to EmailService abstraction in Sprint 1G).

### 4.1 Verification Email

| Property | Value |
|---|---|
| Subject | `Verify your email — HRMS Platform` |
| Style | Branded HTML. Brand color `#011552`. Inter font. Max-width 480px. |
| Content | Greeting with admin name. Explain they registered org `{orgName}`. Large CTA button: "Verify Email Address" → `{FRONTEND_URL}/register/verify?token={token}`. Fallback text link below button. Footer: "This link expires in 24 hours." |

### 4.2 Welcome Email (sent after successful provisioning)

| Property | Value |
|---|---|
| Subject | `Welcome to HRMS Platform — {orgName} is ready!` |
| Style | Same branded HTML template |
| Content | Greeting with admin name. Congratulate on setting up `{orgName}`. Login URL: `{FRONTEND_URL}/login`. Username: their admin email. Note: "You'll be asked to set a new password on your first login." Large CTA button: "Go to Login". |

---

## 5. Database Operations Summary

All queries target the `platform` schema. No tenant schema interaction except for the email uniqueness cross-tenant scan and the provisioning call.

| Operation | Table | Type |
|---|---|---|
| Check slug availability | `platform.tenants`, `platform.registration_requests` | SELECT |
| Check email availability | `platform.super_admins`, `platform.registration_requests`, `{each_tenant}.users` | SELECT (multi-schema) |
| Create registration | `platform.registration_requests` | INSERT |
| Verify email | `platform.registration_requests` | SELECT + UPDATE |
| Provision tenant | (delegates to `TenantProvisioningService` from Sprint 1B) | Full pipeline |
| Resend verification | `platform.registration_requests` | SELECT + UPDATE |

---

## 6. Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| Slug taken between registration and provisioning (race condition) | Re-check slug in `platform.tenants` at verification time. If taken, append `-{6 random hex chars}` suffix. |
| Token used twice (double-click on email link) | Second call sees `status = 'provisioned'` and returns `already_provisioned` — no error. |
| Token expired (>24h) | Return 400 with clear message. Frontend shows resend option. |
| Provisioning fails mid-way | `TenantProvisioningService` handles cleanup (drops schema, deletes tenant row). Registration request marked as `failed`. |
| Email delivery fails | Log error. Registration request remains `pending`. User can click "Resend" on pending page. |
| Same email registers twice (before first is verified) | Second registration attempt fails with 409 — email uniqueness checked against pending registrations too. |
| Browser navigates directly to `/register/verify` without token | Show "Invalid link" state. |

---

## 7. Module Registration

Update `backend/src/app.module.ts`:
- Import `RegistrationModule`
- `RegistrationModule` should import `TenantModule` (to access `TenantProvisioningService`)
- No guards on any registration endpoints — they're all public

---

## 8. Verification & Acceptance Criteria

### API Tests

**Test 1: Check slug availability**
```
GET /api/public/register/check-slug?slug=fresh-new-org
→ { success: true, data: { available: true } }

GET /api/public/register/check-slug?slug=acme-corp   (if test tenant from 1B exists)
→ { success: true, data: { available: false } }
```

**Test 2: Check email availability**
```
GET /api/public/register/check-email?email=newuser@test.com
→ { success: true, data: { available: true } }

GET /api/public/register/check-email?email=admin@hrms-platform.com
→ { success: true, data: { available: false } }
```

**Test 3: Full registration flow**
```
POST /api/public/register
Body: { organizationName: "Test Org", slug: "test-org", adminName: "Jane Smith", adminEmail: "jane@testorg.com", password: "Test@1234", subscriptionTier: "standard", maxUsers: 5 }
→ { success: true, data: { message: "...", registrationId: "<uuid>" } }
→ Check email inbox for verification link

GET /api/public/register/verify?token=<token_from_email>
→ { success: true, data: { status: "provisioned", slug: "test-org", tenantId: "<uuid>" } }
→ Check email inbox for welcome email

Verify in DB:
  SELECT * FROM platform.registration_requests WHERE slug = 'test-org';
  -- status should be 'provisioned', tenant_id should be set

  SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_test_org';
  -- schema should exist

  SET search_path TO "tenant_test_org";
  SELECT email, must_reset_password FROM users;
  -- jane@testorg.com, must_reset_password = true
```

**Test 4: Resend verification**
```
POST /api/public/register/resend-verification
Body: { email: "jane@testorg.com" }
→ { success: true, data: { message: "If a pending registration exists..." } }
```

**Test 5: Expired token**
```
Manually set created_at to 25 hours ago in DB, then:
GET /api/public/register/verify?token=<old_token>
→ 400 Bad Request, "Verification token has expired"
```

**Test 6: Duplicate slug**
```
POST /api/public/register
Body: { ... slug: "acme-corp" ... }   (already exists)
→ 409 Conflict, "slug is already taken"
```

### Frontend Tests

- [ ] `/register` renders form with all fields, accessible without login
- [ ] Typing org name auto-fills slug in kebab-case
- [ ] Slug field shows green check / red error on blur after API call
- [ ] Email field shows error on blur if already in use
- [ ] Password strength meter updates in real-time
- [ ] Confirm Password shows mismatch error
- [ ] Tier selector shows two card options, Standard pre-selected
- [ ] Submit disabled until all fields valid + T&C checked
- [ ] On success: redirects to `/register/pending` with email displayed
- [ ] Pending page shows resend button with 60s cooldown timer
- [ ] Verify page shows loading → success with "Go to Login" button
- [ ] Verify page handles expired token with resend option
- [ ] Verify page handles invalid token with "Register" link

### Full Checklist

- [ ] Registration page publicly accessible without authentication
- [ ] Slug auto-generates from org name and shows real-time availability via API
- [ ] Email uniqueness checked across `platform.super_admins`, pending registrations, and ALL tenant `users` tables
- [ ] Registration creates record in `platform.registration_requests` with `status = 'pending'`
- [ ] Verification email sent with branded HTML containing clickable link
- [ ] Verification token expires after 24 hours
- [ ] Clicking valid verification link triggers full provisioning pipeline (schema + tables + seed + admin user)
- [ ] After provisioning, `registration_requests.status = 'provisioned'` and `tenant_id` is linked
- [ ] Welcome email sent after successful provisioning with login URL
- [ ] Admin's `must_reset_password = TRUE` in the provisioned tenant schema
- [ ] Expired verification tokens return clear error with resend option
- [ ] Failed provisioning sets `status = 'failed'` and is visible to super admins
- [ ] Resend verification generates new token and resets 24h window
- [ ] Resend does not reveal whether email exists (no enumeration)
- [ ] Slug race condition handled: if slug taken at provisioning time, random suffix appended
- [ ] Duplicate registration with same slug returns 409
- [ ] Duplicate registration with same email returns 409
- [ ] All 5 API endpoints appear in Swagger docs at `/api/docs`
- [ ] Both email templates use brand styling (`#011552`, Inter font)

---

*Sprint 1D Complete. Next: Sprint 1E — Tenant Auth & Session Management*
