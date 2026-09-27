import { buildHealth } from '@todoodle/shared/health';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { errorResponse } from '../lib/errors';

export { buildHealth, type Health } from '@todoodle/shared/health';

/** Mounted at both /health and /api/health. Never touches D1 (must answer during migrations). */
export const health = new Hono<AppEnv>();
health.get('/', (c) => c.json(buildHealth(c.env)));
health.all('/', () => errorResponse('method_not_allowed', 405));
