ALTER TABLE "public"."contests" ADD COLUMN "invite_required" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "public"."contests"
SET "invite_required" = true
WHERE "invite_digest" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."contests" ADD CONSTRAINT "contests_writeup_configuration"
CHECK ("writeup_required" OR "writeup_deadline_at" IS NULL);
--> statement-breakpoint
ALTER TABLE "public"."contests" ADD CONSTRAINT "contests_invite_configuration"
CHECK ((NOT "invite_required" OR "invite_digest" IS NOT NULL)
  AND ("invite_digest" IS NULL OR octet_length("invite_digest") = 32));
--> statement-breakpoint
ALTER TABLE "public"."contests" DROP CONSTRAINT "contests_team_size";
--> statement-breakpoint
ALTER TABLE "public"."contests" ADD CONSTRAINT "contests_team_size"
CHECK ("min_team_size" > 0 AND "max_team_size" >= "min_team_size" AND "max_team_size" <= 100);
--> statement-breakpoint
ALTER TABLE "public"."contests" ADD CONSTRAINT "contests_registration_constraints_shape"
CHECK (jsonb_typeof("registration_constraints") = 'object'
  AND ("registration_constraints" - 'allowed_email_domains') = '{}'::jsonb
  AND (NOT ("registration_constraints" ? 'allowed_email_domains')
    OR jsonb_typeof("registration_constraints" -> 'allowed_email_domains') = 'array'));
