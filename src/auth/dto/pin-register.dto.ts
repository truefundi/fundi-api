import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';
import { FULL_NAME_PATTERN } from '../../common/validation/full-name';

export class PinRegisterDto extends PhoneDto {
  @ApiProperty({
    example: 'Prince Example',
    description:
      "The account holder's full name. Unicode letters, spaces, apostrophes, and hyphens only.",
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value,
  )
  @MinLength(2)
  @MaxLength(120)
  @Matches(FULL_NAME_PATTERN)
  fullName!: string;

  @ApiProperty({
    example: '123456',
    description: 'A numeric PIN containing 4 to 6 digits.',
    minLength: 4,
    maxLength: 6,
    format: 'password',
  })
  @IsString()
  @Matches(/^\d{4,6}$/)
  pin!: string;
}
