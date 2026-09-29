import { test } from '@playwright/test';
import { longAnnotationWraps } from './participants';

/**
 * Story 9, TC-26 cross-browser: the 300-character annotation must cap at
 * TEXT_MAX_AUTO_WIDTH_WORLD (±2 units) and render several wrapped lines in
 * firefox and webkit as well (per the tasks, wrapping differences between
 * engines stay within the ±2 tolerance). This spec is targeted by the
 * firefox and webkit playwright projects and also runs in chromium.
 */
test.describe('Text: long-annotation wrapping (cross-browser)', () => {
  test('TC-26: 300-character annotation caps at 600 and wraps to several lines', async ({ page }) => {
    await longAnnotationWraps(page);
  });
});
