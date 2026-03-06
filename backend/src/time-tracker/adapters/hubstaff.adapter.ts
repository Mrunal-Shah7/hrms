import type {
  AdapterContext,
  RawPunchEvent,
  StandardPunchEvent,
  TimeTrackerAdapter,
} from './adapter.interface';

const NOT_IMPLEMENTED = 'Not Implemented';

export interface HubstaffAdapterConfig {
  apiToken?: string;
  organizationId?: string;
  employeeMatchField?: string;
}

export class HubstaffAdapter implements TimeTrackerAdapter {
  constructor(private readonly _config: HubstaffAdapterConfig = {}) {}

  async fetchLogs(_since: Date, _context?: AdapterContext): Promise<RawPunchEvent[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  mapToStandardFormat(raw: RawPunchEvent[]): StandardPunchEvent[] {
    return raw.map((r) => ({
      employeeIdentifier: String((r as { employeeIdentifier?: string }).employeeIdentifier ?? ''),
      punchType: ((r as { punchType?: 'in' | 'out' }).punchType as 'in' | 'out') ?? 'in',
      punchTime: new Date((r as { punchTime?: string }).punchTime ?? Date.now()),
      rawData: (r as object) ?? null,
    }));
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
