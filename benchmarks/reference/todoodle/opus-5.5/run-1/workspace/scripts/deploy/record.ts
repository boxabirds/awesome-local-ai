import { DEPLOYMENT_LOG_HEADER, DEPLOYMENT_LOG_PATH } from './constants.ts';
import type { FsLike, GitLike } from './types.ts';

export type ReleaseStatus = 'success' | 'failed' | 'blocked' | 'skipped';

export type LogEntry = {
  deployId: string;
  operator: string;
  environment: string;
  gitSha: string;
  timestamp: string;
  status: ReleaseStatus;
  version: string;
};

/** RFC 4180: quote fields containing a comma, quote, CR or LF; double embedded quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** One CSV line (no line terminator) in DEPLOYMENT_LOG_HEADER column order. */
export function formatCsvRow(e: LogEntry): string {
  return [e.deployId, e.operator, e.environment, e.gitSha, e.timestamp, e.status, e.version].map(csvField).join(',');
}

/** YYYYMMDD-HHMMSS in UTC. */
export function deployStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export function deployTagName(environment: string, iso: string): string {
  return `deploy/${environment}/${deployStamp(iso)}`;
}

/**
 * Appends the release to the deployment log (creating it with its header if missing) and,
 * for successful releases, tags HEAD `deploy/<env>/YYYYMMDD-HHMMSS` and pushes the tag.
 */
export async function recordRelease(
  e: LogEntry,
  deps: { fs: FsLike; git: GitLike; tag: boolean; log?: (line: string) => void; logPath?: string },
): Promise<void> {
  const path = deps.logPath ?? DEPLOYMENT_LOG_PATH;
  if (!(await deps.fs.exists(path))) await deps.fs.writeFile(path, `${DEPLOYMENT_LOG_HEADER}\n`);
  await deps.fs.appendFile(path, `${formatCsvRow(e)}\n`);

  if (deps.tag) {
    const tag = deployTagName(e.environment, e.timestamp);
    await deps.git.createTag(tag, `Release ${e.version} (${e.gitSha}) to ${e.environment} by ${e.operator}`);
    const pushed = await deps.git.pushTag(tag);
    deps.log?.(pushed ? `Tagged ${tag} and pushed it.` : `Tagged ${tag} (no git remote configured; not pushed).`);
  }
}
