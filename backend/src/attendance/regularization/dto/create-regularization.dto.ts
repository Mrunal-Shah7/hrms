import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateRegularizationDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @Matches(HHMM, { message: 'punchIn must be HH:MM format' })
  punchIn?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'punchOut must be HH:MM format' })
  punchOut?: string;

  @IsNotEmpty({ message: 'Reason is required' })
  @MaxLength(500)
  reason!: string;
}
