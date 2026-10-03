import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
// Namespace import, not a default import: the project compiles without
// esModuleInterop, so `import cookieParser from 'cookie-parser'` typechecks but is
// undefined at runtime.
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Allows a bounded base64 profile image while keeping request bodies size-limited.
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  // Populates req.cookies for the admin session cookies and the two-factor challenge.
  app.use(cookieParser());

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const corsOrigins = configService.get<string[]>('cors.origins', [
    'http://localhost:3000',
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

  // Swagger Documentation Setup
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
    // Lets Swagger UI send the admin session cookies, which no request body carries.
    .addCookieAuth('adminAccessToken')
    .addCookieAuth('adminRefreshToken')
    .addCookieAuth('adminTwoFactorChallenge')
    .addTag('auth', 'Phone-OTP sign-up and sign-in, token exchange, and session revocation.')
    .addTag(
      'admin-auth',
      'Admin dashboard sign-in: email and password, then an SMS second factor. Sessions are held in httpOnly cookies.',
    )
    .addTag('users', 'Profile and account administration. Routes marked admin need the ADMIN role.')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`Fundi Backend running on port ${port}`);
  logger.log(
    `Swagger documentation available at http://localhost:${port}/api/docs`,
  );
}
bootstrap();
