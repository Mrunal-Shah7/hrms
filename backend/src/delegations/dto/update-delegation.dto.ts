import {
  IsOptional,
  IsIn,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const DELEGATION_TYPES = ['permanent', 'temporary', 'leave_coverage', 'project_based', 'training'] as const;
const DELEGATION_STATUSES = ['active', 'completed', 'cancelled'] as const;

export class UpdateDelegationDto {
  @ApiPropertyOptional({ enum: DELEGATION_TYPES })
  @IsOptional()
  @IsIn(DELEGATION_TYPES)
  type?: (typeof DELEGATION_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: DELEGATION_STATUSES })
  @IsOptional()
  @IsIn(DELEGATION_STATUSES)
  status?: (typeof DELEGATION_STATUSES)[number];
}
