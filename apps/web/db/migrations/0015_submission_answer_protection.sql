ALTER TABLE "public"."submissions"
ALTER COLUMN "answer_ciphertext" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "public"."submissions"
ADD CONSTRAINT "submissions_answer_digest_length"
CHECK (octet_length("answer_digest") = 32);
--> statement-breakpoint
ALTER TABLE "public"."submissions"
ADD CONSTRAINT "submissions_answer_ciphertext_envelope"
CHECK (octet_length("answer_ciphertext") >= 33);
