import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom ThrottlerGuard that returns the Sprint 1E spec response format on 429.
 * {
 *   success: false,
 *   error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please try again in X seconds." }
 * }
 */
@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: { timeToBlockExpire?: number },
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(throttlerLimitDetail.timeToBlockExpire ?? 60));
    const message = `Too many requests. Please try again in ${seconds} seconds.`;
    throw new HttpException(
      {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
