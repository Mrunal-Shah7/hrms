/**
 * Leave Requests API client.
 */

const getBase = () =>
  (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<{
  success: boolean;
  data?: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json;
}

// --- Types (aligned with backend responses) ---

export interface LeaveTypeRef {
  id: string;
  name: string;
  code: string;
  color: string | null;
}

export interface EmployeeRef {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  department: string | null;
  designation: string | null;
}

export interface ReviewerRef {
  firstName: string;
  lastName: string;
}

export interface LeaveRequestListItem {
  id: string;
  employee: EmployeeRef;
  leaveType: LeaveTypeRef;
  startDate: string;
  endDate: string;
  durationType: string;
  totalDays: number;
  reason: string | null;
  status: string;
  reviewer: ReviewerRef | null;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

export interface BreakdownRow {
  date: string;
  day: string;
  type: 'full' | 'first_half' | 'second_half' | 'holiday' | 'weekend';
  days: number;
  holiday?: string;
}

export interface BalanceImpact {
  asOnDate: string;
  availableBalance: number;
  currentBooking: number;
  balanceAfterBooking: number;
  asOnYearEnd: string;
  estimatedBalance: number;
}

export interface LeaveRequestDetail extends LeaveRequestListItem {
  teamEmail: string | null;
  dateOfRequest: string;
  breakdown: BreakdownRow[];
  balanceImpact: BalanceImpact;
}

export interface ListLeaveRequestsParams {
  page?: number;
  limit?: number;
  status?: string;
  leaveTypeId?: string;
  year?: number;
  userId?: string;
  sortBy?: string;
  sortOrder?: string;
}

export async function listLeaveRequests(params: ListLeaveRequestsParams = {}) {
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.status) q.set('status', params.status);
  if (params.leaveTypeId) q.set('leaveTypeId', params.leaveTypeId);
  if (params.year != null) q.set('year', String(params.year));
  if (params.userId) q.set('userId', params.userId);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<LeaveRequestListItem[]>(`/leave/requests?${q}`);
}

export async function getLeaveRequest(id: string) {
  return request<LeaveRequestDetail>(`/leave/requests/${id}`);
}

export interface PreviewLeaveDaysResult {
  totalDays: number;
  breakdown: BreakdownRow[];
  holidaysInRange: Array<{ date: string; name: string; isOptional?: boolean }>;
  message?: string;
}

export async function previewLeaveDays(
  startDate: string,
  endDate: string,
  durationType: 'full_day' | 'first_half' | 'second_half' = 'full_day'
) {
  const q = new URLSearchParams({ startDate, endDate, durationType });
  return request<PreviewLeaveDaysResult>(`/leave/requests/preview?${q}`);
}

export interface ApplyLeaveInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  durationType?: 'full_day' | 'first_half' | 'second_half';
  teamEmail?: string;
  reason?: string;
}

export interface ApplyLeaveResult {
  id: string;
  leaveType: LeaveTypeRef;
  startDate: string;
  endDate: string;
  durationType: string;
  totalDays: number;
  reason: string | null;
  status: string;
  createdAt: string;
  breakdown: BreakdownRow[];
  balanceImpact?: {
    currentAvailable: number;
    afterApproval: number;
    estimatedYearEnd: number;
  };
  warnings?: string[];
}

export async function applyLeave(body: ApplyLeaveInput) {
  return request<ApplyLeaveResult>('/leave/requests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface ReviewLeaveInput {
  action: 'approve' | 'reject';
  comment?: string;
}

export async function reviewLeave(id: string, body: ReviewLeaveInput) {
  return request<LeaveRequestDetail>(`/leave/requests/${id}/review`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function cancelLeaveRequest(id: string) {
  return request<LeaveRequestDetail>(`/leave/requests/${id}/cancel`, {
    method: 'PUT',
  });
}

export function getLeaveRequestsExportUrl(
  format: 'csv' | 'xlsx' | 'pdf',
  params?: ListLeaveRequestsParams
) {
  const q = new URLSearchParams({ format });
  if (params?.status) q.set('status', params.status);
  if (params?.year != null) q.set('year', String(params.year));
  if (params?.userId) q.set('userId', params.userId);
  if (params?.leaveTypeId) q.set('leaveTypeId', params.leaveTypeId);
  return `${getBase()}/leave/requests/export?${q}`;
}
