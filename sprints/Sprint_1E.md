# Sprint 1E — Tenant Auth & Session Management

## Goal
Build the complete tenant-level authentication system: tenant user login (validates against tenant schema, checks tenant status), JWT token pair with refresh rotation, session tracking in `user_sessions`, password reset via 6-digit OTP, forced password change on first login, compensation re-authentication, the `TenantAuthGuard` (rejects platform tokens), and rate limiting on all auth endpoints. Includes a functional frontend login page, forgot password flow, and forced password change page.

---

## 1. Scope Boundaries

### In Scope (Sprint 1E)
- 9 backend auth API endpoints
- `TenantJwtStrategy` + `TenantAuthGuard`
- Rate limiting (global + per-endpoint)
- Frontend: `/login`, `/forgot-password`, `/reset-password`, `/force-change-password` pages

### Out of Scope (deferred)
| Feature | Sprint |
|---|---|
| Account profile page, security page, sessions page, settings, privacy, organization pages | 2C |
| Account change-password (current + new) | 2C |
| Account sessions list + revoke | 2C |
| Profile photo upload | 2C |
| External user badge rendering in UI | 1H / 2C |

---

## 2. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/auth/auth.module.ts` | NestJS module for tenant auth |
| `src/auth/auth.controller.ts` | 9 auth API endpoints |
| `src/auth/auth.service.ts` | All tenant auth logic |
| `src/auth/strategies/tenant-jwt.strategy.ts` | Passport JWT strategy for tenant tokens |
| `src/auth/guards/tenant-auth.guard.ts` | Guard that validates tenant JWTs |
| `src/auth/dto/tenant-login.dto.ts` | Login DTO |
| `src/auth/dto/tenant-refresh.dto.ts` | Refresh DTO |
| `src/auth/dto/tenant-forgot-password.dto.ts` | Forgot password DTO |
| `src/auth/dto/tenant-verify-otp.dto.ts` | Verify OTP DTO |
| `src/auth/dto/tenant-reset-password.dto.ts` | Reset password DTO |
| `src/auth/dto/force-change-password.dto.ts` | Forced first-login password change DTO |
| `src/auth/dto/re-authenticate.dto.ts` | Compensation re-auth DTO |
| `src/auth/dto/index.ts` | Barrel export |
| `src/common/guards/tenant-auth.guard.ts` | Re-export for convenience |
| `src/common/guards/throttle.guard.ts` | Rate limit configuration |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(auth)/login/page.tsx` | Tenant login page |
| `src/app/(auth)/forgot-password/page.tsx` | Forgot password → OTP → reset flow |
| `src/app/(auth)/force-change-password/page.tsx` | Forced password change on first login |
| `src/app/(auth)/layout.tsx` | Blank layout for auth pages (no shell) |
| `src/services/auth.ts` | Auth API helper functions |
| `src/lib/auth-guard.tsx` | Client-side route protection HOC/hook |

### Dependencies to Install
```
backend: npm install @nestjs/throttler
```

### Module Registration
- Import `AuthModule` into `AppModule`
- Import `ThrottlerModule` into `AppModule` (global rate limiting)
- Auth routes are under `/api/auth/*` — these DO pass through `TenantMiddleware` (tenant must be resolved for login to work)

---

## 3. Important Architectural Note: Tenant Auth Routes Through TenantMiddleware

Unlike platform auth (`/api/platform/auth/*` which bypasses tenant middleware), tenant auth routes (`/api/auth/*`) **DO** pass through `TenantMiddleware`. This is intentional:

- The login endpoint needs to know WHICH tenant the user belongs to
- `TenantMiddleware` resolves the tenant from subdomain / `X-Tenant-ID` / `X-Tenant-Slug` header
- The resolved `req.tenant` tells the auth service which schema to query for user credentials

**Exception:** The middleware already blocks suspended/cancelled tenants. But login should show a more specific error message. So the auth service should catch these cases and return appropriate messages:
- Suspended → "Your organization's account has been suspended. Please contact your administrator."
- Cancelled → "Your organization's account has been cancelled."

Since `TenantMiddleware` already throws 403 for suspended/cancelled tenants BEFORE the request reaches the controller, the auth service doesn't need to re-check. The middleware error message is the one users see. Ensure the middleware error messages are user-friendly (already done in Sprint 1B).

---

## 4. API Specification

Controller prefix: `auth`. All endpoints require tenant resolution via middleware (except the middleware itself blocks bad tenants).

### 4.1 `POST /api/auth/login` — Tenant User Login

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `email` | string | `@IsEmail()`, `@IsNotEmpty()` |
| `password` | string | `@IsString()`, `@IsNotEmpty()` |

**Service Logic:**
1. Tenant is already resolved by middleware → available as `req.tenant`
2. Set `search_path` to `req.tenant.schemaName`
3. Query `users` table: `SELECT id, email, password_hash, first_name, last_name, display_name, photo_url, email_domain_type, status, must_reset_password FROM users WHERE email = $1`
4. If not found → `401 "Invalid email or password"` (no enumeration)
5. If `user.status !== 'active'` → `401 "Your account is not active. Please contact your administrator."`
6. Compare password with bcrypt → if mismatch → `401 "Invalid email or password"`
7. Load user's roles and permissions:
   - Query: `SELECT r.name FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = $1`
   - Query: `SELECT DISTINCT p.module || ':' || p.action || ':' || p.resource as permission_key FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id JOIN user_roles ur ON rp.role_id = ur.role_id WHERE ur.user_id = $1`
   - This gives the union of all permissions across all roles (as per PRD: "effective permissions = union of all role permissions")
8. Generate JWT access token (15 min)
9. Generate refresh token (7 days)
10. Hash refresh token, store in `user_sessions` with device info
11. Update `users.last_login_at = NOW()`

**Access Token Payload (PRD 7.2 step 7):**
```
{
  userId: string,
  tenantId: string,        // from req.tenant.id
  schemaName: string,      // from req.tenant.schemaName
  roles: string[],         // ["Admin", "HR Manager"]
  permissions: string[],   // ["leave:approve:leave_requests", "employee_management:view:employees", ...]
  type: 'tenant'           // distinguishes from platform tokens
}
```

**Response:**
```
{
  success: true,
  data: {
    accessToken: "...",
    refreshToken: "...",
    user: {
      id, email, firstName, lastName, displayName, photoUrl,
      emailDomainType, roles, mustResetPassword
    }
  }
}
```

**Frontend behavior on `mustResetPassword: true`:** Redirect to `/force-change-password` before allowing access to any other page.

---

### 4.2 `POST /api/auth/refresh` — Refresh Token Pair

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `refreshToken` | string | `@IsNotEmpty()` |

**Service Logic:**
1. Tenant resolved by middleware → set `search_path`
2. Query all non-expired sessions for this tenant: `SELECT id, user_id, refresh_token_hash FROM user_sessions WHERE expires_at > NOW()`
3. Iterate sessions, bcrypt compare the provided refresh token against each hash
4. If no match → `401 "Invalid or expired refresh token"`
5. Verify user still active: `SELECT id, status FROM users WHERE id = $1`
6. If user inactive → delete session, return `401`
7. **Rotation:** Delete old session
8. Reload roles/permissions (they may have changed since last login)
9. Generate new token pair
10. Store new refresh token hash in `user_sessions`
11. Return new `{ accessToken, refreshToken }`

---

### 4.3 `POST /api/auth/logout` — Invalidate Session

**Auth Required:** `TenantAuthGuard`

**Request Body (optional):**

| Field | Type | Required |
|---|---|---|
| `refreshToken` | string | No |

**Service Logic:**
1. If `refreshToken` provided → find matching session by bcrypt compare, delete it
2. If no `refreshToken` → delete ALL sessions for `req.user.userId`
3. Return `{ success: true, data: { message: "Logged out successfully" } }`

---

### 4.4 `POST /api/auth/forgot-password` — Send OTP

**No Auth Required** (but tenant middleware still resolves tenant)

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `email` | string | `@IsEmail()` |

**Service Logic:**
1. Set `search_path` to tenant schema
2. Find user: `SELECT id, email, first_name FROM users WHERE email = $1 AND status = 'active'`
3. If not found → **still return success** (no enumeration)
4. Invalidate existing unused OTPs: `UPDATE password_reset_otps SET used = TRUE WHERE user_id = $1 AND used = FALSE`
5. Generate 6-digit OTP: `crypto.randomInt(100000, 999999).toString()`
6. Hash OTP with bcrypt, store in `password_reset_otps` with `expires_at = NOW() + 10 minutes`
7. Send OTP via email (direct nodemailer, same pattern as Sprint 1C — refactored to EmailService in Sprint 1G)

**OTP Email Template:**
- Subject: `"Password Reset OTP — {orgName}"`
- Body: Branded HTML (`#011552`, Inter). Greeting with user's first name. Large styled OTP display (32px, letter-spacing). "This OTP expires in 10 minutes." footer.

**Response:** `{ success: true, data: { message: "If an account exists with this email, an OTP has been sent." } }`

---

### 4.5 `POST /api/auth/verify-otp` — Verify OTP → Get Reset Token

**No Auth Required**

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `email` | string | `@IsEmail()` |
| `otp` | string | `@Length(6, 6)` |

**Service Logic:**
1. Find user by email in tenant schema
2. If not found → `400 "Invalid OTP"`
3. Query valid OTPs: `SELECT id, otp_hash FROM password_reset_otps WHERE user_id = $1 AND used = FALSE AND expires_at > NOW() ORDER BY created_at DESC LIMIT 5`
4. Bcrypt compare provided OTP against each hash
5. If no match → `400 "Invalid or expired OTP"`
6. Mark matched OTP as `used = TRUE`
7. Generate a short-lived reset token (JWT, 15 min): payload `{ userId, tenantId, schemaName, purpose: 'password_reset', type: 'tenant' }`
8. Return `{ success: true, data: { resetToken } }`

---

### 4.6 `POST /api/auth/reset-password` — Reset Password with Token

**No Auth Required**

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `resetToken` | string | `@IsNotEmpty()` |
| `newPassword` | string | Min 8 chars, 1 upper, 1 lower, 1 number, 1 special char |

**Service Logic:**
1. Verify and decode `resetToken` JWT
2. Validate `purpose === 'password_reset'` and `type === 'tenant'`
3. Set `search_path` to `schemaName` from token payload
4. Hash new password (bcrypt, 12 rounds)
5. Update user: `SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW()`
6. Invalidate ALL sessions: `DELETE FROM user_sessions WHERE user_id = $1`
7. Mark all remaining OTPs as used: `UPDATE password_reset_otps SET used = TRUE WHERE user_id = $1 AND used = FALSE`
8. Return `{ success: true, data: { message: "Password reset successfully. Please log in." } }`

---

### 4.7 `POST /api/auth/force-change-password` — First Login Forced Reset

**Auth Required:** `TenantAuthGuard`

This endpoint is called when `mustResetPassword = true`. The user already has a valid JWT from login but must change password before doing anything else.

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `newPassword` | string | Min 8 chars, 1 upper, 1 lower, 1 number, 1 special char |

**Service Logic:**
1. Extract `userId` and `schemaName` from JWT
2. Verify `must_reset_password = TRUE` for this user (if already false, return `400 "Password change not required"`)
3. Hash new password
4. Update user: `SET password_hash = $1, must_reset_password = FALSE, updated_at = NOW()`
5. Return `{ success: true, data: { message: "Password updated successfully." } }`

**Note:** This does NOT invalidate the current session — the user stays logged in with the same token. Their next token refresh will have `mustResetPassword: false`.

---

### 4.8 `POST /api/auth/re-authenticate` — Compensation Re-Auth

**Auth Required:** `TenantAuthGuard`

Used before accessing the Compensation module. Returns a short-lived token that must be included as `X-Compensation-Token` header on all compensation API calls.

**Request Body:**

| Field | Type | Validation |
|---|---|---|
| `password` | string | `@IsNotEmpty()` |

**Service Logic:**
1. Extract `userId` and `schemaName` from JWT
2. Load user's `password_hash` from tenant schema
3. Bcrypt compare → if mismatch → `401 "Invalid password"`
4. Generate `compensationAccessToken` (JWT, 5 min TTL): payload `{ userId, tenantId, schemaName, purpose: 'compensation_access', type: 'tenant' }`
5. Return `{ success: true, data: { compensationAccessToken, expiresIn: 300 } }`

**Frontend Usage:** Store in memory (not localStorage). Pass as `X-Compensation-Token` header on compensation API calls. When expired, prompt re-auth modal. Compensation guard implementation is deferred to the Compensation module sprint.

---

### 4.9 `GET /api/auth/me` — Get Current User

**Auth Required:** `TenantAuthGuard`

**Service Logic:**
1. Extract `userId` and `schemaName` from JWT
2. Query user profile + roles: `SELECT u.*, array_agg(r.name) as roles FROM users u LEFT JOIN user_roles ur ON u.id = ur.user_id LEFT JOIN roles r ON ur.role_id = r.id WHERE u.id = $1 GROUP BY u.id`
3. Return user data (exclude `password_hash`)

**Response:**
```
{
  success: true,
  data: {
    id, email, firstName, lastName, displayName, phone, photoUrl,
    emailDomainType, status, mustResetPassword, lastLoginAt,
    roles: ["Admin", "HR Manager"],
    permissions: ["leave:approve:leave_requests", ...]
  }
}
```

---

## 5. Tenant JWT Strategy & Guard

### 5.1 `TenantJwtStrategy`

- Strategy name: `'tenant-jwt'`
- Extracts token from `Authorization: Bearer <token>` header
- Secret: env `TENANT_JWT_ACCESS_SECRET` (separate from `PLATFORM_JWT_ACCESS_SECRET`)
- On validate:
  - Check `payload.type === 'tenant'` — reject if not
  - Return `{ userId, tenantId, schemaName, roles, permissions, type }` → attached as `req.user`

### 5.2 `TenantAuthGuard`

- Extends `AuthGuard('tenant-jwt')`
- On failure: return `401 "Authentication required"`
- Used on all tenant-scoped endpoints that require login

### 5.3 JWT Secret Environment Variables

Add to `backend/.env`:

```
TENANT_JWT_ACCESS_SECRET=your-tenant-access-secret-change-in-production
TENANT_JWT_REFRESH_SECRET=your-tenant-refresh-secret-change-in-production
```

These MUST be different from the platform JWT secrets (`PLATFORM_JWT_ACCESS_SECRET`, `PLATFORM_JWT_REFRESH_SECRET`) to ensure platform and tenant tokens are cryptographically incompatible.

### 5.4 Token Isolation Guarantee

With separate secrets:
- A `type: 'platform'` token signed with `PLATFORM_JWT_ACCESS_SECRET` → fails verification against `TENANT_JWT_ACCESS_SECRET` → `TenantAuthGuard` rejects it
- A `type: 'tenant'` token signed with `TENANT_JWT_ACCESS_SECRET` → fails verification against `PLATFORM_JWT_ACCESS_SECRET` → `PlatformAuthGuard` rejects it
- Even if someone forges the `type` field, the signature won't match the wrong secret

---

## 6. Rate Limiting

### 6.1 Global Configuration

Use `@nestjs/throttler` module. Register in `AppModule`:
- Default global limit: **100 requests per 60 seconds per IP** (general API protection)

### 6.2 Auth-Specific Rate Limits

Apply stricter limits on auth endpoints using `@Throttle()` decorator overrides:

| Endpoint | Limit | Window | Purpose |
|---|---|---|---|
| `POST /api/auth/login` | 5 requests | 5 minutes | Brute-force prevention (PRD 7.5) |
| `POST /api/auth/forgot-password` | 3 requests | 15 minutes | OTP abuse prevention |
| `POST /api/auth/verify-otp` | 5 requests | 5 minutes | OTP brute-force prevention |
| `POST /api/auth/reset-password` | 3 requests | 15 minutes | Reset abuse prevention |
| `POST /api/auth/re-authenticate` | 5 requests | 5 minutes | Compensation re-auth brute-force |
| `POST /api/platform/auth/login` | 5 requests | 5 minutes | Platform brute-force (apply retroactively to Sprint 1C) |
| `POST /api/platform/auth/forgot-password` | 3 requests | 15 minutes | Platform OTP abuse |

### 6.3 Throttle Response

When rate limit exceeded, return:
```
{
  success: false,
  error: {
    code: "RATE_LIMIT_EXCEEDED",
    message: "Too many requests. Please try again in X seconds."
  }
}
```
HTTP status: `429 Too Many Requests`

### 6.4 Retroactive: Apply to Platform Auth (Sprint 1C)

Add `@Throttle()` decorators to `PlatformAuthController` endpoints:
- `platform/auth/login` → 5 per 5 min
- `platform/auth/forgot-password` → 3 per 15 min
- `platform/auth/verify-otp` → 5 per 5 min

---

## 7. Session Cleanup

### 7.1 Extend the Cleanup Cron from Sprint 1C

The `SessionCleanupService` (built in Sprint 1C) currently only cleans platform sessions. Extend it to also clean expired tenant sessions across all tenant schemas:

**Additional Logic:**
1. Query all active tenant schemas: `SELECT schema_name FROM platform.tenants WHERE status != 'cancelled'`
2. For each schema:
   - `DELETE FROM "{schema}".user_sessions WHERE expires_at < NOW()`
   - `DELETE FROM "{schema}".password_reset_otps WHERE expires_at < NOW() OR used = TRUE`
3. Log count of cleaned records

---

## 8. Frontend Specification

### 8.1 Login Page — `/(auth)/login`

**Layout:** Blank layout (no sidebar/header). Centered card on light background. Brand logo at top.

**Visual distinction from platform login:** Different subtitle text ("Sign in to your organization" vs "Platform Admin"), different accent color treatment, or a small org badge if the tenant name is known.

**Form Fields:**
- Email (email input, required)
- Password (password input, required)
- "Forgot password?" link → navigates to `/forgot-password`
- Submit button: "Sign In"

**Submit Behavior:**
1. Call `POST /api/auth/login` (include tenant header `X-Tenant-Slug` or `X-Tenant-ID` for localhost dev)
2. On success:
   - Store `accessToken` and `refreshToken` in localStorage (or Zustand + localStorage)
   - Update `useAuthStore` with user data
   - If `user.mustResetPassword === true` → redirect to `/force-change-password`
   - Else → redirect to `/dashboard`
3. On 401 → show error: "Invalid email or password"
4. On 403 (tenant suspended/cancelled) → show error from response message
5. On 429 → show error: "Too many login attempts. Please try again later."

### 8.2 Forgot Password Page — `/(auth)/forgot-password`

**Multi-step flow in a single page (same pattern as Sprint 1C platform forgot password):**

**Step 1 — Enter Email:**
- Email input
- "Send OTP" button → calls `POST /api/auth/forgot-password`
- On success → advance to Step 2

**Step 2 — Enter OTP:**
- 6-digit OTP input (numeric only, centered, large text, tracking-widest)
- "Verify OTP" button → calls `POST /api/auth/verify-otp`
- "Resend OTP" link → goes back to Step 1 (calls forgot-password again)
- On success → advance to Step 3 (store `resetToken` in component state)

**Step 3 — New Password:**
- New password input (with strength meter + validation hints)
- "Reset Password" button → calls `POST /api/auth/reset-password`
- On success → show success message + "Back to Login" button

### 8.3 Force Change Password Page — `/(auth)/force-change-password`

**Accessible only when authenticated with `mustResetPassword = true`.**

**Content:**
- Heading: "Set Your New Password"
- Message: "For security, you need to change your password before continuing."
- New password input (with strength meter)
- Confirm password input
- "Update Password" button → calls `POST /api/auth/force-change-password`
- On success → redirect to `/dashboard`

**Route Protection:** If user navigates here but `mustResetPassword = false`, redirect to `/dashboard`. If user is not authenticated, redirect to `/login`.

### 8.4 Auth API Helper

**File:** `frontend/src/services/auth.ts`

Export functions:
- `login(email, password)` → `POST /api/auth/login`
- `refresh(refreshToken)` → `POST /api/auth/refresh`
- `logout(refreshToken?)` → `POST /api/auth/logout`
- `forgotPassword(email)` → `POST /api/auth/forgot-password`
- `verifyOtp(email, otp)` → `POST /api/auth/verify-otp`
- `resetPassword(resetToken, newPassword)` → `POST /api/auth/reset-password`
- `forceChangePassword(newPassword)` → `POST /api/auth/force-change-password`
- `reAuthenticate(password)` → `POST /api/auth/re-authenticate`
- `me()` → `GET /api/auth/me`

### 8.5 Client-Side Route Protection Hook

**File:** `frontend/src/lib/auth-guard.tsx`

Create a `useRequireAuth()` hook or `<RequireAuth>` wrapper component:

**Behavior:**
1. Check `useAuthStore` for `isAuthenticated`
2. If not authenticated → redirect to `/login`
3. If authenticated and `user.mustResetPassword === true` and current route is NOT `/force-change-password` → redirect to `/force-change-password`
4. Otherwise → render children

This hook will be used by the tenant layout in Sprint 1H to protect all `(tenant)` routes.

### 8.6 Axios Interceptor for Token Refresh

**Update** `frontend/src/services/api.ts`:

Add a response interceptor:
1. On `401` response (access token expired)
2. Attempt to refresh using stored `refreshToken`
3. If refresh succeeds → retry original request with new access token
4. If refresh fails → clear auth state, redirect to `/login`
5. Queue concurrent requests during refresh (avoid multiple refresh calls)

---

## 9. Environment Variable Additions

Add to `backend/.env`:

```
# Tenant Auth JWT (separate from Platform)
TENANT_JWT_ACCESS_SECRET=tenant-access-secret-min-32-chars-change-in-production
TENANT_JWT_REFRESH_SECRET=tenant-refresh-secret-min-32-chars-change-in-production

# Shared JWT config
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
```

Add to `backend/.env.example` (same keys, placeholder values).

---

## 10. Verification & Acceptance Criteria

### API Tests

**Test 1: Tenant Login**
```
POST /api/auth/login
Headers: X-Tenant-Slug: acme-corp  (or X-Tenant-ID: <uuid>)
Body: { "email": "john@acme.com", "password": "Admin@123" }
→ 200: { accessToken, refreshToken, user: { id, email, roles: ["Admin"], mustResetPassword: true } }
```

**Test 2: Tenant Token Rejected by Platform Guard**
```
GET /api/platform/auth/me
Headers: Authorization: Bearer <tenant_access_token>
→ 401 Unauthorized (token signed with wrong secret)
```

**Test 3: Platform Token Rejected by Tenant Guard**
```
GET /api/auth/me
Headers: Authorization: Bearer <platform_access_token>, X-Tenant-Slug: acme-corp
→ 401 Unauthorized
```

**Test 4: Refresh Token Rotation**
```
POST /api/auth/refresh
Headers: X-Tenant-Slug: acme-corp
Body: { "refreshToken": "<token_from_login>" }
→ 200: { accessToken, refreshToken }  (new pair)

POST /api/auth/refresh (same old token again)
→ 401 (old token invalidated)
```

**Test 5: Forced Password Change**
```
POST /api/auth/force-change-password
Headers: Authorization: Bearer <token>, X-Tenant-Slug: acme-corp
Body: { "newPassword": "NewSecure@123" }
→ 200: { message: "Password updated successfully." }

Verify in DB: SELECT must_reset_password FROM tenant_acme_corp.users WHERE email = 'john@acme.com';
→ must_reset_password = false
```

**Test 6: Password Reset via OTP Flow**
```
POST /api/auth/forgot-password
Headers: X-Tenant-Slug: acme-corp
Body: { "email": "john@acme.com" }
→ 200 (check email for OTP)

POST /api/auth/verify-otp
Body: { "email": "john@acme.com", "otp": "<6_digits>" }
→ 200: { resetToken }

POST /api/auth/reset-password
Body: { "resetToken": "<token>", "newPassword": "AnotherP@ss1" }
→ 200 (all sessions invalidated)
```

**Test 7: Rate Limiting**
```
Send 6 rapid POST /api/auth/login requests with wrong password
→ First 5: 401
→ 6th: 429 Too Many Requests
```

**Test 8: Suspended Tenant Blocked**
```
Manually: UPDATE platform.tenants SET status = 'suspended' WHERE slug = 'acme-corp';

POST /api/auth/login
Headers: X-Tenant-Slug: acme-corp
Body: { "email": "john@acme.com", "password": "..." }
→ 403: "Your organization's account has been suspended..."
(blocked by TenantMiddleware before reaching auth controller)
```

**Test 9: Inactive User Blocked**
```
Manually: UPDATE tenant_acme_corp.users SET status = 'inactive' WHERE email = 'john@acme.com';

POST /api/auth/login
Headers: X-Tenant-Slug: acme-corp
Body: { "email": "john@acme.com", "password": "..." }
→ 401: "Your account is not active..."
```

**Test 10: Compensation Re-Auth**
```
POST /api/auth/re-authenticate
Headers: Authorization: Bearer <token>, X-Tenant-Slug: acme-corp
Body: { "password": "NewSecure@123" }
→ 200: { compensationAccessToken, expiresIn: 300 }
```

### Frontend Tests

- [ ] `/login` renders with brand styling, distinct from platform login
- [ ] Login with valid credentials → redirects to `/dashboard` (or `/force-change-password` if `mustResetPassword`)
- [ ] Login with invalid credentials → shows "Invalid email or password"
- [ ] Login to suspended tenant → shows suspension message
- [ ] "Forgot password?" link works → OTP flow completes through all 3 steps
- [ ] Force change password page blocks navigation until password updated
- [ ] After force change → redirects to `/dashboard`
- [ ] Axios interceptor auto-refreshes on 401 and retries request

### Full Checklist

- [ ] Tenant login validates against tenant schema `users` table — never platform
- [ ] Login blocked if `platform.tenants.status` is `suspended` or `cancelled`
- [ ] Login blocked if `users.status` is not `active`
- [ ] Access token payload contains `{ userId, tenantId, schemaName, roles, permissions, type: 'tenant' }`
- [ ] Access token expires in 15 minutes
- [ ] Refresh token expires in 7 days
- [ ] Refresh token rotation: old token invalid after use
- [ ] Session stored in tenant `user_sessions` with device info
- [ ] Platform JWT rejected by `TenantAuthGuard` (different secret)
- [ ] Tenant JWT rejected by `PlatformAuthGuard` (different secret)
- [ ] Rate limit: 5 login attempts per 5 minutes per IP → 429
- [ ] Rate limit: 3 forgot-password requests per 15 minutes per IP → 429
- [ ] Global rate limit: 100 requests per 60 seconds per IP
- [ ] Forgot password sends 6-digit OTP via email
- [ ] OTP expires after 10 minutes, single use only
- [ ] Password reset invalidates ALL user sessions
- [ ] Forced password change works on first login (`must_reset_password`)
- [ ] After forced change, `must_reset_password` set to `FALSE`
- [ ] Compensation re-auth returns 5-minute token
- [ ] `GET /api/auth/me` returns user profile with roles and permissions
- [ ] Expired platform sessions AND tenant sessions cleaned by daily cron
- [ ] All 9 tenant auth endpoints appear in Swagger docs
- [ ] Retroactive: Platform auth endpoints also rate-limited

---

*Sprint 1E Complete. Next: Sprint 1F — RBAC Engine*
