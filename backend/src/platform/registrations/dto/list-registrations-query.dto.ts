import {
  IsOptional,
  IsIn,
  IsInt,
  Min,
  Max,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListRegistrationsQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'verified', 'provisioned', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'verified', 'provisioned', 'failed'])
  status?: string;

  @ApiPropertyOptional({ description: 'Search by org name or admin email' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: ['created_at', 'organization_name', 'status'],
    default: 'created_at',
  })
  @IsOptional()
  @IsIn(['created_at', 'organization_name', 'status'])
  sortBy?: string = 'created_at';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
