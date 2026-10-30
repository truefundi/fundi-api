import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CreateMockPaymentDto } from './dto/create-mock-payment.dto';
import { CreateCompletedPaymentDto } from './dto/create-completed-payment.dto';
import { ExtendPaymentDto } from './dto/extend-payment.dto';
import { RecordProcessedPaymentDto } from './dto/record-processed-payment.dto';
import { UpdateCompletedPaymentDto } from './dto/update-completed-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('api/v1')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments/mock')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  createMock(@CurrentUser() user: AuthUser, @Body() dto: CreateMockPaymentDto) {
    return this.payments.createMockPayment(user.id, dto);
  }

  @Post('payments/processed')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  recordProcessed(
    @CurrentUser() user: AuthUser,
    @Body() dto: RecordProcessedPaymentDto,
  ) {
    return this.payments.recordFrontendProcessedPayment(user.id, dto);
  }

  @Get('payments/mine')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  listMine(@CurrentUser() user: AuthUser) {
    return this.payments.listMine(user.id);
  }

  @Get('admin/payments')
  @Auth(UserRole.ADMIN)
  listAll() {
    return this.payments.listAll();
  }

  @Get('admin/payments/completed')
  @Auth(UserRole.ADMIN)
  listCompleted() {
    return this.payments.listCompletedPayments();
  }

  @Post('admin/payments/completed')
  @Auth(UserRole.ADMIN)
  createCompleted(
    @Body() dto: CreateCompletedPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.createCompletedPayment(dto, user.id);
  }

  @Get('admin/payments/completed/:paymentId')
  @Auth(UserRole.ADMIN)
  getCompleted(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.getCompletedPayment(paymentId);
  }

  @Patch('admin/payments/completed/:paymentId')
  @Auth(UserRole.ADMIN)
  updateCompleted(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdateCompletedPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.updateCompletedPayment(paymentId, dto, user.id);
  }

  @Delete('admin/payments/completed/:paymentId')
  @Auth(UserRole.ADMIN)
  deleteCompleted(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.deleteCompletedPayment(paymentId, user.id);
  }

  @Patch('admin/payments/:paymentId/extend')
  @Auth(UserRole.ADMIN)
  extend(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ExtendPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.extend(paymentId, dto, user.id);
  }
}
