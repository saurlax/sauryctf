# SauryCTF instance worker

This directory is the independent Go module for the private dynamic-instance
worker. It will consume versioned `instance_jobs`, operate approved Docker or
Kubernetes providers, reconcile managed resources, and write observations back
to PostgreSQL.

The worker must not expose public user, authentication, contest, submission, or
administration APIs. It must not import code from `legacy/go-monolith`.

The executable entry point is `cmd/worker`. At this stage it exposes only the
private `/health/live` and `/health/ready` probes; all other paths return 404.
It does not register authentication, user, team, contest, submission,
scoreboard, or administration routes.

Required configuration:

- `WORKER_ID`: stable identifier for lease ownership.
- `WORKER_DATABASE_URL`: PostgreSQL URL for a dedicated credentialed login.

Optional configuration:

- `WORKER_DATABASE_EXPECTED_ROLE` (default `sauryctf_worker`)
- `WORKER_DATABASE_MAX_CONNECTIONS` (default `10`)
- `WORKER_DATABASE_CONNECT_TIMEOUT` (default `5s`)
- `WORKER_HEALTH_ADDRESS` (default `:8081`)
- `WORKER_READINESS_TIMEOUT` (default `2s`)
- `WORKER_SHUTDOWN_TIMEOUT` (default `15s`)

The process starts even while PostgreSQL is temporarily unavailable: liveness
continues to succeed and readiness fails until the restricted role and instance
job schema are available. Apply `deploy/postgres/worker-role.sql` after the Web
migrations, then grant that group role to the deployment-specific login role.
Passwords stay in deployment Secrets and are never stored in this repository.

Run locally with `pnpm dev:worker` after configuring the Worker variables. Job
consumption and providers are introduced by later OpenSpec tasks.
