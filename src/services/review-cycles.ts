/**
 * Review cycles API client (Performance module).
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

export interface ReviewCycleListItem {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  reviewCount: number;
  submittedCount: number;
  acknowledgedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListReviewCyclesParams {
  page?: number;
  limit?: number;
  status?: string;
  sortBy?: string;
  sortOrder?: string;
}

export async function listReviewCycles(params: ListReviewCyclesParams = {}) {
  const q = new URLSearchParams();
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.status) q.set('status', params.status);
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<ReviewCycleListItem[]>(`/performance/review-cycles?${q}`);
}

export async function getReviewCycle(id: string) {
  return request<ReviewCycleListItem>(`/performance/review-cycles/${id}`);
}

export interface CreateCycleInput {
  name: string;
  type: 'quarterly' | 'annual' | 'custom';
  startDate: string;
  endDate: string;
}

export async function createReviewCycle(body: CreateCycleInput) {
  return request<ReviewCycleListItem>('/performance/review-cycles', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface UpdateCycleInput {
  name?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  status?: 'draft' | 'active' | 'completed';
}

export async function updateReviewCycle(id: string, body: UpdateCycleInput) {
  return request<ReviewCycleListItem>(`/performance/review-cycles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteReviewCycle(id: string) {
  return request<{ message: string }>(`/performance/review-cycles/${id}`, { method: 'DELETE' });
}
