# Sprint 1H — Frontend Foundation & UI Shell

## Goal
Build the complete frontend application skeleton: finalize the four Next.js route groups with their layouts, build the tenant app shell (sidebar + header), build the platform admin shell, create reusable shared components (DataTable, ExportMenu, SearchBar, pagination), finalize the Zustand auth store, wire up React Query provider, complete the API client with token refresh interceptor, implement permission-based sidebar visibility, and apply the brand theme throughout. By the end of this sprint, both the tenant and platform apps have a fully functional shell that all future module pages slot into.

---

## 1. What Already Exists (From Previous Sprints)

| Component | Sprint | Status |
|---|---|---|
| Next.js project with TypeScript, Tailwind, shadcn/ui components | 1A | ✅ |
| Route group directories: `(auth)`, `(public)`, `(platform)`, `(tenant)` | 1A | ✅ Directories exist |
| Axios API instance (`services/api.ts`) | 1A | ✅ Placeholder |
| Zustand auth store skeleton (`stores/auth.store.ts`) | 1A Patch 5 | ✅ Skeleton with `AuthUser` interface |
| React Query provider wrapper | 1A Patch 4 | ✅ Provider component exists |
| Platform login page | 1C | ✅ Functional |
| Platform login blank layout | 1C | ✅ |
| Registration pages (`/register`, `/register/pending`, `/register/verify`) | 1D | ✅ Defined |
| Tenant login, forgot password, force change password pages | 1E | ✅ Defined |
| Auth API helper (`services/auth.ts`) | 1E | ✅ |
| `useRequireAuth()` hook / `<RequireAuth>` wrapper | 1E | ✅ Defined |
| `usePermission()` hook, `<PermissionGate>`, `<NoPermission>` | 1F | ✅ Defined |
| WebSocket notification gateway (backend) | 1G | ✅ |
| Brand colors: `#011552` primary, Inter font | 1A | ✅ In Tailwind config |

**This sprint wires everything together into cohesive layouts and builds the missing UI components.**

---

## 2. Files to Create / Update

### Layouts
| File | Purpose |
|---|---|
| `src/app/(auth)/layout.tsx` | Blank centered layout for login/forgot-password/force-change (finalize) |
| `src/app/(public)/layout.tsx` | Blank layout for registration pages (finalize) |
| `src/app/(platform)/layout.tsx` | Platform admin shell (sidebar + header) — wraps all platform pages EXCEPT login |
| `src/app/(platform)/platform/login/layout.tsx` | Blank override for login page (already exists from 1C) |
| `src/app/(tenant)/layout.tsx` | Tenant app shell (sidebar + header) — wraps all tenant pages |

### Shell Components
| File | Purpose |
|---|---|
| `src/components/layout/tenant-shell.tsx` | Tenant shell: sidebar + header + main content area |
| `src/components/layout/tenant-sidebar.tsx` | Tenant sidebar navigation with permission-based visibility |
| `src/components/layout/tenant-header.tsx` | Tenant header bar (logo, quick-create, search, notifications, settings, profile) |
| `src/components/layout/platform-shell.tsx` | Platform admin shell: simpler sidebar + header |
| `src/components/layout/platform-sidebar.tsx` | Platform sidebar (Dashboard, Tenants, Billing, Registrations, Admins) |
| `src/components/layout/platform-header.tsx` | Platform header (logo, admin name, logout) |
| `src/components/layout/notification-panel.tsx` | Slide-out notification panel (triggered by bell icon) |
| `src/components/layout/profile-dropdown.tsx` | Profile avatar dropdown (My Profile, My Account, Sign Out) |
| `src/components/layout/quick-create-menu.tsx` | [+] quick-create dropdown menu |

### Shared Components
| File | Purpose |
|---|---|
| `src/components/shared/data-table.tsx` | Generic data table with sorting, selection, pagination |
| `src/components/shared/data-table-pagination.tsx` | Pagination controls (records-per-page dropdown, page nav, total count) |
| `src/components/shared/data-table-toolbar.tsx` | Toolbar above table (view switcher, filters, search, primary action, export menu) |
| `src/components/shared/export-menu.tsx` | Three-dots export dropdown (PDF, XLSX, CSV) |
| `src/components/shared/search-bar.tsx` | Global search input component |
| `src/components/shared/page-header.tsx` | Reusable page header (title, breadcrumb, action buttons) |
| `src/components/shared/loading-spinner.tsx` | Loading state component |
| `src/components/shared/empty-state.tsx` | Empty state component (icon + message + optional action) |
| `src/components/shared/confirm-dialog.tsx` | Reusable confirmation dialog |
| `src/components/shared/filter-sidebar.tsx` | Collapsible filter panel for data table pages |

### State & Services
| File | Purpose |
|---|---|
| `src/stores/auth.store.ts` | Finalize Zustand auth store (expand skeleton from Patch 5) |
| `src/stores/platform-auth.store.ts` | Zustand store for platform admin auth state |
| `src/services/api.ts` | Finalize Axios instance with token refresh interceptor |
| `src/services/notification.ts` | Notification API helpers + Socket.IO client connection |
| `src/hooks/useNotifications.ts` | Hook for notification state (unread count, real-time updates) |
| `src/hooks/useDebounce.ts` | Debounce hook (used by search, slug check, email check) |

### Types
| File | Purpose |
|---|---|
| `src/types/index.ts` | Finalize shared types (expand from Patch 6) |

---

## 3. Route Group Layouts

### 3.1 `(auth)` Layout — Blank Centered

**Routes under this group:** `/login`, `/forgot-password`, `/force-change-password`

**Layout behavior:**
- Full-height centered layout with light background (`bg-slate-50`)
- No sidebar, no header
- Just renders `{children}` centered vertically and horizontally
- Tenant context resolved by `TenantMiddleware` on the backend (via subdomain or headers), but the frontend layout itself has no tenant-specific chrome

### 3.2 `(public)` Layout — Blank

**Routes under this group:** `/register`, `/register/pending`, `/register/verify`

**Layout behavior:**
- Same as `(auth)` — clean, centered, no shell
- No authentication required

### 3.3 `(platform)` Layout — Platform Admin Shell

**Routes under this group:** `/platform/dashboard`, `/platform/tenants`, `/platform/billing`, `/platform/admins`, `/platform/registrations`

**Exception:** `/platform/login` uses its own blank layout (already in place from Sprint 1C)

**Layout behavior:**
1. Check `platformAccessToken` in localStorage. If missing → redirect to `/platform/login`
2. If present → render `<PlatformShell>` with sidebar + header + `{children}`
3. The layout uses `PlatformAuthStore` (not tenant auth store)

### 3.4 `(tenant)` Layout — Tenant App Shell

**Routes under this group:** `/dashboard`, `/employees`, `/leave`, `/attendance`, `/time-tracker`, `/performance`, `/files`, `/compensation`, `/recruitment`, `/onboarding`, `/offboarding`, `/reports`, `/settings`, `/account`

**Layout behavior:**
1. Use `<RequireAuth>` wrapper (from Sprint 1E) — redirects to `/login` if not authenticated
2. If `user.mustResetPassword === true` → redirect to `/force-change-password`
3. Render `<TenantShell>` with sidebar + header + `{children}`
4. Establish WebSocket connection for notifications on mount

---

## 4. Tenant Sidebar Specification

### 4.1 Navigation Items

Reference: `settings.png` (project file) — shows the sidebar structure from the existing product.

| Order | Icon | Label | Route | Permission Check | Notes |
|---|---|---|---|---|---|
| 1 | `Home` (lucide) | Home | `/dashboard` | Always visible | — |
| 2 | `ClipboardList` | Onboarding | `/onboarding` | `onboarding:view:onboarding_records` | HR, Admin only |
| 3 | `Palmtree` | Leave Tracker | `/leave` | `leave:view:leave_requests` | All (view own) |
| 4 | `CalendarDays` | Attendance | `/attendance` | `attendance:view:attendance` | All (view own) |
| 5 | `Timer` | Time Tracker | `/time-tracker` | `time_tracker:view:time_logs` | All (view own) |
| 6 | `TrendingUp` | Performance | `/performance` | `performance:view:goals` | All |
| 7 | `FolderOpen` | Files | `/files` | `files:view:file_records` | All |
| 8 | `Wallet` | Compensation | `/compensation` | `compensation:view:salary` | All (own), HR/Admin (all) |
| 9 | `MoreHorizontal` | More | (expands) | — | Expandable section |
| 9a | `Briefcase` | → Recruitment | `/recruitment` | `recruitment:view:job_openings` AND `subscription_tier === 'with_recruitment'` | Tier + permission gated |
| 9b | `Users` | → Employee Mgmt | `/employees` | `employee_management:view:employees` | — |
| 10 | `Settings` | Operations | `/settings` | `settings:view:rbac` | Admin only |
| 11 | `BarChart3` | Reports | `/reports` | `reports:view:reports` | HR, Admin |

### 4.2 Permission-Based Visibility

Each nav item runs `usePermission()` or `useHasAnyPermission()` from Sprint 1F. If the user doesn't have the required permission, the item is hidden (not disabled — completely invisible).

### 4.3 "More" Expandable Section

The "More" item is a collapsible group:
- Click to expand → shows Recruitment and Employee Mgmt as sub-items
- Collapse on second click
- If neither sub-item is visible (no permissions), the "More" group itself is hidden

### 4.4 Subscription Tier Check for Recruitment

Recruitment visibility requires BOTH:
1. Permission: `recruitment:view:job_openings`
2. Tenant's `subscription_tier === 'with_recruitment'`

The subscription tier is available from the auth store (loaded at login or via `/api/auth/me`). The login response or `/me` endpoint should include `tenant.subscriptionTier`. 

**New addition to Sprint 1E's login response:** Include `tenant: { subscriptionTier, name }` in the login response data. Update the Zustand auth store to hold this.

### 4.5 Active State

The current route highlights the matching sidebar item:
- Active item: Brand background (`bg-brand/10`), brand text color (`text-brand`), left border accent
- Hover: Subtle background change (`bg-slate-100`)

### 4.6 Sidebar Collapse

- Desktop: Sidebar always visible, fixed width (~240px)
- Mobile (below `md` breakpoint): Sidebar hidden, hamburger menu in header toggles a slide-over drawer
- Optional: Collapse to icon-only mode (64px) on desktop via a toggle button at the bottom of the sidebar (nice-to-have, not required for v1)

---

## 5. Tenant Header Specification

### 5.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│  [Logo]                              [+] 🔍 🔔 ⚙ [Avatar] │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Components (Left to Right)

**Logo (left):**
- Brand mark: Square with `H` in brand color, or the org name
- No per-tenant logo customization in v1 (PRD 6.3: "Platform logo, no per-tenant logo customization")

**Quick-Create Button `[+]` (right):**
- Blue circular button with `Plus` icon
- Click opens a dropdown with context-aware quick-create actions:
  - "New Employee" → opens add employee form (if `employee_management:create:employees`)
  - "New Leave Request" → opens apply leave form (if `leave:create:leave_requests`)
  - "New Goal" → opens create goal form (if `performance:create:goals`)
- Each item gated by `<PermissionGate>` — only shows items user can create
- For v1: items navigate to the respective page's create form rather than opening a global modal

**Search `🔍`:**
- Click opens a search overlay/command palette (similar to `Cmd+K` pattern)
- Uses shadcn `Command` component (already installed in Sprint 1A)
- Searches across: employees, candidates, job openings (results come from future API endpoints)
- For v1: render the UI but with placeholder "Search coming soon" — actual search API endpoints are built per-module

**Notification Bell `🔔`:**
- Shows red dot badge when unread count > 0
- Unread count fetched from `GET /api/notifications/unread-count` on mount + updated via WebSocket
- Click opens `<NotificationPanel>` (slide-out sheet from right)
- Panel shows: list of recent notifications, "Mark all as read" button, each notification with read/unread state
- Click a notification → mark as read + navigate to relevant page (using `data` field from notification)

**Settings Gear `⚙`:**
- Only visible if user has `settings:view:rbac` or any settings-level permission
- Click navigates to `/settings`

**Profile Avatar:**
- Shows user's avatar (or initials fallback with brand background)
- Click opens dropdown:
  - User name + email (display only)
  - "My Profile" → `/account/profile`
  - "My Account" → `/account/settings`
  - Divider
  - "Sign Out" → calls logout API, clears auth store, redirects to `/login`

---

## 6. Platform Admin Shell Specification

### 6.1 Structure

Simpler than the tenant shell. Reference: PRD Section 4.4.

```
┌──────────────────────────────────────────────────────────┐
│  [Logo]   HRMS Platform Admin                 👤 Admin Name │
├──────────┬───────────────────────────────────────────────┤
│ Sidebar  │           Main Content Area                    │
│          │                                               │
│ Dashboard│                                               │
│ Tenants  │                                               │
│ Billing  │                                               │
│ Reg.     │                                               │
│ Admins   │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### 6.2 Platform Sidebar Items

| Order | Icon | Label | Route |
|---|---|---|---|
| 1 | `LayoutDashboard` | Dashboard | `/platform/dashboard` |
| 2 | `Building2` | Tenants | `/platform/tenants` |
| 3 | `CreditCard` | Billing | `/platform/billing` |
| 4 | `ClipboardList` | Registrations | `/platform/registrations` |
| 5 | `Users` | Admins | `/platform/admins` |

No permission checks — all platform sidebar items visible to all authenticated super admins.

### 6.3 Platform Header

- Left: Brand logo + "HRMS Platform Admin" text
- Right: Admin name + avatar with dropdown (Profile → placeholder, Sign Out → clears platform auth, redirects to `/platform/login`)

---

## 7. Shared Components Specification

### 7.1 `<DataTable>`

Generic, reusable data table used by every list page in the application.

**Props:**

| Prop | Type | Description |
|---|---|---|
| `columns` | `ColumnDef[]` | Column definitions (TanStack Table format) |
| `data` | `T[]` | Row data array |
| `loading` | `boolean` | Show skeleton loading state |
| `pagination` | `PaginationState` | Current page, page size |
| `onPaginationChange` | `(state) => void` | Pagination change handler |
| `totalRows` | `number` | Total server-side count |
| `sorting` | `SortingState` | Current sort state |
| `onSortingChange` | `(state) => void` | Sort change handler |
| `rowSelection` | `RowSelectionState` | Selected rows |
| `onRowSelectionChange` | `(state) => void` | Selection handler |
| `onRowClick` | `(row) => void` | Row click handler (navigate to detail) |

**Implementation notes:**
- Built on `@tanstack/react-table` (install: `npm install @tanstack/react-table`)
- Uses shadcn `Table` components for rendering
- Checkbox column for row selection (optional, controlled by `rowSelection` prop)
- Sortable column headers (click to toggle asc/desc/none)
- Skeleton rows when `loading = true`

### 7.2 `<DataTablePagination>`

**Content:**
- Left: "Showing X to Y of Z results"
- Center: Records-per-page dropdown (10, 25, 50, 100)
- Right: Page navigation (First, Prev, page numbers, Next, Last)

### 7.3 `<DataTableToolbar>`

**Props:**

| Prop | Type | Description |
|---|---|---|
| `searchPlaceholder` | `string` | e.g., "Search employees..." |
| `onSearchChange` | `(value) => void` | Debounced search handler |
| `primaryAction` | `{ label, onClick, permission? }` | Primary action button config |
| `exportEnabled` | `boolean` | Show export menu |
| `onExport` | `(format) => void` | Export handler |
| `filterContent` | `ReactNode` | Custom filter UI to render in filter sidebar |

**Layout:**
```
[View dropdown] [Edit]    [Primary Action Button] [Expand] [Filter] [⋮ Export]
```

### 7.4 `<ExportMenu>`

Three-dots dropdown menu (PRD 6.5):
- "Export as PDF" → calls `onExport('pdf')`
- "Export as Excel (.xlsx)" → calls `onExport('xlsx')`
- "Export as CSV" → calls `onExport('csv')`

Uses shadcn `DropdownMenu`. Each item shows an icon + label.

### 7.5 `<SearchBar>`

- Input with search icon (lucide `Search`)
- Debounced onChange (300ms, using `useDebounce` hook)
- Clear button (X icon) when value is non-empty
- Optional keyboard shortcut hint (`Cmd+K` badge)

### 7.6 `<PageHeader>`

**Props:**

| Prop | Type | Description |
|---|---|---|
| `title` | `string` | Page title |
| `breadcrumbs` | `Array<{ label, href? }>` | Optional breadcrumb trail |
| `actions` | `ReactNode` | Action buttons (right-aligned) |

### 7.7 `<LoadingSpinner>`

Centered spinner with optional text below. Uses brand color. Sizes: `sm`, `md`, `lg`.

### 7.8 `<EmptyState>`

**Props:** `icon` (lucide icon), `title`, `description`, `action?: { label, onClick }`.

Renders: centered layout with large icon, title, description text, and optional action button.

### 7.9 `<ConfirmDialog>`

Reusable confirmation dialog for destructive actions (delete, suspend, etc.).

**Props:** `open`, `onOpenChange`, `title`, `description`, `confirmLabel` (default "Confirm"), `confirmVariant` ("destructive" | "default"), `onConfirm`, `loading`.

Uses shadcn `AlertDialog`.

### 7.10 `<FilterSidebar>`

Collapsible panel that slides in from the left side of the data table area. Contains checkbox groups for filtering (status, department, etc.). Each module provides its own filter content via the `filterContent` prop on `<DataTableToolbar>`.

---

## 8. Zustand Auth Store (Finalized)

### 8.1 Tenant Auth Store

**File:** `src/stores/auth.store.ts`

**State shape:**

```
{
  // Auth state
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;

  // User
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    displayName: string | null;
    photoUrl: string | null;
    emailDomainType: 'company' | 'external';
    roles: string[];
    permissions: string[];
    mustResetPassword: boolean;
  } | null;

  // Tenant context
  tenant: {
    id: string;
    name: string;
    slug: string;
    schemaName: string;
    subscriptionTier: 'standard' | 'with_recruitment';
  } | null;

  // Actions
  setAuth: (accessToken, refreshToken, user, tenant) => void;
  updateTokens: (accessToken, refreshToken) => void;
  updatePermissions: (permissions: string[]) => void;
  logout: () => void;
}
```

**Persistence:** Persist `accessToken`, `refreshToken`, and `user` to localStorage (use Zustand `persist` middleware). On app load, hydrate from localStorage and validate tokens.

**Tenant info source:** The login response (Sprint 1E Section 4.1) should be extended to include `tenant: { id, name, slug, schemaName, subscriptionTier }`. This requires a minor update to Sprint 1E's login service to also return tenant info from `platform.tenants` after resolving the tenant via middleware.

### 8.2 Platform Auth Store

**File:** `src/stores/platform-auth.store.ts`

**State shape:**

```
{
  isAuthenticated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  admin: { id, email, name } | null;

  setAuth: (accessToken, refreshToken, admin) => void;
  updateTokens: (accessToken, refreshToken) => void;
  logout: () => void;
}
```

Same persistence pattern. Separate store from tenant auth — they never interfere.

---

## 9. API Client (Finalized)

### 9.1 Axios Instance

**File:** `src/services/api.ts`

**Base configuration:**
- `baseURL`: `process.env.NEXT_PUBLIC_API_URL` (default `http://localhost:3001/api`)
- Default headers: `Content-Type: application/json`

**Request interceptor:**
1. If tenant auth store has `accessToken` → add `Authorization: Bearer {token}`
2. If tenant auth store has `tenant.slug` → add `X-Tenant-Slug: {slug}` header (for localhost dev where subdomains aren't available)

**Response interceptor (token refresh):**
1. On `401` response:
   a. Check if refresh token exists in store
   b. If yes and not already refreshing → call `/api/auth/refresh`
   c. Queue any concurrent requests that fail during refresh
   d. On refresh success → update store tokens, retry all queued requests with new token
   e. On refresh failure → clear auth store, redirect to `/login`
2. Prevent infinite loops: if the 401 came from the refresh endpoint itself → don't retry

### 9.2 Platform API Client

**File:** `src/services/platform-api.ts`

Separate Axios instance for platform admin APIs:
- Same `baseURL`
- Request interceptor adds `Authorization: Bearer {platformAccessToken}` from platform auth store
- No `X-Tenant-Slug` header (platform routes bypass tenant middleware)
- Response interceptor refreshes via `/api/platform/auth/refresh`

---

## 10. Notification Integration (Frontend)

### 10.1 Socket.IO Client

**File:** `src/services/notification.ts`

**Connection logic:**
1. On tenant auth (user logged in), establish Socket.IO connection to `{API_URL}/notifications`
2. Pass `Authorization: Bearer {accessToken}` in handshake auth
3. Listen for `notification:new` event → update notification state
4. Listen for `notification:unread-count` event → update unread count
5. On logout → disconnect socket

**Install:** `npm install socket.io-client`

### 10.2 `useNotifications()` Hook

**File:** `src/hooks/useNotifications.ts`

**Returns:**

```
{
  unreadCount: number;
  notifications: Notification[];
  isLoading: boolean;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  fetchMore: () => void;
}
```

**Implementation:**
- Uses React Query for fetching notification list (`GET /api/notifications`)
- Subscribes to Socket.IO `notification:new` events to invalidate/update the query cache
- Maintains `unreadCount` from initial fetch + real-time WebSocket updates

---

## 11. Brand Theme Application

### 11.1 Tailwind Configuration

Ensure these are defined in `tailwind.config.ts` (from Sprint 1A, verify/update):

```
colors: {
  brand: {
    DEFAULT: '#011552',
    light: '#1a2d6d',
    dark: '#000d3b',
    50: '#e8ecf5',
    100: '#c5cde6',
    // ... full scale
  }
}

fontFamily: {
  sans: ['Inter', ...defaultTheme.fontFamily.sans],
}
```

### 11.2 CSS Custom Properties

Define in `globals.css` for shadcn/ui theming:

```
:root {
  --primary: 222 88% 17%;       /* #011552 in HSL */
  --primary-foreground: 0 0% 100%;
  --ring: 222 88% 17%;
  /* ... other shadcn variables */
}
```

This makes all shadcn components (buttons, inputs, badges, etc.) use the brand color automatically.

### 11.3 Brand Application Points

- Sidebar background: white with brand-colored active states
- Header: white background with subtle bottom border
- Primary buttons: brand color background, white text
- Links: brand color
- Focus rings: brand color
- Sidebar active item: brand color background at 10% opacity + brand text
- Logo area: brand color square with white "H"

---

## 12. Placeholder Pages

Create minimal placeholder pages for every route that will be built in future sprints. Each placeholder renders `<PageHeader>` with the module title and an `<EmptyState>` with "Coming soon" message. This ensures the sidebar navigation has valid destinations.

| Route | Title | Sprint Built |
|---|---|---|
| `/dashboard` | Dashboard | 7D |
| `/employees` | Employee Management | 3A |
| `/leave` | Leave Tracker | 4A |
| `/attendance` | Attendance | 5A |
| `/time-tracker` | Time Tracker | 4C |
| `/performance` | Performance | 5B |
| `/files` | Files | 5D |
| `/compensation` | Compensation | 6A |
| `/recruitment` | Recruitment | 6C |
| `/onboarding` | Onboarding | 7A |
| `/offboarding` | Offboarding | 6F |
| `/reports` | Reports | 7C |
| `/settings` | Settings | Module sprints |
| `/account/profile` | My Profile | 2C |
| `/platform/dashboard` | Platform Dashboard | 2A |
| `/platform/tenants` | Tenant Management | 2A |
| `/platform/billing` | Billing | 2B |
| `/platform/registrations` | Registration Requests | 2B |
| `/platform/admins` | Super Admin Management | 2B |

---

## 13. Additional Dependencies

```
frontend: npm install @tanstack/react-table socket.io-client zustand
```

`@tanstack/react-table` is needed for the `<DataTable>` component. `socket.io-client` for real-time notifications. `zustand` may already be installed from Sprint 1A — verify.

Also ensure `react-hook-form` and `zod` are installed (PRD 2.1 specifies them):
```
frontend: npm install react-hook-form @hookform/resolvers zod
```

---

## 14. Retroactive Sprint 1E Update: Login Response Includes Tenant Info

Sprint 1E's `POST /api/auth/login` response currently returns:
```
{ accessToken, refreshToken, user: { ... } }
```

Extend to include tenant context:
```
{
  accessToken, refreshToken,
  user: { id, email, firstName, lastName, displayName, photoUrl, emailDomainType, roles, mustResetPassword },
  tenant: { id, name, slug, schemaName, subscriptionTier }
}
```

The tenant info is already available in `req.tenant` (set by `TenantMiddleware`). The login service just needs to include it in the response.

This is needed for:
- Sidebar recruitment visibility (subscription tier check)
- `X-Tenant-Slug` header in Axios interceptor
- Display tenant/org name in the shell

---

## 15. Scope Boundaries

### In Scope (Sprint 1H)
- All 4 route group layouts (finalized)
- Tenant shell (sidebar + header) with permission-based nav
- Platform admin shell (sidebar + header)
- 10 shared components (DataTable, ExportMenu, SearchBar, PageHeader, etc.)
- Finalized Zustand stores (tenant + platform)
- Finalized Axios client with token refresh
- Socket.IO client for notifications
- `useNotifications()` hook
- `useDebounce()` hook
- Brand theme applied across all components
- Placeholder pages for every future module
- Mobile sidebar responsiveness (hamburger toggle)

### Out of Scope
| Feature | Sprint |
|---|---|
| Actual module page content (employees, leave, etc.) | Module sprints |
| Global search API integration (search bar renders but search is placeholder) | Per-module |
| Quick-create forms (buttons render but forms are per-module) | Per-module |
| Settings page content (tile grid UI) | Settings sprint |
| Sidebar collapse to icon-only mode | Future enhancement |

---

## 16. Verification & Acceptance Criteria

### Visual Tests

- [ ] Navigate to `/login` → blank centered layout, no sidebar/header
- [ ] Navigate to `/register` → blank centered layout
- [ ] Log in as tenant user → redirected to `/dashboard` with tenant shell visible
- [ ] Tenant sidebar shows correct items based on user's role/permissions
- [ ] Employee-role user sees: Home, Leave Tracker, Attendance, Time Tracker, Performance, Files, Compensation
- [ ] Employee-role user does NOT see: Onboarding, Operations, Reports
- [ ] Admin-role user sees ALL sidebar items
- [ ] Recruitment only visible when user has permission AND tenant tier is `with_recruitment`
- [ ] "More" section expands/collapses, hidden if no sub-items visible
- [ ] Active sidebar item highlighted with brand color
- [ ] Header: logo, [+] button, search icon, notification bell, settings gear (admin only), avatar
- [ ] Notification bell shows red dot when `unreadCount > 0`
- [ ] Click notification bell → slide-out panel opens with notifications
- [ ] Click profile avatar → dropdown with My Profile, My Account, Sign Out
- [ ] Click Sign Out → clears state, redirects to `/login`
- [ ] Navigate to `/platform/login` → blank layout (no shell)
- [ ] Log in as platform admin → `/platform/dashboard` with platform shell
- [ ] Platform sidebar shows 5 items (Dashboard, Tenants, Billing, Registrations, Admins)
- [ ] All placeholder pages render with title and "Coming soon" empty state

### Functional Tests

- [ ] Axios interceptor adds `Authorization` and `X-Tenant-Slug` headers on tenant API calls
- [ ] Axios interceptor does NOT add `X-Tenant-Slug` on platform API calls
- [ ] Token refresh interceptor: when access token expires, refresh happens silently, original request retried
- [ ] If refresh fails → user redirected to `/login`
- [ ] Socket.IO connects on tenant login, disconnects on logout
- [ ] New notification via WebSocket updates bell badge in real-time
- [ ] `<DataTable>` renders with sortable columns, row selection checkboxes, pagination
- [ ] `<ExportMenu>` shows PDF, XLSX, CSV options in dropdown
- [ ] `<ConfirmDialog>` opens and returns confirmation/cancellation
- [ ] Brand color `#011552` applied to primary buttons, focus rings, active states
- [ ] Inter font loaded and applied as default sans-serif
- [ ] Mobile (below `md`): sidebar hidden, hamburger menu toggles slide-over drawer

### Full Checklist

- [ ] `(auth)` layout: blank centered, used by login/forgot-password/force-change
- [ ] `(public)` layout: blank centered, used by registration pages
- [ ] `(platform)` layout: platform shell with auth check → redirect to `/platform/login`
- [ ] `(tenant)` layout: tenant shell with `<RequireAuth>` + `mustResetPassword` redirect
- [ ] Tenant sidebar: 11 nav items with permission-based visibility
- [ ] Tenant header: logo, quick-create, search, notifications, settings, profile
- [ ] Platform sidebar: 5 items, no permission checks
- [ ] Platform header: logo + "HRMS Platform Admin" + admin profile dropdown
- [ ] `<DataTable>` component with TanStack Table, sorting, selection, pagination
- [ ] `<DataTablePagination>` with records-per-page and page navigation
- [ ] `<DataTableToolbar>` with search, primary action, filter, export
- [ ] `<ExportMenu>` three-dots dropdown (PDF, XLSX, CSV)
- [ ] `<SearchBar>` with debounce and clear button
- [ ] `<PageHeader>` with title, breadcrumbs, action buttons
- [ ] `<LoadingSpinner>`, `<EmptyState>`, `<ConfirmDialog>`, `<FilterSidebar>`
- [ ] Zustand tenant auth store: finalized with user + tenant + tokens + persistence
- [ ] Zustand platform auth store: separate store for platform admin
- [ ] Axios tenant client: auth header + tenant slug header + token refresh interceptor
- [ ] Axios platform client: separate instance for platform APIs
- [ ] Socket.IO notification client: connects on login, receives real-time events
- [ ] `useNotifications()` hook: unread count + notification list + mark-as-read
- [ ] `useDebounce()` hook
- [ ] Brand theme: `#011552` primary, Inter font, applied to all shadcn components
- [ ] Placeholder pages for all 19 future routes
- [ ] Mobile responsive: sidebar toggles via hamburger
- [ ] Sprint 1E retroactive: login response includes `tenant: { id, name, slug, schemaName, subscriptionTier }`
- [ ] `react-hook-form`, `zod`, `@tanstack/react-table`, `socket.io-client` installed

---

*Sprint 1H Complete. Sprint 1 — Core Infrastructure is now fully specified.*

*Next: Sprint 2A — Super Admin Dashboard & Tenant Management*
