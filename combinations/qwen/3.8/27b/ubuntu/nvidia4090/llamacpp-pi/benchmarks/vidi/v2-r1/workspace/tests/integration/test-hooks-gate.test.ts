// Story 4, task 9 "done when": the test hook routes must not exist when
// TEST_HOOKS is not set (the production wrangler.jsonc never sets it).
// Requests to /__test/boards/:id/:op then fall through to the asset server
// (SPA fallback) and never reach the Durable Object.

import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { TEST_HOOK_OPS } from '../../src/worker/test-hooks';

describe('test hook routes are gated (production build lacks them)', () => {
  for (const op of TEST_HOOK_OPS) {
    it(`POST /__test/boards/<valid>/${op} without TEST_HOOKS serves the SPA, not the hook`, async () => {
      const boardId = newBoardId();
      const res = await SELF.fetch(`http://127.0.0.1/__test/boards/${boardId}/${op}`, {
        method: 'POST',
        body: new Uint8Array([0, 0]),
      });
      // The asset server answers (405/404 for a POST to a non-asset route),
      // never the hook's JSON.
      expect([404, 405]).toContain(res.status);
      const text = await res.text();
      expect(text).not.toContain('"ok"');
    });
  }
});
