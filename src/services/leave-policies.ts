/**
 * Leave Policies API client.
 */

const getBase = () => (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

async function request<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T; meta?: { page: number; limit: number; total: number; totalPages: number } }> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json;
}

export interface LeavePolicy {
  id: string;
  leaveType: { id: string; name: string; code: string; color: string | null };
  designation: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  employmentType: string | null;
  annualAllocation: number;
  carryForward: boolean;
  maxCarryForward: number | null;
  accrualType: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListLeavePoliciesParams {
  page?: number;
  limit?: number;
  leaveTypeId?: string;
  departmentId?: string;
  designationId?: string;
  employmentType?: string;
  sortBy?: string;
  sortOrder?: string;
}

export async function listLeavePolicies(params: ListLeavePoliciesParams = {}) {
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.leaveTypeId) q.set('leaveTypeId', params.leaveTypeId);
  if (params.departmentId) q.set('departmentId', params.departmentId);
  if (params.designationId) q.set('designationId', params.designationId);
  if (params.employmentType) q.set('employmentType', params.employmentType);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<LeavePolicy[]>(`/leave/policies?${q}`);
}

export async function getLeavePolicy(id: string) {
  return request<LeavePolicy & { affectedEmployeeCount?: number }>(`/leave/policies/${id}`);
}

export interface PreviewPolicyParams {
  leaveTypeId: string;
  designationId?: string;
  departmentId?: string;
  employmentType?: string;
}

export async function previewPolicyImpact(params: PreviewPolicyParams) {
  const q = new URLSearchParams({ leaveTypeId: params.leaveTypeId });
  if (params.designationId) q.set('designationId', params.designationId);
  if (params.departmentId) q.set('departmentId', params.departmentId);
  if (params.employmentType) q.set('employmentType', params.employmentType);
  return request<{ affectedEmployeeCount: number; sampleEmployees: Array<{ id: string; employeeId: string | null; firstName: string; lastName: string }> }>(`/leave/policies/preview?${q}`);
}

export interface CreateLeavePolicyInput {
  leaveTypeId: string;
  designationId?: string;
  departmentId?: string;
  employmentType?: string;
  annualAllocation: number;
  carryForward: boolean;
  maxCarryForward?: number;
  accrualType: 'annual' | 'monthly' | 'quarterly';
}

export async function createLeavePolicy(body: CreateLeavePolicyInput) {
  return request<LeavePolicy>('/leave/policies', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateLeavePolicy(id: string, body: Partial<CreateLeavePolicyInput>) {
  return request<LeavePolicy>(`/leave/policies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteLeavePolicy(id: string) {
  return request<{ message: string }>(`/leave/policies/${id}`, { method: 'DELETE' });
}

export function getLeavePoliciesExportUrl(
  format: 'csv' | 'xlsx',
  params?: ListLeavePoliciesParams
) {
  const q = new URLSearchParams({ format });
  if (params?.leaveTypeId) q.set('leaveTypeId', params.leaveTypeId);
  if (params?.departmentId) q.set('departmentId', params.departmentId);
  if (params?.designationId) q.set('designationId', params.designationId);
  if (params?.employmentType) q.set('employmentType', params.employmentType);
  return `${getBase()}/leave/policies/export?${q}`;
}
