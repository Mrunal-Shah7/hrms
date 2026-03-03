import { SetMetadata } from '@nestjs/common';

export const CHECK_SEAT_LIMIT_KEY = 'check_seat_limit';

/**
 * Enables seat limit check before user/employee creation.
 * Applied to POST /employees and similar endpoints.
 */
export function CheckSeatLimit() {
  return SetMetadata(CHECK_SEAT_LIMIT_KEY, true);
}
