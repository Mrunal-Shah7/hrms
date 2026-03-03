# AIHRMS Platform — Sprint Roadmap

**Generated:** February 25, 2026
**Based on:** HRMS Technical PRD v2.0
**Total Sprints:** 8 (with 30 sub-sprints)

---

## Decisions Log

| Decision | Choice |
|---|---|
| ORM | Prisma (with raw SQL `SET search_path` for multi-tenancy) |
| Schema approach | Full ~65 tenant tables + platform tables in Sprint 1 |
| Screenshots | Layout reference only — not pixel-copy |
| Sprint granularity | Small, focused sub-sprints |
| Testing | Acceptance criteria per sub-sprint, no formal test suite |
| Localization | Configurable defaults (not India-hardcoded) |
| Deployment | Skipped for now |
| Monorepo tooling | None — Turbopack (Next.js) + SWC (NestJS), separate app directories |
| Brand | Primary: `#011552`, Font: Inter |
| Environment | Local Windows, local PostgreSQL, localhost servers |

---

## Sprint Overview

### Sprint 1 — Core Infrastructure
*The foundation everything else depends on. DB, multi-tenancy, both auth systems, RBAC, and all shared services.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **1A** | Project Scaffolding & Database Setup | Initialize `frontend/` (Next.js + TypeScript + Tailwind + shadcn/ui) and `backend/` (NestJS + TypeScript + Prisma). Set up PostgreSQL locally, `docker-compose.yml` for the DB, `.env` files, shared types/constants, and the full Prisma schema (~65 tenant tables + platform tables). Run initial migration. Seed the platform schema with a default super admin. |
| **1B** | Multi-Tenancy Engine | `TenantMiddleware` that resolves tenant from subdomain / custom domain / `X-Tenant-ID` header. Dynamic Prisma `search_path` switching per request. Tenant provisioning pipeline (create schema → run migrations → seed defaults). Platform routes bypass tenant middleware. |
| **1C** | Platform Auth (Super Admin) | Super admin login at `/platform/login`, JWT (access 15min + refresh 7d), session tracking in `platform.super_admin_sessions`, password reset via OTP, `PlatformAuthGuard`, refresh token rotation. Backend only + minimal frontend login page. |
| **1D** | Self-Service Tenant Registration | Public `/register` page with form (org name, slug auto-gen, email, password, tier selection, user count). Slug uniqueness check, email uniqueness check. Email verification flow with token (24h expiry). On verification → trigger provisioning → send welcome email. `/register/pending` and `/register/verify` pages. Registration request records in platform schema. |
| **1E** | Tenant Auth & Session Management | Tenant login at `/login`, JWT (access 15min + refresh 7d), session tracking in tenant `user_sessions`, password reset via 6-digit OTP, `TenantAuthGuard`, forced password change on first login (`must_reset_password`), tenant status check (suspended/cancelled blocks login), refresh token rotation. Rate limiting on auth endpoints. |
| **1F** | RBAC Engine | Permissions table seeded with all module/action/resource combos. Five default system roles with mapped permissions. `@RequirePermission()` decorator + `PermissionGuard`. `usePermission()` frontend hook. Custom role CRUD APIs. User-role assignment APIs. Union-of-roles permission resolution. |
| **1G** | Core Shared Services | File Storage service (PostgreSQL BYTEA with abstraction interface). Email service (abstraction over SMTP/SendGrid/SES + platform-level env-based config). Notification service + WebSocket gateway (Socket.IO). Export utility (CSV, XLSX, PDF). Audit log service with `AuditInterceptor`. Response interceptor (standard envelope). Global exception filter. |
| **1H** | Frontend Foundation & UI Shell | Next.js App Router route groups: `(auth)`, `(public)`, `(platform)`, `(tenant)`. Tenant app shell: sidebar navigation, header bar (quick-create, search, notifications, profile dropdown). Platform admin shell (separate simpler layout). shadcn/ui base components installed. Shared components: DataTable, ExportMenu, SearchBar, pagination. Zustand auth store. React Query provider. API client service with interceptors. Permission-based sidebar visibility. Brand theme applied (`#011552`, Inter font). |

---

### Sprint 2 — Super Admin Portal & Account Management
*The platform owner's control panel and tenant user account pages.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **2A** | Super Admin Dashboard & Tenant Management | Platform dashboard page with widgets (total tenants by status, total users, revenue overview, recent registrations, trial expiry warnings, overdue payments). Tenant list page (search, filter by status/tier/source, paginated table). Create Tenant form (triggers provisioning). Tenant detail page (info, usage, billing history). Edit tenant, suspend/reactivate/cancel actions. |
| **2B** | Billing, Admin Management & Registration Requests | Billing list page (filter by tenant/status/date). Generate invoice action. Mark as paid/overdue. Billing detail view. Super admin CRUD (add, edit, deactivate — cannot delete last active). Registration requests list (status filter, retry failed provisioning, resend verification). |
| **2C** | Tenant Account Management Pages | Profile page (`/account/profile`) — personal info, email, phone, photo upload. Security page — change password, device sign-ins. Sessions page — active sessions list with revoke. Settings page — user display preferences. Privacy page. Organization page — org details (read-only for non-admins), subscription info. All referencing the screenshot layouts for positioning. |
| **2D** | Subscription Enforcement & Navigation Polish | Middleware that checks `subscription_tier` on recruitment routes (403 if standard). Middleware that checks `current_user_count >= max_users` on employee creation. Dashboard widget for admin showing subscription usage. Sidebar "Recruitment" visibility tied to tier. Final polish on sidebar navigation, header components, permission-based rendering, mobile responsiveness. |

---

### Sprint 3 — Employee Management
*The central module — nearly every other module depends on it.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **3A** | Employee CRUD & List Page | Employee list page with top tabs (Employees / Departments / Designations / Groups / Delegation). Full DataTable with search, filter, sort, pagination, export menu. Add Employee drawer/form (basic info, personal, emergency, address, role assignment). Employee detail page (Overview + Timeline tabs). Edit employee. Soft delete (archive). Welcome email on creation. Auto-generated or manual employee ID. External user badge logic. |
| **3B** | Departments, Designations & Reporting Hierarchy | Departments CRUD (name, code, mail alias, head, parent department). Designations CRUD (name, code, hierarchy level). Reporting hierarchy — admin configures multi-level chain visually (CEO → VP → Director → ... → Employee). `reports_to` field on employee profiles. Org chart API endpoint. |
| **3C** | Groups, Projects, Tasks & Delegations | Groups CRUD + member management (informal cross-department collections). Projects CRUD (name, description, manager, budget, dates, members). Tasks sub-resource (title, assignee, status, priority, due date). Budget visibility restricted to project manager + admin. Delegations CRUD (manager → reportee, type, date range, status). Task assignment triggers notification. |
| **3D** | CSV Import/Export & Module Integration | `GET /api/employees/import/template` — CSV template download. `POST /api/employees/import` — bulk import with per-row validation and error reporting. Export on all data table pages (CSV, XLSX, PDF respecting filters). Audit logging for all employee CUD operations. Notification events wired (new employee created, task assigned, delegation created). |

---

### Sprint 4 — Leave Management & Time Tracker
*Leave application/approval workflow and external time tracking integration.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **4A** | Leave Configuration (Admin) | Leave types CRUD (name, code, color, icon, is_paid, max_consecutive_days). Leave policies CRUD (per designation/department/employment type — annual allocation, carry forward, accrual type). Holidays CRUD (date, name, optional). Year-based data. Default leave types seeded during provisioning. Financial year start month configurable. Settings tile for Leave Tracker. |
| **4B** | Leave Requests, Approvals & Balances | Leave summary page (top tabs: My Data / Team / Holidays, sub-tabs: Summary / Balance / Requests). Apply Leave modal (type, dates, duration type — full/half, reason). Leave balance cards per type. Leave requests list with status filter. HR approval/rejection flow with comments. Employee cancel (pending only). Balance validation (warn on holidays, block on insufficient except LWP). Half-day = 0.5 deduction. Overlapping leave rejection. Manager sees reportees on leave (view only, no approval). Team view. Notifications (submitted, approved, rejected, cancelled). Export. |
| **4C** | Time Tracker Module | Admin config page — list integrations, add/edit/delete, test connection, sync now. Adapter architecture (interface: `fetchLogs`, `mapToStandardFormat`, `testConnection`). MockAdapter that generates realistic dummy data. Cron job for scheduled sync. Time log view for all users (date-filtered punch events + daily summary). `time_tracker_config`, `time_logs`, `daily_time_summary` tables populated. Settings tile for Time Tracker. |

---

### Sprint 5 — Attendance, Performance & Files
*Derived attendance, goal tracking with reviews, and file management.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **5A** | Attendance Module | My Attendance page (week navigator, timeline/list/calendar views). Per-day display: punch-in, punch-out, hours, late/early badges, weekends. Team Attendance (HR: all with department filter, Manager: reportees only). Work schedule CRUD (start/end time, working days, grace period, min hours, overtime threshold). Attendance calculations (late, early departure, overtime, status cross-referenced with leaves + holidays). Regularization request/review flow. Export. Notifications (anomaly, overtime, regularization). |
| **5B** | Performance & Goals | Goals page (tabs: My Data / Team, filter: All/This Week/Last Week/This Month/Last Month). Goal cards with title, priority, description, progress bar, status. Add/edit goals (assignable to individuals, groups, or projects). Progress update with history tracking. Performance review cycles CRUD (quarterly/annual). Reviews: manager submits, employee acknowledges. Goal completion notification. Export. Settings tile for Performance. |
| **5C** | Files Module | Three-scope file browser (My Files / Team / Organization). Folder CRUD with navigation. File upload (multipart), download, delete. File sharing with permission levels (view/edit). "Shared with me" view. Search within files. Owner/admin delete permissions. File shared notification. Uses the File Storage service from Sprint 1G. |

---

### Sprint 6 — Compensation, Recruitment & Offboarding
*Sensitive financial data, full hiring pipeline, and employee exit workflows.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **6A** | Compensation Module | Re-authentication gate (password modal → 5-min `compensationAccessToken` → `X-Compensation-Token` header). All monetary values rendered with CSS blur + eye icon toggle. My Compensation page (salary card, breakdown, payslips, appraisals). HR/Admin view of all employees. Salary components CRUD. Employee salary assignment with breakdown. Payslip generation (PDF via Puppeteer/PDFKit). Appraisal records CRUD. Payslip download. Notifications (payslip generated, appraisal recorded). Export (requires re-auth). Settings tile. |
| **6B** | Recruitment — Job Openings & Candidates | Tier gate (403 if `standard`). Recruitment dashboard with widgets (pipeline, time-to-fill, time-to-hire, upcoming interviews, source analytics). Job openings CRUD + publish (generates shareable public link). Job opening detail with pipeline view + timeline. Candidates CRUD with stage management. Default pipeline stages (New → In Review → Available → Engaged → Offered → Hired → Rejected). Candidate detail with full profile + timeline + notes. Stage change history. Mass actions (email, delete). Candidate stage change notification. Departments view with job/candidate counts. |
| **6C** | Recruitment — Interviews, Assessments, Referrals & Offers | Interview CRUD with participants, evaluation, notes, attachments. Submit evaluation action. Interview feedback per interviewer. Assessments — MCQ + subjective question builder, send to candidates, evaluate submissions. Referrals — "Refer a Candidate" form, list. Offer letters — create + send. Email campaigns — compose, select candidates, bulk send. Public job page (`/careers/{slug}/jobs/{token}`) — no auth, job details, apply form (name, email, phone, resume, cover letter). Notifications (interview scheduled/cancelled, assessment sent, offer sent). Settings tile for Recruitment. |
| **6D** | Offboarding Module | Offboarding template config — 5-step wizard (Preferences → Clearances → Exit Interview → Documents → Workflows). Offboarding list page (employee, type, dates, status, current step). Resignation submission (employee self-service). Termination initiation (HR/Admin). Approval flow. Clearance tracking (IT/HR/Admin forms). Exit interview (customizable questionnaire + responses). Required documents upload. Workflow triggers (email alerts). Post-offboarding: user status → archived, data retention config (default 365 days). Notifications (resignation submitted/approved/rejected, clearance completed). Settings tile. |

---

### Sprint 7 — Onboarding, Reports & Dashboard
*New hire onboarding, aggregated reporting, and the role-based home page.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **7A** | Onboarding Module | Onboarding templates CRUD with checklist items. Onboarding list page (name, email, status, department, source). Sensitive field masking (PAN, Aadhaar, UAN — configurable, not India-hardcoded). Add candidate form (details, address, professional, education repeatable, experience repeatable). Onboarding detail — assigned checklist with per-step progress. Trigger onboarding (starts checklist). "Convert to Employee" action (creates user + employee profile from onboarding + candidate data, sends welcome email). Linked to recruitment (hired candidate → onboarding). Notifications (triggered, completed). Settings tile. |
| **7B** | Reports Module | Dedicated sidebar Reports section. Report types: Attendance, Leave, Headcount, Recruitment (if tier), Performance Reviews, Compensation Summary (requires re-auth), Turnover, Overtime. Each report: filterable (date range, department, groupBy, year, cycle). All exportable (CSV, XLSX, PDF). `GET /api/reports/{reportType}` + `GET /api/reports/{reportType}/export?format=`. |
| **7C** | Dashboard (Home) | Landing page after tenant login. Role-based widget matrix: all users (leave balance, upcoming holidays, goals summary, attendance this week, recent notifications), Manager (reportees on leave, team attendance), HR (pending approvals, new candidates if tier, onboarding/offboarding progress, hiring pipeline if tier), Admin (org headcount, subscription usage, recent audit log). `GET /api/dashboard` returns role-appropriate widget data. |

---

### Sprint 8 — Polish, Integration & Hardening
*Cross-cutting concerns, edge cases, and final quality pass.*

| Sub-Sprint | Title | What's Built |
|---|---|---|
| **8A** | Notification & Email System Completion | Complete event matrix wired across all modules (23+ event types from PRD Section 23). Admin global enable/disable per notification type (email and/or in-app) via Settings → Notifications. WebSocket real-time delivery verified end-to-end. Email templates for all automated emails. Toast notifications on frontend. Notification bell red dot + panel. Mark read / mark all read. |
| **8B** | Settings Module Completion | Tile-based settings page (`/settings`). Top banner: org name, license count, current user. All 14 tiles linked to their config pages (Manage Accounts, Onboarding, Employee Info, Leave, Attendance, Time Tracker, Performance, Files, Compensation, Offboarding, Recruitment, General, Notifications, Audit Logs). Organization settings (org name, domain, timezone, date format, financial year start, default currency). Email config test endpoint. Audit log viewer with search/filter. |
| **8C** | Global Features & Edge Cases | Global search (employees, candidates). Quick-create dropdown (+) — context-aware (new employee, new leave request, new goal). Rate limiting finalized on all endpoints per PRD Section 26.6. Data import/export across all modules verified. Three-dots export menu on every data-table page. Pagination consistency (10/25/50 per page). Error states, empty states, loading states across all pages. Mobile responsiveness pass. `packages/shared/` types/constants/validation schemas finalized. Final acceptance criteria walkthrough against all PRD sections. |

---

## Sprint Summary

| Sprint | Name | Sub-Sprints | Estimated Complexity |
|---|---|---|---|
| **1** | Core Infrastructure | 1A → 1H (8) | Heaviest — foundational |
| **2** | Super Admin Portal & Account Management | 2A → 2D (4) | Medium |
| **3** | Employee Management | 3A → 3D (4) | Medium-Heavy |
| **4** | Leave Management & Time Tracker | 4A → 4C (3) | Medium |
| **5** | Attendance, Performance & Files | 5A → 5C (3) | Medium |
| **6** | Compensation, Recruitment & Offboarding | 6A → 6D (4) | Heavy |
| **7** | Onboarding, Reports & Dashboard | 7A → 7C (3) | Medium |
| **8** | Polish, Integration & Hardening | 8A → 8C (3) | Medium |
| | **Total** | **32 sub-sprints** | |

---

## Dependency Chain

```
Sprint 1 (Core Infra)
    ├── Sprint 2 (Super Admin + Account)
    │       └── Sprint 2D (Subscription Enforcement)
    └── Sprint 3 (Employee Management) ← most modules depend on this
            ├── Sprint 4 (Leave + Time Tracker)
            │       └── Sprint 5A (Attendance — depends on Time Tracker)
            ├── Sprint 5B (Performance)
            ├── Sprint 5C (Files)
            ├── Sprint 6A (Compensation)
            ├── Sprint 6B-C (Recruitment)
            │       └── Sprint 7A (Onboarding — depends on Recruitment)
            ├── Sprint 6D (Offboarding)
            ├── Sprint 7B (Reports — depends on all data modules)
            └── Sprint 7C (Dashboard — depends on all modules)
                    └── Sprint 8 (Polish — depends on everything)
```

---

*When you're ready, say "Start Sprint 1" and I'll generate the detailed, Cursor-ready prompt for Sub-Sprint 1A.*
