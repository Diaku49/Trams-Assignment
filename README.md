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

## Outbox retention and operations

Published `outbox_events` rows are retained for seven days by default and then
deleted in batches. The User Service emits a structured `Outbox operational
metrics` log every minute with cumulative claimed/published/failure/cleanup
counters and gauges for pending, retrying, retained-published rows, and the age
of the oldest pending row. Cleanup also logs its cutoff and deleted row count.

These settings are configurable in milliseconds/rows:

- `OUTBOX_PUBLISHED_RETENTION_MS` (default `604800000`, seven days)
- `OUTBOX_CLEANUP_INTERVAL_MS` (default `3600000`, one hour)
- `OUTBOX_CLEANUP_BATCH_SIZE` (default `500`)
- `OUTBOX_CLEANUP_MAX_BATCHES` (default `20` per cleanup run)
- `OUTBOX_METRICS_INTERVAL_MS` (default `60000`, one minute)

Inspect the metrics in Docker with:

```bash
docker compose logs -f user-service | grep 'Outbox operational metrics'
```

## Inspect and replay `user.events.dlq`

Failed handlers and malformed messages are preserved on `user.events.dlq`.
Malformed records contain their exact original bytes; DLQ headers record the
original subject, source stream sequence, consumer, delivery count, reason, and
error. The original JetStream message is terminated only after this DLQ publish
is acknowledged. The `USER_EVENTS` stream retains these records under its
configured seven-day/512 MiB limits.

List DLQ records and find the `streamSequence` to investigate:

```bash
docker compose exec user-service npm run dlq:inspect
```

Preview a replay without publishing anything:

```bash
docker compose exec user-service npm run dlq:replay -- 42
```

After inspecting and fixing the underlying cause, explicitly replay a valid
processing-failure record to its original subject:

```bash
docker compose exec user-service npm run dlq:replay -- 42 --execute
```

Malformed records require corrected JSON; replaying their preserved invalid
bytes is rejected by the tool. The corrected file is validated against the
shared `user.created` contract before publishing. Copy the correction into the
container, preview it, and then execute:

```bash
docker compose cp corrected-user-created.json user-service:/tmp/corrected.json
docker compose exec user-service npm run dlq:replay -- 42 --payload-file /tmp/corrected.json
docker compose exec user-service npm run dlq:replay -- 42 --payload-file /tmp/corrected.json --execute
```

Replay is intentionally non-destructive: the DLQ record remains available for
audit until stream retention removes it. Each replay gets a unique NATS message
ID, while the Notification Service's persistent `eventId` idempotency still
prevents a duplicate notification for an already completed event.
