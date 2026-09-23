import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement pointer capture; tests install their own stubs.
afterEach(() => {
  cleanup();
});
