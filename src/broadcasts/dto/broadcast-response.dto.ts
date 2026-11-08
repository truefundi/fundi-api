import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BroadcastChannel, BroadcastRole, BroadcastStatus } from '@prisma/client';

// The dashboard history row, plus the delivery counters the compose screen shows.
export class BroadcastResponseDto {
  @ApiProperty({ example: 'b1d4c7e2-9a3f-4f61-8e2d-5c0a7b6d4e31' })
  id!: string;

  @ApiProperty({ example: 'Important service update' })
  title!: string;

  @ApiProperty({ example: 'Fundi will be unavailable for maintenance tonight.' })
  message!: string;

  @ApiProperty({
    enum: BroadcastRole,
    isArray: true,
    example: [BroadcastRole.CUSTOMER, BroadcastRole.TECHNICIAN],
  })
  audience!: { roles: BroadcastRole[]; status: 'active' };

  @ApiProperty({
    enum: BroadcastChannel,
    isArray: true,
    example: [BroadcastChannel.IN_APP, BroadcastChannel.SMS],
  })
  channels!: BroadcastChannel[];

  @ApiProperty({ enum: BroadcastStatus, example: BroadcastStatus.SENT })
  status!: BroadcastStatus;

  @ApiProperty({ example: 'queued' })
  mode!: string;

  @ApiProperty({ example: 842 })
  userCount!: number;

  @ApiProperty({ example: 842 })
  smsRecipientCount!: number;

  @ApiProperty({ example: 842 })
  inAppRecipientCount!: number;

  @ApiProperty({ example: 842 })
  smsSentCount!: number;

  @ApiProperty({ example: 0 })
  smsFailedCount!: number;

  @ApiProperty({ example: 842 })
  inAppSentCount!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  error!: string | null;

  @ApiPropertyOptional({ example: '2026-11-05T09:00:00.000Z', nullable: true })
  sentAt!: Date | null;

  @ApiProperty({ example: '2026-11-05T09:00:00.000Z' })
  createdAt!: Date;
}
