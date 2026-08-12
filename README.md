# Trams Microservices

## Run locally with Docker

The Compose environment starts PostgreSQL, a TLS-enabled NATS/JetStream broker,
runs Prisma migrations, and starts the API Gateway, User Service, and
Notification Service. The User and Notification Services use separate local
databases (`trams` and `trams_notifications`) to preserve data ownership.

```bash
docker compose up --build
```

The API Gateway is available at `http://localhost:3000`; its health endpoint is
`GET /api/health`. NATS monitoring is available at `http://localhost:8222`.

For example, create a user with:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"secure-password-123","name":"Ada"}'
```

The `nats-certs` setup container generates a development-only CA and server
certificate into Docker volumes. NATS receives the server key; application
containers receive only the CA certificate. This makes their `tls://nats:4222`
connections verify the broker certificate.

Run another User Service replica to verify queue-group RPC load balancing:

```bash
docker compose up --scale user-service=2
```

Stop the environment while preserving PostgreSQL and JetStream data:

```bash
docker compose down
```

Remove all local data and regenerate the development certificates on next start:

```bash
docker compose down -v
```

The credentials and JWT secret in `docker-compose.yml` are intentionally local
development values. Supply secrets through your deployment platform in any
non-local environment.
