# Trams Microservices

A small TypeScript microservices system for user management. The API Gateway is
the only public HTTP service. It communicates with the User Service through
NATS request/reply; the User Service publishes `user.created` through a
transactional outbox; and the Notification Service consumes that event from
NATS JetStream.

See [the architecture guide](docs/architecture.md) for the component and
failure flows, and [the OpenAPI specification](docs/openapi.yaml) for the HTTP
API contract.

## Prerequisites

- Node.js 22 or later and npm
- Docker Desktop with Docker Compose v2, for the recommended local setup
- OpenSSL and a local PostgreSQL 16+ instance only when running services
  outside Docker

## Quick start with Docker

Docker Compose is the easiest way to run the complete environment. It starts
PostgreSQL, creates the Notification Service database, generates development
TLS certificates, starts NATS with JetStream, applies both Prisma migration
histories, and starts all three services.

```bash
docker compose up --build
```

The Gateway is available at `http://localhost:3000`; NATS monitoring is at
`http://localhost:8222`.

```bash
# Gateway process only
curl http://localhost:3000/api/health/live

# Gateway + NATS + at least one User Service RPC worker
curl http://localhost:3000/api/health/ready

curl -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"secure-password-123","name":"Ada"}'
```

Run more User Service replicas to exercise queue-group RPC load balancing:

```bash
docker compose up --scale user-service=2
```

Stop services but preserve PostgreSQL and JetStream data:

```bash
docker compose down
```

Remove all Compose volumes, including local database and JetStream data:

```bash
docker compose down -v
```

The Compose passwords and JWT secret are development values only. Never reuse
them in a deployed environment.

## Environment setup for native development

Install workspace dependencies and copy the example environment file:

```bash
npm install
cp .env.example .env
```

Set every blank value in `.env`. The required values are:

| Area                  | Required variables                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User database         | `DATABASE_URL`                                                                                                                                                                                                          |
| Notification database | `NOTIFICATION_DATABASE_URL`                                                                                                                                                                                             |
| NATS clients          | `NATS_URL`, `NATS_USER`, `NATS_PASSWORD`, `NATS_TLS_CA_FILE`                                                                                                                                                            |
| Gateway               | `JWT_SECRET` (at least 32 characters)                                                                                                                                                                                   |
| NATS broker           | `GATEWAY_NATS_USER`, `GATEWAY_NATS_PASSWORD`, `USER_SERVICE_NATS_USER`, `USER_SERVICE_NATS_PASSWORD`, `NOTIFICATION_SERVICE_NATS_USER`, `NOTIFICATION_SERVICE_NATS_PASSWORD`, `NATS_TLS_CERT_FILE`, `NATS_TLS_KEY_FILE` |

`NATS_USER` and `NATS_PASSWORD` identify the particular process being started:
use the Gateway credentials for the Gateway, User Service credentials for the
User Service, and Notification Service credentials for the Notification
Service. Each account has narrow permissions in
[`infra/nats/nats-server.conf`](infra/nats/nats-server.conf).

For a native TLS-enabled NATS server, generate local-only certificates once:

```bash
./infra/nats/generate-local-certs.sh
```

Point `NATS_TLS_CA_FILE`, `NATS_TLS_CERT_FILE`, and `NATS_TLS_KEY_FILE` at the
generated files. Start PostgreSQL and NATS separately, apply migrations, then
run the services:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
npm run dev
```

`npm run dev` runs Gateway, User Service, and Notification Service together.
Use `npm run dev:gateway`, `npm run dev:user`, or `npm run dev:notification`
to run one process. The User and Notification services have no HTTP port; they
need their database and NATS connection before they can start.

## Prisma migrations

There are two independent Prisma schemas and migration histories because the
User and Notification services own different databases:

- `prisma/` owns `users` and `outbox_events` in `DATABASE_URL`.
- `apps/notification-service/prisma/` owns `notification_deliveries` in
  `NOTIFICATION_DATABASE_URL`.

Generate both clients and apply both existing migration histories with:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

Compose runs these commands in its one-off `migrate` service before starting
the application services. For schema changes, create and review a migration in
the schema's owning service, commit it, then use `prisma:migrate:deploy` in
other environments. Do not let one service access the other service's tables.

## Commands and testing

```bash
npm run build                  # TypeScript build for every workspace
npm test                       # Run workspace test scripts
npm run lint                   # ESLint over app and library TypeScript
npm run format                 # Format TypeScript with Prettier
npm run clean                  # Remove generated build output
npm run dlq:inspect            # Inspect user.events.dlq (NATS env required)
npm run dlq:replay -- 42       # Dry-run replay of DLQ stream sequence 42
npm run dlq:replay -- 42 --execute
```

Run `npm run build` before submitting or deploying. `npm test` delegates to
workspace test scripts; add focused unit, integration, and API tests as the
application grows. The current repository does not yet include application
test suites, so a successful command can mean that no test files ran.

## Operations and failure handling

`GET /api/health/live` confirms only that the Gateway process can answer HTTP.
`GET /api/health/ready` (and the backwards-compatible `/api/health`) makes a
short NATS RPC health call, so it returns `503` if NATS or User Service is not
available.

Every Gateway response has `x-request-id`. A valid incoming value is kept;
otherwise the Gateway generates a UUID. Request logs use `pino-http`, redact
credentials/cookies, and forward the request ID to User Service in a NATS
header for correlated logs.

The User Service writes the user and its `user.created` outbox row in one
PostgreSQL transaction. A background relay publishes committed rows to
JetStream, retries failures with exponential backoff, and cleans published rows
after seven days by default. Its structured logs report outbox gauges and
counters.

The Notification Service uses a durable JetStream consumer with explicit ACKs.
Failed deliveries are retried up to five times; then the original event bytes
and diagnostic headers are safely copied to `user.events.dlq`. Notification
delivery state is persisted in the Notification Service database with a unique
`eventId`, which makes normal JetStream redelivery idempotent. A real email
provider should receive that same `eventId` as its idempotency key.

### Inspecting and replaying the DLQ

When using Docker:

```bash
docker compose exec user-service npm run dlq:inspect
docker compose exec user-service npm run dlq:replay -- 42
docker compose exec user-service npm run dlq:replay -- 42 --execute
```

Replay is dry-run by default and never deletes the original DLQ record. A
malformed event requires corrected JSON via `--payload-file`; the utility
validates that payload against the shared `user.created` contract before an
explicit replay.

For detailed retry and replay behavior, see
[docs/architecture.md](docs/architecture.md#failure-and-retry-behavior).
