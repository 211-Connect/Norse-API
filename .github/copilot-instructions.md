# Project Guidelines

## Code Style
- TypeScript + NestJS patterns; modules/controllers/services live under src/ (see [src/app.module.ts](src/app.module.ts)).
- Request typing is extended via global declarations; when using req.* additions, follow [src/global.d.ts](src/global.d.ts).
- Header parsing and validation in this codebase use Zod schemas (see [src/common/dto/headers.dto.ts](src/common/dto/headers.dto.ts)).
- Use skills from .agents/ for code generation and refactoring, but ensure generated code follows project conventions and is reviewed for correctness and security.

## Architecture
- App bootstrap sets global filters/pipes, Helmet, CORS, and header-based API versioning (x-api-version) in [src/main.ts](src/main.ts).
- AppModule wires infra (Redis cache, MongoDB, Redis-backed throttling) and registers domain modules in [src/app.module.ts](src/app.module.ts).
- Middleware: ServiceProviderMiddleware applies to all routes; TenantMiddleware applies only to specific controllers (see [src/app.module.ts](src/app.module.ts)).

## Build and Test
- Install: npm install
- Build: npm run build
- Run: npm run start | npm run start:dev | npm run start:prod
- Lint: npm run lint
- Tests: npm run test | npm run test:e2e | npm run test:cov

## Project Conventions
- Global exception responses include tenant and request metadata via [src/common/filters/global-exception.filter.ts](src/common/filters/global-exception.filter.ts).
- Request-scoped helpers are attached by middleware (cacheService, configService, tenantId) in [src/common/middleware/ServiceProviderMiddleware.ts](src/common/middleware/ServiceProviderMiddleware.ts) and [src/common/middleware/TenantMiddleware.ts](src/common/middleware/TenantMiddleware.ts).
- Swagger is served at /swagger with JSON at /swagger/json (see [src/main.ts](src/main.ts)).

## Integration Points
- Redis cache via cache-manager-redis-store and Redis-backed rate limiter (see [src/app.module.ts](src/app.module.ts)).
- MongoDB connection via Mongoose (see [src/app.module.ts](src/app.module.ts)).
- External APIs used by services include Elasticsearch and Mapbox SDK (see dependencies in [package.json](package.json)).
- Configuration and env var mapping is centralized in [src/common/config/configuration.ts](src/common/config/configuration.ts).

## Security
- Tenant enforcement requires x-tenant-id header for selected controllers (see [src/common/middleware/TenantMiddleware.ts](src/common/middleware/TenantMiddleware.ts)).
- Internal API routes can be protected via x-internal-api-key (see [src/common/guards/internal-api.guard.ts](src/common/guards/internal-api.guard.ts)).
- Rate limiting bypass is allowed when x-api-key matches INTERNAL_API_KEY (see [src/common/guards/throttler.guard.ts](src/common/guards/throttler.guard.ts)).
