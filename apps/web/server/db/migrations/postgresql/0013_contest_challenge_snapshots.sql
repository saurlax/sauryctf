CREATE TABLE "public"."challenge_template_hints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"content" text NOT NULL,
	"release_after_seconds" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_template_hints_template_version_id_challenge_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."challenge_template_versions"("id"),
	CONSTRAINT "challenge_template_hints_title_not_empty" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "challenge_template_hints_content_not_empty" CHECK (length(btrim("content")) > 0),
	CONSTRAINT "challenge_template_hints_release_nonnegative" CHECK ("release_after_seconds" IS NULL OR "release_after_seconds" >= 0)
);
--> statement-breakpoint
CREATE INDEX "challenge_template_hints_version_order" ON "public"."challenge_template_hints" USING btree ("template_version_id", "sort_order", "id");
--> statement-breakpoint
CREATE FUNCTION "public"."reject_immutable_challenge_template_hint_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'challenge template version hints are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "challenge_template_hints_immutable"
BEFORE UPDATE OR DELETE ON "public"."challenge_template_hints"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_challenge_template_hint_change"();
--> statement-breakpoint
CREATE FUNCTION "public"."guard_contest_challenge_snapshot_change"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	contest_status contest_publication_status;
	revision_allowed boolean := COALESCE(current_setting('sauryctf.challenge_revision', true) = 'allowed', false);
BEGIN
	SELECT publication_status INTO contest_status
	FROM contests
	WHERE id = COALESCE(NEW.contest_id, OLD.contest_id);

	IF contest_status IS NULL THEN
		RAISE EXCEPTION 'contest does not exist' USING ERRCODE = '23503';
	END IF;

	IF TG_OP = 'INSERT' AND contest_status <> 'draft' THEN
		RAISE EXCEPTION 'challenge snapshots can only be mounted to draft contests' USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' AND contest_status <> 'draft' THEN
		RAISE EXCEPTION 'published or archived challenge snapshots cannot be deleted' USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'UPDATE' THEN
		IF NEW.contest_id IS DISTINCT FROM OLD.contest_id
			OR NEW.source_template_id IS DISTINCT FROM OLD.source_template_id
			OR NEW.source_version_id IS DISTINCT FROM OLD.source_version_id THEN
			RAISE EXCEPTION 'challenge snapshot source is immutable' USING ERRCODE = '55000';
		END IF;

		IF contest_status = 'archived' THEN
			RAISE EXCEPTION 'archived challenge snapshots are immutable' USING ERRCODE = '55000';
		END IF;

		IF contest_status = 'published'
			AND NOT revision_allowed
			AND (
				NEW.title IS DISTINCT FROM OLD.title
				OR NEW.category IS DISTINCT FROM OLD.category
				OR NEW.description IS DISTINCT FROM OLD.description
				OR NEW.flag_format IS DISTINCT FROM OLD.flag_format
				OR NEW.flag_policy IS DISTINCT FROM OLD.flag_policy
				OR NEW.scoring_policy IS DISTINCT FROM OLD.scoring_policy
				OR NEW.instance_policy IS DISTINCT FROM OLD.instance_policy
				OR NEW.enabled IS DISTINCT FROM OLD.enabled
				OR NEW.publish_at IS DISTINCT FROM OLD.publish_at
				OR NEW.close_at IS DISTINCT FROM OLD.close_at
				OR NEW.submission_limit IS DISTINCT FROM OLD.submission_limit
				OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
			) THEN
			RAISE EXCEPTION 'published challenge snapshot changes require an explicit revision command' USING ERRCODE = '55000';
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "contest_challenges_snapshot_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."contest_challenges"
FOR EACH ROW EXECUTE FUNCTION "public"."guard_contest_challenge_snapshot_change"();
--> statement-breakpoint
CREATE FUNCTION "public"."guard_contest_challenge_child_change"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	contest_status contest_publication_status;
	revision_allowed boolean := COALESCE(current_setting('sauryctf.challenge_revision', true) = 'allowed', false);
BEGIN
	SELECT contest.publication_status INTO contest_status
	FROM contest_challenges challenge
	JOIN contests contest ON contest.id = challenge.contest_id
	WHERE challenge.id = COALESCE(NEW.contest_challenge_id, OLD.contest_challenge_id);

	IF contest_status = 'archived' THEN
		RAISE EXCEPTION 'archived challenge snapshot children are immutable' USING ERRCODE = '55000';
	END IF;

	IF contest_status = 'published' AND NOT revision_allowed THEN
		RAISE EXCEPTION 'published challenge snapshot children require an explicit revision command' USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "challenge_assets_snapshot_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."challenge_assets"
FOR EACH ROW EXECUTE FUNCTION "public"."guard_contest_challenge_child_change"();
--> statement-breakpoint
CREATE TRIGGER "challenge_hints_snapshot_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."challenge_hints"
FOR EACH ROW EXECUTE FUNCTION "public"."guard_contest_challenge_child_change"();
