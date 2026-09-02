CREATE TABLE "public"."rate_limit_windows" (
	"bucket_digest" bytea NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_windows_bucket_window_unique" UNIQUE("bucket_digest", "window_started_at"),
	CONSTRAINT "rate_limit_windows_bucket_digest_sha256" CHECK (octet_length("bucket_digest") = 32),
	CONSTRAINT "rate_limit_windows_expiry_after_start" CHECK ("expires_at" > "window_started_at"),
	CONSTRAINT "rate_limit_windows_request_count_nonnegative" CHECK ("request_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expiry" ON "public"."rate_limit_windows" USING btree ("expires_at", "window_started_at");
