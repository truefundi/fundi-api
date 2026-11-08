import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';

export class PasswordLoginDto extends PhoneDto {
  @ApiProperty({ example: 'secure-password', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
