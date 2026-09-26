import { DANGEROUS_MIGRATION_PATTERNS, type DeployEnvironment, TEMP_TABLE_SUFFIXES } from './constants.ts';

export type Finding = { file: string; line: number; pattern: string };
export type ScanPolicy = 'ok' | 'warn' | 'block';

function unquote(name: string): string {
  return name.replace(/^[`"[]|[`"\]]$/g, '');
}

function isTempTableDrop(tableName: string | undefined): boolean {
  if (!tableName) return false;
  const bare = unquote(tableName).split('.').pop()?.toLowerCase() ?? '';
  return TEMP_TABLE_SUFFIXES.some((suffix) => bare.endsWith(suffix));
}

function lineOf(sql: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (sql.charCodeAt(i) === 10) line++;
  return line;
}

/** Every dangerous pattern in the given (pending) migrations, sorted by file then line. */
export function scanMigrations(files: { name: string; sql: string }[]): Finding[] {
  const findings: Finding[] = [];
  for (const { name, sql } of files) {
    for (const { pattern, regex } of DANGEROUS_MIGRATION_PATTERNS) {
      for (const match of sql.matchAll(new RegExp(regex.source, regex.flags))) {
        if (pattern === 'DROP TABLE' && isTempTableDrop(match[1])) continue;
        findings.push({ file: name, line: lineOf(sql, match.index), pattern });
      }
    }
  }
  return findings.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

/** Production refuses any finding; staging warns and continues. */
export function applyScanPolicy(env: DeployEnvironment, findings: Finding[]): ScanPolicy {
  if (findings.length === 0) return 'ok';
  return env === 'production' ? 'block' : 'warn';
}

export function describeFinding(f: Finding): string {
  return `${f.file}:${f.line} contains ${f.pattern}`;
}
