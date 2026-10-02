# Fundi Platform — Backend REST & Realtime API

The backend API service for the Fundi platform, built with **NestJS**, **TypeScript**, **PostgreSQL + PostGIS**, **Prisma ORM**, **Redis**, **BullMQ**, and **Socket.IO**.

---

## 1. Quick Start Guide

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
```bash
cp .env.example .env
```

### Step 3: Generate Prisma Client
```bash
npm run prisma:generate
```

### Step 4: Run Development Server
```bash
npm run start:dev
```

To populate the initial service categories in the configured database, run:
```bash
npm run prisma:seed
```

* **API Base URL:** `http://localhost:3000`
* **Swagger OpenAPI Documentation:** `http://localhost:3000/api/docs`
* **Health Check Endpoint:** `http://localhost:3000/api/v1/health`

---

## 2. API Scripts & Commands

```bash
npm run start:dev     # Start NestJS development server with watch mode
npm run build         # Build production TypeScript output into dist/
npm run start:prod    # Start compiled production server
npm run test          # Run unit test suite (Jest)
npm run test:e2e      # Run end-to-end integration test suite
npm run lint          # Run ESLint code quality checks
npm run format        # Format code using Prettier
```

---

## 3. Project Architecture

```
backend/
├── prisma/
│   └── schema.prisma         # PostgreSQL + PostGIS Prisma ORM schema
├── src/
│   ├── auth/                 # JWT Authentication & Passport strategy
│   ├── common/               # Global filters & interceptors
│   ├── catalog/              # Public service categories and admin catalog management
│   ├── config/               # Environment configuration loader
│   ├── database/             # Prisma database service & module
│   ├── health/               # API, Database, and Redis health checks
│   ├── jobs/                 # BullMQ background job queues
│   ├── redis/                # ioredis service & module
│   ├── technicians/          # Technician profiles, management, and discovery
│   ├── users/                # User profile management
│   ├── websockets/           # Socket.IO event gateway
│   ├── app.controller.ts     # Root controller (Redirect to Swagger docs)
│   ├── app.module.ts         # Main NestJS module
│   └── main.ts               # Application entry point
├── docs/
│   ├── authentication.md     # Phone OTP authentication endpoint guide
│   ├── implementation-roadmap.md # Ordered daily feature delivery plan
│   ├── service-categories.md # Service catalog endpoint guide
│   ├── technician-onboarding.md # Technician management API guide
│   └── users.md              # User management endpoint guide
├── test/                     # End-to-end (E2E) integration tests
├── .env.example              # Environment variables template
├── eslint.config.mjs         # ESLint configuration
└── tsconfig.json             # TypeScript strict configuration
```

## 4. Health Check and API Documentation

### `GET /api/v1/health`

No request body or authentication is required. It checks the API, PostgreSQL, and Redis availability.

Example success response (`200`):

```json
{
  "status": "ok",
  "timestamp": "2026-09-30T10:00:00.000Z",
  "services": {
    "api": "up",
    "database": "up",
    "redis": "up"
  }
}
```

If PostgreSQL or Redis is unavailable, that service reports `down` and the overall status is `degraded`.

### Swagger UI

Open `http://localhost:3000/api/docs` in a browser to explore the generated OpenAPI documentation and available API routes.

## 5. Feature API Guides

Detailed request formats and expected responses are documented separately:

- [Phone authentication and OTP endpoints](docs/authentication.md)
- [Service categories endpoints](docs/service-categories.md)
- [Technician management and discovery endpoints](docs/technician-onboarding.md)
- [User management endpoints](docs/users.md)
- [Day-by-day implementation roadmap](docs/implementation-roadmap.md)

These guides include required authentication, request examples, successful response structures, and common errors.
