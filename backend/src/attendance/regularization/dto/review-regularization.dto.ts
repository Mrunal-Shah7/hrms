import { IsIn } from 'class-validator';

export class ReviewRegularizationDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';
}
