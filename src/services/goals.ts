/**
 * Goals API client (Performance module).
 */

const getBase = () =>
  (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; meta?: { page: number; limit: number; total: number; totalPages: number } }> {
  const res = await fetch(`${getBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json;
}

export interface AssignedToRef {
  type: 'user' | 'group' | 'project';
  id: string;
  name: string;
}

export interface CreatedByRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface GoalListItem {
  id: string;
  title: string;
  description: string | null;
  assignedTo: AssignedToRef;
  createdBy: CreatedByRef;
  priority: string;
  status: string;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressHistoryItem {
  id: string;
  user: { id: string; firstName: string; lastName: string; photoUrl: string | null };
  oldProgress: number;
  newProgress: number;
  note: string | null;
  createdAt: string;
}

export interface GoalDetail extends GoalListItem {
  progressHistory: ProgressHistoryItem[];
}

export type TimeFilter = 'all' | 'this_week' | 'last_week' | 'this_month' | 'last_month';

export interface ListGoalsParams {
  page?: number;
  limit?: number;
  assignedToType?: string;
  status?: string;
  priority?: string;
  filter?: TimeFilter;
  sortBy?: string;
  sortOrder?: string;
}

export async function listGoals(params: ListGoalsParams = {}) {
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.assignedToType) q.set('assignedToType', params.assignedToType);
  if (params.status) q.set('status', params.status);
  if (params.priority) q.set('priority', params.priority);
  if (params.filter) q.set('filter', params.filter);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<GoalListItem[]>(`/goals?${q}`);
}

export async function getGoal(id: string) {
  return request<GoalDetail>(`/goals/${id}`);
}

export interface CreateGoalInput {
  title: string;
  description?: string;
  assignedToId: string;
  assignedToType?: 'user' | 'group' | 'project';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  startDate?: string;
  dueDate?: string;
}

export async function createGoal(body: CreateGoalInput) {
  return request<GoalDetail>('/goals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface UpdateGoalInput {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  startDate?: string;
  dueDate?: string;
}

export async function updateGoal(id: string, body: UpdateGoalInput) {
  return request<GoalDetail>(`/goals/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export interface UpdateProgressInput {
  progress: number;
  note?: string;
}

export async function updateGoalProgress(id: string, body: UpdateProgressInput) {
  return request<GoalDetail>(`/goals/${id}/progress`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteGoal(id: string) {
  return request<{ message: string }>(`/goals/${id}`, { method: 'DELETE' });
}

export function getGoalsExportUrl(
  format: 'csv' | 'xlsx' | 'pdf',
  params?: { filter?: TimeFilter; status?: string; priority?: string; assignedToType?: string }
) {
  const q = new URLSearchParams({ format });
  if (params?.filter) q.set('filter', params.filter);
  if (params?.status) q.set('status', params.status);
  if (params?.priority) q.set('priority', params.priority);
  if (params?.assignedToType) q.set('assignedToType', params.assignedToType);
  return `${getBase()}/goals/export?${q}`;
}
