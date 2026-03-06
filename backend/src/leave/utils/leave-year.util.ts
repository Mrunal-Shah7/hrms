/**
 * Financial-year-aware leave year utilities.
 * Leave year is determined by organization_settings.financial_year_start_month.
 */

/**
 * Returns the leave year (integer) for a given date.
 * The leave year is identified by the calendar year of its start date.
 * E.g. financialYearStartMonth = 4: Feb 15, 2026 → 2025 (Apr 2025 – Mar 2026);
 *      Jun 1, 2026 → 2026 (Apr 2026 – Mar 2027).
 */
export function getLeaveYear(date: Date, financialYearStartMonth: number): number {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  if (month >= financialYearStartMonth) {
    return year;
  }
  return year - 1;
}

/**
 * Returns the start and end dates of a leave year.
 * E.g. getLeaveYearRange(2026, 4) → { startDate: 2026-04-01, endDate: 2027-03-31 }.
 */
export function getLeaveYearRange(
  year: number,
  financialYearStartMonth: number,
): { startDate: Date; endDate: Date } {
  const startDate = new Date(year, financialYearStartMonth - 1, 1);
  const endDate = new Date(year + 1, financialYearStartMonth - 1, 0); // last day of previous month
  return { startDate, endDate };
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Returns a display label for the leave year, e.g. "Apr 2026 – Mar 2027" or "Jan 2026 – Dec 2026".
 */
export function getLeaveYearLabel(year: number, financialYearStartMonth: number): string {
  const start = new Date(year, financialYearStartMonth - 1, 1);
  const end = new Date(year + 1, financialYearStartMonth - 1, 0);
  const startLabel = `${MONTH_NAMES[start.getMonth()]} ${start.getFullYear()}`;
  const endLabel = `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
  return `${startLabel} – ${endLabel}`;
}
