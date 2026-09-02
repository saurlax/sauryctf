CREATE TABLE "public"."challenge_template_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_version_id" uuid NOT NULL,
	"content_object_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_template_assets_template_version_id_challenge_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."challenge_template_versions"("id"),
	CONSTRAINT "challenge_template_assets_content_object_id_content_objects_id_fk" FOREIGN KEY ("content_object_id") REFERENCES "public"."content_objects"("id"),
	CONSTRAINT "challenge_template_assets_display_name_not_empty" CHECK (length(btrim("display_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "challenge_template_assets_version_object_unique" ON "public"."challenge_template_assets" USING btree ("template_version_id", "content_object_id");
--> statement-breakpoint
CREATE INDEX "challenge_template_assets_version_order" ON "public"."challenge_template_assets" USING btree ("template_version_id", "sort_order", "id");
--> statement-breakpoint
CREATE TRIGGER "challenge_template_assets_committed_object"
BEFORE INSERT OR UPDATE ON "public"."challenge_template_assets"
FOR EACH ROW EXECUTE FUNCTION "public"."require_committed_content_object"('content_object_id');
--> statement-breakpoint
CREATE FUNCTION "public"."reject_immutable_challenge_template_asset_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'challenge template version assets are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "challenge_template_assets_immutable"
BEFORE UPDATE OR DELETE ON "public"."challenge_template_assets"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_immutable_challenge_template_asset_change"();
