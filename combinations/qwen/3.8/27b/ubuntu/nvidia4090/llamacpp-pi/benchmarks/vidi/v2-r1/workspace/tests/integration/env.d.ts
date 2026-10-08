// Type declarations for the cloudflare:test module used in integration tests.
/// <reference types="@cloudflare/vitest-pool-workers" />

import type { BoardRoom } from '../../src/worker/board-room';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
    ASSETS: Fetcher;
    /** Story 12: stored images (assets.api). */
    ASSETS_BUCKET: R2Bucket;
    TEST_HOOKS?: string;
  }
}
