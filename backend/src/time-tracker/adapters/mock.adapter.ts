import type { PrismaClient } from '@prisma/client';
import type {
  AdapterContext,
  RawPunchEvent,
  StandardPunchEvent,
  TimeTrackerAdapter,
} from './adapter.interface';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MAX_LOOKBACK_DAYS = 90;

export interface MockAdapterConfig {
  daysToGenerate?: number;
  punchVarianceMinutes?: number;
  missedPunchRate?: number;
  absentRate?: number;
  overtimeRate?: number;
  lateArrivalRate?: number;
  employeeMatchField?: 'email' | 'employee_id';
}

const DEFAULT_CONFIG: Required<MockAdapterConfig> = {
  daysToGenerate: 30,
  punchVarianceMinutes: 30,
  missedPunchRate: 0.05,
  absentRate: 0.03,
  overtimeRate: 0.1,
  lateArrivalRate: 0.15,
  employeeMatchField: 'employee_id',
};

function parseTimeHHMM(s: string): { hours: number; minutes: number } {
  const [h, m] = s.split(':').map(Number);
  return { hours: h ?? 0, minutes: m ?? 0 };
}

function addMinutes(date: Date, minutes: number): Date {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + minutes);
  return d;
}

function isWorkingDay(date: Date, workingDays: string[]): boolean {
  const dayName = DAY_NAMES[date.getDay()];
  return workingDays.includes(dayName);
}

export class MockAdapter implements TimeTrackerAdapter {
  constructor(private readonly config: MockAdapterConfig = {}) {}

  private get cfg(): Required<MockAdapterConfig> {
    return { ...DEFAULT_CONFIG, ...this.config };
  }

  async fetchLogs(since: Date, context?: AdapterContext): Promise<RawPunchEvent[]> {
    if (!context?.tx) {
      throw new Error('MockAdapter requires AdapterContext.tx to fetch employees and work schedule');
    }
    const tx = context.tx as PrismaClient;

    const employees = await tx.$queryRawUnsafe<
      Array<{ id: string; employee_id: string | null; email: string }>
    >(
      `SELECT id, employee_id, email FROM users WHERE status = 'active'`,
    );

    const scheduleRows = await tx.$queryRawUnsafe<
      Array<{
        start_time: string;
        end_time: string;
        working_days: unknown;
      }>
    >(`SELECT start_time, end_time, working_days FROM work_schedule WHERE is_default = true LIMIT 1`);

    if (scheduleRows.length === 0) {
      return [];
    }

    const ws = scheduleRows[0];
    const workingDays = Array.isArray(ws.working_days)
      ? (ws.working_days as string[])
      : (typeof ws.working_days === 'string' ? JSON.parse(ws.working_days) : []) as string[];

    const start = parseTimeHHMM(ws.start_time);
    const end = parseTimeHHMM(ws.end_time);

    const daysToGen = Math.min(this.cfg.daysToGenerate, MAX_LOOKBACK_DAYS);
    const windowEnd = new Date();
    windowEnd.setHours(0, 0, 0, 0);
    const windowStart = new Date(windowEnd);
    windowStart.setDate(windowStart.getDate() - daysToGen);

    const events: RawPunchEvent[] = [];
    const matchField = this.cfg.employeeMatchField;

    for (const emp of employees) {
      const identifier =
        matchField === 'email' ? emp.email : (emp.employee_id ?? emp.id);
      if (!identifier) continue;

      for (let d = 0; d < daysToGen; d++) {
        const date = new Date(windowStart);
        date.setDate(date.getDate() + d);
        if (date >= windowEnd) break;
        if (!isWorkingDay(date, workingDays)) continue;

        if (Math.random() < this.cfg.absentRate) continue;

        const varianceIn = (Math.random() * 2 - 1) * this.cfg.punchVarianceMinutes;
        let punchInMinutes = start.hours * 60 + start.minutes + varianceIn;
        if (Math.random() < this.cfg.lateArrivalRate) {
          punchInMinutes += 20 + Math.random() * 25;
        }
        const punchIn = new Date(date);
        punchIn.setHours(0, 0, 0, 0);
        punchIn.setMinutes(punchIn.getMinutes() + Math.round(punchInMinutes));

        const varianceOut = (Math.random() * 2 - 1) * this.cfg.punchVarianceMinutes;
        let punchOutMinutes = end.hours * 60 + end.minutes + varianceOut;
        if (Math.random() < this.cfg.overtimeRate) {
          punchOutMinutes += 30 + Math.random() * 90;
        }
        const punchOut = new Date(date);
        punchOut.setHours(0, 0, 0, 0);
        punchOut.setMinutes(punchOut.getMinutes() + Math.round(punchOutMinutes));

        events.push({
          employeeIdentifier: identifier,
          punchType: 'in',
          punchTime: punchIn.toISOString(),
        });
        if (Math.random() >= this.cfg.missedPunchRate) {
          events.push({
            employeeIdentifier: identifier,
            punchType: 'out',
            punchTime: punchOut.toISOString(),
          });
        }
      }
    }

    return events;
  }

  mapToStandardFormat(raw: RawPunchEvent[]): StandardPunchEvent[] {
    return raw.map((r) => ({
      employeeIdentifier: String(r.employeeIdentifier ?? ''),
      punchType: (r.punchType as 'in' | 'out') ?? 'in',
      punchTime: new Date((r.punchTime as string) ?? Date.now()),
      rawData: { ...r } as object,
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Mock adapter is always available' };
  }
}
