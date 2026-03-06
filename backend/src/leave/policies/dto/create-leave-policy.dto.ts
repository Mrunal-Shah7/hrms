import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  IsBoolean,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'freelance'] as const;
const ACCRUAL_TYPES = ['annual', 'monthly', 'quarterly'] as const;

export class CreateLeavePolicyDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID()
  leaveTypeId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @ApiProperty({ minimum: 0, maximum: 365 })
  @IsNumber()
  @Min(0)
  @Max(365)
  annualAllocation: number;

  @ApiProperty()
  @IsBoolean()
  carryForward: boolean;

  @ApiPropertyOptional({ description: 'Required when carryForward is true' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCarryForward?: number;

  @ApiProperty({ enum: ACCRUAL_TYPES })
  @IsIn(ACCRUAL_TYPES)
  accrualType: string;
}
