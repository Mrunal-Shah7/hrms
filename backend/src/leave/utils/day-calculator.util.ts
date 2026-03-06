/**
 * Business day calculation for leave: excludes weekends and holidays.
 * Half-day only valid for single-day requests.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface WorkSchedule {
  workingDays: number[] | string[];
}

export interface HolidayInRange {
  date: string;
  name: string;
  isOptional?: boolean;
}

export interface DayBreakdownItem {
  date: string;
  day: string;
  type: 'full' | 'first_half' | 'second_half' | 'holiday' | 'weekend';
  days: number;
  holiday?: string;
}

export interface CalculateLeaveDaysResult {
  totalDays: number;
  breakdown: DayBreakdownItem[];
  holidaysInRange: HolidayInRange[];
  weekendsInRange: number;
}

function dayOfWeek(date: Date): number {
  return date.getDay();
}

function isWorkingDay(date: Date, workSchedule: WorkSchedule): boolean {
  const dow = dayOfWeek(date);
  const wd = workSchedule.workingDays;
  if (wd.length === 0) return false;
  if (typeof wd[0] === 'number') {
    return (wd as number[]).includes(dow);
  }
  const key = DAY_KEYS[dow];
  return (wd as string[]).map((d) => d.toLowerCase()).includes(key);
}

function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isHoliday(date: Date, holidays: HolidayInRange[]): { name: string; isOptional?: boolean } | null {
  const ymd = dateToYmd(date);
  const h = holidays.find((x) => x.date === ymd);
  return h ? { name: h.name, isOptional: h.isOptional } : null;
}

/**
 * Computes leave days between start and end, excluding weekends and (mandatory) holidays.
 * Half-day only when startDate === endDate.
 */
export function calculateLeaveDays(
  startDate: Date,
  endDate: Date,
  durationType: 'full_day' | 'first_half' | 'second_half',
  holidays: HolidayInRange[],
  workSchedule: WorkSchedule,
): CalculateLeaveDaysResult {
  const breakdown: DayBreakdownItem[] = [];
  let totalDays = 0;
  let weekendsInRange = 0;
  const holidaysInRange: HolidayInRange[] = [];
  const isSingleDay = dateToYmd(startDate) === dateToYmd(endDate);
  const useHalfDay = isSingleDay && (durationType === 'first_half' || durationType === 'second_half');
  const dayIncr = durationType === 'full_day' || !isSingleDay ? 1 : 0.5;

  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (cur <= end) {
    const ymd = dateToYmd(cur);
    const dow = dayOfWeek(cur);
    const dayName = DAY_NAMES[dow];
    const working = isWorkingDay(cur, workSchedule);
    const holiday = isHoliday(cur, holidays);

    if (!working) {
      breakdown.push({
        date: ymd,
        day: dayName,
        type: 'weekend',
        days: 0,
      });
      weekendsInRange++;
    } else if (holiday && !holiday.isOptional) {
      breakdown.push({
        date: ymd,
        day: dayName,
        type: 'holiday',
        days: 0,
        holiday: holiday.name,
      });
      holidaysInRange.push({ date: ymd, name: holiday.name, isOptional: holiday.isOptional });
    } else {
      const days = useHalfDay ? 0.5 : 1;
      breakdown.push({
        date: ymd,
        day: dayName,
        type: useHalfDay ? durationType : 'full',
        days,
      });
      totalDays += days;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return {
    totalDays,
    breakdown,
    holidaysInRange,
    weekendsInRange,
  };
}
