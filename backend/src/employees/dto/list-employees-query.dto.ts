import {
  IsOptional,
  IsNumber,
  IsString,
  IsIn,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListEmployeesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 'createdAt' })
  @IsOptional()
  @IsIn([
    'employeeId',
    'firstName',
    'lastName',
    'email',
    'departmentName',
    'designationName',
    'employmentType',
    'dateOfJoining',
    'status',
    'createdAt',
  ])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'archived', 'all'] })
  @IsOptional()
  @IsIn(['active', 'inactive', 'archived', 'all'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @ApiPropertyOptional({ enum: ['permanent', 'contract', 'intern', 'freelance'] })
  @IsOptional()
  @IsIn(['permanent', 'contract', 'intern', 'freelance'])
  employmentType?: string;

  @ApiPropertyOptional({ enum: ['company', 'external'] })
  @IsOptional()
  @IsIn(['company', 'external'])
  emailDomainType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateOfJoiningFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dateOfJoiningTo?: string;
}
