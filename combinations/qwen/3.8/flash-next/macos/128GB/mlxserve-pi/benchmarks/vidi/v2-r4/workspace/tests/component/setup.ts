import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals here, so Testing Library's automatic cleanup does
// not register itself. Unmount between tests so each one gets a clean document.
afterEach(() => {
  cleanup();
});
