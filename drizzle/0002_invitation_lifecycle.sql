CREATE TRIGGER expire_other_customer_invites
AFTER UPDATE OF accepted_by ON customer_invites
WHEN OLD.accepted_by IS NULL AND NEW.accepted_by IS NOT NULL
BEGIN
  UPDATE customer_invites SET expires_at = 0
  WHERE customer_id = NEW.customer_id AND email = NEW.email
    AND accepted_by IS NULL AND expires_at > 0;
END;
--> statement-breakpoint

CREATE TRIGGER expire_removed_customer_member_invites
AFTER DELETE ON customer_members
BEGIN
  UPDATE customer_invites SET expires_at = 0
  WHERE customer_id = OLD.customer_id AND email = OLD.email
    AND accepted_by IS NULL AND expires_at > 0;
END;
