import { ApiProperty } from '@nestjs/swagger';

// Mirrors the JSON body produced by HttpExceptionFilter for every failed request.
export class ErrorResponseDto {
  @ApiProperty({ example: 404, description: 'HTTP status code of the failure.' })
  statusCode!: number;

  @ApiProperty({
    example: '2026-09-30T10:00:00.000Z',
    description: 'ISO timestamp of when the error was produced.',
  })
  timestamp!: string;

  @ApiProperty({
    example: '/api/v1/auth/login',
    description: 'Request path that failed.',
  })
  path!: string;

  @ApiProperty({
    example: 'No account was found for this phone number.',
    description:
      'Error message. For validation failures this is an array of per-field messages.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
}