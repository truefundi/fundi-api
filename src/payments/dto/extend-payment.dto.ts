import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class ExtendPaymentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  days!: number;
}
