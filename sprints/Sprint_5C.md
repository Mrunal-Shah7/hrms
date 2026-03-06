# Sprint 5C — Files Module

## Goal
Build the Files module: a three-scope file browser (My Files / Team / Organization), folder CRUD with nested navigation, file upload via the existing `FileStorageService` (Sprint 1G), file download with access-controlled streaming, file deletion (owner or admin), file sharing with individual users at view or edit permission levels, a "Shared with me" view, search across files, and the `file_shared` notification event. By the end, every employee has a personal file space, departments have shared team folders, and admins can manage organization-wide documents.

---

## 1. What Already Exists

| Component | Sprint | Status |
|---|---|---|
| `file_records` table (id, name, mime_type, file_size, storage_id, folder_id, scope, owner_id, department_id, created_at, updated_at) | 1A / 1B | ✅ |
| `file_folders` table (id, name, parent_id, scope, owner_id, created_at, updated_at) | 1A / 1B | ✅ |
| `file_shares` table (id, file_record_id, shared_with_id, permission, created_at; UNIQUE file_record_id+shared_with_id) | 1A / 1B | ✅ |
| `file_storage` table (id, file_name, original_name, mime_type, file_size, data BYTEA, uploaded_by, context, context_id, created_at) | 1A / 1B | ✅ |
| `FileStorageService` with `upload`, `download`, `delete`, `getUrl` (PostgreSQL BYTEA provider) | 1G | ✅ |
| `GET /api/files/download/:id` — low-level file download serving from `file_storage` (gap fix endpoint in CoreModule) | Gap Fix 1 | ✅ |
| Seeded permissions: `files:view:files`, `files:create:files`, `files:delete:files`, `files:share:files` | 1B | ✅ |
| Admin/HR Admin/HR Manager/Manager: view + create + delete + share files | 1B | ✅ |
| Employee: view + create + delete (no share) | 1B | ✅ |
| Notification type seeded: `file_shared` (in-app only, email disabled) | Gap Fix 3 | ✅ |
| `/files` placeholder page in sidebar | 1H | ✅ |

---

## 2. Architecture: Two-Layer File System

The Files module uses a **two-layer** architecture:

**Layer 1 — `file_storage` (Sprint 1G):** Low-level blob storage. Stores the actual binary data as BYTEA. Managed by `FileStorageService`. Has no concept of scope, folders, or sharing. Used by other modules too (profile photos, resume uploads, etc.).

**Layer 2 — `file_records` / `file_folders` / `file_shares` (this sprint):** High-level metadata layer. Stores scope (personal/team/org), folder hierarchy, ownership, sharing. References `file_storage.id` via `storage_id` for the actual blob.

**Upload flow:** Multipart file → `FileStorageService.upload()` → blob saved in `file_storage` → create `file_records` row linking to `storage_id` + scope/folder/owner metadata.

**Download flow:** Validate access via `file_records` → fetch `storage_id` → `FileStorageService.download()` → stream to client.

**Delete flow:** Validate ownership → delete `file_records` row → `FileStorageService.delete(storageId)` → blob removed from `file_storage`.

---

## 3. Files to Create

### Backend
| File | Purpose |
|---|---|
| `src/files/files.module.ts` | NestJS module |
| `src/files/files.controller.ts` | File list, upload, download, delete |
| `src/files/files.service.ts` | File business logic + access control |
| `src/files/folders/folders.controller.ts` | Folder CRUD |
| `src/files/folders/folders.service.ts` | Folder business logic |
| `src/files/folders/dto/create-folder.dto.ts` | Create DTO |
| `src/files/folders/dto/update-folder.dto.ts` | Update DTO |
| `src/files/folders/dto/index.ts` | Barrel |
| `src/files/sharing/sharing.controller.ts` | Share/unshare + shared-with-me |
| `src/files/sharing/sharing.service.ts` | Sharing business logic |
| `src/files/sharing/dto/share-file.dto.ts` | Share DTO |
| `src/files/sharing/dto/index.ts` | Barrel |
| `src/files/dto/upload-file.dto.ts` | Upload metadata DTO |

### Frontend
| File | Purpose |
|---|---|
| `src/app/(tenant)/files/page.tsx` | Files page (replaces placeholder) |
| `src/app/(tenant)/files/layout.tsx` | Layout with My Files / Team / Organization tabs |
| `src/components/modules/files/file-browser.tsx` | File browser component (table + breadcrumbs) |
| `src/components/modules/files/folder-tree-sidebar.tsx` | Folder tree navigation sidebar |
| `src/components/modules/files/upload-dialog.tsx` | File upload dialog |
| `src/components/modules/files/share-dialog.tsx` | Share file with users dialog |
| `src/components/modules/files/file-detail-drawer.tsx` | File detail + share info drawer |
| `src/components/modules/files/create-folder-modal.tsx` | Create folder modal |
| `src/services/files.ts` | Files API helpers |

### Module Registration
- Import `FilesModule` into `AppModule`

---

## 4. Scope Definitions

### 4.1 Three Scopes

| Scope | `scope` value | Visibility | Who Can Upload | Who Can Delete |
|---|---|---|---|---|
| My Files | `personal` | Only the owner | Any user | Owner only |
| Team | `team` | All members of the owner's department | Any user in that department | Owner or Admin |
| Organization | `organization` | All employees in the tenant | Admin/HR only | Admin only |

### 4.2 Scope Access Rules

**Personal (`scope = 'personal'`):**
- Owner sees their own files. No one else can see them (unless shared via `file_shares`).
- Any user can create personal files/folders.

**Team (`scope = 'team'`):**
- Files are visible to all active users in the same department as the `department_id` on the file record.
- When a user uploads to "Team", the file's `department_id` is set to the uploader's department (from `employee_profiles.department_id`).
- Any user in that department can upload to the team scope.
- Only the owner or Admin can delete team files.

**Organization (`scope = 'organization'`):**
- Files are visible to ALL active employees in the tenant.
- Only Admin/HR Admin can upload to the organization scope.
- Only Admin can delete organization files.

### 4.3 Sharing (Cross-Scope Access)

File sharing adds individual user access to any file, regardless of scope:
- A personal file shared with another user → that user can see it in "Shared with me"
- A team file shared with a user in another department → that user gains access
- Permission levels: `view` (can download) or `edit` (can download + replace the file)

---

## 5. Folder API

Folders provide hierarchical organization within each scope. Folders are scope-specific — a personal folder cannot be mixed with team files.

Controller prefix: `files/folders`.

### 5.1 `GET /api/files/folders` — List Folders

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `scope` | string | `personal` | `personal`, `team`, `organization` |
| `parentId` | UUID | null (root) | Parent folder ID. `null` or omitted = root level. |
| `departmentId` | UUID | — | Required for team scope if Admin/HR is browsing another department |

**Service Logic:**

For personal scope:
```
SELECT id, name, parent_id, scope, owner_id, created_at, updated_at
FROM file_folders
WHERE scope = 'personal' AND owner_id = $currentUserId
  AND (parent_id = $parentId OR ($parentId IS NULL AND parent_id IS NULL))
ORDER BY name ASC
```

For team scope:
```
WHERE scope = 'team' AND owner_id IN (
  SELECT u.id FROM users u
  JOIN employee_profiles ep ON u.id = ep.user_id
  WHERE ep.department_id = $userDepartmentId
) AND (parent_id = $parentId OR ...)
```

For organization scope:
```
WHERE scope = 'organization' AND (parent_id = $parentId OR ...)
```

**Response:**
```
{
  success: true,
  data: [
    {
      id, name, parentId, scope,
      owner: { id, firstName, lastName },
      fileCount: number,  // files directly in this folder
      subFolderCount: number,
      createdAt, updatedAt
    }
  ]
}
```

---

### 5.2 `POST /api/files/folders` — Create Folder

**Permission:** `@RequirePermission('files', 'create', 'files')`
**Audit:** `@AuditAction('create', 'files', 'folders')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsNotEmpty()`, `@MaxLength(255)` | Yes |
| `scope` | string | `@IsIn(['personal', 'team', 'organization'])` | Yes |
| `parentId` | UUID | `@IsOptional()`, `@IsUUID()` | No |

**Service Logic:**
1. Scope access check:
   - `organization` → only Admin/HR → `403`
   - `team` → any user (folder created in their department)
   - `personal` → any user
2. If `parentId` provided → validate parent exists and has the same `scope`
3. Validate name uniqueness within parent + scope + owner context:
   ```
   SELECT id FROM file_folders
   WHERE name = $name AND scope = $scope
     AND (parent_id = $parentId OR ($parentId IS NULL AND parent_id IS NULL))
     AND owner_id = $ownerId  -- for personal; broader check for team/org
   ```
   If found → `409 "A folder with this name already exists in this location"`
4. Folder depth limit: walk parent chain, max 5 levels
5. Insert with `owner_id = req.user.userId`

---

### 5.3 `PUT /api/files/folders/:id` — Rename Folder

**Permission:** `@RequirePermission('files', 'create', 'files')`
**Audit:** `@AuditAction('update', 'files', 'folders')`

**Access:** Owner or Admin.

**Request Body:** `name` (string, required). Uniqueness check within same parent.

---

### 5.4 `DELETE /api/files/folders/:id` — Delete Folder

**Permission:** `@RequirePermission('files', 'delete', 'files')`
**Audit:** `@AuditAction('delete', 'files', 'folders')`

**Access:** Owner or Admin.

**Service Logic:**
1. Check for files inside folder: `SELECT COUNT(*) FROM file_records WHERE folder_id = $id`
2. Check for sub-folders: `SELECT COUNT(*) FROM file_folders WHERE parent_id = $id`
3. If either > 0 → `400 "Cannot delete a folder that contains files or sub-folders. Remove them first."`
4. Delete folder row

---

### 5.5 `GET /api/files/folders/tree` — Folder Tree

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Query Parameters:** `scope` (required)

Returns the full folder hierarchy for the specified scope as a nested tree (same pattern as department tree from Sprint 3B).

```
{
  success: true,
  data: [
    {
      id, name, children: [
        { id, name, children: [] }
      ]
    }
  ]
}
```

---

## 6. Files API

Controller prefix: `files`.

### 6.1 `GET /api/files` — List Files

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `scope` | string | `personal` | `personal`, `team`, `organization` |
| `folderId` | UUID | null (root) | Folder to browse. `null` = root level of the scope. |
| `search` | string | — | Search by file name (ILIKE) |
| `page` | number | 1 | |
| `limit` | number | 25 | |
| `sortBy` | string | `name` | Sortable: `name`, `fileSize`, `createdAt`, `updatedAt` |
| `sortOrder` | string | `asc` | |

**Service Logic:**

Build query based on scope + access rules (Section 4.2).

```
SELECT fr.id, fr.name, fr.mime_type, fr.file_size, fr.storage_id,
       fr.folder_id, fr.scope, fr.owner_id, fr.department_id,
       fr.created_at, fr.updated_at,
       u.first_name AS owner_first_name, u.last_name AS owner_last_name,
       ff.name AS folder_name,
       (SELECT COUNT(*) FROM file_shares fs WHERE fs.file_record_id = fr.id) AS share_count
FROM file_records fr
LEFT JOIN users u ON fr.owner_id = u.id
LEFT JOIN file_folders ff ON fr.folder_id = ff.id
WHERE fr.scope = $scope
  AND (fr.folder_id = $folderId OR ($folderId IS NULL AND fr.folder_id IS NULL))
  ... scope access filters ...
```

If `search` is provided → search across ALL folders in the scope (ignore `folderId`): `AND fr.name ILIKE '%' || $search || '%'`

**Response:**
```
{
  success: true,
  data: {
    breadcrumbs: [
      { id: null, name: "Root" },
      { id: "{folderId}", name: "Policy" }
    ],
    folders: [
      { id, name, fileCount, subFolderCount, createdAt }
    ],
    files: [
      {
        id, name, mimeType, fileSize,
        owner: { id, firstName, lastName },
        folder: { id, name } | null,
        sharedWith: "All" | "{count} users" | null,
        shareCount: number,
        createdAt, updatedAt
      }
    ]
  },
  meta: { page, limit, total, totalPages }
}
```

**Breadcrumbs:** Walk the folder parent chain from `folderId` up to root. Returned in top-down order for the frontend to render as a clickable path.

**Combined response:** The response includes both folders and files at the current level. Folders are listed first (always unpaginated — typically few), files are paginated.

---

### 6.2 `POST /api/files/upload` — Upload File

**Permission:** `@RequirePermission('files', 'create', 'files')`
**Audit:** `@AuditAction('create', 'files', 'files')`

**Request:** `multipart/form-data`

| Field | Type | Validation | Required |
|---|---|---|---|
| `file` | File | Max size: 25MB. Allowed types: all common document/image/media types. | Yes |
| `scope` | string | `@IsIn(['personal', 'team', 'organization'])` | Yes |
| `folderId` | UUID | `@IsOptional()` | No |

**Service Logic:**
1. Scope access check:
   - `organization` → only Admin/HR
   - `team` → any user (will use their department)
   - `personal` → any user
2. If `folderId` provided → validate folder exists and scope matches
3. Validate file size ≤ 25MB → `400 "File size exceeds 25MB limit"`
4. Upload blob to `file_storage` via `FileStorageService.upload()`:
   ```
   const { id: storageId, url } = await FileStorageService.upload(file.buffer, {
     fileName: sanitizedFileName,
     originalName: file.originalname,
     mimeType: file.mimetype,
     fileSize: file.size,
     uploadedBy: req.user.userId,
     context: 'files_module',
     contextId: null
   });
   ```
5. Create `file_records` row:
   - `name = file.originalname`
   - `mime_type = file.mimetype`
   - `file_size = file.size`
   - `storage_id = storageId`
   - `folder_id = folderId`
   - `scope`
   - `owner_id = req.user.userId`
   - `department_id`: if scope is `team` → fetch from employee_profiles; if `organization` → null; if `personal` → null
6. Return created file record

**File name sanitization:** Strip path separators and dangerous characters. Preserve the original extension.

---

### 6.3 `GET /api/files/:id/download` — Download File (Access-Controlled)

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Note:** This is different from the gap-fix `GET /api/files/download/:id` which serves directly from `file_storage` by storage ID. This endpoint takes a `file_records.id`, validates access, then delegates to `FileStorageService`.

**Service Logic:**
1. Fetch file record: `SELECT * FROM file_records WHERE id = $id`
2. Validate access:
   - **Personal:** `owner_id === req.user.userId` OR file is shared with the user (`file_shares`)
   - **Team:** user is in the same department OR file is shared with user
   - **Organization:** any active user
   - Admin can download any file
3. If no access → `403 "You do not have access to this file"`
4. Fetch blob: `const { data, metadata } = await FileStorageService.download(file.storageId)`
5. Return as `StreamableFile` with:
   - `Content-Type: file.mimeType`
   - `Content-Disposition: attachment; filename="{file.name}"`

---

### 6.4 `DELETE /api/files/:id` — Delete File

**Permission:** `@RequirePermission('files', 'delete', 'files')`
**Audit:** `@AuditAction('delete', 'files', 'files')`

**Access:**
- Personal: owner only
- Team: owner or Admin
- Organization: Admin only

**Service Logic:**
1. Fetch file record
2. Access check per scope rules
3. Delete blob: `await FileStorageService.delete(file.storageId)`
4. Delete `file_records` row (cascades to `file_shares`)
5. Return `{ message: "File deleted" }`

---

### 6.5 `PUT /api/files/:id` — Update File Metadata

**Permission:** `@RequirePermission('files', 'create', 'files')`
**Audit:** `@AuditAction('update', 'files', 'files')`

**Access:** Owner, Admin, or users with `edit` share permission.

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `name` | string | `@IsOptional()`, `@MaxLength(255)` | No |
| `folderId` | UUID or null | `@IsOptional()` | No (move to different folder or root) |

This allows renaming files and moving them between folders within the same scope.

Validate new `folderId` (if provided) is in the same scope as the file.

---

## 7. Sharing API

Controller prefix: `files/sharing`.

### 7.1 `POST /api/files/:id/share` — Share File

**Permission:** `@RequirePermission('files', 'share', 'files')`
**Audit:** `@AuditAction('create', 'files', 'file_shares')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `userId` | UUID | `@IsUUID()` | Yes |
| `permission` | string | `@IsIn(['view', 'edit'])`, default `'view'` | No |

**Service Logic:**
1. Fetch file record → `404`
2. Validate caller is the owner or Admin → `403 "Only the file owner or admin can share files"`
3. Validate `userId` exists and active
4. Cannot share with self → `400 "Cannot share a file with yourself"`
5. Upsert into `file_shares`:
   ```
   INSERT INTO file_shares (file_record_id, shared_with_id, permission)
   VALUES ($fileId, $userId, $permission)
   ON CONFLICT (file_record_id, shared_with_id)
   DO UPDATE SET permission = $permission
   ```
   This means sharing again with the same user updates the permission level.
6. **Notification (PRD 23.1):**
   - Type: `file_shared`
   - Recipient: `userId`
   - Title: "File shared with you"
   - Message: "{ownerName} shared '{fileName}' with you ({permission} access)"
   - Data: `{ fileId, fileName, permission }`
   - In-app only (email disabled per PRD)
7. Return updated share info

---

### 7.2 `POST /api/files/:id/share/bulk` — Share File with Multiple Users

**Permission:** `@RequirePermission('files', 'share', 'files')`
**Audit:** `@AuditAction('create', 'files', 'file_shares')`

**Request Body:**

| Field | Type | Validation | Required |
|---|---|---|---|
| `shares` | array | `@IsArray()`, `@ArrayMinSize(1)` | Yes |
| `shares[].userId` | UUID | `@IsUUID()` | Yes |
| `shares[].permission` | string | `@IsIn(['view', 'edit'])`, default `'view'` | No |

Same logic as single share but batch-processed. Send one notification per recipient.

---

### 7.3 `DELETE /api/files/:id/share/:userId` — Unshare File

**Permission:** `@RequirePermission('files', 'share', 'files')`
**Audit:** `@AuditAction('delete', 'files', 'file_shares')`

**Access:** File owner or Admin.

Delete the `file_shares` row. Return `{ message: "File unshared" }`.

---

### 7.4 `GET /api/files/:id/shares` — List File Shares

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Access:** File owner, Admin, or anyone with share access to the file.

**Response:**
```
{
  success: true,
  data: [
    {
      id,
      user: { id, firstName, lastName, email, photoUrl },
      permission: "view" | "edit",
      createdAt
    }
  ]
}
```

---

### 7.5 `GET /api/files/shared-with-me` — Files Shared With Me

**Permission:** `@RequirePermission('files', 'view', 'files')`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | |
| `limit` | number | 25 | |
| `search` | string | — | Search by file name |
| `sortBy` | string | `createdAt` | Sort by share date |
| `sortOrder` | string | `desc` | |

**Service Logic:**
```
SELECT fr.id, fr.name, fr.mime_type, fr.file_size, fr.scope,
       fr.created_at AS file_created_at, fr.updated_at AS file_updated_at,
       u.first_name AS owner_first_name, u.last_name AS owner_last_name,
       fs.permission, fs.created_at AS shared_at
FROM file_shares fs
JOIN file_records fr ON fs.file_record_id = fr.id
JOIN users u ON fr.owner_id = u.id
WHERE fs.shared_with_id = $currentUserId
ORDER BY fs.created_at DESC
```

**Response:**
```
{
  success: true,
  data: [
    {
      id,  // file_records.id
      name, mimeType, fileSize, scope,
      owner: { id, firstName, lastName },
      permission: "view" | "edit",
      sharedAt,
      fileCreatedAt, fileUpdatedAt
    }
  ],
  meta: { page, limit, total, totalPages }
}
```

---

## 8. Frontend: Files Page

### 8.1 Route: `/files`

Reference: `files.png`

### 8.2 Layout

**Top tabs:** My Files | Team | Organization | Shared with me

Each tab sets the `scope` query parameter and reloads the file browser.

**Right toolbar:** "Manage" button (opens folder management), view toggle (list/grid), filter icon

### 8.3 File Browser Component

**Breadcrumbs bar:** Root > Folder A > Subfolder B (clickable for navigation)

**Combined view — folders first, then files:**

**List View (default, matching screenshot):**

| Column | Source | Notes |
|---|---|---|
| Icon | derived from `mimeType` | File type icon (doc, pdf, image, etc.) |
| Name | `name` | Clickable → download for files, navigate for folders |
| Shared with | `shareCount` | "All" for org scope, "{N} users" for shared files, "—" for unshared |
| Folder | `folder.name` | Only shown in search results |
| Updated on | `updatedAt` | Formatted date |
| Actions | — | Download, Share, Move, Rename, Delete (permission-gated) |

**Grid View:** Card grid with file icon, name, and metadata tooltip on hover.

**Folder rows:** Folder icon + name, click navigates into folder. Shows file count + subfolder count.

### 8.4 Upload Dialog

Triggered by "Upload" button (shown in toolbar per scope).

**Drag-and-drop zone** + "Browse Files" button.

- Accept: all common file types
- Max size: 25MB per file
- Multi-file upload: upload multiple files sequentially, show progress per file
- Target folder: current folder (or root if at root level)
- Progress bar per file

### 8.5 Create Folder Modal

"New Folder" button in the toolbar.

**Fields:**
- Folder Name (text, required)
- Location: current folder (pre-filled, non-editable — folder is created inside the currently navigated folder)

### 8.6 Share Dialog

Triggered by "Share" action on a file row.

**Layout:**
- File name displayed at top
- "Share with" field: searchable user select (uses `/api/employees/lookup`)
- Permission: radio "View" / "Edit"
- "Share" button
- Below: list of current shares (user avatar + name + permission badge + "Remove" button)

### 8.7 File Detail Drawer

Click file name (or info icon) → opens drawer:

**Content:**
- File name + icon
- Size (formatted: KB/MB)
- Type (mime type description)
- Owner (avatar + name)
- Scope badge (Personal / Team / Organization)
- Folder path
- Created date
- Last modified date
- Shares section: list of shared users + permissions (if any)

**Actions:** Download, Share, Move to Folder, Rename, Delete

### 8.8 Shared With Me Tab

Flat list (no folder hierarchy). Shows all files shared with the current user.

Table columns: File icon, Name (clickable → download), Owner, Permission badge (View/Edit), Shared date, Actions (Download)

---

## 9. Scope Boundaries

### In Scope (Sprint 5C)
- Folder CRUD (5 endpoints: list, create, rename, delete, tree)
- File list with scope-based access, folder navigation, search, breadcrumbs
- File upload via `FileStorageService` with metadata in `file_records`
- File download with access validation
- File delete (owner/admin per scope rules)
- File rename and move (within same scope)
- File sharing with individual users (share, bulk share, unshare, list shares)
- "Shared with me" view
- `file_shared` notification (in-app only)
- Three-scope file browser (My Files / Team / Organization)
- Folder tree sidebar navigation
- Upload dialog with drag-and-drop + multi-file support
- Share dialog with user search + permission selector
- File detail drawer
- Audit logging on all CUD operations

### Out of Scope
| Feature | Sprint |
|---|---|
| File versioning (replace with history) | Future |
| File preview (in-browser PDF/image render) | Future |
| Folder sharing (share entire folders) | Future |
| Storage quota per user/tenant | Future |
| File type restrictions (admin-configurable) | Future |
| Bulk file operations (multi-select + delete/move/share) | Future |
| S3/GCS storage provider switch | Future (provider interface exists from Sprint 1G) |
| File comments/annotations | Future |

---

## 10. Verification & Acceptance Criteria

### Folder Tests

**Test 1: Create personal folder**
```
POST /api/files/folders
Body: { name: "Documents", scope: "personal" }
→ 201: Folder created with owner_id = current user
```

**Test 2: Create nested folder**
```
POST /api/files/folders
Body: { name: "Invoices", scope: "personal", parentId: "{documentsId}" }
→ 201: Nested under Documents
```

**Test 3: Duplicate name in same parent**
```
POST /api/files/folders { name: "Documents", scope: "personal" }
→ 409: "A folder with this name already exists in this location"
```

**Test 4: Folder depth limit**
```
# Create 5 levels of folders, try to create 6th
→ 400: "Folder hierarchy cannot exceed 5 levels"
```

**Test 5: Cannot delete folder with files**
```
DELETE /api/files/folders/{id}  # has files inside
→ 400: "Cannot delete a folder that contains files or sub-folders"
```

**Test 6: Employee cannot create org folder**
```
POST /api/files/folders
Body: { name: "Policies", scope: "organization" }
Headers: Bearer <employee_token>
→ 403
```

**Test 7: Folder tree**
```
GET /api/files/folders/tree?scope=personal
→ 200: Nested tree structure
```

### File Upload Tests

**Test 8: Upload personal file**
```
POST /api/files/upload
Form: file=resume.pdf, scope=personal
→ 201: file_records row created, storage_id references file_storage

Verify:
- file_storage has the BYTEA blob
- file_records.name = "resume.pdf"
- file_records.scope = "personal"
- file_records.owner_id = current user
```

**Test 9: Upload to folder**
```
POST /api/files/upload
Form: file=report.docx, scope=personal, folderId={documentsId}
→ 201: file_records.folder_id = documentsId
```

**Test 10: Upload team file**
```
POST /api/files/upload
Form: file=guidelines.pdf, scope=team
→ 201: file_records.department_id = uploader's department
```

**Test 11: Employee cannot upload org file**
```
POST /api/files/upload
Form: file=policy.pdf, scope=organization
Headers: Bearer <employee_token>
→ 403
```

**Test 12: File too large**
```
POST /api/files/upload
Form: file=huge.zip (30MB), scope=personal
→ 400: "File size exceeds 25MB limit"
```

### Download Tests

**Test 13: Download own file**
```
GET /api/files/{id}/download
→ 200: StreamableFile with correct Content-Type and Content-Disposition
```

**Test 14: Download team file (same department)**
```
GET /api/files/{teamFileId}/download
Headers: Bearer <same_dept_user_token>
→ 200: File downloaded
```

**Test 15: Download team file (different department, no share)**
```
GET /api/files/{teamFileId}/download
Headers: Bearer <other_dept_token>
→ 403: "You do not have access to this file"
```

**Test 16: Download shared file (different department)**
```
# File shared with the user
GET /api/files/{teamFileId}/download
Headers: Bearer <shared_user_token>
→ 200: File downloaded
```

**Test 17: Download org file (any user)**
```
GET /api/files/{orgFileId}/download
Headers: Bearer <any_employee_token>
→ 200: File downloaded
```

### Delete Tests

**Test 18: Owner deletes personal file**
```
DELETE /api/files/{personalFileId}
→ 200: file_records deleted, file_storage blob deleted
```

**Test 19: Non-owner cannot delete personal file**
```
DELETE /api/files/{othersPersonalFileId}
Headers: Bearer <different_user_token>
→ 403
```

**Test 20: Admin can delete team file**
```
DELETE /api/files/{teamFileId}
Headers: Bearer <admin_token>
→ 200
```

**Test 21: Only admin can delete org file**
```
DELETE /api/files/{orgFileId}
Headers: Bearer <hr_token>
→ 403

DELETE /api/files/{orgFileId}
Headers: Bearer <admin_token>
→ 200
```

### Sharing Tests

**Test 22: Share file**
```
POST /api/files/{id}/share
Body: { userId: "{otherUserId}", permission: "view" }
→ 200: Share created

Verify: file_shared notification sent to the user (in-app only)
```

**Test 23: Bulk share**
```
POST /api/files/{id}/share/bulk
Body: { shares: [{ userId: "{user1}", permission: "view" }, { userId: "{user2}", permission: "edit" }] }
→ 200: 2 shares created
```

**Test 24: Update share permission (re-share same user)**
```
POST /api/files/{id}/share
Body: { userId: "{otherUserId}", permission: "edit" }
→ 200: Permission updated from view to edit
```

**Test 25: Unshare**
```
DELETE /api/files/{id}/share/{userId}
→ 200: Share removed
```

**Test 26: Cannot share with self**
```
POST /api/files/{id}/share
Body: { userId: "{ownUserId}" }
→ 400: "Cannot share a file with yourself"
```

**Test 27: Employee cannot share (no share permission)**
```
POST /api/files/{id}/share
Headers: Bearer <employee_token>
→ 403
```

**Test 28: List file shares**
```
GET /api/files/{id}/shares
→ 200: Array of { user, permission, createdAt }
```

**Test 29: Shared with me**
```
GET /api/files/shared-with-me
→ 200: Files shared with current user, with owner + permission info
```

### File Operations Tests

**Test 30: Rename file**
```
PUT /api/files/{id}
Body: { name: "Updated Report.pdf" }
→ 200: name updated
```

**Test 31: Move file to folder**
```
PUT /api/files/{id}
Body: { folderId: "{newFolderId}" }
→ 200: file moved

Verify: folderId updated, scope must match
```

**Test 32: Search files**
```
GET /api/files?scope=personal&search=report
→ 200: Files matching "report" across all personal folders
```

### Frontend Tests

- [ ] Files page: My Files / Team / Organization / Shared with me tabs
- [ ] File browser: breadcrumbs navigation (Root > Folder > Subfolder)
- [ ] Folders displayed above files, both in list view
- [ ] List view columns: icon, name, shared with, folder, updated on, actions
- [ ] Click folder → navigates into folder (updates breadcrumbs)
- [ ] Click file name → triggers download
- [ ] Upload dialog: drag-and-drop zone + browse button
- [ ] Multi-file upload with per-file progress bars
- [ ] Upload respects current scope and folder
- [ ] Create Folder modal: name input, creates in current location
- [ ] Share dialog: user search, view/edit permission, current shares listed
- [ ] Share → notification toast for shared user
- [ ] Remove share in share dialog
- [ ] File detail drawer: metadata + shares + action buttons
- [ ] Shared with me: flat file list with owner + permission badges
- [ ] Team tab: shows department files only
- [ ] Organization tab: shows all org files (upload restricted to Admin/HR)
- [ ] Actions permission-gated: share only for users with share permission, delete per scope rules
- [ ] Empty states per tab: "No files yet" + "Upload" call to action
- [ ] Mobile: file browser scrollable, upload dialog full-page, share dialog full-page

### Full Checklist

**Backend:**
- [ ] `GET /api/files/folders` — list folders by scope + parent
- [ ] `POST /api/files/folders` — create with scope access check, depth limit, uniqueness
- [ ] `PUT /api/files/folders/:id` — rename (owner/admin)
- [ ] `DELETE /api/files/folders/:id` — delete empty folders only
- [ ] `GET /api/files/folders/tree` — nested tree per scope
- [ ] `GET /api/files` — list files with scope access, folder navigation, search, breadcrumbs
- [ ] `POST /api/files/upload` — multipart upload → FileStorageService → file_records
- [ ] `GET /api/files/:id/download` — access-validated download
- [ ] `DELETE /api/files/:id` — delete with scope-based ownership rules
- [ ] `PUT /api/files/:id` — rename + move (within same scope)
- [ ] `POST /api/files/:id/share` — share with user + permission + notification
- [ ] `POST /api/files/:id/share/bulk` — batch share
- [ ] `DELETE /api/files/:id/share/:userId` — unshare
- [ ] `GET /api/files/:id/shares` — list file shares
- [ ] `GET /api/files/shared-with-me` — files shared with current user
- [ ] Scope access rules: personal=owner, team=department, org=all, share=override
- [ ] `file_shared` notification (in-app only)
- [ ] Audit logging on all file/folder CUD + sharing operations

**Frontend:**
- [ ] Three-scope file browser with tab navigation
- [ ] Breadcrumb folder navigation
- [ ] Upload dialog with drag-and-drop + progress
- [ ] Share dialog with user search + permission control
- [ ] File detail drawer with metadata + shares
- [ ] Shared with me tab
- [ ] Folder create/rename/delete
- [ ] File rename/move/download/delete

---

*Sprint 5C Complete. Files module fully built.*

*Sprint 5 (Attendance + Performance + Files) complete. Next: Sprint 6A — Compensation Module*
