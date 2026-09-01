CREATE TYPE "public"."challenge_category" AS ENUM ('web', 'pwn', 'crypto', 'reverse', 'misc', 'forensics');
--> statement-breakpoint
CREATE TYPE "public"."content_object_status" AS ENUM ('temporary', 'committed', 'quarantined', 'deleted');
--> statement-breakpoint
CREATE TABLE "public"."content_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"sha256_digest" bytea NOT NULL,
	"size_bytes" bigint NOT NULL,
	"media_type" varchar(255) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"status" "content_object_status" DEFAULT 'temporary' NOT NULL,
	"created_by" uuid NOT NULL,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_objects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "content_objects_size_nonnegative" CHECK ("size_bytes" >= 0),
	CONSTRAINT "content_objects_commit_state" CHECK (("status" = 'committed' AND "committed_at" IS NOT NULL) OR "status" <> 'committed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_objects_storage_key_unique" ON "public"."content_objects" USING btree ("storage_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "content_objects_digest_size_unique" ON "public"."content_objects" USING btree ("sha256_digest", "size_bytes");
--> statement-breakpoint
CREATE TABLE "public"."challenge_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"created_by" uuid NOT NULL,
	"latest_version" integer DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "challenge_templates_slug_normalized" CHECK ("slug" = lower("slug")),
	CONSTRAINT "challenge_templates_latest_version_nonnegative" CHECK ("latest_version" >= 0),
	CONSTRAINT "challenge_templates_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_templates_slug_unique" ON "public"."challenge_templates" USING btree ("slug");
--> statement-breakpoint
CREATE TABLE "public"."challenge_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"category" "challenge_category" NOT NULL,
	"description" text NOT NULL,
	"flag_format" varchar(160),
	"flag_policy" jsonb NOT NULL,
	"scoring_policy" jsonb NOT NULL,
	"instance_policy" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_template_versions_template_id_challenge_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."challenge_templates"("id"),
	CONSTRAINT "challenge_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "challenge_template_versions_number_positive" CHECK ("version_number" > 0),
	CONSTRAINT "challenge_template_versions_title_not_empty" CHECK (length("title") > 0),
	CONSTRAINT "challenge_template_versions_description_not_empty" CHECK (length("description") > 0),
	CONSTRAINT "challenge_template_versions_flag_policy_object" CHECK (jsonb_typeof("flag_policy") = 'object'),
	CONSTRAINT "challenge_template_versions_scoring_policy_object" CHECK (jsonb_typeof("scoring_policy") = 'object'),
	CONSTRAINT "challenge_template_versions_instance_policy_object" CHECK (jsonb_typeof("instance_policy") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_template_versions_number_unique" ON "public"."challenge_template_versions" USING btree ("template_id", "version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_template_versions_template_id_id_unique" ON "public"."challenge_template_versions" USING btree ("template_id", "id");
--> statement-breakpoint
CREATE FUNCTION "public"."reject_immutable_challenge_version_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'challenge template versions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "challenge_template_versions_immutable"
BEFORE UPDATE OR DELETE ON "public"."challenge_template_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_challenge_version_change"();
--> statement-breakpoint
CREATE TABLE "public"."contest_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"source_template_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"snapshot_revision" integer DEFAULT 1 NOT NULL,
	"title" varchar(160) NOT NULL,
	"category" "challenge_category" NOT NULL,
	"description" text NOT NULL,
	"flag_format" varchar(160),
	"flag_policy" jsonb NOT NULL,
	"scoring_policy" jsonb NOT NULL,
	"instance_policy" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"publish_at" timestamp with time zone,
	"close_at" timestamp with time zone,
	"submission_limit" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contest_challenges_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "contest_challenges_source_template_id_challenge_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."challenge_templates"("id"),
	CONSTRAINT "contest_challenges_source_version_fk" FOREIGN KEY ("source_template_id", "source_version_id") REFERENCES "public"."challenge_template_versions"("template_id", "id"),
	CONSTRAINT "contest_challenges_snapshot_revision_positive" CHECK ("snapshot_revision" > 0),
	CONSTRAINT "contest_challenges_publish_window" CHECK ("close_at" IS NULL OR "publish_at" IS NULL OR "close_at" > "publish_at"),
	CONSTRAINT "contest_challenges_submission_limit_positive" CHECK ("submission_limit" IS NULL OR "submission_limit" > 0),
	CONSTRAINT "contest_challenges_policy_objects" CHECK (jsonb_typeof("flag_policy") = 'object' AND jsonb_typeof("scoring_policy") = 'object' AND jsonb_typeof("instance_policy") = 'object'),
	CONSTRAINT "contest_challenges_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contest_challenges_contest_title_unique" ON "public"."contest_challenges" USING btree ("contest_id", "title");
--> statement-breakpoint
CREATE INDEX "contest_challenges_publication_lookup" ON "public"."contest_challenges" USING btree ("contest_id", "enabled", "publish_at", "sort_order");
--> statement-breakpoint
CREATE TABLE "public"."challenge_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_challenge_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"content" text NOT NULL,
	"release_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_hints_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id") ON DELETE cascade,
	CONSTRAINT "challenge_hints_content_not_empty" CHECK (length("content") > 0)
);
--> statement-breakpoint
CREATE INDEX "challenge_hints_release_lookup" ON "public"."challenge_hints" USING btree ("contest_challenge_id", "release_at", "sort_order");
--> statement-breakpoint
CREATE TABLE "public"."challenge_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_challenge_id" uuid NOT NULL,
	"content_object_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_assets_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id") ON DELETE cascade,
	CONSTRAINT "challenge_assets_content_object_id_content_objects_id_fk" FOREIGN KEY ("content_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "challenge_assets_display_name_not_empty" CHECK (length("display_name") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_assets_challenge_object_unique" ON "public"."challenge_assets" USING btree ("contest_challenge_id", "content_object_id");
