CREATE TYPE "public"."contest_publication_status" AS ENUM ('draft', 'published', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."contest_time_phase" AS ENUM ('upcoming', 'running', 'ended');
--> statement-breakpoint
CREATE TYPE "public"."contest_visibility" AS ENUM ('public', 'private');
--> statement-breakpoint
CREATE TYPE "public"."registration_strategy" AS ENUM ('review', 'auto_accept');
--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
--> statement-breakpoint
CREATE TYPE "public"."contest_event_type" AS ENUM ('announcement_published', 'challenge_published', 'hint_published', 'first_solve', 'scoreboard_frozen', 'contest_phase_changed');
--> statement-breakpoint
CREATE TABLE "public"."contests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"publication_status" "contest_publication_status" DEFAULT 'draft' NOT NULL,
	"visibility" "contest_visibility" DEFAULT 'public' NOT NULL,
	"registration_strategy" "registration_strategy" DEFAULT 'review' NOT NULL,
	"invite_digest" bytea,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"scoreboard_freeze_at" timestamp with time zone,
	"practice_enabled" boolean DEFAULT false NOT NULL,
	"writeup_required" boolean DEFAULT false NOT NULL,
	"writeup_deadline_at" timestamp with time zone,
	"min_team_size" integer DEFAULT 1 NOT NULL,
	"max_team_size" integer DEFAULT 5 NOT NULL,
	"registration_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "contests_slug_normalized" CHECK ("slug" = lower("slug")),
	CONSTRAINT "contests_time_window" CHECK ("end_at" > "start_at"),
	CONSTRAINT "contests_freeze_window" CHECK ("scoreboard_freeze_at" IS NULL OR ("scoreboard_freeze_at" >= "start_at" AND "scoreboard_freeze_at" <= "end_at")),
	CONSTRAINT "contests_writeup_deadline" CHECK ("writeup_deadline_at" IS NULL OR "writeup_deadline_at" >= "end_at"),
	CONSTRAINT "contests_team_size" CHECK ("min_team_size" > 0 AND "max_team_size" >= "min_team_size"),
	CONSTRAINT "contests_publication_timestamps" CHECK (("publication_status" = 'draft' AND "published_at" IS NULL AND "archived_at" IS NULL) OR ("publication_status" = 'published' AND "published_at" IS NOT NULL AND "archived_at" IS NULL) OR ("publication_status" = 'archived' AND "published_at" IS NOT NULL AND "archived_at" IS NOT NULL)),
	CONSTRAINT "contests_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contests_slug_unique" ON "public"."contests" USING btree ("slug");
--> statement-breakpoint
CREATE FUNCTION "public"."derive_contest_time_phase"(
	start_at timestamp with time zone,
	end_at timestamp with time zone,
	at_time timestamp with time zone
) RETURNS "public"."contest_time_phase" LANGUAGE sql IMMUTABLE STRICT AS $$
	SELECT CASE
		WHEN at_time < start_at THEN 'upcoming'::"public"."contest_time_phase"
		WHEN at_time < end_at THEN 'running'::"public"."contest_time_phase"
		ELSE 'ended'::"public"."contest_time_phase"
	END
$$;
--> statement-breakpoint
CREATE TABLE "public"."divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_normalized" varchar(80) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "divisions_name_normalized_check" CHECK ("name_normalized" = lower("name_normalized"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_contest_name_unique" ON "public"."divisions" USING btree ("contest_id", "name_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_contest_id_id_unique" ON "public"."divisions" USING btree ("contest_id", "id");
--> statement-breakpoint
CREATE TABLE "public"."participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"division_id" uuid,
	"status" "participation_status" NOT NULL,
	"registered_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"review_reason" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participations_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "participations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id"),
	CONSTRAINT "participations_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "participations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "participations_contest_division_fk" FOREIGN KEY ("contest_id", "division_id") REFERENCES "public"."divisions"("contest_id", "id"),
	CONSTRAINT "participations_review_state" CHECK (("status" IN ('accepted', 'rejected') AND "reviewed_at" IS NOT NULL AND "reviewed_by" IS NOT NULL) OR ("status" IN ('pending', 'withdrawn'))),
	CONSTRAINT "participations_withdrawn_state" CHECK (("status" = 'withdrawn' AND "withdrawn_at" IS NOT NULL) OR ("status" <> 'withdrawn' AND "withdrawn_at" IS NULL)),
	CONSTRAINT "participations_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "participations_contest_team_unique" ON "public"."participations" USING btree ("contest_id", "team_id");
--> statement-breakpoint
CREATE INDEX "participations_contest_status" ON "public"."participations" USING btree ("contest_id", "status", "registered_at");
--> statement-breakpoint
CREATE TABLE "public"."announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"publish_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "announcements_title_not_empty" CHECK (length("title") > 0),
	CONSTRAINT "announcements_body_not_empty" CHECK (length("body") > 0),
	CONSTRAINT "announcements_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE INDEX "announcements_publication_lookup" ON "public"."announcements" USING btree ("contest_id", "publish_at", "withdrawn_at");
--> statement-breakpoint
CREATE TABLE "public"."contest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"event_type" "contest_event_type" NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visible_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "contest_events_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "contest_events_key_not_empty" CHECK (length("event_key") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contest_events_contest_key_unique" ON "public"."contest_events" USING btree ("contest_id", "event_key");
--> statement-breakpoint
CREATE INDEX "contest_events_public_timeline" ON "public"."contest_events" USING btree ("contest_id", "visible_at", "occurred_at", "id");
