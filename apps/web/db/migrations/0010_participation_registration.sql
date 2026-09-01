ALTER TABLE "public"."participations" ADD COLUMN "invite_digest_verified" bytea;
--> statement-breakpoint
ALTER TABLE "public"."participations" ADD CONSTRAINT "participations_invite_digest_length"
CHECK ("invite_digest_verified" IS NULL OR octet_length("invite_digest_verified") = 32);
