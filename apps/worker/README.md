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
- `WORKER_CLAIM_BATCH_SIZE` (default `16`, maximum `100`)
- `WORKER_JOB_CONCURRENCY` (default `16`, maximum `100`)
- `WORKER_LEASE_DURATION` (default `30s`)
- `WORKER_LEASE_RENEW_INTERVAL` (default `10s`, must be shorter than the lease)
- `WORKER_POLL_INTERVAL` (default `1s`)

The process starts even while PostgreSQL is temporarily unavailable: liveness
continues to succeed and readiness fails until the restricted role and instance
job schema are available. Apply `deploy/postgres/worker-role.sql` after the Web
migrations, then grant that group role to the deployment-specific login role.
Passwords stay in deployment Secrets and are never stored in this repository.

The job runner claims bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED`.
Every claim increments a fencing token; renewal and completion require the
current Worker identity and token. On shutdown the runner stops claiming,
cancels active provider operations, returns their current leases to the queue,
and waits for those operations to finish. Provider implementations are wired
into the process by later OpenSpec tasks, so the current executable does not
consume jobs with a placeholder processor.

Run locally with `pnpm dev:worker` after configuring the Worker variables.
