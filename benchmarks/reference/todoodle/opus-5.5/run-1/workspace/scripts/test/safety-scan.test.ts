import { describe, expect, it } from 'vitest';
import { DANGEROUS_MIGRATION_PATTERNS } from '../deploy/constants.ts';
import { applyScanPolicy, scanMigrations } from '../deploy/safety-scan.ts';
import { DANGEROUS_BY_PATTERN, M0001_WORKSPACES, M0002_TASKS, M0003_PROJECTS, M0004_DUE_DATE } from './fixtures/migrations.ts';

describe('scanMigrations', () => {
  it('TC-S01 no pending files -> no findings -> ok', () => {
    const findings = scanMigrations([]);
    expect(findings).toEqual([]);
    expect(applyScanPolicy('production', findings)).toBe('ok');
  });

  it('TC-S02 CREATE TABLE and ALTER TABLE ADD COLUMN are clean (planned 0001-0004)', () => {
    expect(
      scanMigrations([
        { name: '0001_workspaces.sql', sql: M0001_WORKSPACES },
        { name: '0002_tasks.sql', sql: M0002_TASKS },
        { name: '0003_projects.sql', sql: M0003_PROJECTS },
        { name: '0004_task_due_date.sql', sql: M0004_DUE_DATE },
      ]),
    ).toEqual([]);
  });

  it('covers every configured pattern', () => {
    expect(Object.keys(DANGEROUS_BY_PATTERN).sort()).toEqual(DANGEROUS_MIGRATION_PATTERNS.map((p) => p.pattern).sort());
  });

  it.each(Object.entries(DANGEROUS_BY_PATTERN))('TC-S03 %s yields one finding naming file and pattern', (pattern, statement) => {
    const sql = `-- Migration number: 0005\nCREATE TABLE notes (id TEXT PRIMARY KEY);\n${statement}\n`;
    expect(scanMigrations([{ name: '0005_danger.sql', sql }])).toEqual([{ file: '0005_danger.sql', line: 3, pattern }]);
  });

  it('TC-S04 matches case-insensitively', () => {
    expect(scanMigrations([{ name: '0005_lower.sql', sql: 'drop table tasks;' }])).toEqual([
      { file: '0005_lower.sql', line: 1, pattern: 'DROP TABLE' },
    ]);
  });

  it('TC-S05 DROP TABLE of a _temp table is allowed, but _temporary is not (suffix boundary)', () => {
    expect(scanMigrations([{ name: 'a.sql', sql: 'DROP TABLE tasks_temp;' }])).toEqual([]);
    expect(scanMigrations([{ name: 'a.sql', sql: 'DROP TABLE tasks_temporary;' }])).toEqual([
      { file: 'a.sql', line: 1, pattern: 'DROP TABLE' },
    ]);
  });

  it.each(['tasks_new', 'tasks_old', 'tasks_backup', '"tasks_new"', 'IF EXISTS tasks_old'])(
    'TC-S05 DROP TABLE %s is the safe end of a table rebuild',
    (target) => {
      expect(scanMigrations([{ name: 'a.sql', sql: `DROP TABLE ${target};` }])).toEqual([]);
    },
  );

  it('scans comments too (a false positive blocks, the safe failure)', () => {
    expect(scanMigrations([{ name: 'a.sql', sql: '-- we might DROP TABLE tasks later\nSELECT 1;' }])).toHaveLength(1);
  });

  it('matches an ALTER TABLE .. MODIFY split across lines', () => {
    expect(scanMigrations([{ name: 'a.sql', sql: 'SELECT 1;\nALTER TABLE tasks\n  MODIFY name TEXT;' }])).toEqual([
      { file: 'a.sql', line: 2, pattern: 'ALTER TABLE .. MODIFY' },
    ]);
  });

  it('TC-S06 lists every finding across files, ordered by file then line', () => {
    const findings = scanMigrations([
      { name: '0006_b.sql', sql: 'SELECT 1;\nTRUNCATE TABLE tasks;' },
      { name: '0005_a.sql', sql: 'CREATE TABLE x (id TEXT);\n\nALTER TABLE tasks DROP CONSTRAINT fk;\nDROP TABLE projects;' },
    ]);
    expect(findings).toEqual([
      { file: '0005_a.sql', line: 3, pattern: 'DROP CONSTRAINT' },
      { file: '0005_a.sql', line: 4, pattern: 'DROP TABLE' },
      { file: '0006_b.sql', line: 2, pattern: 'TRUNCATE TABLE' },
    ]);
  });
});

describe('applyScanPolicy (TC-S07)', () => {
  const findings = [{ file: 'a.sql', line: 1, pattern: 'DROP TABLE' }];

  it('blocks production when there are findings', () => {
    expect(applyScanPolicy('production', findings)).toBe('block');
  });

  it('warns on staging when there are findings', () => {
    expect(applyScanPolicy('staging', findings)).toBe('warn');
  });

  it.each(['staging', 'production'] as const)('is ok on %s without findings', (env) => {
    expect(applyScanPolicy(env, [])).toBe('ok');
  });
});
