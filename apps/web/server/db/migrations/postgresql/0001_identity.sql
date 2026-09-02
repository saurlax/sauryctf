CREATE TYPE "public"."user_status" AS ENUM ('active', 'banned', 'deleted');
--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM ('user', 'organizer', 'admin');
--> statement-breakpoint
CREATE TYPE "public"."email_token_purpose" AS ENUM ('verify_email', 'reset_password');
--> statement-breakpoint
CREATE TABLE "public"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"username_normalized" varchar(64) NOT NULL,
	"email" varchar(320) NOT NULL,
	"email_normalized" varchar(320) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"session_version" bigint DEFAULT 1 NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_normalized_check" CHECK ("username_normalized" = lower("username_normalized")),
	CONSTRAINT "users_email_normalized_check" CHECK ("email_normalized" = lower("email_normalized")),
	CONSTRAINT "users_session_version_positive" CHECK ("session_version" > 0),
	CONSTRAINT "users_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_normalized_unique" ON "public"."users" USING btree ("username_normalized");
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_unique" ON "public"."users" USING btree ("email_normalized");
--> statement-breakpoint
CREATE TABLE "public"."credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"algorithm" text DEFAULT 'scrypt' NOT NULL,
	"password_hash" text NOT NULL,
	"password_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
	CONSTRAINT "credentials_algorithm_scrypt" CHECK ("algorithm" = 'scrypt'),
	CONSTRAINT "credentials_password_hash_not_empty" CHECK (length("password_hash") > 0)
);
--> statement-breakpoint
CREATE TABLE "public"."user_roles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" "global_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "public"."email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "email_token_purpose" NOT NULL,
	"token_digest" bytea NOT NULL,
	"target_email_normalized" varchar(320) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
	CONSTRAINT "email_tokens_target_normalized_check" CHECK ("target_email_normalized" = lower("target_email_normalized")),
	CONSTRAINT "email_tokens_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_tokens_digest_unique" ON "public"."email_tokens" USING btree ("token_digest");
--> statement-breakpoint
CREATE INDEX "email_tokens_active_lookup" ON "public"."email_tokens" USING btree ("user_id", "purpose", "expires_at");
