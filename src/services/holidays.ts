/**
 * Holidays API client.
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

export interface Holiday {
  id: string;
  name: string;
  date: string;
  isOptional: boolean;
  year: number;
  dayOfWeek?: string;
  createdAt: string;
}

export interface ListHolidaysParams {
  year?: number;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: string;
}

export async function listHolidays(params: ListHolidaysParams = {}) {
  const q = new URLSearchParams();
  if (params.year != null) q.set('year', String(params.year));
  if (params.page != null) q.set('page', String(params.page));
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.sortBy) q.set('sortBy', params.sortBy);
  if (params.sortOrder) q.set('sortOrder', params.sortOrder);
  return request<Holiday[]>(`/holidays?${q}`);
}

export async function getHoliday(id: string) {
  return request<Holiday>(`/holidays/${id}`);
}

export interface CreateHolidayInput {
  name: string;
  date: string;
  isOptional?: boolean;
}

export async function createHoliday(body: CreateHolidayInput) {
  return request<Holiday>('/holidays', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateHoliday(id: string, body: Partial<CreateHolidayInput>) {
  return request<Holiday>(`/holidays/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteHoliday(id: string) {
  return request<{ message: string }>(`/holidays/${id}`, { method: 'DELETE' });
}

export function getHolidaysExportUrl(format: 'csv' | 'xlsx' = 'csv', year?: number) {
  const p = new URLSearchParams({ format });
  if (year != null) p.set('year', String(year));
  return `${getBase()}/holidays/export?${p}`;
}

export function getHolidayImportTemplateUrl() {
  return `${getBase()}/holidays/import/template`;
}

export async function importHolidays(file: File, dryRun: boolean) {
  const form = new FormData();
  form.append('file', file);
  form.append('dryRun', String(dryRun));
  const res = await fetch(`${getBase()}/holidays/import`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json as { success: boolean; data: { summary: { totalRows: number; imported: number; errors: number }; imported: unknown[]; errors: Array<{ row: number; message: string }> } };
}
