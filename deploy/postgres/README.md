# PostgreSQL deployment roles

The Nuxt control plane owns migrations and all business transactions. The Go
instance worker must connect with a separate login role that inherits only the
`sauryctf_worker` group role.

After applying the control-plane migrations, run `worker-role.sql` as the
database owner. Create the credentialed login outside the repository, store its
password in the deployment Secret, and grant it membership:

```sql
CREATE ROLE sauryctf_worker_runtime
  LOGIN
  PASSWORD '<generated deployment secret>'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;
GRANT sauryctf_worker TO sauryctf_worker_runtime;
```

Set `WORKER_DATABASE_URL` to that login role and keep
`WORKER_DATABASE_EXPECTED_ROLE=sauryctf_worker`. Worker readiness rejects a
connection that does not use or inherit the restricted role, or whose instance
job tables have not been migrated.

The role script revokes any existing table grants from the group role before
granting access only to `instances`, `instance_jobs`,
`instance_job_attempts`, and `instance_orphan_reports`. It intentionally grants
no access to identity, team, contest, Flag, submission, solve, or scoreboard
tables.
