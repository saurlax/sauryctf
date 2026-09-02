CREATE TYPE "public"."submission_mode" AS ENUM ('official', 'practice');
--> statement-breakpoint
CREATE TYPE "public"."submission_result" AS ENUM ('incorrect', 'correct', 'already_solved', 'rate_limited', 'ineligible');
--> statement-breakpoint
CREATE TYPE "public"."cheat_clue_status" AS ENUM ('open', 'reviewing', 'dismissed', 'confirmed');
--> statement-breakpoint
CREATE TYPE "public"."scoreboard_view" AS ENUM ('public', 'internal');
--> statement-breakpoint
CREATE TABLE "public"."submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"contest_challenge_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" "submission_mode" NOT NULL,
	"result" "submission_result" NOT NULL,
	"answer_digest" bytea NOT NULL,
	"answer_ciphertext" bytea,
	"request_id" varchar(128) NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "submissions_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id"),
	CONSTRAINT "submissions_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id"),
	CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_request_id_unique" ON "public"."submissions" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "submissions_contest_challenge_time" ON "public"."submissions" USING btree ("contest_id", "contest_challenge_id", "submitted_at", "id");
--> statement-breakpoint
CREATE INDEX "submissions_participation_time" ON "public"."submissions" USING btree ("participation_id", "submitted_at", "id");
--> statement-breakpoint
CREATE TABLE "public"."solves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"contest_id" uuid NOT NULL,
	"contest_challenge_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"mode" "submission_mode" NOT NULL,
	"awarded_score" integer NOT NULL,
	"solve_order" integer NOT NULL,
	"solved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "solves_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id"),
	CONSTRAINT "solves_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "solves_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id"),
	CONSTRAINT "solves_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id"),
	CONSTRAINT "solves_awarded_score_nonnegative" CHECK ("awarded_score" >= 0),
	CONSTRAINT "solves_order_positive" CHECK ("solve_order" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "solves_submission_unique" ON "public"."solves" USING btree ("submission_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "solves_participation_challenge_mode_unique" ON "public"."solves" USING btree ("participation_id", "contest_challenge_id", "mode");
--> statement-breakpoint
CREATE UNIQUE INDEX "solves_challenge_mode_order_unique" ON "public"."solves" USING btree ("contest_challenge_id", "mode", "solve_order");
--> statement-breakpoint
CREATE INDEX "solves_contest_mode_time" ON "public"."solves" USING btree ("contest_id", "mode", "solved_at", "id");
--> statement-breakpoint
CREATE TABLE "public"."score_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"points_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_adjustments_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "score_adjustments_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id"),
	CONSTRAINT "score_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "score_adjustments_delta_nonzero" CHECK ("points_delta" <> 0),
	CONSTRAINT "score_adjustments_reason_not_empty" CHECK (length("reason") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "score_adjustments_request_id_unique" ON "public"."score_adjustments" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX "score_adjustments_contest_participation" ON "public"."score_adjustments" USING btree ("contest_id", "participation_id", "created_at");
--> statement-breakpoint
CREATE TABLE "public"."cheat_clues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"contest_challenge_id" uuid,
	"participation_id" uuid,
	"clue_type" varchar(100) NOT NULL,
	"evidence" jsonb NOT NULL,
	"status" "cheat_clue_status" DEFAULT 'open' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cheat_clues_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "cheat_clues_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id"),
	CONSTRAINT "cheat_clues_participation_id_participations_id_fk" FOREIGN KEY ("participation_id") REFERENCES "public"."participations"("id"),
	CONSTRAINT "cheat_clues_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "cheat_clues_type_not_empty" CHECK (length("clue_type") > 0),
	CONSTRAINT "cheat_clues_evidence_object" CHECK (jsonb_typeof("evidence") = 'object'),
	CONSTRAINT "cheat_clues_review_state" CHECK (("status" IN ('dismissed', 'confirmed') AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL) OR "status" IN ('open', 'reviewing'))
);
--> statement-breakpoint
CREATE INDEX "cheat_clues_review_queue" ON "public"."cheat_clues" USING btree ("contest_id", "status", "created_at");
--> statement-breakpoint
CREATE TABLE "public"."scoreboard_versions" (
	"contest_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoreboard_versions_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "scoreboard_versions_nonnegative" CHECK ("version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "public"."scoreboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"view" "scoreboard_view" NOT NULL,
	"division_id" uuid,
	"scope_key" varchar(64) NOT NULL,
	"version" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scoreboard_snapshots_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade,
	CONSTRAINT "scoreboard_snapshots_contest_division_fk" FOREIGN KEY ("contest_id", "division_id") REFERENCES "public"."divisions"("contest_id", "id"),
	CONSTRAINT "scoreboard_snapshots_scope_key" CHECK (("division_id" IS NULL AND "scope_key" = 'overall') OR ("division_id" IS NOT NULL AND "scope_key" = "division_id"::text)),
	CONSTRAINT "scoreboard_snapshots_version_nonnegative" CHECK ("version" >= 0),
	CONSTRAINT "scoreboard_snapshots_payload_object" CHECK (jsonb_typeof("payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scoreboard_snapshots_scope_version_unique" ON "public"."scoreboard_snapshots" USING btree ("contest_id", "view", "scope_key", "version");
--> statement-breakpoint
CREATE INDEX "scoreboard_snapshots_latest" ON "public"."scoreboard_snapshots" USING btree ("contest_id", "view", "scope_key", "version");
--> statement-breakpoint
CREATE FUNCTION "public"."reject_append_only_fact_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "submissions_append_only" BEFORE UPDATE OR DELETE ON "public"."submissions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
--> statement-breakpoint
CREATE TRIGGER "solves_append_only" BEFORE UPDATE OR DELETE ON "public"."solves"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
--> statement-breakpoint
CREATE TRIGGER "score_adjustments_append_only" BEFORE UPDATE OR DELETE ON "public"."score_adjustments"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
