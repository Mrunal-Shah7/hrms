import { IsInt, IsNumber, Min, Max, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SetBalanceDto {
  @ApiProperty({ description: 'User (employee) to set balance for' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Leave type' })
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ minimum: 2020, maximum: 2099 })
  @IsInt()
  @Min(2020)
  @Max(2099)
  @Type(() => Number)
  year: number;

  @ApiProperty({ description: 'Total allocated days for this type and year', minimum: 0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  totalAllocated: number;
}
