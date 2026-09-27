import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyScanPolicy, scanMigrations } from '../deploy/safety-scan.ts';

// Story 8: the real migrations/0004_task_due_date.sql passes the deploy safety scan (additive only, no CHECK).

const file = path.resolve(import.meta.dirname, '../../migrations/0004_task_due_date.sql');

describe('dates.due_date_field: migration 0004 safety scan', () => {
  it('has no CHECK, DROP TABLE, MODIFY or ADD CONSTRAINT: no findings, production policy ok', () => {
    const sql = readFileSync(file, 'utf8');
    const findings = scanMigrations([{ name: '0004_task_due_date.sql', sql }]);
    expect(findings).toEqual([]);
    expect(applyScanPolicy('production', findings)).toBe('ok');
    expect(sql).toMatch(/ALTER TABLE tasks ADD COLUMN due_date TEXT;/);
    expect(sql).toMatch(/CREATE INDEX idx_tasks_ws_due ON tasks\(workspace_id, deleted, completed_at, due_date\);/);
  });
});
