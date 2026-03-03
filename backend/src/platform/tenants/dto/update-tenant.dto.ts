import {
  IsOptional,
  IsIn,
  IsInt,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Corporation' })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: ['standard', 'with_recruitment'] })
  @IsOptional()
  @IsIn(['standard', 'with_recruitment'])
  subscriptionTier?: 'standard' | 'with_recruitment';

  @ApiPropertyOptional({ minimum: 1, example: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @ApiPropertyOptional({ example: 'hr.acmecorp.com' })
  @IsOptional()
  customDomain?: string;
}
