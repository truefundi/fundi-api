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
});
