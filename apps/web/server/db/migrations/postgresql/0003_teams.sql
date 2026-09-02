CREATE TYPE "public"."team_member_role" AS ENUM ('member', 'captain');
--> statement-breakpoint
CREATE TABLE "public"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"name_normalized" varchar(80) NOT NULL,
	"created_by" uuid NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "teams_name_normalized_check" CHECK ("name_normalized" = lower("name_normalized")),
	CONSTRAINT "teams_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_normalized_unique" ON "public"."teams" USING btree ("name_normalized");
--> statement-breakpoint
CREATE TABLE "public"."team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "team_member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade,
	CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_user_unique" ON "public"."team_members" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_team_user_unique" ON "public"."team_members" USING btree ("team_id", "user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_single_captain_unique" ON "public"."team_members" USING btree ("team_id") WHERE "role" = 'captain';
--> statement-breakpoint
CREATE INDEX "team_members_team_lookup" ON "public"."team_members" USING btree ("team_id", "joined_at");
--> statement-breakpoint
CREATE TABLE "public"."team_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"token_digest" bytea NOT NULL,
	"generation" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade,
	CONSTRAINT "team_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id"),
	CONSTRAINT "team_invites_generation_positive" CHECK ("generation" > 0),
	CONSTRAINT "team_invites_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"),
	CONSTRAINT "team_invites_revocation_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_digest_unique" ON "public"."team_invites" USING btree ("token_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_generation_unique" ON "public"."team_invites" USING btree ("team_id", "generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "team_invites_single_current_unique" ON "public"."team_invites" USING btree ("team_id") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE FUNCTION "public"."assert_team_has_one_captain"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	checked_team_id uuid;
	captain_count integer;
BEGIN
	IF TG_TABLE_NAME = 'teams' THEN
		IF TG_OP <> 'DELETE' THEN
			checked_team_id := NEW.id;
		END IF;
	ELSIF TG_OP = 'DELETE' THEN
		checked_team_id := OLD.team_id;
	ELSIF TG_OP = 'INSERT' THEN
		checked_team_id := NEW.team_id;
	ELSE
		checked_team_id := OLD.team_id;
	END IF;

	IF checked_team_id IS NOT NULL AND EXISTS (SELECT 1 FROM "public"."teams" WHERE id = checked_team_id) THEN
		SELECT count(*) INTO captain_count FROM "public"."team_members" WHERE team_id = checked_team_id AND role = 'captain';
		IF captain_count <> 1 THEN
			RAISE EXCEPTION 'team % must have exactly one captain', checked_team_id USING ERRCODE = '23514';
		END IF;
	END IF;

	IF TG_TABLE_NAME = 'team_members' THEN
		IF TG_OP = 'UPDATE' AND NEW.team_id <> OLD.team_id THEN
			checked_team_id := NEW.team_id;
			IF EXISTS (SELECT 1 FROM "public"."teams" WHERE id = checked_team_id) THEN
				SELECT count(*) INTO captain_count FROM "public"."team_members" WHERE team_id = checked_team_id AND role = 'captain';
				IF captain_count <> 1 THEN
					RAISE EXCEPTION 'team % must have exactly one captain', checked_team_id USING ERRCODE = '23514';
				END IF;
			END IF;
		END IF;
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "teams_exactly_one_captain"
AFTER INSERT OR UPDATE ON "public"."teams"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."assert_team_has_one_captain"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "team_members_exactly_one_captain"
AFTER INSERT OR UPDATE OR DELETE ON "public"."team_members"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION "public"."assert_team_has_one_captain"();
