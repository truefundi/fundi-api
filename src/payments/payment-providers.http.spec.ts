import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { PaymentProvidersController } from './payment-providers.controller';
import { PaymentProvidersService } from './payment-providers.service';
import { MobilePaymentsService } from './mobile-payments.service';

describe('Payment provider routes (HTTP)', () => {
  let app: INestApplication;
  const providers = {
    list: jest.fn().mockResolvedValue([
      { provider: 'MTN', mode: 'MANUAL' },
      { provider: 'AIRTEL', mode: 'MANUAL' },
    ]),
    update: jest
      .fn()
      .mockResolvedValue({ provider: 'MTN', apiEnabled: true, mode: 'API' }),
  };
  const payments = {
    initiate: jest
      .fn()
      .mockResolvedValue({ status: 'SUCCESS', simulated: true }),
    getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
  };
  const body = {
    provider: 'MTN',
    serviceCategoryId: '0a1b2c3d-0000-4000-8000-000000000001',
    phoneNumber: '0788123456',
    idempotencyKey: '0a1b2c3d-0000-4000-8000-000000000002',
  };
  const admin = { 'x-test-role': 'ADMIN', 'x-test-auth-method': 'cookie' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentProvidersController],
      providers: [
        { provide: PaymentProvidersService, useValue: providers },
        { provide: MobilePaymentsService, useValue: payments },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['x-test-role']) throw new UnauthorizedException();
          req.user = { id: 'user-1', role: req.headers['x-test-role'] };
          req.authMethod = req.headers['x-test-auth-method'] || 'bearer';
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it('exposes public modes and restricts configuration to admin cookie sessions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/payments/providers')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/admin/payment-providers')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/payment-providers')
      .set(admin)
      .expect(200);
    for (const headers of [
      { 'x-test-role': 'CUSTOMER' },
      { 'x-test-role': 'ADMIN' },
    ]) {
      await request(app.getHttpServer())
        .patch('/api/v1/admin/payment-providers/MTN')
        .set(headers)
        .send({ apiEnabled: true })
        .expect(403);
    }
    expect(providers.update).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch('/api/v1/admin/payment-providers/MTN')
      .set(admin)
      .send({ apiEnabled: true })
      .expect(200);
    expect(providers.update).toHaveBeenCalledWith('MTN', true, 'user-1');
  });

  it('validates provider names and requires an actual boolean', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/admin/payment-providers/UNKNOWN')
      .set(admin)
      .send({ apiEnabled: true })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/payment-providers/AIRTEL')
      .set(admin)
      .send({ apiEnabled: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/payment-providers/AIRTEL')
      .set(admin)
      .send({})
      .expect(400);
    expect(providers.update).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch('/api/v1/admin/payment-providers/AIRTEL')
      .set(admin)
      .send({ apiEnabled: false })
      .expect(200);
    expect(providers.update).toHaveBeenCalledWith('AIRTEL', false, 'user-1');
  });

  it('requires authentication and normalizes phone numbers for customer/technician payments', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/initiate')
      .send(body)
      .expect(401);
    for (const role of ['CUSTOMER', 'TECHNICIAN']) {
      await request(app.getHttpServer())
        .post('/api/v1/payments/initiate')
        .set('x-test-role', role)
        .send(body)
        .expect(201);
    }
    expect(payments.initiate).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({
        ...body,
        phoneNumber: '+250788123456',
      }),
    );
  });

  it.each([
    { phoneNumber: '12345' },
    { phoneNumber: '' },
    { provider: 'CREDIT_CARD' },
    { idempotencyKey: 'not-a-uuid' },
    { amount: 1 },
    { status: 'SUCCESS' },
  ])('rejects invalid payment input %j', async (override) => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/initiate')
      .set('x-test-role', 'CUSTOMER')
      .send({ ...body, ...override })
      .expect(400);
    expect(payments.initiate).not.toHaveBeenCalled();
  });

  it('passes the authenticated identity to transaction recovery', async () => {
    const id = '0a1b2c3d-0000-4000-8000-000000000003';
    await request(app.getHttpServer())
      .get(`/api/v1/payments/transactions/${id}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/payments/transactions/${id}`)
      .set('x-test-role', 'CUSTOMER')
      .expect(200);
    expect(payments.getTransaction).toHaveBeenCalledWith('user-1', id);
  });
});
