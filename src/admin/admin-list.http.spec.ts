import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { AdminJobsController } from '../jobs/admin-jobs.controller';
import { JobsService } from '../jobs/jobs.service';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { PermissionsService } from '../staff/permissions.service';

describe('Admin list HTTP contracts', () => {
  let app: INestApplication;
  const page = {
    data: [{ id: 'row' }],
    pagination: { page: 2, limit: 5, total: 12, totalPages: 3 },
  };
  const jobs = {
    listForAdmin: jest.fn(),
    listPageForAdmin: jest.fn(),
    getForAdmin: jest.fn(),
  };
  const payments = {
    listAll: jest.fn(),
    listPageForAdmin: jest.fn(),
    summaryForAdmin: jest.fn(),
  };
  const permissions = {
    require: jest.fn(async (id: string) => {
      if (id === 'denied') throw new ForbiddenException('Missing permission');
    }),
  };
  const authentication = {
    canActivate(context: ExecutionContext) {
      const req = context.switchToHttp().getRequest();
      const role = req.headers['x-role'];
      if (!role) throw new UnauthorizedException();
      req.user = { userId: req.headers['x-deny'] ? 'denied' : 'staff-1', role };
      req.authMethod = req.headers['x-auth'] ?? 'cookie';
      return true;
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminJobsController, PaymentsController],
      providers: [
        { provide: JobsService, useValue: jobs },
        { provide: PaymentsService, useValue: payments },
        { provide: PermissionsService, useValue: permissions },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(authentication)
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
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jobs.listForAdmin.mockResolvedValue([{ id: 'legacy-job', offers: [] }]);
    payments.listAll.mockResolvedValue([{ id: 'legacy-payment' }]);
    jobs.listPageForAdmin.mockResolvedValue(page);
    payments.listPageForAdmin.mockResolvedValue(page);
    payments.summaryForAdmin.mockResolvedValue({
      total: 0,
      amount: 0,
      currency: 'RWF',
      byStatus: [],
    });
  });

  it.each(['jobs', 'payments'])(
    'preserves the no-query legacy array for %s',
    async (domain) => {
      const result = await request(app.getHttpServer())
        .get(`/api/v1/admin/${domain}`)
        .set('x-role', 'ADMIN')
        .expect(200);
      expect(Array.isArray(result.body)).toBe(true);
      expect(jobs.listPageForAdmin).not.toHaveBeenCalled();
      expect(payments.listPageForAdmin).not.toHaveBeenCalled();
    },
  );

  it('validates and transforms job filters before selecting the paginated contract', async () => {
    const result = await request(app.getHttpServer())
      .get(
        '/api/v1/admin/jobs?page=2&limit=5&search=%20pipe%20&status=OPEN&group=matching&sortBy=priority&sortOrder=asc',
      )
      .set('x-role', 'ADMIN')
      .expect(200);
    expect(result.body).toEqual(page);
    expect(jobs.listForAdmin).not.toHaveBeenCalled();
    expect(jobs.listPageForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 5,
        search: 'pipe',
        status: 'OPEN',
        group: 'matching',
        sortBy: 'priority',
        sortOrder: 'asc',
      }),
    );
    expect(permissions.require).toHaveBeenCalledWith('staff-1', ['jobs.view']);
  });

  it('supports payment filtering without an explicit page and protects the summary', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/payments?status=EXPIRED&from=2026-11-01T00:00:00Z')
      .set('x-role', 'ADMIN')
      .expect(200);
    expect(payments.listPageForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'EXPIRED',
        from: '2026-11-01T00:00:00Z',
      }),
    );
    expect(payments.listAll).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .get('/api/v1/admin/payments/summary?search=Plumbing')
      .set('x-role', 'ADMIN')
      .expect(200);
    expect(payments.summaryForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Plumbing' }),
    );
    expect(permissions.require).toHaveBeenLastCalledWith('staff-1', [
      'payments.view',
    ]);
  });

  it.each(['jobs', 'payments', 'payments/summary'])(
    'preserves authentication, role, cookie, and permission enforcement on %s',
    async (route) => {
      const url = `/api/v1/admin/${route}?page=1`;
      await request(app.getHttpServer()).get(url).expect(401);
      await request(app.getHttpServer())
        .get(url)
        .set('x-role', 'CUSTOMER')
        .expect(403);
      await request(app.getHttpServer())
        .get(url)
        .set('x-role', 'ADMIN')
        .set('x-auth', 'bearer')
        .expect(403);
      await request(app.getHttpServer())
        .get(url)
        .set('x-role', 'ADMIN')
        .set('x-deny', 'true')
        .expect(403);
      expect(jobs.listPageForAdmin).not.toHaveBeenCalled();
      expect(payments.listPageForAdmin).not.toHaveBeenCalled();
      expect(payments.summaryForAdmin).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['jobs', 'page=0'],
    ['jobs', 'page=NaN'],
    ['jobs', 'limit=101'],
    ['jobs', 'limit=1.5'],
    ['jobs', 'status=INVALID'],
    ['jobs', 'group=INVALID'],
    ['jobs', 'sortBy=DROP_TABLE'],
    ['jobs', 'sortOrder=sideways'],
    ['jobs', 'search='],
    ['jobs', 'customerId=not-a-uuid'],
    ['payments', 'status=INVALID'],
    ['payments', 'from=not-a-date'],
    ['payments', 'unknown=1'],
  ])(
    'rejects invalid %s query %s before executing list queries',
    async (domain, query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/${domain}?${query}`)
        .set('x-role', 'ADMIN')
        .expect(400);
      expect(jobs.listPageForAdmin).not.toHaveBeenCalled();
      expect(payments.listPageForAdmin).not.toHaveBeenCalled();
    },
  );

  it('publishes the dual response contracts, paging parameters and summary in Swagger', () => {
    const spec = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    for (const domain of ['jobs', 'payments']) {
      const operation = spec.paths[`/api/v1/admin/${domain}`].get!;
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'page', in: 'query' }),
          expect.objectContaining({ name: 'limit', in: 'query' }),
        ]),
      );
      expect(operation.responses['200']).toMatchObject({
        content: {
          'application/json': { schema: { oneOf: expect.any(Array) } },
        },
      });
    }
    expect(spec.paths['/api/v1/admin/payments/summary'].get).toBeDefined();
    expect(spec.components?.schemas?.PaginationMetaDto).toBeDefined();
  });
});
