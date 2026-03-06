/**
 * Performance reviews API client.
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

export interface CycleRef {
  id: string;
  name: string;
  type: string;
}

export interface SubjectRef {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  department: string | null;
  designation: string | null;
}

export interface ReviewerRef {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ReviewListItem {
  id: string;
  cycle: CycleRef;
  subject: SubjectRef;
  reviewer: ReviewerRef;
  rating: number | null;
  status: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface ReviewDetail extends ReviewListItem {
  cycle: CycleRef & { startDate: string; endDate: string };
  comments: string | null;
  strengths: string | null;
  improvements: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  updatedAt: string;
}

export interface ListReviewsParams {
  cycleId?: string;
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export async function listReviews(params: ListReviewsParams = {}) {
  const q = new URLSearchParams();
  if (params.cycleId) q.set('cycleId', params.cycleId);
  if (params.status) q.set('status', params.status);
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<ReviewListItem[]>(`/performance/reviews?${q}`);
}

export async function getReview(id: string) {
  return request<ReviewDetail>(`/performance/reviews/${id}`);
}

export interface CreateReviewInput {
  cycleId: string;
  subjectId: string;
  reviewerId: string;
}

export async function createReview(body: CreateReviewInput) {
  return request<ReviewDetail>('/performance/reviews', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface SubmitReviewInput {
  rating: number;
  comments?: string;
  strengths?: string;
  improvements?: string;
}

export async function submitReview(id: string, body: SubmitReviewInput) {
  return request<ReviewDetail>(`/performance/reviews/${id}/submit`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function acknowledgeReview(id: string) {
  return request<ReviewDetail>(`/performance/reviews/${id}/acknowledge`, {
    method: 'PUT',
  });
}
