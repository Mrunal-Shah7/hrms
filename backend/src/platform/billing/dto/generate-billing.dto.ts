import { IsUUID, IsDateString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateBillingDto {
  @ApiProperty({ description: 'Tenant ID' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ description: 'Period start date (YYYY-MM-DD)' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ description: 'Period end date (YYYY-MM-DD)' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ description: 'Per-user rate for the period' })
  @IsNumber()
  @Min(0)
  perUserRate!: number;
}
