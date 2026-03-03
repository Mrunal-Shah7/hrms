import {
  IsArray,
  ValidateNested,
  IsUUID,
  IsOptional,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class HierarchyEntryDto {
  @ApiProperty()
  @IsUUID()
  designationId: string;

  @ApiPropertyOptional({ description: 'null = top of chain' })
  @IsOptional()
  @IsUUID()
  reportsToDesignationId?: string | null;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  level: number;
}

export class UpdateHierarchyDto {
  @ApiProperty({ type: [HierarchyEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HierarchyEntryDto)
  entries: HierarchyEntryDto[];
}
