import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { AdAudience, AdBadge, AdPlacement } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A landing-page promotion card. `imageUrl` accepts an already-hosted image; the
// multipart upload route is the alternative and stores the bytes in object storage.
export class CreateAdDto {
  @ApiPropertyOptional({
    example: 3,
    description: 'Landing-page product this card points at, when it is product-specific.',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @ApiProperty({ example: 'Fundi Home Repair', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example: 'Book a trusted technician for plumbing, electrical, and carpentry work.',
    minLength: 2,
    maxLength: 1000,
  })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({
    example: 'https://cdn.fundi.rw/ads/home-repair.png',
    description:
      'External image URL. Leave empty when uploading a file through the image route.',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional({
    example: 'A technician repairing a kitchen sink',
    maxLength: 200,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  imageAlt?: string;

  @ApiPropertyOptional({ example: 'Explore product', maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  callToAction?: string;

  @ApiPropertyOptional({
    enum: AdBadge,
    default: AdBadge.LIVE,
    description: 'Badge rendered on the card.',
  })
  @IsOptional()
  @IsEnum(AdBadge)
  badge?: AdBadge;

  @ApiPropertyOptional({
    enum: AdPlacement,
    default: AdPlacement.LANDING_PRODUCT,
    description: 'Which surface renders the ad.',
  })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({
    enum: AdAudience,
    default: AdAudience.ALL,
    description: 'Restrict the ad to one role. ALL is visible to everyone.',
  })
  @IsOptional()
  @IsEnum(AdAudience)
  audience?: AdAudience;

  @ApiPropertyOptional({
    default: true,
    description: 'Manual visibility switch. Scheduling is applied on top of it.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description: 'First moment the ad may be shown. Omit to start immediately.',
  })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T00:00:00.000Z',
    description: 'Last moment the ad may be shown. Omit to run until paused.',
  })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({
    default: 0,
    minimum: -1000,
    maximum: 1000,
    description: 'Higher-priority ads render first.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1000)
  @Max(1000)
  priority?: number;
}

// Every field is optional, so the dashboard can patch one switch at a time.
export class UpdateAdDto extends PartialType(CreateAdDto) {}

// Admin listing: includes hidden and out-of-window ads.
export class ListAdsQueryDto {
  @ApiPropertyOptional({ enum: AdPlacement })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({ enum: AdAudience })
  @IsOptional()
  @IsEnum(AdAudience)
  audience?: AdAudience;

  @ApiPropertyOptional({ description: 'Filter by the manual visibility switch.' })
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' ? true : value === false || value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

// Public listing: only callers that know the placement and, optionally, the role.
export class PublicAdsQueryDto {
  @ApiPropertyOptional({ enum: AdPlacement, default: AdPlacement.LANDING_PRODUCT })
  @IsOptional()
  @IsEnum(AdPlacement)
  placement?: AdPlacement;

  @ApiPropertyOptional({
    enum: AdAudience,
    description: 'Return ads addressed to this role plus ALL-audience ads.',
  })
  @IsOptional()
  @IsEnum(AdAudience)
  role?: AdAudience;
}
