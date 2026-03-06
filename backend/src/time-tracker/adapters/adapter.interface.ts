import type { PrismaClient } from '@prisma/client';

/** Raw event format from an external system; shape varies per provider. */
export type RawPunchEvent = Record<string, unknown>;

/** Normalized event format for insertion into time_logs. */
export interface StandardPunchEvent {
  employeeIdentifier: string;
  punchType: 'in' | 'out';
  punchTime: Date;
  rawData: object | null;
}

/** Execution context passed so adapters can run tenant-scoped queries (e.g. MockAdapter). */
export interface AdapterContext {
  tx: PrismaClient;
}

export interface TimeTrackerAdapter {
  /**
   * Fetch punch events from the external system since the given date.
   * For mock adapter, context.tx is used to query employees and work schedule.
   */
  fetchLogs(since: Date, context?: AdapterContext): Promise<RawPunchEvent[]>;

  /** Map raw provider events to the standard format. */
  mapToStandardFormat(raw: RawPunchEvent[]): StandardPunchEvent[];

  /** Test connectivity / credentials. */
  testConnection(): Promise<{ success: boolean; message: string }>;
}
