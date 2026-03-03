import {
  IsNotEmpty,
  IsEmail,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corporation' })
  @IsNotEmpty()
  organizationName!: string;

  @ApiProperty({ example: 'acme-corp', description: 'kebab-case slug' })
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens only',
  })
  slug!: string;

  @ApiProperty({ enum: ['standard', 'with_recruitment'] })
  @IsIn(['standard', 'with_recruitment'])
  subscriptionTier!: 'standard' | 'with_recruitment';

  @ApiProperty({ minimum: 1, example: 25 })
  @IsInt()
  @Min(1)
  maxUsers!: number;

  @ApiProperty({ example: 'billing@acme.com' })
  @IsEmail()
  billingEmail!: string;

  @ApiProperty({ example: 'Jane Admin' })
  @IsNotEmpty()
  adminName!: string;

  @ApiProperty({ example: 'jane@acme.com' })
  @IsEmail()
  adminEmail!: string;

  @ApiPropertyOptional({ minLength: 8, description: 'Optional; auto-generated if not provided' })
  @IsOptional()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  temporaryPassword?: string;

  @ApiPropertyOptional({ example: 'hr.acmecorp.com' })
  @IsOptional()
  customDomain?: string;
}
