import { IsUUID, IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRegistrationEmailDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  @IsNotEmpty()
  registrationId: string;

  @ApiProperty({ example: 'admin@old-domain.com' })
  @IsEmail()
  @IsNotEmpty()
  currentEmail: string;

  @ApiProperty({ example: 'admin@new-domain.com' })
  @IsEmail()
  @IsNotEmpty()
  newEmail: string;
}
