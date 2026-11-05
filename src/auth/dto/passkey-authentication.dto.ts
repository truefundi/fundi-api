import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { PhoneDto } from './phone.dto';

export class PasskeyAuthenticationDto extends PhoneDto {
  @ApiProperty({
    description: 'The credential response produced by the device passkey API.',
    type: Object,
  })
  @IsObject()
  response!: AuthenticationResponseJSON;
}
