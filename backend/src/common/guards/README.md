# Account & Subscription Guards

## SubscriptionTierGuard + @RequireTier()

Gates routes by subscription tier. Used for Recruitment module (Sprint 6C+).

**Usage (when Recruitment is built):**
```ts
@UseGuards(TenantAuthGuard, SubscriptionTierGuard, PermissionGuard)
@RequireTier('with_recruitment')
@Controller('recruitment')
export class RecruitmentController { ... }
```

**Execution order:** TenantAuthGuard → SubscriptionTierGuard → PermissionGuard

**JWT:** `subscriptionTier` must be in the access token payload (from login/refresh).

---

## SeatLimitGuard + @CheckSeatLimit()

Prevents employee creation when `current_user_count >= max_users`.

**Usage (when Employee CRUD is built in Sprint 3A):**
```ts
@Post()
@UseGuards(TenantAuthGuard, PermissionGuard, SeatLimitGuard)
@RequirePermission('employee_management', 'create', 'employees')
@CheckSeatLimit()
async createEmployee(@Body() dto: CreateEmployeeDto) { ... }
```

**current_user_count maintenance:**
- Increment after creating user: `UPDATE platform.tenants SET current_user_count = current_user_count + 1 WHERE id = $1`
- Decrement after archiving user: `UPDATE platform.tenants SET current_user_count = current_user_count - 1 WHERE id = $1`
- Daily cron (2 AM) runs `PlatformTenantsService.recountUsers()` for all tenants to fix drift.
