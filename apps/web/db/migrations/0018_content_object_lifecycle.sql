ALTER TABLE "public"."content_objects" ADD COLUMN "deletion_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "public"."content_objects" DROP CONSTRAINT "content_objects_commit_state";
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_commit_state"
CHECK (("status" = 'temporary' AND "committed_at" IS NULL)
  OR ("status" = 'committed' AND "committed_at" IS NOT NULL)
  OR "status" IN ('quarantined', 'deleted'));
--> statement-breakpoint
ALTER TABLE "public"."content_objects" ADD CONSTRAINT "content_objects_deletion_claim_state"
CHECK ("deletion_claimed_at" IS NULL OR "status" = 'quarantined');
--> statement-breakpoint
DROP INDEX "public"."content_objects_digest_size_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "content_objects_digest_size_unique"
ON "public"."content_objects" USING btree ("sha256_digest", "size_bytes")
WHERE "status" <> 'deleted';
--> statement-breakpoint
CREATE INDEX "content_objects_garbage_collection"
ON "public"."content_objects" USING btree ("status", "created_at", "id")
WHERE "status" IN ('temporary', 'committed', 'quarantined');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."require_committed_content_object"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	object_id uuid;
	object_status "public"."content_object_status";
BEGIN
	object_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
	IF object_id IS NULL THEN
		RETURN NEW;
	END IF;
	SELECT "status" INTO object_status
	FROM "public"."content_objects"
	WHERE "id" = object_id
	FOR SHARE;
	IF object_status IS DISTINCT FROM 'committed'::"public"."content_object_status" THEN
		RAISE EXCEPTION 'content object % must be committed before it can be referenced', object_id USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
