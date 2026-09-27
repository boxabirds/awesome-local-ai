// Worker environment. Type-only module (no runtime imports) to avoid cycles.
import type { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  /** Cloudflare rate-limit binding: BOARD_CREATE_LIMIT requests per BOARD_CREATE_PERIOD_SECONDS per key */
  BOARD_CREATE_LIMITER: RateLimit;
  /** Set to "1" only in test environments; enables the seeded-legacy-board fixture route. */
  TEST_HOOKS?: string;
}
