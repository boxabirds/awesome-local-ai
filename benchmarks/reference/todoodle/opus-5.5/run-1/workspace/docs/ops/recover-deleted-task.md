# Recovering a deleted task (operator runbook)

Todoodle never hard-deletes a task. Deleting a task in the app is a **soft delete**: the row stays in D1
with `deleted = 1` and `deleted_at` set, and every other column (name, description, `completed_at`,
`sort_order`, `version`) is kept. Users can undo a delete for 10 seconds from the app; after that only an
operator can bring a task back. There is no user-facing trash.

## 1. Find the task

You need the workspace id (the `/w/<id>` part of a remembered-workspace URL, or from the user) and some of
the task's name.

```sh
wrangler d1 execute DB --env production --remote --command \
  "SELECT id, name, deleted_at, completed_at, version FROM tasks
   WHERE workspace_id = '<WORKSPACE_ID>' AND deleted = 1 AND name LIKE '%<part of name>%'
   ORDER BY deleted_at DESC LIMIT 20"
```

Confirm the right row with the user (name, roughly when it was deleted). Never share other rows.

## 2. Restore it

Preferred: call the same endpoint the app's Undo uses, so connected browsers update live. It needs the
workspace cookie, so it is usually easier to restore directly in D1:

```sh
wrangler d1 execute DB --env production --remote --command \
  "UPDATE tasks SET deleted = 0, deleted_at = NULL, version = version + 1,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = '<TASK_ID>' AND workspace_id = '<WORKSPACE_ID>' AND deleted = 1"
```

The task returns to its original position (sort order is untouched) and keeps its completed state.
Open browsers pick it up on their next reload or reconnect (a direct D1 update is not broadcast).

## 3. Record it

Note the workspace id, task id, time and who asked in the ops log. Do not copy the task's content.
