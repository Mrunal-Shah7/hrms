import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateBillingStatusDto {
  @ApiProperty({ enum: ['paid', 'overdue'] })
  @IsIn(['paid', 'overdue'])
  status!: 'paid' | 'overdue';
}
