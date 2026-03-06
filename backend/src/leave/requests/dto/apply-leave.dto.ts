import { IsNotEmpty, IsUUID, IsDateString, IsIn, IsOptional, IsEmail, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApplyLeaveDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ enum: ['full_day', 'first_half', 'second_half'], default: 'full_day' })
  @IsOptional()
  @IsIn(['full_day', 'first_half', 'second_half'])
  durationType?: 'full_day' | 'first_half' | 'second_half' = 'full_day';

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  teamEmail?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @MaxLength(1000)
  reason?: string;
}
