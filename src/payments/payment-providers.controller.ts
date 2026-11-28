import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  StaffAuth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import {
  PaymentProviderParamsDto,
  UpdatePaymentProviderDto,
} from './dto/payment-provider.dto';
import { MobilePaymentsService } from './mobile-payments.service';
import { PaymentProvidersService } from './payment-providers.service';

@ApiTags('Payments')
@Controller('api/v1')
export class PaymentProvidersController {
  constructor(
    private readonly providers: PaymentProvidersService,
    private readonly payments: MobilePaymentsService,
  ) {}

  @Get('payments/providers')
  @ApiOperation({
    summary: 'Discover the current payment mode for MTN and Airtel',
  })
  listProviders() {
    return this.providers.list();
  }

  @Get('admin/payment-providers')
  @StaffAuth('payments.configure')
  @ApiOperation({ summary: 'Read independent mobile money provider toggles' })
  listAdminProviders() {
    return this.providers.list();
  }

  @Patch('admin/payment-providers/:provider')
  @StaffAuth('payments.configure')
  @ApiOperation({
    summary: 'Enable API mode or switch a provider to manual approval',
  })
  updateProvider(
    @Param() params: PaymentProviderParamsDto,
    @Body() dto: UpdatePaymentProviderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.providers.update(params.provider, dto.apiEnabled, user.id);
  }

  @Post('payments/initiate')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  @ApiOperation({
    summary:
      'Pay with a phone number (immediate simulated success in development/test)',
  })
  initiate(@CurrentUser() user: AuthUser, @Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(user.id, dto);
  }

  @Get('payments/transactions/:transactionId')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Recover your payment result after reconnecting' })
  getTransaction(
    @CurrentUser() user: AuthUser,
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
  ) {
    return this.payments.getTransaction(user.id, transactionId);
  }
}
