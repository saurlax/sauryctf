CREATE INDEX "participations_team_status" ON "public"."participations" USING btree ("team_id", "status");
--> statement-breakpoint
CREATE FUNCTION "public"."lock_team_for_accepted_participation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	PERFORM 1 FROM "public"."teams" WHERE "id" = NEW."team_id" FOR UPDATE;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "participations_acceptance_team_lock"
BEFORE INSERT OR UPDATE OF "status", "team_id" ON "public"."participations"
FOR EACH ROW WHEN (NEW."status" = 'accepted')
EXECUTE FUNCTION "public"."lock_team_for_accepted_participation"();
