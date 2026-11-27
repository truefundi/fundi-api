import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastChannel, BroadcastRole } from '@prisma/client';

// Mirrors the dashboard's audience picker: one or both roles, always active accounts.
export class BroadcastAudienceDto {
  @ApiProperty({
    enum: BroadcastRole,
    isArray: true,
    example: [BroadcastRole.CUSTOMER, BroadcastRole.TECHNICIAN],
    description: 'At least one role. Administrators can never be targeted.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BroadcastRole, { each: true })
  roles!: BroadcastRole[];

  @ApiPropertyOptional({
    enum: ['active'],
    default: 'active',
    description: 'Only active accounts receive broadcasts.',
  })
  @IsOptional()
  @Equals('active')
  status?: 'active';
}

export class SendBroadcastDto {
  @ApiProperty({ example: 'Important service update', minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @ApiProperty({
    example: 'Fundi will be unavailable for maintenance tonight between 22:00 and 23:00.',
    minLength: 1,
    maxLength: 320,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  message!: string;

  @ApiProperty({ type: BroadcastAudienceDto })
  @ValidateNested()
  @Type(() => BroadcastAudienceDto)
  audience!: BroadcastAudienceDto;

  @ApiProperty({
    enum: BroadcastChannel,
    isArray: true,
    example: [BroadcastChannel.IN_APP, BroadcastChannel.SMS],
    description: 'IN_APP writes to the in-app inbox; SMS also texts each recipient.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BroadcastChannel, { each: true })
  channels!: BroadcastChannel[];
}

export class ListBroadcastsQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
