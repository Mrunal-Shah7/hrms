import { IsOptional, IsIn, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListGoalsQueryDto {
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

  @ApiPropertyOptional({ enum: ['user', 'group', 'project'] })
  @IsOptional()
  @IsIn(['user', 'group', 'project'])
  assignedToType?: string;

  @ApiPropertyOptional({ enum: ['not_started', 'in_progress', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'completed', 'cancelled'])
  status?: string;

  @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'critical'] })
  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: string;

  @ApiPropertyOptional({ enum: ['all', 'this_week', 'last_week', 'this_month', 'last_month'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'this_week', 'last_week', 'this_month', 'last_month'])
  filter?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'dueDate', 'startDate', 'priority', 'status'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'dueDate', 'startDate', 'priority', 'status'])
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;
}
