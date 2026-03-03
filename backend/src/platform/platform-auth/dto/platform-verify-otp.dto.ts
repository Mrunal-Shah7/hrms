import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformVerifyOtpDto {
  @ApiProperty({ example: 'admin@hrms-platform.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '482913' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp: string;
}
