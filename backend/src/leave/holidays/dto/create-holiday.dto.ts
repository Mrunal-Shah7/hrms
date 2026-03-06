import { IsNotEmpty, IsOptional, IsBoolean, MaxLength, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHolidayDto {
  @ApiProperty({ maxLength: 255 })
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;
}
