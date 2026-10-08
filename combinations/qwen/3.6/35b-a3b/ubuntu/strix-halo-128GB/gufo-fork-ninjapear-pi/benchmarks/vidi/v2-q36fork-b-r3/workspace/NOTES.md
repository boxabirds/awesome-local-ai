# NOTES.md — Story 4: Unavailable functionality

## Blocked Tasks (No Browser/Playwright Infrastructure)

### Task 6: E2E persistence across real process restarts (TC-19 to TC-21)
**Why blocked:** Requires Chromium browser and Playwright test runner to verify end-to-end board persistence in a real browser context. The CI agent environment does not have a display server or browser installed.

**Test cases requiring browser:**
- TC-19 "Overnight return": Create notes, close browser, restart process, reopen → verify notes identical
- TC-20 "Leave immediately": Create note, kill both contexts, restart → verify note persists
- TC-21 "Big board open": Seed large board, verify all elements render within budget time

**How to run when available:** `npm run test:e2e` in a headful/headless Chromium environment with Workers deployed.

### Task 9: E2E broken board honest failure (TC-24)
**Why blocked:** Requires Chromium browser + Playwright to verify the full user flow of encountering a corrupt board, seeing the red error message, and recovering after repair via test hook.

**Test workflow requires:**
1. Browser interaction to create and compact a board
2. Calling `POST /__test/boards/:id/corrupt-snapshot` test hook
3. Verifying red banner UI rendering
4. Calling `POST /__test/boards/:id/repair` to restore
5. Verifying recovery without page reload

**Note:** Test hooks (`/__test/*`) must only be exposed when `env.TEST_HOOKS === '1'`, never in production config.

## Miniflare SQLite Limitation
The Cloudflare Durable Object SQLite extension is only available in production Workers deployments. In `wrangler dev` / Miniflare, BoardStore detects missing SQL ops and operates in no-op mode. This allows integration tests to validate room state machine behavior but skips actual data persistence verification. 

Full persistence validation requires deployment to Cloudflare Workers with KV/SQlite support enabled, or testing against a local workerd build with SQLite compiled in.
