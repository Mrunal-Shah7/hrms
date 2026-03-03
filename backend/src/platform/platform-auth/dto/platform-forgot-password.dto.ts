import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformForgotPasswordDto {
  @ApiProperty({ example: 'admin@hrms-platform.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
