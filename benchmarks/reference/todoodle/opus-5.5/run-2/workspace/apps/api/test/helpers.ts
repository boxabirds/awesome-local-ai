import { env } from 'cloudflare:test';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@todoodle/shared/limits';

export const ORIGIN = 'https://todoodle.test';
export const CLIENT_HEADERS = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };

export const BASELINE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const SCRATCH_TABLE = 'scratch_items';

export async function createScratchRows(count: number) {
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS ${SCRATCH_TABLE} (id INTEGER PRIMARY KEY, label TEXT)`);
  const insert = env.DB.prepare(`INSERT INTO ${SCRATCH_TABLE} (label) VALUES (?)`);
  await env.DB.batch(Array.from({ length: count }, (_, i) => insert.bind(`row ${i + 1}`)));
}

export async function countScratchRows(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${SCRATCH_TABLE}`).first<{ n: number }>();
  return row?.n ?? 0;
}
