// ============================================================================
// Shared types, constants, and enums used by both frontend and backend
// ============================================================================

export const TenantStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CANCELLED: "cancelled",
  TRIAL: "trial",
} as const;

export const SubscriptionTier = {
  STANDARD: "standard",
  WITH_RECRUITMENT: "with_recruitment",
} as const;

export const UserStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  ARCHIVED: "archived",
} as const;

export const EmploymentType = {
  PERMANENT: "permanent",
  CONTRACT: "contract",
  INTERN: "intern",
  FREELANCE: "freelance",
} as const;

export const LeaveRequestStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

export const RegistrationSource = {
  SELF_SERVICE: "self_service",
  SUPER_ADMIN: "super_admin",
} as const;

export const RegistrationStatus = {
  PENDING: "pending",
  VERIFIED: "verified",
  PROVISIONED: "provisioned",
  FAILED: "failed",
} as const;

export const BillingStatus = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
} as const;

export const EmailDomainType = {
  COMPANY: "company",
  EXTERNAL: "external",
} as const;

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
