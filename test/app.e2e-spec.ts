import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  // Public category discovery returns the active catalog as an array.
  it('/api/v1/catalog/categories (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/catalog/categories')
      .expect(200)
      .expect(Array.isArray);
  });

  // Public category name search is available without authentication.
  it('/api/v1/catalog/categories/search (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/catalog/categories/search?name=plumb')
      .expect(200)
      .expect(Array.isArray);
  });

  // Category mutations require a valid administrator access token.
  it('/api/v1/catalog/categories (POST) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .post('/api/v1/catalog/categories')
      .send({ name: 'Unauthorized Category' })
      .expect(401);
  });

  // Technician draft profiles cannot be accessed without a technician token.
  it('/api/v1/technicians/profile (GET) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .get('/api/v1/technicians/profile')
      .expect(401);
  });

  // Explicit technician profile registration requires a technician token.
  it('/api/v1/technicians/profile (POST) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .post('/api/v1/technicians/profile')
      .send({ publicLocationLabel: 'Kigali' })
      .expect(401);
  });

  // Customer discovery and administrator management require their respective roles.
  it('/api/v1/technicians (GET) rejects unauthenticated requests', () => {
    return request(app.getHttpServer()).get('/api/v1/technicians').expect(401);
  });

  it('/api/v1/admin/technicians (GET) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .get('/api/v1/admin/technicians')
      .expect(401);
  });

  // Technician availability changes require technician authentication.
  it('/api/v1/technicians/availability (PATCH) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/technicians/availability')
      .send({ availabilityStatus: 'ONLINE' })
      .expect(401);
  });

  // Admin technician creation requires administrator authentication.
  it('/api/v1/admin/technicians (POST) rejects unauthenticated requests', () => {
    return request(app.getHttpServer())
      .post('/api/v1/admin/technicians')
      .send({
        user: { fullName: 'Test Technician', phoneNumber: '+250788123456' },
      })
      .expect(401);
  });

  // The landing-page technician directory is intentionally public.
  it('/api/v1/public/technicians (GET) returns an array without authentication', () => {
    return request(app.getHttpServer())
      .get('/api/v1/public/technicians')
      .expect(200)
      .expect(Array.isArray);
  });

  // Unavailable technicians are not exposed through the public detail route.
  it('/api/v1/public/technicians/:id (GET) hides unavailable profiles', () => {
    return request(app.getHttpServer())
      .get('/api/v1/public/technicians/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});
