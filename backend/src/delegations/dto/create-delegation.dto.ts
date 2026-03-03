import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsIn,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DELEGATION_TYPES = ['permanent', 'temporary', 'leave_coverage', 'project_based', 'training'] as const;

export class CreateDelegationDto {
  @ApiPropertyOptional({ description: 'If omitted, uses current user. Only Admin/HR can set another user.' })
  @IsOptional()
  @IsUUID()
  delegatorId?: string;

  @ApiProperty()
  @IsUUID()
  delegateeId: string;

  @ApiProperty({ enum: DELEGATION_TYPES })
  @IsNotEmpty()
  @IsIn(DELEGATION_TYPES)
  type: (typeof DELEGATION_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
