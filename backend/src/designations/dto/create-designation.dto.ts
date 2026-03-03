import { IsNotEmpty, IsInt, Min, Max, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDesignationDto {
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

  @ApiProperty({ minimum: 0, maximum: 100, description: '0 = highest (e.g. CEO), higher = lower in hierarchy' })
  @IsInt()
  @Min(0)
  @Max(100)
  hierarchyLevel: number;
}
