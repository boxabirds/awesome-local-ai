import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_LOG_HEADER } from '../deploy/constants.ts';
import { type LogEntry, deployTagName, formatCsvRow } from '../deploy/record.ts';

const entry: LogEntry = {
  deployId: 'staging-20260925-123456',
  operator: 'Ada Lovelace',
  environment: 'staging',
  gitSha: 'a'.repeat(40),
  timestamp: '2026-09-25T12:34:56.000Z',
  status: 'success',
  version: 'v1.2.0',
};

describe('formatCsvRow', () => {
  it('writes fields in header order', () => {
    expect(DEPLOYMENT_LOG_HEADER).toBe('deploy_id,operator,environment,git_sha,timestamp,status,version');
    expect(formatCsvRow(entry)).toBe(
      `staging-20260925-123456,Ada Lovelace,staging,${'a'.repeat(40)},2026-09-25T12:34:56.000Z,success,v1.2.0`,
    );
  });

  it('TC-V05 quotes and escapes an operator name with a comma and quotes', () => {
    const row = formatCsvRow({ ...entry, operator: 'Doe, "J"' });
    expect(row.split(',').slice(0, 1)).toEqual(['staging-20260925-123456']);
    expect(row).toContain(',"Doe, ""J""",staging,');
  });

  it('quotes fields containing line breaks', () => {
    expect(formatCsvRow({ ...entry, operator: 'a\nb' })).toContain(',"a\nb",');
  });
});

describe('deployTagName', () => {
  it('is deploy/<env>/YYYYMMDD-HHMMSS in UTC', () => {
    expect(deployTagName('production', '2026-01-02T03:04:05.678Z')).toBe('deploy/production/20260102-030405');
  });
});
