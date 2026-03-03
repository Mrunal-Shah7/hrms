import { IsNotEmpty, IsEmail, IsString, MaxLength, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])[A-Za-z\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}$/;

export class CreateAdminDto {
  @ApiProperty({ description: 'Admin full name' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ description: 'Admin email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Password (min 8 chars, 1 upper, 1 lower, 1 number, 1 special)',
  })
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_REGEX, {
    message:
      'Password must have at least 8 characters, 1 uppercase, 1 lowercase, 1 number, and 1 special character',
  })
  password!: string;
}
