-- Story 8: due dates. A due date is a calendar date 'YYYY-MM-DD' (no time, no zone); NULL = no date. Each
-- viewer decides what is today or overdue from their own local date, so nothing here is zone-aware. The shared
-- zod schemas validate the value (no CHECK: additive only, passes the migration safety scan).
ALTER TABLE tasks ADD COLUMN due_date TEXT;

-- Today and its count: open, non-deleted tasks of a workspace with due_date <= the viewer's date.
CREATE INDEX idx_tasks_ws_due ON tasks(workspace_id, deleted, completed_at, due_date);
