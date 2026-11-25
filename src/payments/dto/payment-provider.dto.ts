import { ApiProperty } from '@nestjs/swagger';
import { MobilePaymentProvider } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';

export class PaymentProviderParamsDto {
  @ApiProperty({ enum: MobilePaymentProvider })
  @IsEnum(MobilePaymentProvider)
  provider!: MobilePaymentProvider;
}

export class UpdatePaymentProviderDto {
  @ApiProperty({
    description: 'Enable API mode, or disable it for manual approval.',
  })
  @IsBoolean()
  apiEnabled!: boolean;
}
