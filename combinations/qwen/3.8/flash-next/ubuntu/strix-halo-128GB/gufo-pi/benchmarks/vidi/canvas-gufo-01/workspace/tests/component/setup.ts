import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Clipboard mocks are installed per-test; make sure none leaks.
  const clipboard = (navigator as unknown as { clipboard?: Clipboard }).clipboard;
  if (clipboard) delete (navigator as unknown as Record<string, unknown>)['clipboard'];
});
