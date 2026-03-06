/**
 * Leave Balance Engine API client.
 */

const getBase = () => (typeof window !== 'undefined' ? '' : process.env.NEXT_PUBLIC_API_URL ?? '') + '/api';

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

export interface GenerateBalancesInput {
  year: number;
  userId?: string;
  dryRun?: boolean;
}

export interface GenerateBalancesResult {
  dryRun: boolean;
  year: number;
  summary: {
    employeesProcessed: number;
    balancesCreated: number;
    balancesUpdated: number;
    carryForwardsApplied: number;
  };
}

export async function generateBalances(body: GenerateBalancesInput) {
  return request<GenerateBalancesResult>('/leave/balances/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface BalanceStatus {
  year: number;
  leaveYearLabel: string;
  totalActiveEmployees: number;
  employeesWithBalances: number;
  employeesWithoutBalances: number;
  missingEmployees: Array<{ id: string; employeeId: string | null; firstName: string; lastName: string }>;
  lastGeneratedAt: string | null;
}

export async function getBalanceStatus(year: number) {
  return request<BalanceStatus>(`/leave/balances/status?year=${year}`);
}

export function getBalanceImportTemplateUrl() {
  return `${getBase()}/leave/balances/import/template`;
}

export interface BalanceImportResult {
  summary: { totalRows: number; imported: number; errors: number };
  imported: unknown[];
  errors: Array<{ row: number; message: string }>;
}

export async function importLeaveBalances(file: File, dryRun: boolean) {
  const form = new FormData();
  form.append('file', file);
  form.append('dryRun', String(dryRun));
  const res = await fetch(`${getBase()}/leave/balances/import`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? res.statusText);
  return json as { success: boolean; data: BalanceImportResult };
}
