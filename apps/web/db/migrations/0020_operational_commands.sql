CREATE TYPE "public"."operational_command_kind" AS ENUM (
	'cache_rebuild',
	'dead_letter_replay',
	'instance_reconcile',
	'session_invalidate',
	'result_recalculate'
);
--> statement-breakpoint
CREATE TYPE "public"."operational_command_status" AS ENUM ('pending', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "public"."operational_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "operational_command_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"reason" text NOT NULL,
	"status" "operational_command_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error_code" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "operational_commands_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id"),
	CONSTRAINT "operational_commands_idempotency_key_length" CHECK (length("idempotency_key") BETWEEN 16 AND 128),
	CONSTRAINT "operational_commands_request_id_not_empty" CHECK (length(btrim("request_id")) > 0),
	CONSTRAINT "operational_commands_reason_length" CHECK (length(btrim("reason")) BETWEEN 10 AND 1000),
	CONSTRAINT "operational_commands_result_object" CHECK ("result" IS NULL OR jsonb_typeof("result") = 'object'),
	CONSTRAINT "operational_commands_result_state" CHECK (
		("status" = 'pending' AND "result" IS NULL AND "error_code" IS NULL AND "completed_at" IS NULL)
		OR ("status" = 'succeeded' AND "result" IS NOT NULL AND "error_code" IS NULL AND "completed_at" IS NOT NULL)
		OR ("status" = 'failed' AND "result" IS NULL AND "error_code" IS NOT NULL AND "completed_at" IS NOT NULL)
	)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_commands_idempotency_key_unique" ON "public"."operational_commands" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "operational_commands_status_time" ON "public"."operational_commands" USING btree ("status", "created_at");
