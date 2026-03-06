import { IsInt, Min, Max, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @MaxLength(2000)
  comments?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @MaxLength(1000)
  strengths?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @MaxLength(1000)
  improvements?: string;
}
