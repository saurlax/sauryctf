CREATE TYPE "public"."security_log_severity" AS ENUM ('info', 'warn', 'error');
--> statement-breakpoint
CREATE TABLE "public"."security_log_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"severity" "security_log_severity" NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"error_code" varchar(128) NOT NULL,
	"method" varchar(16) NOT NULL,
	"route" text NOT NULL,
	"status_code" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_log_events_event_type_not_empty" CHECK (length(btrim("event_type")) > 0),
	CONSTRAINT "security_log_events_request_id_not_empty" CHECK (length(btrim("request_id")) > 0),
	CONSTRAINT "security_log_events_error_code_not_empty" CHECK (length(btrim("error_code")) > 0),
	CONSTRAINT "security_log_events_method_not_empty" CHECK (length(btrim("method")) > 0),
	CONSTRAINT "security_log_events_route_absolute" CHECK (left("route", 1) = '/'),
	CONSTRAINT "security_log_events_status_code" CHECK ("status_code" BETWEEN 400 AND 599)
);
--> statement-breakpoint
CREATE INDEX "security_log_events_expiry" ON "public"."security_log_events" USING btree ("occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "security_log_events_request" ON "public"."security_log_events" USING btree ("request_id", "occurred_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_append_only_fact_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE'
		AND TG_TABLE_NAME IN ('audit_events', 'security_log_events')
		AND current_setting('sauryctf.retention_cleanup', true) = 'enabled' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "security_log_events_append_only" BEFORE UPDATE OR DELETE ON "public"."security_log_events"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_append_only_fact_change"();
--> statement-breakpoint
CREATE FUNCTION "public"."apply_data_retention"(
	"audit_before" timestamp with time zone,
	"security_before" timestamp with time zone,
	"batch_limit" integer
) RETURNS TABLE ("audit_deleted" integer, "security_logs_deleted" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
	audit_count integer;
	security_count integer;
BEGIN
	IF audit_before IS NULL OR security_before IS NULL
		OR batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 10000 THEN
		RAISE EXCEPTION 'invalid retention boundary or batch size' USING ERRCODE = '22023';
	END IF;
	IF audit_before > clock_timestamp() - interval '365 days'
		OR security_before > clock_timestamp() - interval '90 days' THEN
		RAISE EXCEPTION 'retention boundary is newer than the minimum policy' USING ERRCODE = '22023';
	END IF;

	PERFORM set_config('sauryctf.retention_cleanup', 'enabled', true);
	WITH candidates AS (
		SELECT event.id
		FROM public.audit_events AS event
		WHERE event.occurred_at <= audit_before
		ORDER BY event.occurred_at, event.id
		FOR UPDATE OF event SKIP LOCKED
		LIMIT batch_limit
	), deleted AS (
		DELETE FROM public.audit_events AS event
		USING candidates
		WHERE event.id = candidates.id
		RETURNING event.id
	)
	SELECT count(*)::integer INTO audit_count FROM deleted;

	WITH candidates AS (
		SELECT event.id
		FROM public.security_log_events AS event
		WHERE event.occurred_at <= security_before
		ORDER BY event.occurred_at, event.id
		FOR UPDATE OF event SKIP LOCKED
		LIMIT batch_limit
	), deleted AS (
		DELETE FROM public.security_log_events AS event
		USING candidates
		WHERE event.id = candidates.id
		RETURNING event.id
	)
	SELECT count(*)::integer INTO security_count FROM deleted;
	PERFORM set_config('sauryctf.retention_cleanup', 'disabled', true);

	RETURN QUERY SELECT audit_count, security_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."apply_data_retention"(timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC;
