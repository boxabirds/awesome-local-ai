import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';

/**
 * Story 3's named product settings. The capacity constraint (PRD live.capacity:
 * "the simultaneous-editor capacity is a single named product setting; changing
 * it must not require redesign, and tests must use that setting rather than a
 * hard-coded number") lives here; every test reads these values.
 */
describe('live collaboration settings', () => {
  it('states the soft capacity and the latency budget', () => {
    expect(MAX_CONCURRENT_EDITORS).toBe(5);
    expect(LIVE_UPDATE_LATENCY_BUDGET_MS).toBe(1000);
  });

  it('states the connection timing', () => {
    expect(RECONNECT_MAX_BACKOFF_MS).toBe(10_000);
    expect(CONNECTED_CONFIRMATION_MS).toBe(2000);
    expect(CATCH_UP_TEST_OUTAGE_MS).toBe(30_000);
    expect(E2E_EVENTUAL_TIMEOUT_MS).toBeGreaterThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
  });
});
