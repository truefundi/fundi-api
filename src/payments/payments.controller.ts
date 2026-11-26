import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  StaffAuth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CreateMockPaymentDto } from './dto/create-mock-payment.dto';
import { CreateCompletedPaymentDto } from './dto/create-completed-payment.dto';
import { ExtendPaymentDto } from './dto/extend-payment.dto';
import { RecordProcessedPaymentDto } from './dto/record-processed-payment.dto';
import { UpdateCompletedPaymentDto } from './dto/update-completed-payment.dto';
import { PaymentQuoteDto } from './dto/payment-quote.dto';
import { CreatePaymentClaimDto } from './dto/create-payment-claim.dto';
import { ListPaymentClaimsDto } from './dto/list-payment-claims.dto';
import { ReviewPaymentClaimDto } from './dto/review-payment-claim.dto';
import { PaymentsService } from './payments.service';

@Controller('api/v1')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments/quote')
  quote(@Query() dto: PaymentQuoteDto) {
    return this.payments.quote(dto);
  }

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

  @Post('payments/claims')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  submitPaymentClaim(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentClaimDto,
  ) {
    return this.payments.submitPaymentClaim(user.id, dto);
  }

  @Get('payments/claims/mine')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  listMyPaymentClaims(@CurrentUser() user: AuthUser) {
    return this.payments.listMyPaymentClaims(user.id);
  }

  @Get('admin/payment-claims')
  @StaffAuth('payments.view')
  listPaymentClaimsForAdmin(@Query() query: ListPaymentClaimsDto) {
    return this.payments.listPaymentClaimsForAdmin(query);
  }

  @Get('admin/payment-claims/:claimId')
  @StaffAuth('payments.view')
  getPaymentClaimForAdmin(
    @Param('claimId', ParseUUIDPipe) claimId: string,
  ) {
    return this.payments.getPaymentClaimForAdmin(claimId);
  }

  @Patch('admin/payment-claims/:claimId/review')
  @StaffAuth('payments.approve')
  reviewPaymentClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: ReviewPaymentClaimDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.reviewPaymentClaim(claimId, dto, user.id);
  }

  @Delete('admin/payment-claims/:claimId')
  @StaffAuth('payments.manage')
  deletePaymentClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.deletePaymentClaim(claimId, user.id);
  }

  @Get('admin/payments')
  @StaffAuth('payments.view')
  listAll() {
    return this.payments.listAll();
  }

  @Get('admin/payments/completed')
  @StaffAuth('payments.view')
  listCompleted() {
    return this.payments.listCompletedPayments();
  }

  @Post('admin/payments/completed')
  @StaffAuth('payments.manage')
  createCompleted(
    @Body() dto: CreateCompletedPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.createCompletedPayment(dto, user.id);
  }

  @Get('admin/payments/completed/:paymentId')
  @StaffAuth('payments.view')
  getCompleted(@Param('paymentId', ParseUUIDPipe) paymentId: string) {
    return this.payments.getCompletedPayment(paymentId);
  }

  @Patch('admin/payments/completed/:paymentId')
  @StaffAuth('payments.manage')
  updateCompleted(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: UpdateCompletedPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.updateCompletedPayment(paymentId, dto, user.id);
  }

  @Delete('admin/payments/completed/:paymentId')
  @StaffAuth('payments.manage')
  deleteCompleted(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.deleteCompletedPayment(paymentId, user.id);
  }

  @Patch('admin/payments/:paymentId/extend')
  @StaffAuth('payments.manage')
  extend(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: ExtendPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.payments.extend(paymentId, dto, user.id);
  }
}
