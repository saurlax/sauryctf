ALTER TABLE "public"."cheat_clues"
ADD COLUMN "clue_key" varchar(200);
--> statement-breakpoint
UPDATE "public"."cheat_clues"
SET "clue_key" = 'legacy:' || "id"::text
WHERE "clue_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "public"."cheat_clues"
ALTER COLUMN "clue_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."cheat_clues"
ADD CONSTRAINT "cheat_clues_type_supported"
CHECK ("clue_type" IN (
  'repeated_incorrect_answer',
  'shared_incorrect_answer',
  'abnormal_submission_frequency',
  'foreign_team_flag'
));
--> statement-breakpoint
CREATE UNIQUE INDEX "cheat_clues_key_unique"
ON "public"."cheat_clues" USING btree ("clue_key");
