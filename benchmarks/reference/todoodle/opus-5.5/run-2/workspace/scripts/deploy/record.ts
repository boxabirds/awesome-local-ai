import { dirname } from 'node:path';
import { DEPLOYMENT_LOG_HEADER, DEPLOYMENT_LOG_PATH } from './constants';
import type { FsLike, GitLike } from './types';

export type LogEntry = {
  deployId: string;
  operator: string;
  environment: string;
  gitSha: string;
  timestamp: string;
  status: 'success' | 'failed' | 'blocked' | 'skipped';
  version: string;
};

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** One RFC 4180 row (no line terminator), fields in DEPLOYMENT_LOG_HEADER order. */
export function formatCsvRow(e: LogEntry): string {
  return [e.deployId, e.operator, e.environment, e.gitSha, e.timestamp, e.status, e.version]
    .map(csvField)
    .join(',');
}

/** UTC YYYYMMDD-HHMMSS for an ISO timestamp. */
export function releaseStamp(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export function deployTagName(environment: string, isoTimestamp: string): string {
  return `deploy/${environment}/${releaseStamp(isoTimestamp)}`;
}

/**
 * Appends the entry to the deployment log (creating it with its header if missing) and, when
 * `tag` is set, tags HEAD `deploy/<env>/YYYYMMDD-HHMMSS` and pushes the tag. Errors propagate.
 */
export async function recordRelease(
  e: LogEntry,
  deps: { fs: FsLike; git: GitLike; tag: boolean; logPath?: string },
): Promise<void> {
  const logPath = deps.logPath ?? DEPLOYMENT_LOG_PATH;
  if (!(await deps.fs.exists(logPath))) {
    await deps.fs.mkdir(dirname(logPath));
    await deps.fs.appendFile(logPath, `${DEPLOYMENT_LOG_HEADER}\n`);
  } else {
    const existing = await deps.fs.readFile(logPath);
    if (existing.length > 0 && !existing.endsWith('\n')) await deps.fs.appendFile(logPath, '\n');
  }
  await deps.fs.appendFile(logPath, `${formatCsvRow(e)}\n`);

  if (deps.tag) {
    const name = deployTagName(e.environment, e.timestamp);
    await deps.git.createTag(name, `Release ${e.version} (${e.gitSha}) to ${e.environment} by ${e.operator}`);
    await deps.git.pushTag(name);
  }
}
