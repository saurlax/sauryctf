CREATE SCHEMA IF NOT EXISTS "control_plane";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "control_plane"."runtime_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "control_plane"."runtime_metadata" ("key", "value")
VALUES ('schema', '{"baseline":1}'::jsonb)
ON CONFLICT ("key") DO NOTHING;
