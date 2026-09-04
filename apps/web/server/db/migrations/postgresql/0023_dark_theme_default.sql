ALTER TABLE "public"."platform_settings"
  ALTER COLUMN "theme" SET DEFAULT 'dark';

UPDATE "public"."platform_settings"
SET "theme" = 'dark'
WHERE "singleton" = true
  AND "theme" = 'system'
  AND "version" = 1
  AND "updated_by" IS NULL;
