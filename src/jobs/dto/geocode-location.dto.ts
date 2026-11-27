import { IsString, MaxLength, MinLength } from 'class-validator';

export class GeocodeLocationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  location!: string;
}
