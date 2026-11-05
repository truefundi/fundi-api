import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

export class PasskeyRegistrationDto {
  @ApiProperty({
    description: 'The credential response produced by the device passkey API.',
    type: Object,
  })
  @IsObject()
  response!: RegistrationResponseJSON;
}
