import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

afterEach(cleanup);

/**
 * jsdom has no canvas, and says so loudly on every `getContext` call.
 *
 * The board measures text with a 2D context (`textLayout`) and falls back to estimating
 * from the font size when there is not one — which is the honest answer in jsdom, where
 * there is no font to measure either. Stubbing it to `null` takes that path on purpose
 * instead of by exception, and keeps the "not implemented" noise out of every run.
 */
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});
