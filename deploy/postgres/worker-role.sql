-- Run after the control-plane migrations have created the instance tables.
-- Runtime login credentials are deployment Secrets and must not be committed.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sauryctf_worker') THEN
    CREATE ROLE sauryctf_worker
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE sauryctf_worker
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

REVOKE ALL ON SCHEMA public FROM sauryctf_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM sauryctf_worker;
GRANT USAGE ON SCHEMA public TO sauryctf_worker;

GRANT SELECT ON TABLE
  public.instances,
  public.instance_jobs,
  public.instance_job_attempts
TO sauryctf_worker;

GRANT UPDATE (
  observed_state,
  observed_generation,
  provider_resource_id,
  entrypoints,
  access_ciphertext,
  last_observed_at,
  last_error_code,
  last_error_summary,
  version,
  updated_at
) ON public.instances TO sauryctf_worker;

GRANT UPDATE (
  status,
  available_at,
  lease_owner,
  lease_until,
  fencing_token,
  attempt_count,
  error_code,
  error_summary,
  started_at,
  finished_at
) ON public.instance_jobs TO sauryctf_worker;

GRANT INSERT (
  id,
  job_id,
  attempt_number,
  worker_id,
  fencing_token,
  outcome,
  error_code,
  error_summary,
  started_at,
  finished_at
) ON public.instance_job_attempts TO sauryctf_worker;

GRANT UPDATE (
  outcome,
  error_code,
  error_summary,
  finished_at
) ON public.instance_job_attempts TO sauryctf_worker;
