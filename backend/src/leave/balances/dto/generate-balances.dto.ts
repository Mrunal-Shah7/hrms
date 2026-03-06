import { IsInt, Min, Max, IsOptional, IsUUID, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class GenerateBalancesDto {
  @ApiProperty({ minimum: 2020, maximum: 2099 })
  @IsInt()
  @Min(2020)
  @Max(2099)
  @Type(() => Number)
  year: number;

  @ApiPropertyOptional({ description: 'Generate for a single employee only' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  dryRun?: boolean;
}
