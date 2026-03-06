import { PartialType } from '@nestjs/swagger';
import { CreateLeaveTypeDto } from './create-leave-type.dto';
import { IsOptional, IsBoolean, IsInt, Min, MaxLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'Code must contain only uppercase letters, numbers, or underscore',
  })
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Color must be a valid hex' })
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(50)
  icon?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConsecutiveDays?: number;
}
