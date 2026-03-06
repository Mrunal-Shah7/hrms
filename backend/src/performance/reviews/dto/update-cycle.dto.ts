import { IsOptional, IsNotEmpty, IsIn, IsDateString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCycleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: ['quarterly', 'annual', 'custom'] })
  @IsOptional()
  @IsIn(['quarterly', 'annual', 'custom'])
  type?: 'quarterly' | 'annual' | 'custom';

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ['draft', 'active', 'completed'] })
  @IsOptional()
  @IsIn(['draft', 'active', 'completed'])
  status?: 'draft' | 'active' | 'completed';
}
