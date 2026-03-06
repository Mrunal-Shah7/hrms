import {
  IsOptional,
  IsIn,
  MaxLength,
  IsDateString,
} from 'class-validator';

export class UpdateGoalDto {
  @IsOptional()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsIn(['not_started', 'in_progress', 'completed', 'cancelled'])
  status?: 'not_started' | 'in_progress' | 'completed' | 'cancelled';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
