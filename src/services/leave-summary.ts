/**
 * Leave Summary, Balance, Team & Reportees API client.
 */

const getBase = () =>
  (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

async function request<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data?: T }> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json;
}

// --- Summary ---

export interface LeaveTypeSummaryRef {
  id: string;
  name: string;
  code: string;
  color: string | null;
  icon: string | null;
  isPaid: boolean;
}

export interface SummaryBalance {
  leaveType: LeaveTypeSummaryRef;
  available: number;
  booked: number;
  totalAllocated: number;
  carriedForward: number;
}

export interface UpcomingLeave {
  id: string;
  leaveType: { name: string; color: string | null };
  startDate: string;
  endDate: string;
  totalDays: number;
  status: string;
}

export interface PastLeave {
  id: string;
  leaveType: { name: string; color: string | null };
  startDate: string;
  endDate: string;
  totalDays: number;
  status: string;
  reason: string | null;
}

export interface UpcomingHoliday {
  name: string;
  date: string;
  isOptional: boolean;
}

export interface LeaveSummary {
  year: number;
  leaveYearLabel: string;
  yearStats: { totalBooked: number; totalAbsent: number };
  balances: SummaryBalance[];
  upcomingLeaves: UpcomingLeave[];
  pastLeaves: PastLeave[];
  upcomingHolidays: UpcomingHoliday[];
}

export async function getLeaveSummary(year?: number, userId?: string) {
  const q = new URLSearchParams();
  if (year != null) q.set('year', String(year));
  if (userId) q.set('userId', userId);
  const path = q.toString() ? `/leave/summary?${q}` : '/leave/summary';
  return request<LeaveSummary>(path);
}

// --- Balance ---

export interface BalanceRow {
  leaveType: {
    id: string;
    name: string;
    code: string;
    color: string | null;
    icon: string | null;
    isPaid: boolean;
    maxConsecutiveDays: number | null;
  };
  totalAllocated: number;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

export async function getLeaveBalance(year?: number, userId?: string) {
  const q = new URLSearchParams();
  if (year != null) q.set('year', String(year));
  if (userId) q.set('userId', userId);
  const path = q.toString() ? `/leave/balance?${q}` : '/leave/balance';
  return request<BalanceRow[]>(path);
}

// --- Team & Reportees ---

export interface TeamOnLeaveEntry {
  employee: {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    department: string | null;
    designation: string | null;
  };
  leaveType: { name: string; color: string | null };
  startDate: string;
  endDate: string;
  durationType: string;
  totalDays: number;
}

export async function getTeamOnLeave(date?: string, departmentId?: string) {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  if (departmentId) q.set('departmentId', departmentId);
  const path = q.toString() ? `/leave/team?${q}` : '/leave/team';
  return request<TeamOnLeaveEntry[]>(path);
}

export async function getReporteesOnLeave(date?: string) {
  const path = date ? `/leave/reportees?date=${encodeURIComponent(date)}` : '/leave/reportees';
  return request<TeamOnLeaveEntry[]>(path);
}
