CREATE TYPE "public"."instance_provider" AS ENUM ('docker', 'kubernetes');
--> statement-breakpoint
CREATE TYPE "public"."instance_desired_state" AS ENUM ('running', 'stopped');
--> statement-breakpoint
CREATE TYPE "public"."instance_observed_state" AS ENUM ('pending', 'starting', 'running', 'stopping', 'stopped', 'failed', 'unknown');
--> statement-breakpoint
CREATE TYPE "public"."instance_job_operation" AS ENUM ('ensure', 'inspect', 'destroy', 'reconcile');
--> statement-breakpoint
CREATE TYPE "public"."instance_job_status" AS ENUM ('ready', 'leased', 'retry_wait', 'succeeded', 'dead', 'cancelled', 'superseded');
--> statement-breakpoint
CREATE TYPE "public"."instance_attempt_outcome" AS ENUM ('running', 'succeeded', 'retryable_error', 'permanent_error', 'cancelled', 'lease_lost');
--> statement-breakpoint
CREATE TABLE "public"."instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"contest_challenge_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"provider" "instance_provider" NOT NULL,
	"desired_state" "instance_desired_state" DEFAULT 'stopped' NOT NULL,
	"desired_generation" bigint DEFAULT 1 NOT NULL,
	"observed_state" "instance_observed_state" DEFAULT 'pending' NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"provider_resource_id" varchar(255),
	"entrypoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_ciphertext" bytea,
	"last_observed_at" timestamp with time zone,
	"last_error_code" varchar(128),
	"last_error_summary" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instances_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "instances_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id"),
	CONSTRAINT "instances_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id"),
	CONSTRAINT "instances_desired_generation_positive" CHECK ("desired_generation" > 0),
	CONSTRAINT "instances_observed_generation_nonnegative" CHECK ("observed_generation" >= 0),
	CONSTRAINT "instances_observation_not_ahead" CHECK ("observed_generation" <= "desired_generation"),
	CONSTRAINT "instances_entrypoints_array" CHECK (jsonb_typeof("entrypoints") = 'array'),
	CONSTRAINT "instances_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instances_participation_challenge_unique" ON "public"."instances" USING btree ("participation_id", "contest_challenge_id");
--> statement-breakpoint
CREATE INDEX "instances_expiry_reconcile" ON "public"."instances" USING btree ("desired_state", "expires_at");
--> statement-breakpoint
CREATE INDEX "instances_observation_staleness" ON "public"."instances" USING btree ("observed_state", "last_observed_at");
--> statement-breakpoint
CREATE TABLE "public"."instance_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"operation" "instance_job_operation" NOT NULL,
	"payload_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"desired_generation" bigint NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"status" "instance_job_status" DEFAULT 'ready' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_until" timestamp with time zone,
	"fencing_token" bigint DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"error_code" varchar(128),
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "instance_jobs_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade,
	CONSTRAINT "instance_jobs_payload_version_positive" CHECK ("payload_version" > 0),
	CONSTRAINT "instance_jobs_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
	CONSTRAINT "instance_jobs_desired_generation_positive" CHECK ("desired_generation" > 0),
	CONSTRAINT "instance_jobs_fencing_nonnegative" CHECK ("fencing_token" >= 0),
	CONSTRAINT "instance_jobs_attempts_valid" CHECK ("attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"),
	CONSTRAINT "instance_jobs_lease_shape" CHECK (("status" = 'leased' AND "lease_owner" IS NOT NULL AND "lease_until" IS NOT NULL) OR ("status" <> 'leased'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_jobs_idempotency_key_unique" ON "public"."instance_jobs" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_jobs_generation_operation_unique" ON "public"."instance_jobs" USING btree ("instance_id", "desired_generation", "operation");
--> statement-breakpoint
CREATE INDEX "instance_jobs_claim" ON "public"."instance_jobs" USING btree ("status", "available_at", "created_at");
--> statement-breakpoint
CREATE INDEX "instance_jobs_lease_expiry" ON "public"."instance_jobs" USING btree ("status", "lease_until");
--> statement-breakpoint
CREATE TABLE "public"."instance_job_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_id" varchar(128) NOT NULL,
	"fencing_token" bigint NOT NULL,
	"outcome" "instance_attempt_outcome" DEFAULT 'running' NOT NULL,
	"error_code" varchar(128),
	"error_summary" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "instance_job_attempts_job_id_instance_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."instance_jobs"("id") ON DELETE cascade,
	CONSTRAINT "instance_job_attempts_number_positive" CHECK ("attempt_number" > 0),
	CONSTRAINT "instance_job_attempts_fencing_positive" CHECK ("fencing_token" > 0),
	CONSTRAINT "instance_job_attempts_finish_state" CHECK (("outcome" = 'running' AND "finished_at" IS NULL) OR ("outcome" <> 'running' AND "finished_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_job_attempts_number_unique" ON "public"."instance_job_attempts" USING btree ("job_id", "attempt_number");
--> statement-breakpoint
CREATE INDEX "instance_job_attempts_job_time" ON "public"."instance_job_attempts" USING btree ("job_id", "started_at");
