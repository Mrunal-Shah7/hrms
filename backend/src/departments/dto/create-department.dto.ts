import { IsNotEmpty, IsOptional, IsEmail, IsUUID, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ maxLength: 255 })
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({ maxLength: 50, description: 'Uppercase alphanumeric, underscore, hyphen' })
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Code must contain only uppercase letters, numbers, underscore, or hyphen',
  })
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  mailAlias?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  headId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
