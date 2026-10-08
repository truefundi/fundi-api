import { ExecutionContext, INestApplication, Logger, NotFoundException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import * as request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Exercises the full request pipeline used in main.ts (ValidationPipe +
// HttpExceptionFilter) with a stand-in JWT guard, so real RolesGuard
// enforcement, query validation, and the shared error envelope are verified
// over HTTP without a database or token fixtures.
describe('Users endpoints (HTTP)', () => {
  let app: INestApplication;

  const knownId = '0a1b2c3d-0000-4000-8000-000000000001';
  const usersService = {
    findAll: jest.fn(),
    search: jest.fn(),
    getByEmail: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    updateAccount: jest.fn(),
    deleteAccount: jest.fn(),
  };

  // Stand-in for AuthGuard('jwt'): a request carries its role in a test header.
  const testAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: unknown }>();
      const role = req.headers['x-test-role'];
      if (!role) throw new UnauthorizedException();
      req.user = { userId: knownId, role };
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
    usersService.findAll.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    usersService.getById.mockResolvedValue({ id: knownId });
    usersService.updateStatus.mockResolvedValue({ id: knownId, status: 'INACTIVE' });

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(testAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors the global configuration in main.ts.
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const asAdmin = () => ({ 'x-test-role': 'ADMIN' });

  describe('authorization', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
      expect(usersService.findAll).not.toHaveBeenCalled();
    });

    it('rejects CUSTOMER callers with 403 on GET /users', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('x-test-role', 'CUSTOMER')
        .expect(403);
      expect(usersService.findAll).not.toHaveBeenCalled();
    });

    it('rejects TECHNICIAN callers with 403 on GET /users/:id', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/users/${knownId}`)
        .set('x-test-role', 'TECHNICIAN')
        .expect(403);
      expect(usersService.getById).not.toHaveBeenCalled();
    });

    it('rejects non-admin status changes with 403', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${knownId}/status`)
        .set('x-test-role', 'TECHNICIAN')
        .send({ status: 'INACTIVE' })
        .expect(403);
      expect(usersService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('GET /users', () => {
    it('returns the paginated envelope for an admin', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set(asAdmin())
        .expect(200);

      expect(body).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('passes converted query values to the service', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users?search=john&page=2&limit=5&role=TECHNICIAN&status=ACTIVE')
        .set(asAdmin())
        .expect(200);

      expect(usersService.findAll).toHaveBeenCalledWith({
        page: 2,
        limit: 5,
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        search: 'john',
      });
    });

    it.each([
      ['page=0', 'an out-of-range page'],
      ['page=abc', 'a non-numeric page'],
      ['limit=101', 'an out-of-range limit'],
      ['role=SUPERADMIN', 'an unknown role'],
      ['status=PENDING', 'an unknown status'],
      ['search=', 'an empty search'],
      ['bogus=1', 'an unknown parameter'],
    ])('rejects %s (%s) with a 400 validation envelope', async (query) => {
      const { body } = await request(app.getHttpServer())
        .get(`/api/v1/users?${query}`)
        .set(asAdmin())
        .expect(400);

      expect(body.statusCode).toBe(400);
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.path).toBe('string');
      expect(Array.isArray(body.message)).toBe(true);
      expect(usersService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('GET /users/:id', () => {
    it('returns one user for an admin', async () => {
      const { body } = await request(app.getHttpServer())
        .get(`/api/v1/users/${knownId}`)
        .set(asAdmin())
        .expect(200);

      expect(body).toEqual({ id: knownId });
    });

    it('returns 404 when the user does not exist', async () => {
      usersService.getById.mockRejectedValue(
        new NotFoundException('User with ID was not found.'),
      );

      const { body } = await request(app.getHttpServer())
        .get('/api/v1/users/1a1b2c3d-0000-4000-8000-000000000099')
        .set(asAdmin())
        .expect(404);

      expect(body.statusCode).toBe(404);
    });

    it('returns 400 for a malformed id', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/not-a-uuid')
        .set(asAdmin())
        .expect(400);
      expect(usersService.getById).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /users/:id/status', () => {
    it('updates the status for an admin', async () => {
      const { body } = await request(app.getHttpServer())
        .patch(`/api/v1/users/${knownId}/status`)
        .set(asAdmin())
        .send({ status: 'INACTIVE' })
        .expect(200);

      expect(usersService.updateStatus).toHaveBeenCalledWith(knownId, 'INACTIVE');
      expect(body).toEqual({ id: knownId, status: 'INACTIVE' });
    });

    it('rejects an unknown status value with 400', async () => {
      const { body } = await request(app.getHttpServer())
        .patch(`/api/v1/users/${knownId}/status`)
        .set(asAdmin())
        .send({ status: 'PENDING' })
        .expect(400);

      expect(Array.isArray(body.message)).toBe(true);
      expect(usersService.updateStatus).not.toHaveBeenCalled();
    });

    it('rejects a missing status with 400', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${knownId}/status`)
        .set(asAdmin())
        .send({})
        .expect(400);
      expect(usersService.updateStatus).not.toHaveBeenCalled();
    });
  });
});
