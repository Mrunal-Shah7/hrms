import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ManualSyncDto {
  @IsUUID()
  configId!: string;

  @IsOptional()
  @IsDateString()
  since?: string;
}
