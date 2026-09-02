# SauryCTF instance worker

This directory is the independent Go module for the private dynamic-instance
worker. It consumes versioned `instance_jobs`, operates approved Docker or
Kubernetes providers, reconciles managed resources, and writes observations back
to PostgreSQL.

The worker must not expose public user, authentication, contest, submission, or
administration APIs. Control-plane business logic belongs only in `apps/web`.

The executable entry point is `cmd/worker`. It starts the leased job runner,
periodic reconciler, and private `/health/live` and `/health/ready` probes; all
other HTTP paths return 404. It does not register authentication, user, team,
contest, submission, scoreboard, or administration routes.

Required configuration:

- `WORKER_ID`: stable identifier for lease ownership.
- `WORKER_DATABASE_URL`: PostgreSQL URL for a dedicated credentialed login.
- `WORKER_ENABLED_PROVIDERS`: comma-separated `docker`, `kubernetes`, or both.
- `INSTANCE_SECRET_KEYS`: deployment Secret containing a JSON keyring of
  unpadded base64url-encoded 32-byte envelope keys. Retain old keys while any
  live instance generation still references them.
- `WORKER_DOCKER_PUBLIC_HOST`: plain hostname or IP returned in Docker
  entrypoints; required when `docker` is enabled.

Optional configuration:

- `WORKER_DATABASE_EXPECTED_ROLE` (default `sauryctf_worker`)
- `WORKER_PLATFORM_ID` (default `sauryctf`; scopes resource ownership labels)
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
- `WORKER_RECONCILE_INTERVAL` (default `30s`)
- `WORKER_OPERATION_TIMEOUT` (default `5m`)
- `WORKER_RETRY_INITIAL_DELAY` (default `1s`)
- `WORKER_RETRY_MAX_DELAY` (default `1m`)
- `WORKER_DOCKER_ENDPOINT` (default `unix:///var/run/docker.sock`)
- `WORKER_DOCKER_API_VERSION` (default `v1.47`)
- `WORKER_KUBERNETES_NAMESPACE` (default `sauryctf-instances`)
- `WORKER_KUBERNETES_HTTP_DOMAIN` (enables HTTP Ingress routes)
- `WORKER_KUBERNETES_INGRESS_CLASS`
- `WORKER_KUBERNETES_TLS_SECRET`
- `WORKER_KUBERNETES_TCP_PORT_START` (enables the controlled TCP port range)
- `WORKER_KUBERNETES_LOAD_BALANCER_CLASS`

The process starts even while PostgreSQL or an enabled Provider is temporarily
unavailable: liveness continues to succeed and readiness fails until the
restricted role, instance job schema, and every enabled Provider can be
queried. Apply `deploy/postgres/worker-role.sql` after the Web migrations, then
grant that group role to the deployment-specific login role. Passwords stay in
deployment Secrets and are never stored in this repository.

The job runner claims bounded batches with PostgreSQL `FOR UPDATE SKIP LOCKED`.
Every claim increments a fencing token; renewal and completion require the
current Worker identity and token. On shutdown the runner stops claiming,
cancels active provider operations, returns their current leases to the queue,
and waits for those operations to finish. The production processor maps only
`ensure`, `inspect`, `destroy`, and `reconcile` jobs to the selected Provider,
then records observations with the active lease owner and fencing token.

Every claim also opens an immutable numbered attempt. Provider failures use
safe typed classifications: retryable failures enter capped exponential
backoff, permanent failures and exhausted retry budgets enter `dead`, and
explicit cancellations enter `cancelled`. A newer desired generation makes an
older job `superseded`; expired fencing owners are recorded as `lease_lost`.
Queue rows retain the latest safe error code and summary while the attempts
table preserves the complete execution history for later dead-letter replay.

Observation writes are conditional on the current job id, Worker owner,
unexpired lease, fencing token, instance id, and desired generation. They
advance `observed_generation` and the instance version together, so an expired
Worker or a job from an older desired generation cannot overwrite a newer
resource observation. Only validated ready entrypoints and sealed access bytes
may be stored for a `running` instance.

The periodic reconciler compares PostgreSQL intent with provider inventory.
It only calls a provider for resources carrying the complete deployment,
contest, mounted-challenge, team, instance, and generation label set. Foreign,
missing, or malformed ownership labels produce structured warnings and are
never adopted or deleted. Clearly stale generations and current resources that
are stopped or expired are converged idempotently; ambiguous, future, duplicate,
or unknown identities are upserted into `instance_orphan_reports` for manual
disposition. The configured Docker and Kubernetes adapters share this loop.

All runtime adapters implement the same `Ensure(InstanceSpec)`,
`Inspect(InstanceKey)`, `Destroy(InstanceKey)`, and platform-scoped inventory
contract. Keys generate one DNS-safe deterministic name from a deployment hash,
the complete instance UUID, and desired generation, so retries converge without
truncated-ID collisions. The shared provider contract suite requires repeated
destroy calls for an absent resource to return the same valid `stopped`
observation.

The Docker adapter talks directly to a versioned Docker Engine HTTP API over a
Unix socket or explicit HTTP(S) origin. It never shells out to the Docker CLI.
It pulls the immutable image reference, creates the deterministic container,
passes validated environment values, applies CPU/memory/writable-layer limits,
publishes declared ports, and stores the complete ownership plus entrypoint
metadata in labels. Existing containers are reused only when all ownership
labels match. Missing resources make `Inspect` return a safe `unknown` state and
make repeated `Destroy` calls return `stopped`. Set `TEST_DOCKER_HOST` (and
optionally `TEST_DOCKER_IMAGE`) to include the real Engine lifecycle test.

The Kubernetes adapter uses `client-go` against one explicitly configured
namespace. It declaratively creates or updates one deterministic Deployment,
ClusterIP Service, and optional opaque Secret for each instance generation.
All three resources carry the complete ownership labels; conflicting resources
are rejected instead of adopted or deleted. Deployment availability is read
from the current observed generation, ready replicas, available replicas, and
the `Available=True` condition. HTTP entrypoints use deterministic hosts on a
configured Ingress domain and become ready only after the Ingress reports a
load-balancer address. TCP entrypoints use an explicitly enabled consecutive
port range on a dedicated LoadBalancer Service; the adapter always sets
`allocateLoadBalancerNodePorts=false` and never falls back to NodePort. The
Worker publishes no entrypoint until both the workload and every required route
are ready. Instance-sensitive variables arrive only as an opaque
`instance-secrets.v1` envelope. The control plane encrypts each payload with a
random data key and wraps that key with the active AES-256-GCM deployment key;
the authenticated context binds provider, owner identifiers, instance, and
generation. The Worker decrypts immediately before `Ensure`, clears plaintext
buffers when the provider returns, and never copies Flag material to logs or
labels. Kubernetes stores the decrypted values in the owned opaque Secret and
injects them through exact `SecretKeyRef` entries; the Secret is deleted with
the instance. Docker receives the same reserved variables only in its typed
Engine API create request.

Kubernetes workloads always run with `runAsNonRoot`, RuntimeDefault seccomp, a
read-only root filesystem, all Linux capabilities dropped, privilege escalation
disabled, ServiceAccount token automount disabled, and service-link injection
disabled. CPU, memory, and ephemeral-storage requests equal their validated
limits; the only writable filesystem is a size-bounded `/tmp` EmptyDir. Every
instance also owns a NetworkPolicy that permits inbound traffic only on declared
challenge ports. The `deny` egress mode has no egress rule, while `internet`
allows public IPv4 destinations plus DNS and excludes private, link-local,
loopback, metadata, multicast, and reserved ranges. `Inspect` refuses to publish
an entrypoint if the workload security fields or NetworkPolicy drift from these
generated defaults.

The Kubernetes package has fake-client contract tests and an API-server-backed
envtest lifecycle test. Install matching envtest assets and run it with
`TEST_KUBERNETES_ENVTEST=1` plus `KUBEBUILDER_ASSETS` pointing at that asset
directory. The integration test creates its own ephemeral API server and etcd,
so it does not use the developer's current kubeconfig or mutate a shared
cluster.

The release lifecycle suite uses a real Docker Engine, an isolated PostgreSQL
container, and a disposable single-node k3s cluster. Run it with
`pnpm test:instances:lifecycle`. It verifies control-plane renewal and quota
transactions, Worker lease fencing, expiry reconciliation, Docker and k3s
creation/readiness/destruction, and recovery from the create-before-writeback
crash window. The suite deletes its named containers and k3s namespace on exit.

Run locally with `pnpm dev:worker` after configuring the Worker variables.
