import { IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IntersectionType } from '@nestjs/swagger';
import { ListLeaveRequestsQueryDto } from './list-leave-requests-query.dto';

class ExportFormatQueryDto {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx', 'pdf'], default: 'csv' })
  @IsOptional()
  @IsIn(['csv', 'xlsx', 'pdf'])
  format?: 'csv' | 'xlsx' | 'pdf';
}

/** Query DTO for leave requests export; includes format so it is whitelisted by ValidationPipe. */
export class ExportLeaveRequestsQueryDto extends IntersectionType(
  ListLeaveRequestsQueryDto,
  ExportFormatQueryDto,
) {}
