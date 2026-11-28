import {
  ExecutionContext,
  INestApplication,
  Logger,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { PaymentClaimMethod, PaymentClaimStatus } from '@prisma/client';
import * as request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PermissionsService } from '../staff/permissions.service';

describe('Payment claim endpoints (HTTP)', () => {
  let app: INestApplication;

  const customerId = '0a1b2c3d-0000-4000-8000-000000000001';
  const adminId = '0a1b2c3d-0000-4000-8000-000000000002';
  const claimId = '0a1b2c3d-0000-4000-8000-000000000003';
  const paymentId = '0a1b2c3d-0000-4000-8000-000000000004';

  const claimsService = {
    submitPaymentClaim: jest.fn(),
    listMyPaymentClaims: jest.fn(),
    listPaymentClaimsForAdmin: jest.fn(),
    getPaymentClaimForAdmin: jest.fn(),
    reviewPaymentClaim: jest.fn(),
    deletePaymentClaim: jest.fn(),
  };

  const testAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{
        headers: Record<string, string>;
        user?: unknown;
        authMethod?: 'bearer' | 'cookie';
      }>();
      const role = req.headers['x-test-role'];
      if (!role) throw new UnauthorizedException();
      req.user = {
        userId: role === 'ADMIN' ? adminId : customerId,
        role,
      };
      req.authMethod =
        req.headers['x-test-auth-method'] === 'cookie' ? 'cookie' : 'bearer';
      return true;
    },
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    claimsService.submitPaymentClaim.mockResolvedValue({
      id: claimId,
      customerId,
      status: PaymentClaimStatus.PENDING,
      amount: 1250,
      paymentMethod: PaymentClaimMethod.MTN,
      pricingDetails: { customerTotal: 1250 },
      bookingPayment: null,
    });
    claimsService.listMyPaymentClaims.mockResolvedValue([]);
    claimsService.listPaymentClaimsForAdmin.mockResolvedValue([]);
    claimsService.getPaymentClaimForAdmin.mockResolvedValue({ id: claimId });
    claimsService.reviewPaymentClaim.mockResolvedValue({
      id: claimId,
      status: PaymentClaimStatus.APPROVED,
      bookingPayment: { id: paymentId, status: 'VALID' },
    });
    claimsService.deletePaymentClaim.mockResolvedValue({
      id: claimId,
      deleted: true,
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: claimsService },
        {
          provide: PermissionsService,
          useValue: { require: jest.fn().mockResolvedValue({}) },
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(testAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const asCustomer = () => ({ 'x-test-role': 'CUSTOMER' });
  const asAdmin = () => ({
    'x-test-role': 'ADMIN',
    'x-test-auth-method': 'cookie',
  });
  const claimBody = {
    serviceCategoryId: '0a1b2c3d-0000-4000-8000-000000000005',
    requestType: 'NORMAL',
    amount: 1250,
    paymentMethod: 'MTN',
    paymentNumber: '+250788123456',
  };

  it('submits a pending claim for the authenticated customer', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/payments/claims')
      .set(asCustomer())
      .send(claimBody)
      .expect(201);

    expect(body).toMatchObject({
      id: claimId,
      customerId,
      status: 'PENDING',
      amount: 1250,
      bookingPayment: null,
      pricingDetails: { customerTotal: 1250 },
    });
    expect(claimsService.submitPaymentClaim).toHaveBeenCalledWith(
      customerId,
      expect.objectContaining({
        serviceCategoryId: claimBody.serviceCategoryId,
        amount: 1250,
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
      }),
    );
  });

  it('rejects invalid claim input and returns the expected amount for a mismatch', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/claims')
      .set(asCustomer())
      .send({ ...claimBody, amount: 0 })
      .expect(400);
    expect(claimsService.submitPaymentClaim).not.toHaveBeenCalled();

    claimsService.submitPaymentClaim.mockRejectedValueOnce(
      new BadRequestException({
        message: 'Claim amount does not match the quote.',
        expectedAmount: 1250,
        pricingDetails: { customerTotal: 1250 },
      }),
    );
    const { body } = await request(app.getHttpServer())
      .post('/api/v1/payments/claims')
      .set(asCustomer())
      .send({ ...claimBody, amount: 1200 })
      .expect(400);

    expect(body).toMatchObject({
      statusCode: 400,
      message: 'Claim amount does not match the quote.',
      expectedAmount: 1250,
      pricingDetails: { customerTotal: 1250 },
    });
  });

  it('returns only the authenticated user’s claims', async () => {
    claimsService.listMyPaymentClaims.mockResolvedValueOnce([
      { id: claimId, customerId, status: 'PENDING' },
    ]);

    const { body } = await request(app.getHttpServer())
      .get('/api/v1/payments/claims/mine')
      .set(asCustomer())
      .expect(200);

    expect(body).toEqual([{ id: claimId, customerId, status: 'PENDING' }]);
    expect(claimsService.listMyPaymentClaims).toHaveBeenCalledWith(customerId);
  });

  it('allows admins to approve a claim and returns the issued booking payment ID', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/payment-claims/${claimId}/review`)
      .set(asCustomer())
      .send({ status: 'APPROVED' })
      .expect(403);
    expect(claimsService.reviewPaymentClaim).not.toHaveBeenCalled();

    const { body } = await request(app.getHttpServer())
      .patch(`/api/v1/admin/payment-claims/${claimId}/review`)
      .set(asAdmin())
      .send({
        status: 'APPROVED',
        reviewNote: 'Transfer verified.',
      })
      .expect(200);

    expect(body).toMatchObject({
      id: claimId,
      status: 'APPROVED',
      bookingPayment: { id: paymentId, status: 'VALID' },
    });
    expect(claimsService.reviewPaymentClaim).toHaveBeenCalledWith(
      claimId,
      expect.objectContaining({
        status: PaymentClaimStatus.APPROVED,
        reviewNote: 'Transfer verified.',
      }),
      adminId,
    );
  });

  it('lets admins reject and delete claims but denies unauthenticated access', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/payment-claims')
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/payment-claims/${claimId}/review`)
      .set(asAdmin())
      .send({ status: 'REJECTED', reviewNote: 'No matching transfer.' })
      .expect(200);
    expect(claimsService.reviewPaymentClaim).toHaveBeenCalledWith(
      claimId,
      expect.objectContaining({ status: PaymentClaimStatus.REJECTED }),
      adminId,
    );

    const { body } = await request(app.getHttpServer())
      .delete(`/api/v1/admin/payment-claims/${claimId}`)
      .set(asAdmin())
      .expect(200);
    expect(body).toEqual({ id: claimId, deleted: true });
    expect(claimsService.deletePaymentClaim).toHaveBeenCalledWith(
      claimId,
      adminId,
    );
  });
});
