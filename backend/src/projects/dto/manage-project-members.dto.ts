import {
  IsArray,
  IsUUID,
  ArrayMinSize,
  ValidateNested,
  IsOptional,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ProjectMemberDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ enum: ['member', 'lead'] })
  @IsOptional()
  @IsIn(['member', 'lead'])
  role?: string;
}

export class AddProjectMembersDto {
  @ApiProperty({ type: [ProjectMemberDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProjectMemberDto)
  members: ProjectMemberDto[];
}

export class RemoveProjectMembersDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  userIds: string[];
}
