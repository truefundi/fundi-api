import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { JobsModule } from './../src/jobs/jobs.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

// Stands in for JobsModule inside the test graph.
@Module({})
class NoJobsModule {}

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Nothing here exercises the background queue, and a live BullMQ worker opens its
      // own Redis connections whose teardown races the shutdown below, surfacing as an
      // unhandled error attributed to whichever test happens to be running. Dropping the
      // module keeps the suite hermetic; JobsModule is a leaf that nothing injects.
      .overrideModule(JobsModule)
      .useModule(NoJobsModule)
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the request pipeline that main.ts builds, so these tests see the same
    // validation, error envelope and cookie parsing that the running server has.
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.use(cookieParser());
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

  // Admin sign-in. Only the checks that need neither Postgres nor Redis are covered
  // here, so these run on a bare checkout. The credential, lockout and authenticator
  // code-checking logic is covered by admin-auth.service.spec.ts.
  describe('admin sign-in', () => {
    // The body is validated before any credential is looked up.
    it('/api/v1/auth/admin/login (POST) rejects a request with no password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/admin/login')
        .send({ email: 'admin@fundi.rw' })
        .expect(400);
    });

    it('/api/v1/auth/admin/login (POST) rejects a password that breaks the strength rules', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/admin/login')
        .send({ email: 'admin@fundi.rw', password: 'alllowercase' })
        .expect(400);
    });

    // The challenge id is only ever read from a cookie. Accepting it in the body would
    // let a caller aim a verification at a challenge that is not their own.
    it('/api/v1/auth/admin/login (POST) refuses a challenge id supplied in the body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/admin/login')
        .send({ email: 'admin@fundi.rw', password: 'Fundi#Admin2026', challengeId: 'forged' })
        .expect(400);
    });

    // Nothing is pending without the cookie that /login sets.
    it('/api/v1/auth/admin/2fa/verify (POST) rejects a code with no pending challenge', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/admin/2fa/verify')
        .send({ code: '123456' })
        .expect(400);
    });

    // The second factor is an authenticator app, so there is nothing to resend and the
    // route is gone rather than left answering 400.
    it('/api/v1/auth/admin/2fa/resend (POST) is no longer routed', () => {
      return request(app.getHttpServer()).post('/api/v1/auth/admin/2fa/resend').expect(404);
    });

    // Refreshing reads the cookie and nothing else, so there is no body to send.
    it('/api/v1/auth/admin/refresh (POST) rejects a call with no refresh cookie', () => {
      return request(app.getHttpServer()).post('/api/v1/auth/admin/refresh').expect(400);
    });

    // Signing out always succeeds and always clears all three cookies, so the dashboard
    // can never be left holding a session it has no way to drop.
    it('/api/v1/auth/admin/logout (POST) succeeds with no session and clears the cookies', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/admin/logout')
        .expect(200);

      expect(response.body.message).toBe('Signed out successfully.');
      const cleared = (response.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(cleared).toContain('fundi_admin_access=');
      expect(cleared).toContain('fundi_admin_refresh=');
      expect(cleared).toContain('fundi_admin_2fa_challenge=');
    });

    // This stays shut until the second factor completes, because no access cookie
    // exists before /2fa/verify has succeeded.
    it('/api/v1/auth/admin/me (GET) rejects unauthenticated requests', () => {
      return request(app.getHttpServer()).get('/api/v1/auth/admin/me').expect(401);
    });

    // Account self-service also requires authentication, and unlike the rest of the
    // admin surface it accepts only a bearer token.
    it('/api/v1/users/me (PATCH) rejects unauthenticated requests', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .send({ fullName: 'Attempted Change' })
        .expect(401);
    });
  });
});
