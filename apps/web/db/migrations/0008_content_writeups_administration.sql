CREATE TYPE "public"."writeup_status" AS ENUM ('draft', 'submitted', 'approved', 'changes_requested');
--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM ('queued', 'validating', 'processing', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."platform_theme" AS ENUM ('system', 'light', 'dark');
--> statement-breakpoint
CREATE TYPE "public"."authentication_mode" AS ENUM ('password_only');
--> statement-breakpoint
CREATE TYPE "public"."content_reference_type" AS ENUM ('challenge_attachment', 'writeup_attachment', 'export_package', 'platform_logo');
--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM ('succeeded', 'rejected', 'failed');
--> statement-breakpoint
CREATE UNIQUE INDEX "participations_contest_id_id_unique" ON "public"."participations" USING btree ("contest_id", "id");
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_storage_key_not_empty" CHECK (length(btrim("storage_key")) > 0);
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_sha256_length" CHECK (octet_length("sha256_digest") = 32);
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_media_type_not_empty" CHECK (length(btrim("media_type")) > 0);
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_filename_not_empty" CHECK (length(btrim("original_filename")) > 0);
--> statement-breakpoint
ALTER TABLE "public"."content_objects" DROP CONSTRAINT "content_objects_commit_state";
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_commit_state" CHECK (("status" = 'temporary' AND "committed_at" IS NULL) OR ("status" = 'committed' AND "committed_at" IS NOT NULL) OR "status" IN ('quarantined', 'deleted'));
--> statement-breakpoint
CREATE TABLE "public"."writeups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"participation_id" uuid NOT NULL,
	"status" "writeup_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer,
	"submitted_version" integer,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writeups_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "writeups_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "writeups_contest_participation_fk" FOREIGN KEY ("contest_id", "participation_id") REFERENCES "public"."participations"("contest_id", "id"),
	CONSTRAINT "writeups_current_version_positive" CHECK ("current_version" IS NULL OR "current_version" > 0),
	CONSTRAINT "writeups_submitted_version_valid" CHECK ("submitted_version" IS NULL OR ("submitted_version" > 0 AND "submitted_version" <= "current_version")),
	CONSTRAINT "writeups_submission_state" CHECK (("status" = 'draft' AND "submitted_version" IS NULL AND "submitted_at" IS NULL) OR ("status" <> 'draft' AND "current_version" IS NOT NULL AND "submitted_version" IS NOT NULL AND "submitted_at" IS NOT NULL)),
	CONSTRAINT "writeups_review_state" CHECK (("status" IN ('draft', 'submitted') AND "reviewed_by" IS NULL AND "review_note" IS NULL AND "reviewed_at" IS NULL) OR ("status" = 'approved' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL) OR ("status" = 'changes_requested' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND length(btrim("review_note")) > 0)),
	CONSTRAINT "writeups_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "writeups_contest_participation_unique" ON "public"."writeups" USING btree ("contest_id", "participation_id");
--> statement-breakpoint
CREATE INDEX "writeups_review_queue" ON "public"."writeups" USING btree ("contest_id", "status", "submitted_at");
--> statement-breakpoint
CREATE TABLE "public"."writeup_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"writeup_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writeup_versions_writeup_id_writeups_id_fk" FOREIGN KEY ("writeup_id") REFERENCES "public"."writeups"("id"),
	CONSTRAINT "writeup_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "writeup_versions_number_positive" CHECK ("version_number" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "writeup_versions_number_unique" ON "public"."writeup_versions" USING btree ("writeup_id", "version_number");
--> statement-breakpoint
ALTER TABLE "public"."writeups" ADD CONSTRAINT "writeups_current_version_fk" FOREIGN KEY ("id", "current_version") REFERENCES "public"."writeup_versions"("writeup_id", "version_number") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "public"."writeups" ADD CONSTRAINT "writeups_submitted_version_fk" FOREIGN KEY ("id", "submitted_version") REFERENCES "public"."writeup_versions"("writeup_id", "version_number") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TABLE "public"."imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_object_id" uuid NOT NULL,
	"package_version" varchar(64) NOT NULL,
	"status" "transfer_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"requested_by" uuid NOT NULL,
	"result_contest_id" uuid,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "imports_package_object_id_content_objects_id_fk" FOREIGN KEY ("package_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "imports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "imports_result_contest_id_contests_id_fk" FOREIGN KEY ("result_contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "imports_package_version_not_empty" CHECK (length(btrim("package_version")) > 0),
	CONSTRAINT "imports_idempotency_key_length" CHECK (length("idempotency_key") BETWEEN 16 AND 128),
	CONSTRAINT "imports_error_details_object" CHECK ("error_details" IS NULL OR jsonb_typeof("error_details") = 'object'),
	CONSTRAINT "imports_result_state" CHECK (("status" = 'succeeded' AND "result_contest_id" IS NOT NULL AND "error_details" IS NULL AND "finished_at" IS NOT NULL) OR ("status" = 'failed' AND "result_contest_id" IS NULL AND "error_details" IS NOT NULL AND "finished_at" IS NOT NULL) OR ("status" IN ('queued', 'validating', 'processing') AND "result_contest_id" IS NULL AND "error_details" IS NULL AND "finished_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "imports_idempotency_key_unique" ON "public"."imports" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "imports_status_queue" ON "public"."imports" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "public"."exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"package_object_id" uuid,
	"package_version" varchar(64) NOT NULL,
	"status" "transfer_status" DEFAULT 'queued' NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"requested_by" uuid NOT NULL,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "exports_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id"),
	CONSTRAINT "exports_package_object_id_content_objects_id_fk" FOREIGN KEY ("package_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "exports_package_version_not_empty" CHECK (length(btrim("package_version")) > 0),
	CONSTRAINT "exports_idempotency_key_length" CHECK (length("idempotency_key") BETWEEN 16 AND 128),
	CONSTRAINT "exports_error_details_object" CHECK ("error_details" IS NULL OR jsonb_typeof("error_details") = 'object'),
	CONSTRAINT "exports_result_state" CHECK (("status" = 'succeeded' AND "package_object_id" IS NOT NULL AND "error_details" IS NULL AND "finished_at" IS NOT NULL) OR ("status" = 'failed' AND "package_object_id" IS NULL AND "error_details" IS NOT NULL AND "finished_at" IS NOT NULL) OR ("status" IN ('queued', 'validating', 'processing') AND "package_object_id" IS NULL AND "error_details" IS NULL AND "finished_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "exports_idempotency_key_unique" ON "public"."exports" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "exports_status_queue" ON "public"."exports" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "public"."platform_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"brand_name" varchar(120) DEFAULT 'SauryCTF' NOT NULL,
	"logo_object_id" uuid,
	"theme" "platform_theme" DEFAULT 'system' NOT NULL,
	"default_locale" "system_locale" DEFAULT 'zh-CN' NOT NULL,
	"public_registration_enabled" boolean DEFAULT true NOT NULL,
	"authentication_mode" "authentication_mode" DEFAULT 'password_only' NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_logo_object_id_content_objects_id_fk" FOREIGN KEY ("logo_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "platform_settings_singleton_true" CHECK ("singleton" = true),
	CONSTRAINT "platform_settings_brand_name_not_empty" CHECK (length(btrim("brand_name")) > 0),
	CONSTRAINT "platform_settings_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "public"."content_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_object_id" uuid NOT NULL,
	"reference_type" "content_reference_type" NOT NULL,
	"contest_challenge_id" uuid,
	"writeup_version_id" uuid,
	"export_id" uuid,
	"platform_setting_id" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_references_content_object_id_content_objects_id_fk" FOREIGN KEY ("content_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "content_references_contest_challenge_id_contest_challenges_id_fk" FOREIGN KEY ("contest_challenge_id") REFERENCES "public"."contest_challenges"("id") ON DELETE cascade,
	CONSTRAINT "content_references_writeup_version_id_writeup_versions_id_fk" FOREIGN KEY ("writeup_version_id") REFERENCES "public"."writeup_versions"("id") ON DELETE cascade,
	CONSTRAINT "content_references_export_id_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."exports"("id") ON DELETE cascade,
	CONSTRAINT "content_references_platform_setting_id_platform_settings_singleton_fk" FOREIGN KEY ("platform_setting_id") REFERENCES "public"."platform_settings"("singleton") ON DELETE cascade,
	CONSTRAINT "content_references_exactly_one_owner" CHECK (num_nonnulls("contest_challenge_id", "writeup_version_id", "export_id", "platform_setting_id") = 1),
	CONSTRAINT "content_references_owner_type" CHECK (("reference_type" = 'challenge_attachment' AND "contest_challenge_id" IS NOT NULL) OR ("reference_type" = 'writeup_attachment' AND "writeup_version_id" IS NOT NULL) OR ("reference_type" = 'export_package' AND "export_id" IS NOT NULL) OR ("reference_type" = 'platform_logo' AND "platform_setting_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_references_challenge_object_unique" ON "public"."content_references" USING btree ("contest_challenge_id", "content_object_id") WHERE "contest_challenge_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "content_references_writeup_object_unique" ON "public"."content_references" USING btree ("writeup_version_id", "content_object_id") WHERE "writeup_version_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "content_references_export_object_unique" ON "public"."content_references" USING btree ("export_id", "content_object_id") WHERE "export_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "content_references_setting_object_unique" ON "public"."content_references" USING btree ("platform_setting_id", "content_object_id") WHERE "platform_setting_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "content_references_object_lookup" ON "public"."content_references" USING btree ("content_object_id", "reference_type");
--> statement-breakpoint
CREATE TABLE "public"."audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(128) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" uuid,
	"reason" text,
	"outcome" "audit_outcome" NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id"),
	CONSTRAINT "audit_events_action_not_empty" CHECK (length(btrim("action")) > 0),
	CONSTRAINT "audit_events_target_type_not_empty" CHECK (length(btrim("target_type")) > 0),
	CONSTRAINT "audit_events_request_id_not_empty" CHECK (length(btrim("request_id")) > 0),
	CONSTRAINT "audit_events_reason_not_empty" CHECK ("reason" IS NULL OR length(btrim("reason")) > 0),
	CONSTRAINT "audit_events_changes_object" CHECK (jsonb_typeof("changes") = 'object'),
	CONSTRAINT "audit_events_metadata_object" CHECK (jsonb_typeof("metadata") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_request_action_target_unique" ON "public"."audit_events" USING btree ("request_id", "action", "target_type", "target_id") WHERE "target_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_request_action_without_target_unique" ON "public"."audit_events" USING btree ("request_id", "action", "target_type") WHERE "target_id" IS NULL;
--> statement-breakpoint
CREATE INDEX "audit_events_actor_time" ON "public"."audit_events" USING btree ("actor_user_id", "occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "audit_events_target_time" ON "public"."audit_events" USING btree ("target_type", "target_id", "occurred_at", "id");
--> statement-breakpoint
CREATE FUNCTION "public"."reject_immutable_content_identity_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
		OR NEW."sha256_digest" IS DISTINCT FROM OLD."sha256_digest"
		OR NEW."size_bytes" IS DISTINCT FROM OLD."size_bytes"
		OR NEW."media_type" IS DISTINCT FROM OLD."media_type"
		OR NEW."original_filename" IS DISTINCT FROM OLD."original_filename"
		OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'content object identity is immutable' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "content_objects_identity_immutable" BEFORE UPDATE ON "public"."content_objects"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_content_identity_change"();
--> statement-breakpoint
CREATE FUNCTION "public"."require_committed_content_object"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	object_id uuid;
	object_status "public"."content_object_status";
BEGIN
	object_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
	IF object_id IS NULL THEN
		RETURN NEW;
	END IF;
	SELECT "status" INTO object_status FROM "public"."content_objects" WHERE "id" = object_id;
	IF object_status IS DISTINCT FROM 'committed'::"public"."content_object_status" THEN
		RAISE EXCEPTION 'content object % must be committed before it can be referenced', object_id USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "challenge_assets_committed_object" BEFORE INSERT OR UPDATE ON "public"."challenge_assets"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('content_object_id');
--> statement-breakpoint
CREATE TRIGGER "imports_committed_object" BEFORE INSERT OR UPDATE ON "public"."imports"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('package_object_id');
--> statement-breakpoint
CREATE TRIGGER "exports_committed_object" BEFORE INSERT OR UPDATE ON "public"."exports"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('package_object_id');
--> statement-breakpoint
CREATE TRIGGER "platform_settings_committed_logo" BEFORE INSERT OR UPDATE ON "public"."platform_settings"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('logo_object_id');
--> statement-breakpoint
CREATE TRIGGER "content_references_committed_object" BEFORE INSERT OR UPDATE ON "public"."content_references"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('content_object_id');
--> statement-breakpoint
CREATE TRIGGER "writeup_versions_append_only" BEFORE UPDATE OR DELETE ON "public"."writeup_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
--> statement-breakpoint
CREATE TRIGGER "contest_events_append_only" BEFORE UPDATE OR DELETE ON "public"."contest_events"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
--> statement-breakpoint
CREATE TRIGGER "audit_events_append_only" BEFORE UPDATE OR DELETE ON "public"."audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
