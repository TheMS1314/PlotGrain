CREATE TABLE account_profiles (
  user_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  updated_at INTEGER NOT NULL
);
