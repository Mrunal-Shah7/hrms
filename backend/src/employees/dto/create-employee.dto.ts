import {
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsUUID,
  IsIn,
  IsArray,
  IsBoolean,
  IsDateString,
  IsObject,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

class AddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(255)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(255)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @MaxLength(20)
  postalCode?: string;
}

export class CreateEmployeeDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @MaxLength(50)
  employeeId?: string;

  @ApiProperty({ maxLength: 100 })
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ maxLength: 100 })
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @MaxLength(100)
  displayName?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @ApiProperty()
  @IsUUID()
  departmentId: string;

  @ApiProperty()
  @IsUUID()
  designationId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportsTo?: string;

  @ApiProperty({ enum: ['permanent', 'contract', 'intern', 'freelance'] })
  @IsIn(['permanent', 'contract', 'intern', 'freelance'])
  employmentType: string;

  @ApiProperty()
  @IsDateString()
  dateOfJoining: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other', 'prefer_not_to_say'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other', 'prefer_not_to_say'])
  gender?: string;

  @ApiPropertyOptional({ enum: ['single', 'married', 'divorced', 'widowed'] })
  @IsOptional()
  @IsIn(['single', 'married', 'divorced', 'widowed'])
  maritalStatus?: string;

  @ApiPropertyOptional({ enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] })
  @IsOptional()
  @IsIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
  bloodGroup?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @MaxLength(255)
  emergencyContactName?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @MaxLength(50)
  emergencyContactRelation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  presentAddress?: AddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AddressDto)
  permanentAddress?: AddressDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sameAsPresentAddress?: boolean;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sendWelcomeEmail?: boolean;
}
