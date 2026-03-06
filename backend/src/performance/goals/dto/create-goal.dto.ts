import {
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsIn,
  MaxLength,
  IsDateString,
} from 'class-validator';

export class CreateGoalDto {
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsUUID()
  assignedToId: string;

  @IsOptional()
  @IsIn(['user', 'group', 'project'])
  assignedToType?: 'user' | 'group' | 'project' = 'user';

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'critical'])
  priority?: 'low' | 'medium' | 'high' | 'critical' = 'medium';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
