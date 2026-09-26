import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyScanPolicy, scanMigrations } from '../deploy/safety-scan.ts';

// Story 7, TC-02: the real migrations/0003_projects.sql passes the deploy safety scan (the same scan a
// production release runs), so it can never be blocked or need a table rebuild.

const file = path.resolve(import.meta.dirname, '../../migrations/0003_projects.sql');

describe('projects.schema: migration 0003 safety scan', () => {
  it('TC-02 has no CHECK, DROP TABLE, MODIFY or ADD CONSTRAINT: no findings, production policy ok', () => {
    const sql = readFileSync(file, 'utf8');
    const findings = scanMigrations([{ name: '0003_projects.sql', sql }]);
    expect(findings).toEqual([]);
    expect(applyScanPolicy('production', findings)).toBe('ok');
    // And it is the additive migration the design describes.
    expect(sql).toMatch(/CREATE TABLE projects/);
    expect(sql).toMatch(/ALTER TABLE tasks ADD COLUMN project_id TEXT REFERENCES projects\(id\)/);
    expect(sql).toMatch(/ALTER TABLE tasks ADD COLUMN delete_batch_id TEXT/);
  });
});
