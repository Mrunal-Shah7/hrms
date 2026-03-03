export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  subscriptionTier: 'standard' | 'with_recruitment';
  maxUsers: number;
  currentUserCount: number;
  status: 'active' | 'suspended' | 'cancelled' | 'trial';
  customDomain: string | null;
}

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  billingEmail: string;
  subscriptionTier: 'standard' | 'with_recruitment';
  maxUsers: number;
  customDomain?: string;
  registrationSource: 'self_service' | 'super_admin';
  adminName: string;
  adminEmail: string;
  adminPasswordHash: string;
}

export interface ProvisionTenantResult {
  tenantId: string;
  schemaName: string;
  adminUserId: string;
  slug: string;
}
