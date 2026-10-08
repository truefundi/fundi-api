import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

// Shared paging defaults so the query DTO and the service agree on the same limits.
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const MAX_SEARCH_LENGTH = 200;

// Validates the optional query parameters on GET /users. Unknown parameters are
// rejected by the global ValidationPipe (whitelist + forbidNonWhitelisted).
export class ListUsersQueryDto {
  @ApiProperty({
    required: false,
    type: 'integer',
    default: DEFAULT_PAGE,
    minimum: 1,
    example: 1,
    description: 'Page number, 1-based. Defaults to 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    default: DEFAULT_PAGE_LIMIT,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    example: 20,
    description: `Rows per page, between 1 and ${MAX_PAGE_LIMIT}. Defaults to ${DEFAULT_PAGE_LIMIT}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiProperty({
    required: false,
    enum: Object.values(UserRole),
    example: 'TECHNICIAN',
    description: 'Only return users with this role.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({
    required: false,
    enum: Object.values(UserStatus),
    example: 'ACTIVE',
    description: 'Only return users with this account status.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiProperty({
    required: false,
    type: 'string',
    example: 'john',
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Substring matched against full name, phone number, and email. Combines with `role`, `status`, and paging.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The search query parameter must not be empty.' })
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;
}
