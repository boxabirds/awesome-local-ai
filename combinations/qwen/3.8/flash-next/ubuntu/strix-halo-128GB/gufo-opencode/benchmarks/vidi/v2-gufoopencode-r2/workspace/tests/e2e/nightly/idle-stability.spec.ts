// Nightly TC-29 (task 9): idle connections must never flap.

import { test, expect } from '@playwright/test';
import {
  closeParticipants,
  connectionState,
  installRecorder,
  openParticipants,
  readRecorder,
} from '../helpers/participants';

const IDLE_MS = 45_000;

test('TC-29: two idle contexts stay connected for 45s; badge never shows Reconnecting', async ({
  browser,
}) => {
  const parties = await openParticipants(browser, ['Idle-A', 'Idle-B']);
  const consoleErrors: string[] = [];
  for (const p of parties) {
    p.page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`${p.name}: ${msg.text()}`);
    });
    p.page.on('pageerror', (err) => consoleErrors.push(`${p.name}: ${String(err)}`));
    await installRecorder(p.page);
  }
  try {
    await parties[0].page.waitForTimeout(IDLE_MS);
    for (const p of parties) {
      const rec = await readRecorder(p.page);
      expect(rec.states, `${p.name} connection states during idle`).toEqual(['connected']);
      expect(
        rec.badges.filter((b) => b.includes('Reconnecting')),
        `${p.name} badge never renders Reconnecting while idle`,
      ).toEqual([]);
      expect(await connectionState(p.page)).toBe('connected');
    }
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeParticipants(parties);
  }
});
