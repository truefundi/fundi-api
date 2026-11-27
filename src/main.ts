import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
// Namespace imports: the project compiles without esModuleInterop.
import * as cookieParser from 'cookie-parser';
import * as helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfiguredIoAdapter } from './websockets/configured-io.adapter';
import {
  ADMIN_2FA_CHALLENGE_COOKIE,
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
} from './auth/admin-cookies';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  // Trust the immediate reverse proxy (Traefik) for X-Forwarded-For / X-Forwarded-Proto.
  app.set('trust proxy', 1);

  // Ensure SIGTERM / SIGINT cleanly drain Prisma, Redis, and BullMQ connections.
  app.enableShutdownHooks();

  // Security headers (allow cross-origin resource embedding for authenticated media previews).
  app.use(
    helmet.default({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Bounded JSON / form body limits.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // Populates req.cookies for the admin session cookies and the two-factor challenge.
  app.use(cookieParser());

  const configService = app.get(ConfigService);
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, configService));
  const port = configService.get<number>('port', 3000);
  const environment = configService.get<string>('environment', 'development');
  const corsOrigins = configService.get<string[]>('cors.origins', [
    'http://localhost:3000',
    'http://localhost:8081',
  ]);

  // Global Exception Filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global Pipe Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS Configuration
  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Expose Swagger OpenAPI UI only outside production.
  if (environment !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Fundi API')
      .setDescription('Fundi Platform Backend REST & Realtime API')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Paste the `accessToken` returned by `POST /api/v1/auth/verify-otp`, with no "Bearer " prefix.',
        },
        'accessToken',
      )
      .addCookieAuth(ADMIN_ACCESS_COOKIE, undefined, 'adminAccessToken')
      .addCookieAuth(ADMIN_REFRESH_COOKIE, undefined, 'adminRefreshToken')
      .addCookieAuth(
        ADMIN_2FA_CHALLENGE_COOKIE,
        undefined,
        'adminTwoFactorChallenge',
      )
      .addTag(
        'auth',
        'Phone-OTP sign-up and sign-in, token exchange, and session revocation.',
      )
      .addTag(
        'admin-auth',
        'Admin dashboard sign-in: email and password, then an authenticator second factor. Sessions are held in httpOnly cookies.',
      )
      .addTag(
        'users',
        'Profile and account administration. Routes marked admin need the ADMIN role.',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
  logger.log(`Fundi Backend running on port ${port} (${environment})`);
  if (environment !== 'production') {
    logger.log(
      `Swagger documentation available at http://localhost:${port}/api/docs`,
    );
  }
}
bootstrap();
