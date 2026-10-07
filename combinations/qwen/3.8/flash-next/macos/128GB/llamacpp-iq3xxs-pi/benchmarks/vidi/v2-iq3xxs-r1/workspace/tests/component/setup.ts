import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Enable React's act() environment so act() works outside RTL's auto-wrappers.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());
