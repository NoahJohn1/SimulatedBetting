CREATE TABLE "rate_limits" (
	"subject_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_subject_id_bucket_window_start_pk" PRIMARY KEY("subject_id","bucket","window_start")
);
