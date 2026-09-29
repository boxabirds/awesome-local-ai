import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  // Clear the test-only camera hook between tests.
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});
