# Sprint 2C — Tenant Account Management Pages

## Goal
Build the six tenant-level account management pages that every user can access: Profile (personal info, email, phone, photo upload), Security (change password, device sign-ins), Sessions (active sessions with revoke), Settings (user display preferences), Privacy (data contacts, personal/org details), and Organization (org info + subscription, read-only for non-admins). These pages live under `/account/*` in the `(tenant)` route group and use a dedicated account sidebar layout (inspired by the reference screenshots). All API endpoints are self-service — users manage their own account data.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `users` table with profile fields | 1A | ✅ |
| `user_sessions` table with device_info JSONB | 1A | ✅ |
| `password_reset_otps` table | 1A | ✅ |
| `organization_settings` table (org-level timezone, date format, currency) | 1A | ✅ |
| `file_storage` table + `FileStorageService` | 1A / 1G | ✅ |
| `PUT /api/account/change-password` (PRD 7.4) | — | ❌ Needs building |
| `GET /api/account/profile` (PRD 7.4) | — | ❌ Needs building |
| `PUT /api/account/profile` (PRD 7.4) | — | ❌ Needs building |
| `PUT /api/account/profile/photo` (PRD 7.4) | — | ❌ Needs building |
| `GET /api/account/sessions` (PRD 7.4) | — | ❌ Needs building |
| `DELETE /api/account/sessions/:id` (PRD 7.4) | — | ❌ Needs building |

---

## 2. Schema Addition: `user_preferences` Table

The existing schema has no user-level preferences. The `organization_settings` table holds org-level defaults, but users need their own overrides for display preferences. Add a new table to the tenant schema.

### 2.1 Prisma Model

```
model UserPreference {
  id                   String   @id @default(uuid()) @db.Uuid
  userId               String   @unique @map("user_id") @db.Uuid
  dateFormat           String?  @map("date_format") @db.VarChar(20)      // null = use org default
  timezone             String?  @db.VarChar(50)                           // null = use org default
  language             String   @default("en") @db.VarChar(10)
  profilePictureVisibility String @default("everyone") @map("profile_picture_visibility") @db.VarChar(20) // 'everyone' | 'organization' | 'nobody'
  newSignInAlert       Boolean  @default(true) @map("new_sign_in_alert")
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_preferences")
}
```

Add the relation to the `User` model:
```
userPreference  UserPreference?
```

### 2.2 Tenant DDL Addition

Add to `setup-tenant-schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_format VARCHAR(20),
  timezone VARCHAR(50),
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  profile_picture_visibility VARCHAR(20) NOT NULL DEFAULT 'everyone',
  new_sign_in_alert BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 2.3 Provisioning Seed Update

During tenant provisioning (Sprint 1B), after creating the admin user, also create a default `user_preferences` row for them (all nulls → falls back to org defaults). This should be added to the provisioning seed logic.

---

## 3. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/account/account.module.ts` | NestJS module |
| `src/account/account.controller.ts` | Account API endpoints |
| `src/account/account.service.ts` | Account management logic |
| `src/account/dto/update-profile.dto.ts` | DTO for profile update |
| `src/account/dto/change-password.dto.ts` | DTO for password change |
| `src/account/dto/update-preferences.dto.ts` | DTO for preferences update |
| `src/account/dto/update-privacy-details.dto.ts` | DTO for privacy details update |
| `src/account/dto/index.ts` | Barrel export |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/account/layout.tsx` | Account pages layout with account sidebar |
| `src/app/(tenant)/account/profile/page.tsx` | Profile page |
| `src/app/(tenant)/account/security/page.tsx` | Security page |
| `src/app/(tenant)/account/sessions/page.tsx` | Sessions page |
| `src/app/(tenant)/account/settings/page.tsx` | Settings page |
| `src/app/(tenant)/account/privacy/page.tsx` | Privacy page |
| `src/app/(tenant)/account/organization/page.tsx` | Organization page |
| `src/components/layout/account-sidebar.tsx` | Account section sidebar navigation |
| `src/services/account.ts` | Account API helpers |

### Module Registration
- Import `AccountModule` into `AppModule`
- All routes under `/api/account/*` — tenant-scoped, require `TenantAuthGuard`
- No `@RequirePermission()` needed — all endpoints operate on the authenticated user's own data

---

## 4. Account Layout

### 4.1 Account Sidebar

Reference: `accounts_profile.png` — the screenshots show a dedicated sidebar for account pages, separate from the main tenant sidebar.

**Implementation:** When navigating to any `/account/*` route, the page uses a nested layout with its own sidebar inside the main tenant shell's content area. The main tenant sidebar still shows (with "Account" or user avatar highlighted), and the account sidebar appears in the content area on the left.

**Account Sidebar Items:**

| Icon | Label | Route | Sub-items |
|---|---|---|---|
| `User` | Profile | `/account/profile` | Personal Information, Email Address, Mobile Numbers (scroll anchors) |
| `Shield` | Security | `/account/security` | Password, Device Sign-ins (scroll anchors) |
| `Monitor` | Sessions | `/account/sessions` | Active Sessions (scroll anchor) |
| `Settings` | Settings | `/account/settings` | Preferences, Notifications (scroll anchors) |
| `Lock` | Privacy | `/account/privacy` | Personal Details, Organization Details (scroll anchors) |
| `Building2` | Organization | `/account/organization` | Organization Info, Subscription (scroll anchors) |

**Active state:** Same brand color pattern as main sidebar. Sub-items are anchor links that scroll to the corresponding section on the page.

---

## 5. API Specification

All endpoints are tenant-scoped (`TenantAuthGuard`). Controller prefix: `account`. All operate on `req.user.userId` — no `:id` parameter needed (self-service only).

### 5.1 `GET /api/account/profile` — Get Own Profile

**Service Logic:**
1. Set search_path to tenant schema
2. Query user + employee profile + preferences:
```sql
SELECT u.id, u.email, u.first_name, u.last_name, u.display_name,
       u.phone, u.photo_url, u.email_domain_type, u.status, u.created_at,
       ep.gender, ep.date_of_birth, ep.marital_status,
       up.date_format, up.timezone, up.language, up.profile_picture_visibility
FROM users u
LEFT JOIN employee_profiles ep ON u.id = ep.user_id
LEFT JOIN user_preferences up ON u.id = up.user_id
WHERE u.id = $1
```
3. Get org defaults from `organization_settings` for fallback display

**Response:**
```
{
  success: true,
  data: {
    id, email, firstName, lastName, displayName, phone, photoUrl,
    emailDomainType, status, createdAt,
    personal: {
      gender, dateOfBirth, maritalStatus
    },
    preferences: {
      dateFormat,          // user override or null (frontend shows org default)
      timezone,            // user override or null
      language,
      profilePictureVisibility
    },
    orgDefaults: {
      dateFormat: "DD-MMM-YYYY",
      timezone: "UTC",
      currency: "USD"
    }
  }
}
```

---

### 5.2 `PUT /api/account/profile` — Update Profile

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `firstName` | string | `@IsOptional()`, `@MaxLength(100)` | No |
| `lastName` | string | `@IsOptional()`, `@MaxLength(100)` | No |
| `displayName` | string | `@IsOptional()`, `@MaxLength(100)` | No |
| `phone` | string | `@IsOptional()`, `@MaxLength(20)` | No |
| `gender` | string | `@IsOptional()`, `@IsIn(['male', 'female', 'other', 'prefer_not_to_say'])` | No |
| `dateOfBirth` | string | `@IsOptional()`, `@IsDateString()` | No |
| `maritalStatus` | string | `@IsOptional()`, `@IsIn(['single', 'married', 'divorced', 'widowed'])` | No |

**Service Logic:**
1. Update `users` table: `first_name`, `last_name`, `display_name`, `phone`
2. Update `employee_profiles` table: `gender`, `date_of_birth`, `marital_status`
3. If employee_profiles row doesn't exist for this user → skip personal fields (user may not have an employee profile yet if they're a standalone admin)
4. Return updated profile

**Note:** `email` is NOT editable through this endpoint. Email changes would require verification flow — out of scope for v1.

---

### 5.3 `PUT /api/account/profile/photo` — Upload Profile Photo

**Content-Type:** `multipart/form-data`

**Body:** `photo` field — image file (JPEG, PNG, WebP)

**Service Logic:**
1. Validate file: must be image (`image/jpeg`, `image/png`, `image/webp`), max 5 MB
2. If user already has a photo → delete old file from `file_storage` via `FileStorageService`
3. Upload new photo via `FileStorageService.upload()` with context `'profile_photo'`, `contextId = userId`
4. Get the access URL from `FileStorageService.getUrl()`
5. Update `users.photo_url` with the URL
6. Return `{ photoUrl: "..." }`

**Delete variant:** `DELETE /api/account/profile/photo`
1. If `photo_url` is null → `400 "No profile photo to delete"`
2. Delete file from storage
3. Set `users.photo_url = NULL`

---

### 5.4 `PUT /api/account/change-password` — Change Password

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `currentPassword` | string | `@IsNotEmpty()` | Yes |
| `newPassword` | string | Min 8 chars, 1 upper, 1 lower, 1 number, 1 special | Yes |

**Service Logic:**
1. Fetch user's `password_hash` from `users` table
2. Bcrypt compare `currentPassword` against stored hash
3. If mismatch → `400 "Current password is incorrect"`
4. If `newPassword === currentPassword` → `400 "New password must be different from current password"`
5. Hash new password (bcrypt, 12 rounds)
6. Update `users.password_hash`
7. Set `users.must_reset_password = FALSE` (in case it was still true)
8. Invalidate all OTHER sessions (keep current session): `DELETE FROM user_sessions WHERE user_id = $1 AND id != $currentSessionId`
9. Return `{ message: "Password changed successfully. Other sessions have been signed out." }`

**How to identify current session:** The `currentSessionId` can be derived from the refresh token — during login (Sprint 1E), the session ID is either stored in the JWT payload or the refresh token can be matched. For simplicity, pass the current session ID as part of the JWT access token payload. 

**Retroactive Sprint 1E update:** Add `sessionId` to the tenant JWT access token payload so the change-password endpoint can identify which session to keep.

---

### 5.5 `GET /api/account/sessions` — List Active Sessions

**Service Logic:**
```sql
SELECT id, device_info, created_at, expires_at
FROM user_sessions
WHERE user_id = $1 AND expires_at > NOW()
ORDER BY created_at DESC
```

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      deviceInfo: { browser: "Chrome 121", os: "Windows 11", ip: "203.0.113.1", location: "Mumbai, India" },
      createdAt,
      expiresAt,
      isCurrent: true   // true if session ID matches the one in req.user.sessionId
    },
    ...
  ]
}
```

**`isCurrent` flag:** Compare each session's ID against `req.user.sessionId` (from the JWT). The current session is marked so the frontend can label it "Current Session" and prevent revocation.

---

### 5.6 `DELETE /api/account/sessions/:id` — Revoke a Session

**Path Param:** `id` (UUID — session ID)

**Service Logic:**
1. Find session: `SELECT id, user_id FROM user_sessions WHERE id = $1 AND user_id = $2`
2. If not found → `404 "Session not found"`
3. If `id === req.user.sessionId` → `400 "Cannot revoke your current session. Use logout instead."`
4. Delete the session row
5. Return `{ message: "Session revoked" }`

---

### 5.7 `GET /api/account/preferences` — Get User Preferences

**Service Logic:**
1. Query `user_preferences` where `user_id = $1`
2. If no row exists → return defaults (date_format: null, timezone: null, language: 'en', etc.)
3. Also fetch `organization_settings` for fallback display

**Response:**
```
{
  success: true,
  data: {
    preferences: { dateFormat, timezone, language, profilePictureVisibility, newSignInAlert },
    orgDefaults: { dateFormat: "DD-MMM-YYYY", timezone: "UTC" }
  }
}
```

---

### 5.8 `PUT /api/account/preferences` — Update User Preferences

**Request Body (DTO):**

| Field | Type | Validation | Required |
|---|---|---|---|
| `dateFormat` | string | `@IsOptional()`, `@IsIn(['DD-MMM-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])` | No |
| `timezone` | string | `@IsOptional()`, valid IANA timezone | No |
| `language` | string | `@IsOptional()`, `@IsIn(['en'])` (expand later) | No |
| `profilePictureVisibility` | string | `@IsOptional()`, `@IsIn(['everyone', 'organization', 'nobody'])` | No |
| `newSignInAlert` | boolean | `@IsOptional()`, `@IsBoolean()` | No |

**Service Logic:**
1. Upsert `user_preferences`: if row exists for user → update, if not → create
2. Setting a field to `null` means "use organization default"
3. Return updated preferences

---

### 5.9 `GET /api/account/organization` — Get Organization Info

**Service Logic:**
1. Fetch org settings from `organization_settings` table
2. Fetch tenant info from `platform.tenants` by `req.user.tenantId` (cross-schema query to platform)
3. Combine into response

**Response:**
```
{
  success: true,
  data: {
    organization: {
      name,
      slug,
      customDomain,
      defaultTimezone,
      dateFormat,
      financialYearStartMonth,
      defaultCurrency
    },
    subscription: {
      tier,
      maxUsers,
      currentUserCount,
      status,
      trialEndsAt
    }
  }
}
```

**Authorization note:** All authenticated users can view this. No permission check needed.

### 5.10 `PUT /api/account/organization` — Update Organization Settings (Admin Only)

**Auth:** `TenantAuthGuard` + `@RequirePermission('settings', 'edit', 'organization')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `orgName` | string | `@IsOptional()`, `@MaxLength(255)` | No |
| `defaultTimezone` | string | `@IsOptional()`, valid IANA timezone | No |
| `dateFormat` | string | `@IsOptional()`, `@IsIn([...])` | No |
| `financialYearStartMonth` | number | `@IsOptional()`, `@Min(1)`, `@Max(12)` | No |
| `defaultCurrency` | string | `@IsOptional()`, ISO 4217 code | No |

**Service Logic:**
1. Update `organization_settings` fields
2. If `orgName` changed → also update `platform.tenants.name` (cross-schema)
3. Return updated settings

---

## 6. Frontend: Account Pages

### 6.1 Profile Page — `/account/profile`

Reference: `accounts_profile.png`

**Layout:** Vertical stack of card sections.

**Section 1: Profile Header (card)**
- Left: Avatar (large, clickable to change photo). If no photo → initials with brand background.
- Center: Full name + email
- Right: "Edit" button → toggles all sections into edit mode

**Section 2: Personal Information (card)**
Display mode (default):

| Label | Value |
|---|---|
| Full Name | `{firstName} {lastName}` |
| Display Name | `{displayName}` or "Not set" |
| Gender | `{gender}` or "Not set" |
| Country/Region | Derived from timezone (display only) |
| State | Derived from timezone (display only) |
| Language | `{language}` |
| Time zone | `{timezone}` or org default with "(Organization default)" label |

Edit mode: inline form fields replace the display values. "Save" and "Cancel" buttons at bottom.

**Section 3: My Email Addresses (card)**
- Shows current email with verified icon
- "Add Email Address" link — out of scope for v1 (show as disabled with tooltip "Coming soon")
- Description: "View and manage the email addresses associated with your account."

**Section 4: My Mobile Numbers (card)**
- Shows current phone number (if set)
- "Add Mobile Number" link — for v1, editing phone number is handled in the Personal Information edit mode
- Description: "View and manage all of the mobile numbers associated with your account."

**Photo Upload:**
- Click avatar → file picker (accept `image/jpeg, image/png, image/webp`)
- Preview selected image before upload
- "Upload" and "Cancel" buttons
- Call `PUT /api/account/profile/photo`
- Show loading spinner during upload
- On success → update avatar everywhere (header, profile page)

### 6.2 Security Page — `/account/security`

Reference: `accounts_security.png`

**Section 1: Password (card)**
- Shows: "Last changed {relative date}" or "Never changed"
- "Change Password" button → expands inline form:
  - Current Password (password input with show/hide toggle)
  - New Password (password input with strength indicator)
  - Confirm New Password (must match)
  - "Update Password" and "Cancel" buttons
- Call `PUT /api/account/change-password`
- On success: show success message "Password changed. Other sessions have been signed out."

**Section 2: Device Sign-ins (card)**
- Shows list of recent sessions/devices (from `GET /api/account/sessions`)
- Each entry: device icon (Desktop/Mobile) + device name (browser + OS) + location + "Current Device" badge if applicable
- This is a read-only view on the security page — management happens on the Sessions page
- "Manage Sessions" link → navigates to `/account/sessions`

**Out of Scope sections (visible in screenshot but not in our PRD):**
- Geo-fencing → not applicable
- Allowed IP Address → not applicable
- Application-Specific Passwords → not applicable
- These sections should NOT be rendered. Our security page only has Password + Device Sign-ins.

### 6.3 Sessions Page — `/account/sessions`

Reference: `accounts_sessions.png`

**Section 1: Active Sessions (card)**
- Description: "View and manage all of your active sessions."
- List of sessions from `GET /api/account/sessions`

**Each session row:**
- Left: Device icon (Monitor for desktop, Smartphone for mobile — detect from `device_info.os`)
- Center: Device name (`{browser} on {os}`), location (`{location}`), created date (relative)
- Right: "Current Session" badge (green, non-revokable) OR "Revoke" button (red text)

**Revoke behavior:**
1. Click "Revoke" → `<ConfirmDialog>`:
   - Title: "Revoke Session"
   - Description: "This will sign out the device at **{location}** ({browser} on {os}). The user will need to log in again on that device."
   - Confirm: "Revoke"
   - Variant: destructive
2. Call `DELETE /api/account/sessions/{id}`
3. On success → remove from list, show toast

**Out of Scope sections (visible in screenshot):**
- Activity History → not applicable for v1
- Connected Apps → not applicable
- App Sign-Ins → not applicable

### 6.4 Settings Page — `/account/settings`

Reference: `accounts_settings.png`

**Section 1: Preferences (card)**

| Setting | Control | Description |
|---|---|---|
| Date Format | select dropdown | Options: `DD-MMM-YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`. Shows "(Organization default: {orgDefault})" hint. |
| Time zone | searchable select | IANA timezone list. Shows "(Organization default: {orgDefault})" hint. |
| Profile Picture Visibility | select dropdown | Options: "Everyone", "My Organization", "Nobody" |

**Section 2: Notifications (card)**

| Setting | Control | Description |
|---|---|---|
| New sign-in to account alert | toggle switch | Receive email alerts when signed in from a new device. Default: on. |

Each setting saves on change (auto-save with debounce, no submit button). Call `PUT /api/account/preferences` on each change. Show subtle "Saved" indicator.

**Out of Scope sections (visible in screenshot):**
- Authorized Websites → not applicable
- Linked Accounts → not applicable
- Close Account → not applicable for v1 (tenant cancellation is a platform admin action)

### 6.5 Privacy Page — `/account/privacy`

Reference: `accounts_privacy.png`

**Section 1: Personal Details (card)**
- Displays: Name, Email Address (read-only summary)
- "Edit Details" link → navigates to `/account/profile` (reuses profile edit)

**Section 2: Organization Details (card)**
- Displays: Organization name, slug
- For Admin users: "Edit Details" link → navigates to `/account/organization`
- For non-Admin users: read-only, no edit link

**Section 3: Contact Details (card)**
- Displays: phone number (if set)
- "Edit" link → navigates to `/account/profile`

This page is deliberately lightweight for v1. It's a summary view that links to the relevant edit pages. More granular data privacy controls (data export, deletion requests, consent management) are future enhancements.

### 6.6 Organization Page — `/account/organization`

Reference: `accounts_organizatipn.png`

**Section 1: Organization Info (card)**

| Label | Value |
|---|---|
| Organization Name | `{name}` |
| Slug | `{slug}` (monospace) |
| Custom Domain | `{customDomain}` or "Not configured" |
| Default Timezone | `{defaultTimezone}` |
| Date Format | `{dateFormat}` |
| Financial Year Start | Month name (e.g., "April") |
| Default Currency | `{defaultCurrency}` |

For Admin users: "Edit" button → inline edit mode for org settings. Calls `PUT /api/account/organization`.
For non-Admin users: all read-only, no edit button.

**Section 2: Subscription Info (card)**

| Label | Value |
|---|---|
| Plan | badge: "Standard" or "Standard + Recruitment" |
| User Seats | `{currentUserCount} / {maxUsers}` with progress bar |
| Status | colored badge |
| Trial Ends | date (if applicable) or "N/A" |

Always read-only. Subscription changes are managed by the platform super admin (Sprint 2A).

**Out of Scope sections (visible in screenshot):**
- SAML Authentication → not applicable for v1
- Domains → not applicable for v1

---

## 7. Retroactive Updates

### 7.1 Sprint 1E: Add `sessionId` to JWT Payload

The tenant access token payload (Sprint 1E Section 4.1) needs `sessionId`:

**Current payload:**
```
{ userId, tenantId, schemaName, roles, permissions, type: 'tenant' }
```

**Updated payload:**
```
{ userId, tenantId, schemaName, roles, permissions, type: 'tenant', sessionId }
```

The `sessionId` is the `user_sessions.id` created during login. This allows the change-password and sessions endpoints to identify the current session.

### 7.2 Sprint 1B: Seed `user_preferences` for Admin User

During tenant provisioning, after creating the admin user, insert a default `user_preferences` row:
```sql
INSERT INTO user_preferences (user_id) VALUES ($adminUserId);
```

All fields use defaults (null for date_format/timezone → falls back to org defaults).

---

## 8. API Helper

**File:** `src/services/account.ts`

Exports:
- `getProfile()` → `GET /api/account/profile`
- `updateProfile(data)` → `PUT /api/account/profile`
- `uploadPhoto(file)` → `PUT /api/account/profile/photo` (multipart FormData)
- `deletePhoto()` → `DELETE /api/account/profile/photo`
- `changePassword(data)` → `PUT /api/account/change-password`
- `getSessions()` → `GET /api/account/sessions`
- `revokeSession(id)` → `DELETE /api/account/sessions/{id}`
- `getPreferences()` → `GET /api/account/preferences`
- `updatePreferences(data)` → `PUT /api/account/preferences`
- `getOrganization()` → `GET /api/account/organization`
- `updateOrganization(data)` → `PUT /api/account/organization`

All use the tenant Axios instance.

---

## 9. Scope Boundaries

### In Scope (Sprint 2C)
- Account sidebar layout (nested within tenant shell)
- 6 account pages (Profile, Security, Sessions, Settings, Privacy, Organization)
- 11 API endpoints (profile CRUD, photo upload/delete, change password, sessions list/revoke, preferences get/update, org get/update)
- `user_preferences` table (new schema addition)
- Retroactive: `sessionId` in JWT payload, seed user_preferences on provisioning

### Out of Scope
| Feature | When |
|---|---|
| Email change with verification | Future enhancement |
| Multi-factor authentication | Future enhancement |
| Geo-fencing / IP restrictions | Not planned |
| Application-specific passwords | Not planned |
| Connected apps / App sign-ins | Not planned |
| Close account (self-service tenant deletion) | Not planned (platform admin action) |
| Activity history / audit log for own account | Future enhancement |
| SAML / SSO organization config | Future enhancement |
| Domain management | Future enhancement |
| Language i18n (only English for v1) | Future enhancement |

---

## 10. Verification & Acceptance Criteria

### API Tests

**Test 1: Get profile**
```
GET /api/account/profile
Headers: Authorization: Bearer <tenant_token>
→ 200: Full profile with personal info, preferences, org defaults
```

**Test 2: Update profile**
```
PUT /api/account/profile
Body: { "firstName": "Jane", "displayName": "JD", "phone": "+919876543210", "gender": "female" }
→ 200: Updated profile

Verify: users.first_name = 'Jane', employee_profiles.gender = 'female'
```

**Test 3: Photo upload**
```
PUT /api/account/profile/photo
Content-Type: multipart/form-data
Body: photo=<file.jpg>
→ 200: { photoUrl: "/api/files/download/{id}" }

Verify: file_storage has entry with context='profile_photo', users.photo_url updated

PUT /api/account/profile/photo
Body: photo=<10mb_file.jpg>
→ 400: "File exceeds maximum size"

PUT /api/account/profile/photo
Body: photo=<file.pdf>
→ 400: "Only image files are allowed"
```

**Test 4: Delete photo**
```
DELETE /api/account/profile/photo
→ 200: "Profile photo deleted"

Verify: users.photo_url = NULL, file_storage entry removed
```

**Test 5: Change password**
```
PUT /api/account/change-password
Body: { "currentPassword": "wrong", "newPassword": "NewPass@123" }
→ 400: "Current password is incorrect"

PUT /api/account/change-password
Body: { "currentPassword": "CurrentPass@123", "newPassword": "CurrentPass@123" }
→ 400: "New password must be different from current password"

PUT /api/account/change-password
Body: { "currentPassword": "CurrentPass@123", "newPassword": "NewSecure@456" }
→ 200: "Password changed successfully. Other sessions have been signed out."

Verify: Other sessions deleted, current session preserved
```

**Test 6: List sessions**
```
GET /api/account/sessions
→ 200: Array of sessions with device info, current session marked isCurrent: true
```

**Test 7: Revoke session**
```
DELETE /api/account/sessions/<other-session-id>
→ 200: "Session revoked"

DELETE /api/account/sessions/<current-session-id>
→ 400: "Cannot revoke your current session"
```

**Test 8: Preferences**
```
GET /api/account/preferences
→ 200: Preferences with org defaults

PUT /api/account/preferences
Body: { "dateFormat": "MM/DD/YYYY", "timezone": "Asia/Kolkata", "newSignInAlert": false }
→ 200: Updated preferences

PUT /api/account/preferences
Body: { "dateFormat": null }
→ 200: dateFormat reset to null (will use org default)
```

**Test 9: Organization info**
```
GET /api/account/organization
→ 200: Org settings + subscription info (any user)

PUT /api/account/organization
Headers: Authorization: Bearer <employee_token>
Body: { "orgName": "New Name" }
→ 403: Permission denied (employee lacks settings:edit:organization)

PUT /api/account/organization
Headers: Authorization: Bearer <admin_token>
Body: { "orgName": "Acme Industries", "defaultTimezone": "Asia/Kolkata" }
→ 200: Updated org settings
Verify: platform.tenants.name also updated to "Acme Industries"
```

### Frontend Tests

- [ ] Account sidebar renders with 6 items, correct active highlighting
- [ ] Sub-items scroll to the corresponding section on click
- [ ] Profile page: display mode shows all fields, edit mode toggles inline forms
- [ ] Avatar click opens file picker, photo preview before upload, upload + display
- [ ] Delete photo removes avatar, shows initials fallback
- [ ] Security page: "Change Password" expands inline form, strength indicator works
- [ ] Password change success shows message about other sessions signed out
- [ ] Device sign-ins section shows session list with device icons + location
- [ ] Sessions page: "Current Session" badge on current, "Revoke" button on others
- [ ] Revoke confirm dialog, session removed from list on success
- [ ] Settings page: date format + timezone + visibility + notification toggle
- [ ] Settings auto-save on change with "Saved" indicator
- [ ] Privacy page: summary cards with links to profile/organization edit
- [ ] Organization page: org info + subscription, edit button only for Admin role
- [ ] Non-admin users see read-only organization info, no edit button
- [ ] All pages responsive (mobile layout stacks cards vertically)

### Full Checklist

- [ ] `user_preferences` table added to Prisma schema + tenant DDL
- [ ] Provisioning seeds default `user_preferences` row for admin user
- [ ] `sessionId` added to tenant JWT access token payload (retroactive Sprint 1E update)
- [ ] Account layout with nested sidebar (6 items with scroll anchors)
- [ ] `GET /api/account/profile` — returns user + personal + preferences + org defaults
- [ ] `PUT /api/account/profile` — updates user + employee_profiles fields
- [ ] `PUT /api/account/profile/photo` — uploads photo via FileStorageService, validates type + size
- [ ] `DELETE /api/account/profile/photo` — deletes photo from storage + nulls URL
- [ ] `PUT /api/account/change-password` — validates current, hashes new, invalidates other sessions
- [ ] Cannot revoke current session via change-password (keeps current session alive)
- [ ] `GET /api/account/sessions` — lists active sessions with `isCurrent` flag
- [ ] `DELETE /api/account/sessions/:id` — revokes session (blocks current session revocation)
- [ ] `GET /api/account/preferences` — returns user prefs + org defaults
- [ ] `PUT /api/account/preferences` — upserts user preferences, null = use org default
- [ ] `GET /api/account/organization` — returns org settings + subscription (any user)
- [ ] `PUT /api/account/organization` — updates org settings (Admin only, `settings:edit:organization`)
- [ ] Org name change also updates `platform.tenants.name`
- [ ] Profile page: personal info display + edit, email/phone sections, photo upload
- [ ] Security page: change password with inline form, device sign-ins summary
- [ ] Sessions page: active sessions with current badge, revoke with confirm
- [ ] Settings page: preferences + notification toggles, auto-save
- [ ] Privacy page: summary view with links to edit pages
- [ ] Organization page: org info + subscription, admin-only edit
- [ ] All 11 endpoints in Swagger under "Account" tag

---

*Sprint 2C Complete. Next: Sprint 2D — Subscription Enforcement & Navigation Polish*
