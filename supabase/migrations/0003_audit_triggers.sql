-- ============================================================
-- Migration 0003: Audit log triggers
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- Allow record_id to be NULL for tables whose PK is not a UUID
-- (app_settings uses text key; all others use uuid id)
ALTER TABLE audit_log ALTER COLUMN record_id DROP NOT NULL;

-- Generic trigger function (SECURITY DEFINER writes to audit_log bypassing RLS)
-- Uses to_jsonb() ->> 'id' so it works for any table; returns NULL for app_settings
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := (to_jsonb(OLD) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSE
    v_id := (to_jsonb(NEW) ->> 'id')::uuid;
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  END IF;
END;
$$;

-- Attach to all mutable tables
CREATE TRIGGER audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_account_snapshots
  AFTER INSERT OR UPDATE OR DELETE ON account_snapshots
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_goals
  AFTER INSERT OR UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_planned_outflows
  AFTER INSERT OR UPDATE OR DELETE ON planned_outflows
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_wedding_items
  AFTER INSERT OR UPDATE OR DELETE ON wedding_items
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_accounts
  AFTER INSERT OR UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_app_settings
  AFTER INSERT OR UPDATE OR DELETE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
