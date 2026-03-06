import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ArrayMinSize,
  IsIn,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export class CreateWorkScheduleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(HHMM, { message: 'startTime must be HH:MM format' })
  startTime!: string;

  @IsString()
  @Matches(HHMM, { message: 'endTime must be HH:MM format' })
  endTime!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DAYS, { each: true })
  workingDays!: string[];

  @IsInt()
  @Min(0)
  @Max(60)
  gracePeriodMinutes!: number;

  @IsNumber()
  @Min(1)
  @Max(24)
  minHoursFullDay!: number;

  @IsNumber()
  @Min(0.5)
  @Max(12)
  minHoursHalfDay!: number;

  @IsNumber()
  @Min(1)
  @Max(24)
  overtimeThresholdHours!: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
