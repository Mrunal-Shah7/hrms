import { PartialType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto';
import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @ApiPropertyOptional({ enum: ['active', 'completed', 'on_hold'] })
  @IsOptional()
  @IsIn(['active', 'completed', 'on_hold'])
  status?: string;
}
