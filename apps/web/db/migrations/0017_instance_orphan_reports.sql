CREATE TABLE "public"."instance_orphan_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "instance_provider" NOT NULL,
	"provider_resource_id" varchar(255) NOT NULL,
	"claimed_instance_id" uuid,
	"claimed_generation" bigint,
	"reason" varchar(64) NOT NULL,
	"ownership_labels" jsonb NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "instance_orphan_reports_resource_id_not_empty" CHECK (length("provider_resource_id") > 0),
	CONSTRAINT "instance_orphan_reports_generation_positive" CHECK ("claimed_generation" IS NULL OR "claimed_generation" > 0),
	CONSTRAINT "instance_orphan_reports_reason_supported" CHECK ("reason" IN ('unknown_instance', 'identity_mismatch', 'provider_mismatch', 'future_generation', 'duplicate_identity')),
	CONSTRAINT "instance_orphan_reports_labels_object" CHECK (jsonb_typeof("ownership_labels") = 'object'),
	CONSTRAINT "instance_orphan_reports_occurrences_positive" CHECK ("occurrences" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_orphan_reports_resource_unique" ON "public"."instance_orphan_reports" USING btree ("provider", "provider_resource_id");
--> statement-breakpoint
CREATE INDEX "instance_orphan_reports_open" ON "public"."instance_orphan_reports" USING btree ("resolved_at", "last_seen_at");
