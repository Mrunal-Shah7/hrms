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

export class ListTenantsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'trial', 'suspended', 'cancelled'] })
  @IsOptional()
  @IsIn(['active', 'trial', 'suspended', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ enum: ['standard', 'with_recruitment'] })
  @IsOptional()
  @IsIn(['standard', 'with_recruitment'])
  tier?: string;

  @ApiPropertyOptional({ enum: ['self_service', 'super_admin'] })
  @IsOptional()
  @IsIn(['self_service', 'super_admin'])
  source?: string;

  @ApiPropertyOptional({ description: 'Search by name, slug, or billing email' })
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
    enum: ['name', 'slug', 'created_at', 'status', 'current_user_count'],
    default: 'created_at',
  })
  @IsOptional()
  @IsIn(['name', 'slug', 'created_at', 'status', 'current_user_count'])
  sortBy?: string = 'created_at';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
