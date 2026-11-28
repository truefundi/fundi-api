import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { PERMISSION_KEYS, PermissionKey } from '../permission-catalog';
import { STAFF_ROLES } from '../staff-roles';

export class PermissionToggleDto {
  @ApiProperty({ enum: PERMISSION_KEYS, example: 'payments.view' })
  @IsIn(PERMISSION_KEYS)
  key!: PermissionKey;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateStaffPermissionsDto {
  @ApiProperty({
    type: [PermissionToggleDto],
    description: 'Only listed toggles change; the batch is atomic.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @ArrayUnique((item: PermissionToggleDto) => item.key)
  @ValidateNested({ each: true })
  @Type(() => PermissionToggleDto)
  permissions!: PermissionToggleDto[];
}

export class UpdateStaffRoleDto {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  role!: UserRole;
}

export class ListStaffDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
