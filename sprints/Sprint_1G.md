# Sprint 1G — Core Shared Services

## Goal
Build the seven cross-cutting backend services that every module depends on: File Storage (PostgreSQL BYTEA with abstraction interface), Email Service (abstraction over SMTP/SendGrid/SES), Notification Service + WebSocket gateway (Socket.IO), Export Utility (CSV, XLSX, PDF), Audit Log Service + `AuditInterceptor`, Response Interceptor (standard envelope), and Global Exception Filter. Also refactor direct nodemailer calls in Sprints 1C and 1D to use the new EmailService.

---

## 1. What Already Exists (From Previous Sprints)

| Component | Sprint | Status |
|---|---|---|
| `file_storage` table (Prisma + tenant DDL) | 1A | ✅ Schema exists |
| `email_config` table (Prisma + tenant DDL) | 1A | ✅ Schema exists |
| `notifications` table (Prisma + tenant DDL) | 1A | ✅ Schema exists |
| `notification_settings` table (Prisma + tenant DDL) | 1A | ✅ Schema exists |
| `audit_logs` table (Prisma + tenant DDL) | 1A | ✅ Schema exists |
| Direct nodemailer OTP email in PlatformAuthService | 1C | ⚠️ Needs refactor to EmailService |
| Direct nodemailer verification + welcome emails in RegistrationService | 1D | ⚠️ Needs refactor to EmailService |
| Direct nodemailer OTP email in tenant AuthService | 1E | ⚠️ Needs refactor to EmailService |

---

## 2. Files to Create

### Backend — Core Services
| File | Purpose |
|---|---|
| `src/core/core.module.ts` | NestJS module exporting all shared services |
| `src/core/file-storage/file-storage.service.ts` | File upload/download/delete with provider abstraction |
| `src/core/file-storage/file-storage.interface.ts` | `IFileStorageProvider` interface |
| `src/core/file-storage/providers/postgres.provider.ts` | PostgreSQL BYTEA implementation |
| `src/core/email/email.service.ts` | Email send/sendBulk with provider abstraction |
| `src/core/email/email.interface.ts` | `IEmailProvider` interface |
| `src/core/email/providers/smtp.provider.ts` | SMTP (nodemailer) implementation |
| `src/core/email/platform-email.service.ts` | Platform-level email (uses env vars, no tenant) |
| `src/core/notification/notification.service.ts` | Create, query, mark read, unread count |
| `src/core/notification/notification.controller.ts` | 4 notification API endpoints |
| `src/core/notification/notification.gateway.ts` | WebSocket gateway (Socket.IO) |
| `src/core/notification/dto/` | DTOs for notification endpoints |
| `src/core/export/export.service.ts` | CSV, XLSX, PDF generation |
| `src/core/audit/audit.service.ts` | Audit log creation + query |
| `src/core/audit/audit.controller.ts` | 2 audit log API endpoints |
| `src/core/audit/audit.interceptor.ts` | `AuditInterceptor` — auto-captures CUD operations |

### Backend — Global Interceptors & Filters
| File | Purpose |
|---|---|
| `src/common/interceptors/response.interceptor.ts` | Wraps all responses in `{ success, data, meta }` |
| `src/common/filters/global-exception.filter.ts` | Catches all exceptions → `{ success: false, error: { code, message, details } }` |

### Dependencies to Install
```
backend: npm install exceljs pdfkit json2csv @nestjs/websockets @nestjs/platform-socket.io socket.io
```

### Module Registration
- Import `CoreModule` into `AppModule` as a global module (`@Global()`)
- Register `ResponseInterceptor` as a global interceptor in `main.ts` (via `app.useGlobalInterceptors()`)
- Register `GlobalExceptionFilter` as a global filter in `main.ts` (via `app.useGlobalFilters()`)
- `AuditInterceptor` is NOT global — it's applied per-controller or per-method using `@UseInterceptors(AuditInterceptor)` where needed

---

## 3. File Storage Service

### 3.1 Interface: `IFileStorageProvider`

| Method | Signature | Description |
|---|---|---|
| `upload` | `(file: Buffer, metadata: FileMetadata) → Promise<{ id: string; url: string }>` | Store file, return ID |
| `download` | `(id: string) → Promise<{ data: Buffer; metadata: FileMetadata }>` | Retrieve file data |
| `delete` | `(id: string) → Promise<void>` | Remove file |
| `getUrl` | `(id: string) → Promise<string>` | Get access URL (for BYTEA: `/api/files/download/{id}`, for S3: pre-signed URL) |

**`FileMetadata` type:**
```
{
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;   // userId
  context?: string;     // 'profile_photo', 'resume', 'document', etc.
  contextId?: string;   // related entity UUID
}
```

### 3.2 PostgreSQL BYTEA Provider (v1 active implementation)

**Upload:** Insert into tenant schema `file_storage` table with `data = <Buffer>` as BYTEA.

**Download:** Select from `file_storage` by ID, return `data` column as Buffer.

**Delete:** Delete row from `file_storage` by ID.

**getUrl:** Returns internal API path: `/api/files/download/{id}` — the file is served by a controller endpoint that calls `download()` and streams the result.

### 3.3 Provider Selection

Read `FILE_STORAGE_PROVIDER` from env:
- `postgres` (default) → use `PostgresFileStorageProvider`
- `s3` → placeholder, throws "S3 provider not yet implemented" (future sprint)

### 3.4 File Size Limits

Configure in env:
- `MAX_FILE_SIZE_MB=10` (default 10 MB)
- Validate in service before storing. Reject with `400 "File exceeds maximum size of {MAX_FILE_SIZE_MB}MB"`

### 3.5 Environment Variables

```
FILE_STORAGE_PROVIDER=postgres
MAX_FILE_SIZE_MB=10
```

---

## 4. Email Service

### 4.1 Two Layers

**Platform Email Service (`PlatformEmailService`):**
- Used for emails sent BEFORE or OUTSIDE a tenant context: super admin OTP, registration verification, welcome emails
- Config comes from env vars (already defined in Sprint 1A): `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`
- Always uses SMTP (nodemailer) since it's platform-level

**Tenant Email Service (`EmailService`):**
- Used for emails sent WITHIN a tenant context: employee welcome, leave approval notifications, password reset OTPs, etc.
- Config comes from the tenant's `email_config` table (per-tenant customization)
- If no tenant `email_config` row exists or `is_active = false`, falls back to platform-level env config
- Supports multiple providers via abstraction

### 4.2 Interface: `IEmailProvider`

| Method | Signature | Description |
|---|---|---|
| `send` | `(to: string, subject: string, htmlBody: string, options?: EmailOptions) → Promise<void>` | Send single email |
| `sendBulk` | `(recipients: string[], subject: string, htmlBody: string, options?: EmailOptions) → Promise<void>` | Send to multiple recipients |

**`EmailOptions` type:**
```
{
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}
```

### 4.3 SMTP Provider (v1 active implementation)

Uses `nodemailer`. Creates transporter from config (either env vars for platform, or `email_config` table JSONB for tenant).

### 4.4 Tenant Email Config Test Endpoint

`POST /api/settings/email/test` (PRD 9.2)

- Auth: `TenantAuthGuard` + `@RequirePermission('settings', 'edit', 'email')`
- Body: `{ testEmail: string }` (where to send test)
- Logic: Load tenant's `email_config`, attempt to send a test email. Return success/failure with error details on failure.

### 4.5 Refactor Existing Direct Nodemailer Calls

After `PlatformEmailService` and `EmailService` are built, refactor these existing services:

| Service | Sprint | Current | Refactor To |
|---|---|---|---|
| `PlatformAuthService.sendOtpEmail()` | 1C | Direct nodemailer | Inject `PlatformEmailService`, call `send()` |
| `RegistrationService.sendVerificationEmail()` | 1D | Direct nodemailer | Inject `PlatformEmailService`, call `send()` |
| `RegistrationService.sendWelcomeEmail()` | 1D | Direct nodemailer | Inject `PlatformEmailService`, call `send()` |
| `AuthService` (tenant OTP email) | 1E | Direct nodemailer | Inject `EmailService` (tenant-aware), call `send()` |

Remove all inline `nodemailer.createTransport()` calls and `require('nodemailer')` from those services. They should only depend on the injected email service.

### 4.6 Email Templates Approach

For v1, HTML templates are inline strings in the service (same as current approach). Add a `// TODO: Migrate to template engine (Handlebars/Mjml) in future sprint` comment. Each email function accepts dynamic fields and returns formatted HTML.

Keep all email templates in a shared location for reuse:

**File:** `src/core/email/templates/` (directory of template-building functions)
- `otp-email.template.ts` — used by platform auth + tenant auth forgot-password
- `verification-email.template.ts` — used by registration
- `welcome-email.template.ts` — used by registration + employee creation
- `notification-email.template.ts` — generic notification wrapper

Each template function takes parameters and returns an HTML string. Brand constants (`#011552`, Inter font, max-width 480px) are shared.

---

## 5. Notification Service + WebSocket Gateway

### 5.1 Notification Service

**Methods:**

| Method | Description |
|---|---|
| `create(userId, type, title, message, data?)` | Insert into `notifications` table. If `in_app_enabled` for this type → emit via WebSocket. If `email_enabled` → send email. |
| `findAll(userId, page, limit, unreadOnly?)` | Paginated query of user's notifications |
| `markAsRead(notificationId, userId)` | Set `is_read = TRUE` (verify ownership) |
| `markAllAsRead(userId)` | Set `is_read = TRUE` for all of user's notifications |
| `getUnreadCount(userId)` | `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE` |

**Notification type checking:**
Before creating a notification, check `notification_settings` table for the given `type`:
- If `in_app_enabled = TRUE` → insert into DB + emit WebSocket event
- If `email_enabled = TRUE` → also send email via `EmailService`
- If neither → skip (log warning: "Notification type {type} is disabled")

### 5.2 Notification API Endpoints

Controller prefix: `notifications`. All tenant-scoped, `TenantAuthGuard` required.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/notifications?page=&limit=&unreadOnly=` | Self only | List own notifications, paginated |
| `PUT` | `/api/notifications/:id/read` | Self only | Mark single notification as read |
| `PUT` | `/api/notifications/read-all` | Self only | Mark all own notifications as read |
| `GET` | `/api/notifications/unread-count` | Self only | Get unread count (integer) |

**"Self only" authorization:** These endpoints don't need `@RequirePermission()` — they implicitly operate on `req.user.userId` only. A user can only see/manage their own notifications.

**Pagination response:**
```
{
  success: true,
  data: [ { id, type, title, message, data, isRead, createdAt }, ... ],
  meta: { page: 1, limit: 20, total: 47, totalPages: 3 }
}
```

### 5.3 Notification Settings API

Controller prefix: `settings/notifications`. Admin only.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/settings/notifications` | `@RequirePermission('settings', 'view', 'notifications')` | List all notification type settings |
| `PUT` | `/api/settings/notifications` | `@RequirePermission('settings', 'edit', 'notifications')` | Update settings (bulk) |

**PUT body:**
```
{
  "settings": [
    { "notificationType": "leave_approved", "emailEnabled": true, "inAppEnabled": true },
    { "notificationType": "leave_rejected", "emailEnabled": false, "inAppEnabled": true },
    ...
  ]
}
```

Upsert each row by `notification_type`.

### 5.4 WebSocket Gateway

**Technology:** NestJS `@WebSocketGateway()` with Socket.IO adapter.

**Namespace:** `/notifications`

**Connection Flow:**
1. Client connects with `Authorization: Bearer <accessToken>` as auth handshake
2. Gateway validates the tenant JWT in the `handleConnection` lifecycle hook
3. If valid → join the user to a room named `user:{userId}`
4. If invalid → disconnect

**Events Emitted (server → client):**

| Event | Payload | When |
|---|---|---|
| `notification:new` | `{ id, type, title, message, data, createdAt }` | When `NotificationService.create()` is called and `in_app_enabled = TRUE` |
| `notification:unread-count` | `{ count: number }` | After any new notification or mark-as-read |

**Events Listened (client → server):**

| Event | Payload | Purpose |
|---|---|---|
| `notification:mark-read` | `{ notificationId: string }` | Alternative to REST API for marking read |

### 5.5 Environment Variables

```
WEBSOCKET_PORT=3002              # or same port as HTTP if using same server
WEBSOCKET_CORS_ORIGIN=http://localhost:3000
```

**Implementation note:** For v1, the WebSocket gateway runs on the same NestJS HTTP server (same port). No separate `WEBSOCKET_PORT` needed — Socket.IO integrates with the existing HTTP server. Add `WEBSOCKET_CORS_ORIGIN` to allow frontend connections.

---

## 6. Export Service

### 6.1 Purpose

Reusable service called by any module to generate downloadable files. Not exposed as its own API — each module has its own `/export` endpoint that calls this service internally.

### 6.2 Interface

| Method | Signature | Description |
|---|---|---|
| `toCsv` | `(data: any[], columns: ColumnDef[], options?: CsvOptions) → Promise<Buffer>` | Generate CSV file |
| `toXlsx` | `(data: any[], columns: ColumnDef[], options?: XlsxOptions) → Promise<Buffer>` | Generate Excel file |
| `toPdf` | `(data: any[], columns: ColumnDef[], options?: PdfOptions) → Promise<Buffer>` | Generate PDF table |

**`ColumnDef` type:**
```
{
  key: string;         // field name in data objects
  header: string;      // display name in header row
  width?: number;      // column width (XLSX/PDF)
  format?: (value: any) => string;  // custom value formatter
}
```

### 6.3 CSV Generation

- Library: `json2csv`
- Encoding: UTF-8 with BOM (for Excel compatibility with non-ASCII characters)
- Returns Buffer with MIME type `text/csv`

### 6.4 XLSX Generation

- Library: `exceljs`
- Auto-filter on header row
- Column widths from `ColumnDef.width` or auto-calculated
- Header row styled: bold, background color `#011552` (brand), white text
- Returns Buffer with MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

### 6.5 PDF Generation

- Library: `pdfkit`
- Orientation: landscape (default for data tables)
- Header: title + generated date + tenant/org name
- Table: simple grid with header row styled (brand color background)
- Footer: page numbers
- Returns Buffer with MIME type `application/pdf`

### 6.6 Usage Pattern (for future module sprints)

Each module controller adds an export endpoint:
```
GET /api/leave/requests/export?format=csv|xlsx|pdf&status=...&from=...&to=...
```

The controller:
1. Queries data (applying same filters as the list endpoint)
2. Defines `ColumnDef[]` for the module's export fields
3. Calls `ExportService.toCsv()`, `.toXlsx()`, or `.toPdf()` based on `format`
4. Returns the buffer as a `StreamableFile` with correct headers (Content-Type, Content-Disposition)

---

## 7. Audit Log Service + Interceptor

### 7.1 Audit Service

**Methods:**

| Method | Description |
|---|---|
| `log(entry: AuditEntry)` | Insert into `audit_logs` table |
| `findAll(filters, page, limit)` | Paginated query with filters |
| `findByEntity(entityType, entityId)` | Get full history for a specific entity |

**`AuditEntry` type:**
```
{
  userId?: string;       // nullable for system actions
  action: 'create' | 'update' | 'delete';
  module: string;        // e.g., 'employee_management', 'leave'
  entityType: string;    // e.g., 'employee', 'leave_request', 'role'
  entityId: string;
  oldValue?: object;     // previous state (for update/delete)
  newValue?: object;     // new state (for create/update)
  ipAddress?: string;
  userAgent?: string;
}
```

### 7.2 Audit API Endpoints

Controller prefix: `audit-logs`. Admin only.

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| `GET` | `/api/audit-logs?module=&userId=&action=&entityType=&from=&to=&page=&limit=` | `@RequirePermission('settings', 'view', 'audit_logs')` | Search/filter audit logs, paginated |
| `GET` | `/api/audit-logs/:entityType/:entityId` | `@RequirePermission('settings', 'view', 'audit_logs')` | Full change history for a specific entity |

**Search response:**
```
{
  success: true,
  data: [
    {
      id, userId, userName, action: "update", module: "leave",
      entityType: "leave_request", entityId: "...",
      oldValue: { status: "pending" },
      newValue: { status: "approved" },
      ipAddress, userAgent, createdAt
    },
    ...
  ],
  meta: { page, limit, total, totalPages }
}
```

**Entity history response:** Same structure, filtered to a single entity, sorted by `created_at DESC` (most recent change first).

### 7.3 `AuditInterceptor`

**Purpose:** A NestJS interceptor that automatically captures before/after state for CUD operations without manual `auditService.log()` calls in every service method.

**How it works:**

1. Applied per-controller or per-method using `@UseInterceptors(AuditInterceptor)`
2. Requires a companion decorator `@AuditAction(module, entityType)` on the method to provide metadata
3. **Before handler execution:** For UPDATE/DELETE, load the current entity state from the DB (the "old value"). This requires the interceptor to know how to fetch the entity — solved by reading the route param `:id` and the entity type from the decorator metadata.
4. **After handler execution:** Capture the response body as the "new value"
5. Build an `AuditEntry` and call `AuditService.log()`

**`@AuditAction()` decorator:**
```
@AuditAction(module: string, entityType: string)
```

**Limitations for v1:**
- The interceptor captures the response body as `newValue`. For creates, this works well. For updates, it gets the updated entity if the service returns it.
- For deletes, `oldValue` is captured before deletion, `newValue` is null.
- If the handler throws an exception, no audit log is created (correct behavior — failed operations shouldn't be logged).

**Usage example (for future sprints):**
```
@Put(':id')
@UseInterceptors(AuditInterceptor)
@AuditAction('leave', 'leave_request')
async updateLeaveRequest(@Param('id') id: string, @Body() dto: UpdateLeaveRequestDto) { ... }
```

### 7.4 Interceptor Needs Tenant Schema

The `AuditInterceptor` inserts into the current tenant's `audit_logs` table. It reads the schema from `req.user.schemaName` (set by `TenantAuthGuard` in Sprint 1E).

For the "load old value" step, it also needs to query the tenant schema. Use the `PrismaService.withTenantSchema()` pattern from Sprint 1B.

---

## 8. Response Interceptor

### 8.1 Purpose

Wraps ALL successful responses in a standard envelope format (PRD 2.3):

```
{
  success: true,
  data: <response body>,
  meta?: { page, limit, total, totalPages }  // if pagination present
}
```

### 8.2 Implementation Approach

- Global NestJS interceptor registered in `main.ts`
- Intercepts the response after controller execution
- If the response is already an object with a `success` field → pass through (don't double-wrap)
- If the response is a raw value/object → wrap in `{ success: true, data: <value> }`
- If the response contains `meta` at the top level → extract and place in envelope `meta` field

### 8.3 Exclusions

- `StreamableFile` responses (file downloads, exports) → pass through unwrapped
- WebSocket messages → not affected (interceptor is HTTP-only)
- Swagger endpoint (`/api/docs`) → not affected

### 8.4 Interaction with Existing Responses

Many controllers in Sprints 1C–1F already return `{ success: true, data: ... }` manually. The interceptor should detect this (check for `success` property) and pass through without double-wrapping. This means:
- Existing manually-wrapped responses continue to work
- New controllers can return raw data and the interceptor wraps it
- Over time, controllers can be simplified to return raw data

---

## 9. Global Exception Filter

### 9.1 Purpose

Catches ALL unhandled exceptions and formats them consistently (PRD 2.3):

```
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Human-readable message",
    details?: { ... }         // validation errors, field-level details
  }
}
```

### 9.2 Exception Mapping

| Exception Type | HTTP Status | Error Code | Behavior |
|---|---|---|---|
| `BadRequestException` | 400 | `BAD_REQUEST` | Extract message from exception |
| `ValidationPipe` errors | 400 | `VALIDATION_ERROR` | Format class-validator errors into field-level details |
| `UnauthorizedException` | 401 | `UNAUTHORIZED` | Generic auth failure |
| `ForbiddenException` | 403 | `PERMISSION_DENIED` | Permission guard failures |
| `NotFoundException` | 404 | `NOT_FOUND` | Resource not found |
| `ConflictException` | 409 | `CONFLICT` | Duplicate resource |
| `ThrottlerException` | 429 | `RATE_LIMIT_EXCEEDED` | Rate limit from `@nestjs/throttler` |
| `HttpException` (other) | varies | `HTTP_ERROR` | Generic HTTP error |
| Unknown/unhandled | 500 | `INTERNAL_ERROR` | Log full error, return generic message (don't leak stack traces) |

### 9.3 Validation Error Details Format

When `class-validator` pipe throws, format the details as:

```
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed",
    details: {
      "email": ["email must be a valid email address"],
      "password": ["password must be at least 8 characters", "password must contain at least 1 uppercase letter"]
    }
  }
}
```

### 9.4 Production vs Development

- In development (`NODE_ENV !== 'production'`): include `stack` property in the error object for debugging
- In production: never include stack traces. Log them server-side but don't expose.

---

## 10. Environment Variable Additions

Add to `backend/.env`:

```
# File Storage
FILE_STORAGE_PROVIDER=postgres
MAX_FILE_SIZE_MB=10

# WebSocket
WEBSOCKET_CORS_ORIGIN=http://localhost:3000

# Node environment
NODE_ENV=development
```

---

## 11. Scope Boundaries

### In Scope (Sprint 1G)
- All 7 shared services (file storage, email, notification, export, audit, response interceptor, exception filter)
- WebSocket gateway for notifications
- Notification + audit log API endpoints
- Email service test endpoint
- Refactor Sprints 1C/1D/1E to use EmailService
- Email template files (shared directory)

### Out of Scope (future sprints)
| Feature | Sprint |
|---|---|
| File download controller endpoint (`GET /api/files/download/:id`) | 4G (Files module) |
| S3/GCS file storage provider | Future enhancement |
| SendGrid / AWS SES email providers | Future enhancement (interface exists, just add provider) |
| Notification settings admin UI page | Settings sprint |
| Audit log admin UI page | Settings sprint |
| Module-specific export endpoints (e.g., `/api/leave/requests/export`) | Each module sprint |
| Email template admin UI (if needed) | Future enhancement |

---

## 12. Verification & Acceptance Criteria

### Service Tests

**Test 1: File upload + download**
```
# Upload
POST /api/files/upload (multipart — future controller, for now test service directly)
→ Returns { id, url }

# Download
GET /api/files/download/{id}
→ Returns file binary with correct Content-Type and Content-Disposition
```
*Note: The file upload/download controller is built in the Files module sprint. For 1G, verify the service works via a simple test script or unit test.*

**Test 2: Platform email service**
```
# Trigger a platform auth OTP (Sprint 1C)
POST /api/platform/auth/forgot-password
Body: { "email": "admin@hrms-platform.com" }
→ OTP email received (now sent via PlatformEmailService instead of direct nodemailer)
```

**Test 3: Tenant email service (with fallback)**
```
# With no email_config in tenant schema → should fall back to platform env config
POST /api/auth/forgot-password
Headers: X-Tenant-Slug: acme-corp
Body: { "email": "john@acme.com" }
→ OTP email received (sent via EmailService falling back to env config)
```

**Test 4: Email test endpoint**
```
POST /api/settings/email/test
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
Body: { "testEmail": "test@example.com" }
→ 200 if email sent successfully, 400 with error details if config is wrong
```

**Test 5: Notification creation + WebSocket**
```
# Connect to WebSocket namespace /notifications with valid tenant JWT
# Call NotificationService.create() (triggered by a leave approval or similar action)
→ Client receives 'notification:new' event with { id, type, title, message }
→ GET /api/notifications/unread-count returns incremented count
```

**Test 6: Notification endpoints**
```
GET /api/notifications?page=1&limit=10&unreadOnly=true
→ 200: paginated list of unread notifications

PUT /api/notifications/:id/read
→ 200: notification marked as read

PUT /api/notifications/read-all
→ 200: all notifications marked as read

GET /api/notifications/unread-count
→ 200: { count: 0 }
```

**Test 7: Export service**
```
# Test directly via service (module export endpoints come in future sprints)
ExportService.toCsv(sampleData, columns)
→ Buffer with valid CSV content, UTF-8 BOM

ExportService.toXlsx(sampleData, columns)
→ Buffer with valid .xlsx content, styled header row

ExportService.toPdf(sampleData, columns)
→ Buffer with valid PDF content, landscape, branded header
```

**Test 8: Audit log**
```
GET /api/audit-logs?module=leave&action=update&page=1&limit=20
Headers: Authorization: Bearer <admin_token>, X-Tenant-Slug: acme-corp
→ 200: paginated audit log entries

GET /api/audit-logs/leave_request/<uuid>
→ 200: full change history for that leave request
```

**Test 9: Response interceptor**
```
# Any successful endpoint
GET /api/roles
→ Response body is { success: true, data: [...], meta: { ... } }
(not just raw array)
```

**Test 10: Global exception filter**
```
# Validation error
POST /api/auth/login
Body: { "email": "not-an-email" }
→ 400: { success: false, error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { email: ["..."] } } }

# Not found
GET /api/roles/00000000-0000-0000-0000-000000000000/permissions
→ 404: { success: false, error: { code: "NOT_FOUND", message: "Role not found" } }

# Rate limit
(Trigger rate limit)
→ 429: { success: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests..." } }
```

### Full Checklist

**File Storage:**
- [ ] `IFileStorageProvider` interface defined with `upload`, `download`, `delete`, `getUrl`
- [ ] PostgreSQL BYTEA provider implements the interface
- [ ] Provider selected via `FILE_STORAGE_PROVIDER` env variable
- [ ] File size validation against `MAX_FILE_SIZE_MB`

**Email:**
- [ ] `IEmailProvider` interface defined with `send`, `sendBulk`
- [ ] SMTP provider implements the interface using nodemailer
- [ ] `PlatformEmailService` reads config from env vars (platform-level)
- [ ] `EmailService` reads config from tenant `email_config` table, falls back to env
- [ ] `POST /api/settings/email/test` sends test email and reports success/failure
- [ ] Sprint 1C `PlatformAuthService` refactored to use `PlatformEmailService`
- [ ] Sprint 1D `RegistrationService` refactored to use `PlatformEmailService`
- [ ] Sprint 1E tenant `AuthService` refactored to use `EmailService`
- [ ] Email template functions centralized in `src/core/email/templates/`

**Notification:**
- [ ] `NotificationService.create()` inserts notification and checks `notification_settings`
- [ ] WebSocket gateway authenticates via tenant JWT handshake
- [ ] Connected users receive `notification:new` event in real-time
- [ ] `GET /api/notifications` returns paginated list (own notifications only)
- [ ] `PUT /api/notifications/:id/read` marks single as read (ownership verified)
- [ ] `PUT /api/notifications/read-all` marks all own as read
- [ ] `GET /api/notifications/unread-count` returns integer count
- [ ] `GET /api/settings/notifications` returns all type settings (Admin)
- [ ] `PUT /api/settings/notifications` updates settings (Admin)

**Export:**
- [ ] `ExportService.toCsv()` generates valid CSV with UTF-8 BOM
- [ ] `ExportService.toXlsx()` generates valid XLSX with branded header styling
- [ ] `ExportService.toPdf()` generates valid PDF in landscape with branded header
- [ ] All three methods accept `ColumnDef[]` for flexible column configuration

**Audit:**
- [ ] `AuditService.log()` inserts into tenant `audit_logs` table
- [ ] `AuditInterceptor` captures old/new state for CUD operations
- [ ] `@AuditAction()` decorator provides module + entityType metadata
- [ ] `GET /api/audit-logs` supports filtering by module, userId, action, entityType, date range
- [ ] `GET /api/audit-logs/:entityType/:entityId` returns full entity change history
- [ ] Both endpoints require `settings:view:audit_logs` permission

**Response Interceptor:**
- [ ] All successful responses wrapped in `{ success: true, data, meta? }`
- [ ] Already-wrapped responses (with `success` property) pass through without double-wrapping
- [ ] `StreamableFile` responses pass through unwrapped
- [ ] Pagination `meta` extracted and placed in envelope

**Global Exception Filter:**
- [ ] All exceptions produce `{ success: false, error: { code, message, details? } }`
- [ ] Validation errors include field-level details
- [ ] 500 errors don't leak stack traces in production
- [ ] Stack traces included in development mode
- [ ] All HTTP exception types mapped to appropriate error codes

**General:**
- [ ] All services registered in `CoreModule` with `@Global()` decorator
- [ ] `ResponseInterceptor` and `GlobalExceptionFilter` registered globally in `main.ts`
- [ ] All notification + audit endpoints appear in Swagger docs

---

*Sprint 1G Complete. Next: Sprint 1H — Frontend Foundation & UI Shell*
