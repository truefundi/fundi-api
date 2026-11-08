import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';

export class PinLoginDto extends PhoneDto {
  @ApiProperty({
    example: '123456',
    description: 'The 4–6 digit PIN associated with this account.',
    minLength: 4,
    maxLength: 6,
    format: 'password',
  })
  @IsString()
  @Matches(/^\d{4,6}$/)
  pin!: string;
}
