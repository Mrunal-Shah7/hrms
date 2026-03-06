/**
 * Leave Types API client.
 * Base URL is assumed from env (e.g. NEXT_PUBLIC_API_URL) or relative /api.
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

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
  isPaid: boolean;
  maxConsecutiveDays: number | null;
  policyCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListLeaveTypesParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
}

export async function listLeaveTypes(params: ListLeaveTypesParams = {}) {
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.search) q.set('search', params.search);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<LeaveType[]>(`/leave/types?${q}`);
}

export async function getLeaveType(id: string) {
  return request<LeaveType>(`/leave/types/${id}`);
}

export interface CreateLeaveTypeInput {
  name: string;
  code: string;
  color?: string;
  icon?: string;
  isPaid: boolean;
  maxConsecutiveDays?: number;
}

export async function createLeaveType(body: CreateLeaveTypeInput) {
  return request<LeaveType>('/leave/types', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateLeaveType(id: string, body: Partial<CreateLeaveTypeInput>) {
  return request<LeaveType>(`/leave/types/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteLeaveType(id: string) {
  return request<{ message: string }>(`/leave/types/${id}`, { method: 'DELETE' });
}

export function getLeaveTypesExportUrl(format: 'csv' | 'xlsx' = 'csv') {
  return `${getBase()}/leave/types/export?format=${format}`;
}
