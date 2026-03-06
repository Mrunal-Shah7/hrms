import { IsNotEmpty, IsIn, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewLeaveDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsNotEmpty()
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @MaxLength(500)
  comment?: string;
}
