import { DANGEROUS_MIGRATION_PATTERNS, type DeployEnv, TEMP_TABLE_SUFFIXES } from './constants';

export type Finding = { file: string; line: number; pattern: string };

const DROP_TABLE_TARGET = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?([\w.]+)/i;

function isTempTableDrop(sqlFromMatch: string): boolean {
  const table = DROP_TABLE_TARGET.exec(sqlFromMatch)?.[1]?.toLowerCase();
  return table !== undefined && TEMP_TABLE_SUFFIXES.some((suffix) => table.endsWith(suffix));
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
    for (const { name: pattern, regex } of DANGEROUS_MIGRATION_PATTERNS) {
      for (const match of sql.matchAll(new RegExp(regex.source, regex.flags))) {
        if (pattern === 'DROP TABLE' && isTempTableDrop(sql.slice(match.index))) continue;
        findings.push({ file: name, line: lineOf(sql, match.index), pattern });
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Production refuses dangerous changes; staging warns and continues. */
export function applyScanPolicy(env: DeployEnv, findings: Finding[]): 'ok' | 'warn' | 'block' {
  if (findings.length === 0) return 'ok';
  return env === 'production' ? 'block' : 'warn';
}

export function describeFinding(f: Finding): string {
  return `${f.file}:${f.line} contains ${f.pattern}`;
}
