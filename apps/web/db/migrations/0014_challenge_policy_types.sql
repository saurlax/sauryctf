ALTER TABLE "public"."challenge_template_versions"
ADD CONSTRAINT "challenge_template_versions_flag_policy_type"
CHECK (("flag_policy" ? 'type') AND "flag_policy" ->> 'type' IN ('static', 'team-derived', 'synchronous'));
--> statement-breakpoint
ALTER TABLE "public"."challenge_template_versions"
ADD CONSTRAINT "challenge_template_versions_scoring_policy_type"
CHECK (("scoring_policy" ? 'type') AND "scoring_policy" ->> 'type' IN ('fixed-v1', 'decay-v1'));
--> statement-breakpoint
ALTER TABLE "public"."challenge_template_versions"
ADD CONSTRAINT "challenge_template_versions_instance_policy_type"
CHECK (("instance_policy" ? 'type') AND "instance_policy" ->> 'type' IN ('none', 'dynamic'));
--> statement-breakpoint
ALTER TABLE "public"."contest_challenges"
ADD CONSTRAINT "contest_challenges_flag_policy_type"
CHECK (("flag_policy" ? 'type') AND "flag_policy" ->> 'type' IN ('static', 'team-derived', 'synchronous'));
--> statement-breakpoint
ALTER TABLE "public"."contest_challenges"
ADD CONSTRAINT "contest_challenges_scoring_policy_type"
CHECK (("scoring_policy" ? 'type') AND "scoring_policy" ->> 'type' IN ('fixed-v1', 'decay-v1'));
--> statement-breakpoint
ALTER TABLE "public"."contest_challenges"
ADD CONSTRAINT "contest_challenges_instance_policy_type"
CHECK (("instance_policy" ? 'type') AND "instance_policy" ->> 'type' IN ('none', 'dynamic'));
