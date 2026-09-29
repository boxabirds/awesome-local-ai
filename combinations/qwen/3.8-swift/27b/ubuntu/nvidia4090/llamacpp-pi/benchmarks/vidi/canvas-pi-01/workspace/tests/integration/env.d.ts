// Type the test pool's `env` with the worker's Env (BOARD_ROOM + ASSETS).
import type { Env } from '../../src/worker/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
