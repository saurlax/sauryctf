CREATE TYPE "public"."mail_delivery_status" AS ENUM ('pending', 'leased', 'retry_wait', 'sent', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."system_locale" AS ENUM ('zh-CN', 'en');
--> statement-breakpoint
CREATE TABLE "public"."domain_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(64) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "domain_outbox_aggregate_type_not_empty" CHECK (length("aggregate_type") > 0),
	CONSTRAINT "domain_outbox_event_type_not_empty" CHECK (length("event_type") > 0),
	CONSTRAINT "domain_outbox_event_version_positive" CHECK ("event_version" > 0),
	CONSTRAINT "domain_outbox_attempt_count_nonnegative" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_outbox_dedupe_key_unique" ON "public"."domain_outbox" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "domain_outbox_dispatch" ON "public"."domain_outbox" USING btree ("published_at", "available_at", "occurred_at");
--> statement-breakpoint
CREATE TABLE "public"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"template_key" varchar(128) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
	CONSTRAINT "notifications_source_event_id_domain_outbox_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."domain_outbox"("id"),
	CONSTRAINT "notifications_template_key_not_empty" CHECK (length("template_key") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_source_unique" ON "public"."notifications" USING btree ("user_id", "source_event_id");
--> statement-breakpoint
CREATE INDEX "notifications_user_unread" ON "public"."notifications" USING btree ("user_id", "read_at", "created_at");
--> statement-breakpoint
CREATE TABLE "public"."mail_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_event_id" uuid NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"recipient_normalized" varchar(320) NOT NULL,
	"template_key" varchar(128) NOT NULL,
	"locale" "system_locale" DEFAULT 'zh-CN' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "mail_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(128),
	"lease_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_deliveries_source_event_id_domain_outbox_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."domain_outbox"("id"),
	CONSTRAINT "mail_deliveries_recipient_normalized_check" CHECK ("recipient_normalized" = lower("recipient_normalized")),
	CONSTRAINT "mail_deliveries_template_key_not_empty" CHECK (length("template_key") > 0),
	CONSTRAINT "mail_deliveries_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
	CONSTRAINT "mail_deliveries_max_attempts_positive" CHECK ("max_attempts" > 0),
	CONSTRAINT "mail_deliveries_attempt_limit" CHECK ("attempt_count" <= "max_attempts")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_deliveries_source_recipient_template_unique" ON "public"."mail_deliveries" USING btree ("source_event_id", "recipient_normalized", "template_key");
--> statement-breakpoint
CREATE INDEX "mail_deliveries_dispatch" ON "public"."mail_deliveries" USING btree ("status", "available_at");
