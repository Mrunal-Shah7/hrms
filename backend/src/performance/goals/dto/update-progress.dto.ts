import { IsInt, Min, Max, IsOptional, MaxLength } from 'class-validator';

export class UpdateProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progress: number;

  @IsOptional()
  @MaxLength(500)
  note?: string;
}
