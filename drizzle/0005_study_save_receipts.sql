ALTER TABLE study_versions ADD COLUMN request_key TEXT;
--> statement-breakpoint
ALTER TABLE study_versions ADD COLUMN request_actor TEXT;
--> statement-breakpoint
ALTER TABLE study_versions ADD COLUMN request_digest TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX study_versions_request ON study_versions(study_id, request_actor, request_key)
WHERE request_key IS NOT NULL;
