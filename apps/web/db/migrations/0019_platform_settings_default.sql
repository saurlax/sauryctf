INSERT INTO "public"."platform_settings" DEFAULT VALUES
ON CONFLICT ("singleton") DO NOTHING;
