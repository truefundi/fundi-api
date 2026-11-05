import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdAudience, AdBadge, AdPlacement } from '@prisma/client';

// The shape the dashboard and the landing page both consume. `status` keeps the
// existing frontend vocabulary ("Live" / "Coming soon") while `badge` is the stored
// enum, and `isLive` folds scheduling and the manual switch into one flag.
export class AdResponseDto {
  @ApiProperty({ example: '4b1c9f0a-3d2e-4b8a-9f11-7c6d5e4a3b21' })
  id!: string;

  @ApiPropertyOptional({ example: 3, nullable: true })
  productId!: number | null;

  @ApiProperty({ example: 'Fundi Home Repair' })
  title!: string;

  @ApiProperty({ example: 'Book a trusted technician for plumbing and electrical work.' })
  description!: string;

  @ApiPropertyOptional({
    example: '/api/v1/ads/4b1c9f0a-3d2e-4b8a-9f11-7c6d5e4a3b21/image',
    nullable: true,
  })
  imageUrl!: string | null;

  @ApiPropertyOptional({ example: 'A technician repairing a kitchen sink', nullable: true })
  imageAlt!: string | null;

  @ApiPropertyOptional({ example: 'Explore product', nullable: true })
  callToAction!: string | null;

  @ApiProperty({ enum: AdBadge, example: AdBadge.LIVE })
  badge!: AdBadge;

  @ApiProperty({ enum: ['Live', 'Coming soon'], example: 'Live' })
  status!: 'Live' | 'Coming soon';

  @ApiProperty({ enum: AdPlacement, example: AdPlacement.LANDING_PRODUCT })
  placement!: AdPlacement;

  @ApiProperty({ enum: AdAudience, example: AdAudience.ALL })
  audience!: AdAudience;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    example: true,
    description: 'True when the ad is active and the current time is inside its window.',
  })
  isLive!: boolean;

  @ApiPropertyOptional({ example: '2026-11-01T00:00:00.000Z', nullable: true })
  startsAt!: Date | null;

  @ApiPropertyOptional({ example: '2026-12-01T00:00:00.000Z', nullable: true })
  endsAt!: Date | null;

  @ApiProperty({ example: 0 })
  priority!: number;

  @ApiProperty({ example: 120 })
  impressions!: number;

  @ApiProperty({ example: 14 })
  clicks!: number;

  @ApiProperty({ example: '2026-11-05T09:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-11-05T09:00:00.000Z' })
  updatedAt!: Date;
}
