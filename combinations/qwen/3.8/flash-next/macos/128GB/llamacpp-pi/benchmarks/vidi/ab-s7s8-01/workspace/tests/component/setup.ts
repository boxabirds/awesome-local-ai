import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearFrames, installFrameQueue } from './harness';

// Deterministic animation frames: see harness.ts. Installed before any test runs,
// so the gesture's and the marquee's frame-coalesced writes only happen when a test
// calls flushFrame().
installFrameQueue();

afterEach(() => {
  cleanup();
  clearFrames();
  // Clear the test-only camera hook between tests.
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});
