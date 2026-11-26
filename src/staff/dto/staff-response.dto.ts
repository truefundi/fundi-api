import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { PERMISSION_KEYS } from '../permission-catalog';
import { STAFF_ROLES } from '../staff-roles';

export class PermissionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: PERMISSION_KEYS }) key!: string;
  @ApiProperty({ example: 'payments' }) module!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: 'staff.manage is reserved for SUPER_ADMIN.' })
  reserved!: boolean;
  @ApiPropertyOptional({
    description:
      'Present in access responses; configured assignment independent of account status.',
  })
  enabled?: boolean;
  @ApiPropertyOptional({
    description:
      'SUPER_ADMIN permissions and reserved permissions cannot be toggled.',
  })
  locked?: boolean;
}

export class PermissionModuleDto {
  @ApiProperty({ example: 'payments' }) module!: string;
  @ApiProperty({ type: [PermissionResponseDto] })
  permissions!: PermissionResponseDto[];
}

export class StaffSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty() phoneNumber!: string;
  @ApiProperty({ enum: STAFF_ROLES }) role!: UserRole;
  @ApiProperty({ enum: UserStatus }) status!: UserStatus;
  @ApiProperty() superAdmin!: boolean;
  @ApiProperty({
    type: [String],
    description: 'Explicit grants only. SUPER_ADMIN needs no assignment rows.',
  })
  assignedPermissions!: string[];
  @ApiProperty({
    type: [String],
    description: 'Current access. Empty for inactive or suspended accounts.',
  })
  effectivePermissions!: string[];
}

export class StaffAccessDto extends StaffSummaryDto {
  @ApiProperty({ type: [PermissionModuleDto] }) modules!: PermissionModuleDto[];
}

export class StaffPaginationDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class StaffPageDto {
  @ApiProperty({ type: [StaffSummaryDto] }) data!: StaffSummaryDto[];
  @ApiProperty({ type: StaffPaginationDto }) pagination!: StaffPaginationDto;
}
