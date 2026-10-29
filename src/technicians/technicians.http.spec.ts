import {
  ExecutionContext,
  INestApplication,
  Logger,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TechniciansAdminController } from './technicians-admin.controller';
import { TechniciansController } from './technicians.controller';
import { TechniciansPublicController } from './technicians-public.controller';
import { TechniciansService } from './technicians.service';
import { AuthService } from '../auth/auth.service';

// Exercises the full request pipeline used in main.ts (ValidationPipe +
// HttpExceptionFilter) with a stand-in JWT guard, so query conversion,
// unknown-parameter rejection, role checks, and the shared `{ data,
// pagination }` envelope are verified over HTTP without a database.
describe('Technician list endpoints (HTTP)', () => {
  let app: INestApplication;

  const technicianId = '0a1b2c3d-0000-4000-8000-000000000001';
  const categoryId = 'e5a4f4d7-0b21-46d8-9a4b-98765d332100';

  const envelope = (data: unknown[] = []) => ({
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length ? 1 : 0,
    },
  });

  const techniciansService = {
    registerPublicTechnician: jest.fn(),
    registerMyProfile: jest.fn(),
    listAllByAdmin: jest.fn(),
    searchByAdmin: jest.fn(),
    searchByUserDetails: jest.fn(),
    listAvailable: jest.fn(),
    listApproved: jest.fn(),
    listPublic: jest.fn(),
    setAccountStatusByAdmin: jest.fn(),
  };
  const authService = {
    requestTechnicianRegistrationOtp: jest.fn(),
  };

  // Stand-in for AuthGuard('jwt'): a request carries its role in a test header.
  const testAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context
        .switchToHttp()
        .getRequest<{ headers: Record<string, string>; user?: unknown }>();
      const role = req.headers['x-test-role'];
      if (!role) throw new UnauthorizedException();
      req.user = { userId: technicianId, role };
      return true;
    },
  };

  beforeAll(() => {
    // The exception filter logs every failure; keep test output readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    techniciansService.listAllByAdmin.mockResolvedValue(envelope());
    techniciansService.registerMyProfile.mockResolvedValue({
      id: technicianId,
    });
    techniciansService.registerPublicTechnician.mockResolvedValue({
      id: technicianId,
      user: { id: 'public-user-id' },
    });
    authService.requestTechnicianRegistrationOtp.mockResolvedValue({
      message: 'OTP generated.',
    });
    techniciansService.searchByAdmin.mockResolvedValue(envelope());
    techniciansService.listAvailable.mockResolvedValue(envelope());
    techniciansService.listApproved.mockResolvedValue(envelope());
    techniciansService.listPublic.mockResolvedValue(envelope());
    techniciansService.setAccountStatusByAdmin.mockResolvedValue({
      id: technicianId,
    } as never);

    const moduleRef = await Test.createTestingModule({
      controllers: [
        TechniciansAdminController,
        TechniciansController,
        TechniciansPublicController,
      ],
      providers: [
        { provide: TechniciansService, useValue: techniciansService },
        { provide: AuthService, useValue: authService },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(testAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors the global configuration in main.ts.
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

  const asAdmin = () => ({ 'x-test-role': 'ADMIN' });

  describe('authorization', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/technicians')
        .expect(401);
      expect(techniciansService.listAllByAdmin).not.toHaveBeenCalled();
    });

    describe('POST /technicians/register', () => {
      it('creates a public technician registration and starts phone OTP verification', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/technicians/register')
          .send({
            user: {
              fullName: 'Amina Example',
              phoneNumber: '0788123456',
              email: ' AMINA@EXAMPLE.COM ',
            },
            profile: {
              gender: 'FEMALE',
              nationalIdNumber: 'ID123456',
              baseAddress: 'Kigali, Rwanda',
              publicLocationLabel: 'Kigali',
              baseLatitude: null,
              baseLongitude: null,
              paymentMethod: 'MOMO',
              paymentNumber: '0788123456',
              serviceExperiences: [
                {
                  categoryId,
                  yearsOfExperience: 5,
                },
              ],
            },
          })
          .expect(201);

        expect(techniciansService.registerPublicTechnician).toHaveBeenCalledWith(
          expect.objectContaining({
            user: expect.objectContaining({
              phoneNumber: '+250788123456',
              email: 'amina@example.com',
            }),
            profile: expect.objectContaining({
              baseLatitude: null,
              baseLongitude: null,
              paymentNumber: '+250788123456',
            }),
          }),
        );
        expect(
          authService.requestTechnicianRegistrationOtp,
        ).toHaveBeenCalledWith('public-user-id');
      });
    });

    it('rejects non-admin callers with 403 on the admin list', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/technicians')
        .set('x-test-role', 'CUSTOMER')
        .expect(403);
      expect(techniciansService.listAllByAdmin).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/technicians', () => {
    it('returns the paginated envelope for an admin', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/admin/technicians')
        .set(asAdmin())
        .expect(200);

      expect(body).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('passes converted query values to the service', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/v1/admin/technicians' +
            '?search=%20amina%20&location=kigali&verificationStatus=APPROVED' +
            '&availabilityStatus=ONLINE&status=ACTIVE' +
            `&categoryId=${categoryId}&category=Plumbing&minYearsOfExperience=3` +
            '&page=2&limit=5',
        )
        .set(asAdmin())
        .expect(200);

      expect(techniciansService.listAllByAdmin).toHaveBeenCalledWith({
        search: 'amina',
        location: 'kigali',
        verificationStatus: 'APPROVED',
        availabilityStatus: 'ONLINE',
        status: 'ACTIVE',
        categoryId,
        category: 'Plumbing',
        minYearsOfExperience: 3,
        page: 2,
        limit: 5,
      });
    });

    it.each([
      ['page=0', 'an out-of-range page'],
      ['page=abc', 'a non-numeric page'],
      ['limit=101', 'an out-of-range limit'],
      ['verificationStatus=SUPERSEDED', 'an unknown verification status'],
      ['availabilityStatus=AWAY', 'an unknown availability status'],
      ['status=DORMANT', 'an unknown account status'],
      ['minYearsOfExperience=abc', 'a non-numeric experience filter'],
      ['categoryId=not-a-uuid', 'a malformed category ID'],
      ['search=', 'an empty search'],
      ['nationalIdNumber=ID123456', 'a removed technician profile field'],
      ['bogus=1', 'an unknown parameter'],
    ])('rejects %s (%s) with a 400 validation envelope', async (query) => {
      const { body } = await request(app.getHttpServer())
        .get(`/api/v1/admin/technicians?${query}`)
        .set(asAdmin())
        .expect(400);

      expect(body.statusCode).toBe(400);
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.path).toBe('string');
      expect(Array.isArray(body.message)).toBe(true);
      expect(techniciansService.listAllByAdmin).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/technicians/search', () => {
    it('passes converted search values to the service', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/v1/admin/technicians/search' +
            '?query=%20Kigali%20&page=1&limit=10',
        )
        .set(asAdmin())
        .expect(200);

      expect(techniciansService.searchByAdmin).toHaveBeenCalledWith({
        query: 'Kigali',
        page: 1,
        limit: 10,
      });
    });

    describe('POST /technicians/profile', () => {
      it('accepts nationalIdNumber as a technician profile field', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/technicians/profile')
          .set('x-test-role', 'TECHNICIAN')
          .send({ nationalIdNumber: 'ID123456' })
          .expect(201);

        expect(techniciansService.registerMyProfile).toHaveBeenCalledWith(
          technicianId,
          { nationalIdNumber: 'ID123456' },
        );
      });

      it('allows a logged-in customer to start a technician profile', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/technicians/profile')
          .set('x-test-role', 'CUSTOMER')
          .send({ nationalIdNumber: 'ID123456' })
          .expect(201);

        expect(techniciansService.registerMyProfile).toHaveBeenCalledWith(
          technicianId,
          { nationalIdNumber: 'ID123456' },
        );
      });

      it('accepts a text location with null coordinates for a logged-in customer', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/technicians/profile')
          .set('x-test-role', 'CUSTOMER')
          .send({
            gender: 'FEMALE',
            baseAddress: 'Kigali, Rwanda',
            publicLocationLabel: 'Kigali',
            baseLatitude: null,
            baseLongitude: null,
          })
          .expect(201);

        expect(techniciansService.registerMyProfile).toHaveBeenCalledWith(
          technicianId,
          expect.objectContaining({
            baseAddress: 'Kigali, Rwanda',
            publicLocationLabel: 'Kigali',
            baseLatitude: null,
            baseLongitude: null,
          }),
        );
      });
    });

    it('returns the paginated envelope', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/admin/technicians/search?query=Kigali')
        .set(asAdmin())
        .expect(200);

      expect(body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
    });
  });

  describe('GET /technicians (discovery)', () => {
    it('passes converted filters to the service with the caller viewer', async () => {
      await request(app.getHttpServer())
        .get(
          '/api/v1/technicians' +
            '?query=solar&location=kigali&category=Plumbing' +
            `&categoryId=${categoryId}&minYearsOfExperience=2&page=2&limit=5`,
        )
        .set('x-test-role', 'CUSTOMER')
        .expect(200);

      expect(techniciansService.listAvailable).toHaveBeenCalledWith(
        {
          categoryId,
          query: 'solar',
          location: 'kigali',
          category: 'Plumbing',
          minYearsOfExperience: 2,
          page: 2,
          limit: 5,
        },
        'authenticated',
      );
    });

    it('serves admins the admin viewer projection', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/technicians')
        .set(asAdmin())
        .expect(200);

      expect(techniciansService.listAvailable).toHaveBeenCalledWith(
        expect.anything(),
        'admin',
      );
    });

    it('rejects filters discovery does not expose, with 400', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/technicians?verificationStatus=APPROVED')
        .set('x-test-role', 'CUSTOMER')
        .expect(400);

      expect(Array.isArray(body.message)).toBe(true);
      expect(techniciansService.listAvailable).not.toHaveBeenCalled();
    });
  });

  describe('GET /public/technicians', () => {
    it('lists technicians without a token and returns the envelope', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/public/technicians?page=1&limit=10')
        .expect(200);

      expect(techniciansService.listPublic).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
      expect(body).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
  });

  describe('PATCH /admin/technicians/:id/status', () => {
    it('forwards the account status change to the service', async () => {
      const { body } = await request(app.getHttpServer())
        .patch(`/api/v1/admin/technicians/${technicianId}/status`)
        .set(asAdmin())
        .send({ status: 'SUSPENDED' })
        .expect(200);

      expect(techniciansService.setAccountStatusByAdmin).toHaveBeenCalledWith(
        technicianId,
        'SUSPENDED',
        technicianId,
      );
      expect(body).toEqual({ id: technicianId });
    });

    it.each([
      ['PENDING', 'a status outside the user status enum'],
      ['SUSPENDED!', 'a malformed status'],
    ])('rejects %s (%s) with a 400 validation envelope', async (value) => {
      const { body } = await request(app.getHttpServer())
        .patch(`/api/v1/admin/technicians/${technicianId}/status`)
        .set(asAdmin())
        .send({ status: value })
        .expect(400);

      expect(body.statusCode).toBe(400);
      expect(Array.isArray(body.message)).toBe(true);
      expect(techniciansService.setAccountStatusByAdmin).not.toHaveBeenCalled();
    });

    it('rejects a missing status body with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/technicians/${technicianId}/status`)
        .set(asAdmin())
        .send({})
        .expect(400);
      expect(techniciansService.setAccountStatusByAdmin).not.toHaveBeenCalled();
    });
  });
});
