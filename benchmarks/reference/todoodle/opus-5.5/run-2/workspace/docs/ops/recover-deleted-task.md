# Recover a deleted task (operator runbook)

Deleting a task in Todoodle is a **soft delete**: the row stays in D1 with `deleted = 1` and
`deleted_at` set; every other column (name, description, `completed_at`, `sort_order`) is kept.
Nothing in the app hard-deletes tasks. Users can undo a delete for 10 seconds in the UI; after
that, only an operator can bring a task back.

## 1. Find the task

You need the workspace id (the `/w/<id>` part of the address the user sees). Ask the user for the
task's name, roughly when they deleted it, or both.

```sh
npx wrangler d1 execute DB --env production --remote --command \
  "SELECT id, name, completed_at, deleted_at, version FROM tasks
   WHERE workspace_id = '<workspace id>' AND deleted = 1
   ORDER BY deleted_at DESC LIMIT 20"
```

Use `--env staging` for staging. Never paste workspace secrets or links into tickets or chat.

## 2. Restore it

Run the same statement the API's restore endpoint runs (it keeps `completed_at` and `sort_order`,
so the task returns to the same list, position and completed/open state):

```sh
npx wrangler d1 execute DB --env production --remote --command \
  "UPDATE tasks SET deleted = 0, deleted_at = NULL, version = version + 1
   WHERE id = '<task id>' AND workspace_id = '<workspace id>' AND deleted = 1"
```

Exactly one row should change. If none did, check the ids (or it was already restored).

## 3. Tell the user

People with the workspace open see the task after their next refresh (a direct D1 change is not
broadcast live). Ask them to reload the page.
