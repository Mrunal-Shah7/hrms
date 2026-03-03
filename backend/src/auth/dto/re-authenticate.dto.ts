import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReAuthenticateDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password: string;
}
