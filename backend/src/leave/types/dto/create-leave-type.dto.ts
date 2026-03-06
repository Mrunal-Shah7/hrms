import {
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLeaveTypeDto {
  @ApiProperty({ maxLength: 100 })
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ maxLength: 20, description: 'Uppercase letters, numbers, underscore only' })
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'Code must contain only uppercase letters, numbers, or underscore',
  })
  code: string;

  @ApiPropertyOptional({ example: '#4CAF50' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'Color must be a valid hex (e.g. #4CAF50)' })
  color?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @MaxLength(50)
  icon?: string;

  @ApiProperty()
  @IsBoolean()
  isPaid: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConsecutiveDays?: number;
}
