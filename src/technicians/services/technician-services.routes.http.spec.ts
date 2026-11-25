import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthService } from '../../auth/auth.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { TechniciansController } from '../technicians.controller';
import { TechniciansService } from '../technicians.service';
import { TechnicianServicesController } from './technician-services.controller';
import { TechnicianServicesService } from './technician-services.service';

/**
 * Adding a service goes through the per-service review (pending until an admin
 * approves it). Both controllers live under /api/v1/technicians, and Nest
 * answers a path with the first controller that declares it, so a second
 * POST /profile/services on TechniciansController would silently take over.
 */
describe('POST /api/v1/technicians/profile/services (HTTP)', () => {
  let app: INestApplication;
  const userId = '0a1b2c3d-0000-4000-8000-000000000001';
  const categoryId = '0a1b2c3d-0000-4000-8000-000000000002';

  const reviewFlow = { add: jest.fn() };
  const technicians = { addServiceExperience: jest.fn() };

  const testAuthGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context
        .switchToHttp()
        .getRequest<{ headers: Record<string, string>; user?: unknown }>();
      const role = req.headers['x-test-role'];
      if (!role) throw new UnauthorizedException();
      req.user = { userId, role };
      return true;
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    reviewFlow.add.mockResolvedValue({
      id: 'service-1',
      categoryId,
      status: 'PENDING',
    });

    // Registered in the same order as TechniciansModule.
    const moduleRef = await Test.createTestingModule({
      controllers: [TechniciansController, TechnicianServicesController],
      providers: [
        { provide: TechniciansService, useValue: technicians },
        { provide: AuthService, useValue: {} },
        { provide: TechnicianServicesService, useValue: reviewFlow },
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

  it('sends a new service to the review flow, not the profile service', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/technicians/profile/services')
      .set('x-test-role', 'TECHNICIAN')
      .send({ categoryId, yearsOfExperience: 4 })
      .expect(201);

    expect(res.body).toMatchObject({ id: 'service-1', status: 'PENDING' });
    expect(reviewFlow.add).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ categoryId, yearsOfExperience: 4 }),
    );
    expect(technicians.addServiceExperience).not.toHaveBeenCalled();
  });
});
