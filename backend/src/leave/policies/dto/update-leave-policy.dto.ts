import { PartialType } from '@nestjs/swagger';
import { CreateLeavePolicyDto } from './create-leave-policy.dto';
import { IsOptional, IsBoolean, IsNumber, IsUUID, IsIn, Min, Max } from 'class-validator';

const EMPLOYMENT_TYPES = ['permanent', 'contract', 'intern', 'freelance'] as const;
const ACCRUAL_TYPES = ['annual', 'monthly', 'quarterly'] as const;

export class UpdateLeavePolicyDto extends PartialType(CreateLeavePolicyDto) {
  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  annualAllocation?: number;

  @IsOptional()
  @IsBoolean()
  carryForward?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCarryForward?: number;

  @IsOptional()
  @IsIn(ACCRUAL_TYPES)
  accrualType?: string;
}
