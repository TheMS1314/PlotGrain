CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX customers_owner ON customers(owner_id, created_at);
--> statement-breakpoint

CREATE TABLE customer_members (
  customer_id TEXT NOT NULL REFERENCES customers(id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  email TEXT NOT NULL,
  PRIMARY KEY (customer_id, user_id)
);
--> statement-breakpoint
CREATE INDEX customer_members_user ON customer_members(user_id, customer_id);
--> statement-breakpoint

CREATE TABLE customer_invites (
  digest TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  expires_at INTEGER NOT NULL,
  accepted_by TEXT
);
--> statement-breakpoint
CREATE INDEX customer_invites_scope ON customer_invites(customer_id, expires_at);
--> statement-breakpoint

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX projects_customer ON projects(customer_id, created_at, id);
--> statement-breakpoint

CREATE TABLE studies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  head INTEGER NOT NULL DEFAULT 0 CHECK (head >= 0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX studies_project ON studies(project_id, created_at, id);
--> statement-breakpoint

CREATE TABLE study_versions (
  study_id TEXT NOT NULL REFERENCES studies(id),
  version INTEGER NOT NULL CHECK (version > 0),
  label TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  restored_from INTEGER,
  PRIMARY KEY (study_id, version),
  FOREIGN KEY (study_id, restored_from) REFERENCES study_versions(study_id, version)
);
--> statement-breakpoint
CREATE TRIGGER advance_study_head AFTER INSERT ON study_versions
BEGIN
  UPDATE studies SET head = NEW.version WHERE id = NEW.study_id;
END;
--> statement-breakpoint

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX threads_project ON threads(project_id, created_at, id);
--> statement-breakpoint

CREATE TABLE thread_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX thread_messages_thread ON thread_messages(thread_id, id);
--> statement-breakpoint

CREATE TRIGGER add_invited_customer_member
AFTER UPDATE OF accepted_by ON customer_invites
WHEN OLD.accepted_by IS NULL AND NEW.accepted_by IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO customer_members (customer_id, user_id, role, email)
  VALUES (NEW.customer_id, NEW.accepted_by, NEW.role, NEW.email);
END;
