import {
  IsOptional,
  IsIn,
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({
    enum: ['DD-MMM-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'],
  })
  @IsOptional()
  @IsIn(['DD-MMM-YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'])
  dateFormat?: string | null;

  @ApiPropertyOptional({ description: 'IANA timezone' })
  @IsOptional()
  @IsString()
  timezone?: string | null;

  @ApiPropertyOptional({ enum: ['en'] })
  @IsOptional()
  @IsIn(['en'])
  language?: string;

  @ApiPropertyOptional({
    enum: ['everyone', 'organization', 'nobody'],
  })
  @IsOptional()
  @IsIn(['everyone', 'organization', 'nobody'])
  profilePictureVisibility?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  newSignInAlert?: boolean;
}
