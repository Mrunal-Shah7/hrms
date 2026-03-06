import { IsOptional, IsNumber, IsIn, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListHolidaysQueryDto {
  @ApiPropertyOptional({ description: 'Leave year (default: current)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(2020)
  @Max(2099)
  year?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({ default: 'date' })
  @IsOptional()
  @IsIn(['date', 'name', 'createdAt'])
  sortBy?: string = 'date';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: string = 'asc';
}
