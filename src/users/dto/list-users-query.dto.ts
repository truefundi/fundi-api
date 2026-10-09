import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { PagedQueryDto } from '../../common/dto/paged-query.dto';
import { MAX_SEARCH_LENGTH } from '../../common/dto/pagination.constants';

// Re-exported so existing imports keep working from this module.
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_SEARCH_LENGTH,
} from '../../common/dto/pagination.constants';

// Validates the optional query parameters on GET /users. Unknown parameters are
// rejected by the global ValidationPipe (whitelist + forbidNonWhitelisted).
// Paging (`page`, `limit`) is inherited from the shared PagedQueryDto.
export class ListUsersQueryDto extends PagedQueryDto {
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
