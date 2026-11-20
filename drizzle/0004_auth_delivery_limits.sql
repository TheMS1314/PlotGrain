CREATE TABLE auth_delivery_limits (
  recipient TEXT NOT NULL PRIMARY KEY,
  hour INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX auth_delivery_limits_hour ON auth_delivery_limits(hour);
