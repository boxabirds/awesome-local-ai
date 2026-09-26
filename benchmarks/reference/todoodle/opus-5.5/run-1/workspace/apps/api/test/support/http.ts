import { CONTENT_SECURITY_POLICY } from '../../src/middleware/security-headers.ts';
import { expect } from 'vitest';

export const ORIGIN = 'https://todoodle.test';
export const CLIENT = { 'X-Todoodle-Client': 'web' } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function url(path: string): string {
  return new URL(path, ORIGIN).toString();
}

export function expectBaselineHeaders(res: Response) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('X-Request-Id')).toMatch(UUID);
}

/** A throwaway table for proving storage isolation and reset behaviour. Story 1 owns no real tables. */
export const SCRATCH_TABLE = 'test_scratch';

export async function createScratchRows(db: D1Database, count: number) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${SCRATCH_TABLE} (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`).run();
  for (let i = 0; i < count; i++) {
    await db.prepare(`INSERT INTO ${SCRATCH_TABLE} (label) VALUES (?)`).bind(`row ${i}`).run();
  }
}

export async function countScratchRows(db: D1Database): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${SCRATCH_TABLE}`).first<{ n: number }>();
  return row?.n ?? 0;
}
