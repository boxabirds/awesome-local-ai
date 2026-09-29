// Story 3 — connection status badge + reconnect catch-up, over real WebSockets
// served by `wrangler dev` (nightly config). Outages use context.setOffline(),
// which y-websocket observes as a socket close and then reconnects.
import { test, expect } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config.ts';
import {
  notes,
  firstNote,
  createNoteAt,
  pasteIntoEditor,
  resetCam,
  setCamera,
} from './helpers/sticky.ts';
import { openBoard, newCollaborator, getConnectionState, connectionBadge, goOffline, goOnline } from './helpers/room.ts';

// Reconnect + catch-up may wait on backoff (bounded) + sync + the confirmation
// window, so the budget covers all of those.
const RECONNECT_BUDGET =
  RECONNECT_MAX_BACKOFF_MS + LIVE_UPDATE_LATENCY_BUDGET_MS + CONNECTED_CONFIRMATION_MS + 3000;

test('TC-28 an offline board shows the Reconnecting badge', async ({ browser }) => {
  const id = newBoardId();
  const alex = await newCollaborator(browser);
  await openBoard(alex, id);

  // Reach the steady 'connected' state first (badge hidden).
  await expect
    .poll(() => getConnectionState(alex), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3 })
    .toBe('connected');
  await expect(connectionBadge(alex)).toHaveCount(0);

  await goOffline(alex);
  await expect(connectionBadge(alex)).toContainText('Reconnecting', {
    timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3,
  });
});

test('TC-29 edits made during an outage catch up on reconnect', async ({ browser }) => {
  const id = newBoardId();
  const alex = await newCollaborator(browser);
  const sam = await newCollaborator(browser);
  await openBoard(alex, id);
  await openBoard(sam, id);
  await setCamera(alex, resetCam());
  await setCamera(sam, resetCam());
  await expect
    .poll(() => getConnectionState(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3 })
    .toBe('connected');

  // Sam drops offline for the outage window; Alex keeps editing.
  await goOffline(sam);
  await expect
    .poll(() => getConnectionState(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3 })
    .toBe('reconnecting');

  for (let i = 0; i < 5; i++) {
    await createNoteAt(alex, 300 + i * 130, 300);
    await pasteIntoEditor(alex, `note ${i}`);
    await alex.keyboard.press('Escape');
  }
  await expect(notes(alex)).toHaveCount(5);

  // The link returns within the outage window: Sam catches up and the badge clears.
  await goOnline(sam);
  await expect(notes(sam)).toHaveCount(5, { timeout: CATCH_UP_TEST_OUTAGE_MS + RECONNECT_BUDGET });
  await expect
    .poll(() => getConnectionState(sam), { timeout: RECONNECT_BUDGET })
    .toBe('connected');
  await expect(connectionBadge(sam)).toHaveCount(0);
});

test('TC-30 a quick offline/online toggle recovers and keeps streaming', async ({ browser }) => {
  const id = newBoardId();
  const alex = await newCollaborator(browser);
  const sam = await newCollaborator(browser);
  await openBoard(alex, id);
  await openBoard(sam, id);
  await setCamera(alex, resetCam());
  await setCamera(sam, resetCam());
  await expect
    .poll(() => getConnectionState(alex), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3 })
    .toBe('connected');

  // A brief blip: down then straight back up.
  await goOffline(alex);
  await goOnline(alex);

  await expect
    .poll(() => getConnectionState(alex), { timeout: RECONNECT_BUDGET })
    .toBe('connected');

  // Live updates still stream afterwards.
  await createNoteAt(sam, 500, 300);
  await pasteIntoEditor(sam, 'after blip');
  await sam.keyboard.press('Escape');
  await expect(notes(alex)).toHaveCount(1, { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 5 });
  await expect(firstNote(alex)).toContainText('after blip');
});
