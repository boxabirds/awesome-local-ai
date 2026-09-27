import { describe, expect, it } from 'vitest';
import { DANGEROUS_MIGRATION_PATTERNS } from '../deploy/constants';
import { applyScanPolicy, type Finding, scanMigrations } from '../deploy/safety-scan';
import {
  DANGEROUS_BY_PATTERN,
  REBUILD_WITH_TEMP_TABLES,
  SAFE_0001_WORKSPACES,
  SAFE_0002_TASKS,
  SAFE_0003_PROJECTS,
  SAFE_0004_DUE_DATE,
} from './fixtures/migrations';

describe('scanMigrations', () => {
  it('TC-S01 no pending files -> no findings', () => {
    expect(scanMigrations([])).toEqual([]);
    expect(applyScanPolicy('production', [])).toBe('ok');
  });

  it('TC-S02 CREATE TABLE and ALTER TABLE ADD COLUMN migrations are clean', () => {
    const findings = scanMigrations([
      { name: '0001_workspaces.sql', sql: SAFE_0001_WORKSPACES },
      { name: '0002_tasks.sql', sql: SAFE_0002_TASKS },
      { name: '0003_projects.sql', sql: SAFE_0003_PROJECTS },
      { name: '0004_task_due_date.sql', sql: SAFE_0004_DUE_DATE },
    ]);
    expect(findings).toEqual([]);
  });

  it('covers every configured pattern', () => {
    expect(DANGEROUS_BY_PATTERN.map((d) => d.pattern)).toEqual(
      DANGEROUS_MIGRATION_PATTERNS.map((p) => p.name),
    );
  });

  it.each(DANGEROUS_BY_PATTERN)('TC-S03 flags $pattern naming file and pattern', ({ pattern, sql }) => {
    expect(scanMigrations([{ name: '0005_change.sql', sql }])).toEqual([
      { file: '0005_change.sql', line: 2, pattern },
    ]);
  });

  it('TC-S04 matching is case-insensitive', () => {
    expect(scanMigrations([{ name: '0005_x.sql', sql: 'drop table tasks;' }])).toEqual([
      { file: '0005_x.sql', line: 1, pattern: 'DROP TABLE' },
    ]);
  });

  it('TC-S05 DROP TABLE of a _temp table is allowed, _temporary is not', () => {
    expect(scanMigrations([{ name: '0005_a.sql', sql: 'DROP TABLE tasks_temp;' }])).toEqual([]);
    expect(scanMigrations([{ name: '0005_b.sql', sql: 'DROP TABLE tasks_temporary;' }])).toEqual([
      { file: '0005_b.sql', line: 1, pattern: 'DROP TABLE' },
    ]);
  });

  it('TC-S05 table-rebuild temp tables (_new/_old/_backup, IF EXISTS) are allowed', () => {
    expect(scanMigrations([{ name: '0006_rebuild.sql', sql: REBUILD_WITH_TEMP_TABLES }])).toEqual([]);
  });

  it('scans comments too (a false positive blocks, the safe failure)', () => {
    expect(
      scanMigrations([{ name: '0005_c.sql', sql: '-- later: DROP TABLE tasks\nSELECT 1;' }]),
    ).toHaveLength(1);
  });

  it('TC-S06 lists every finding across files, ordered by file then line', () => {
    const findings = scanMigrations([
      {
        name: '0006_second.sql',
        sql: 'CREATE TABLE a (id TEXT);\nTRUNCATE TABLE tasks;\n',
      },
      {
        name: '0005_first.sql',
        sql: 'CREATE TABLE b (n INTEGER CHECK (n > 0));\nSELECT 1;\nDROP TABLE projects;\n',
      },
    ]);
    expect(findings).toEqual<Finding[]>([
      { file: '0005_first.sql', line: 1, pattern: 'CHECK (' },
      { file: '0005_first.sql', line: 3, pattern: 'DROP TABLE' },
      { file: '0006_second.sql', line: 2, pattern: 'TRUNCATE TABLE' },
    ]);
  });
});

describe('applyScanPolicy (TC-S07)', () => {
  const findings: Finding[] = [{ file: '0005_x.sql', line: 1, pattern: 'DROP TABLE' }];

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
