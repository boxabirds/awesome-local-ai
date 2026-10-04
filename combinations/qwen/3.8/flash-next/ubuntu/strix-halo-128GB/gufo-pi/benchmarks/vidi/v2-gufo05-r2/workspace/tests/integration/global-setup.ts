/**
 * Boots the live `wrangler dev` server once for the whole `live` test project.
 * Tests isolate themselves from each other by using a fresh random board id, so
 * they never see another test's room.
 */

import { startLiveServer, stopLiveServer } from './helpers/live-server';

export async function setup(): Promise<void> {
  await startLiveServer();
}

export async function teardown(): Promise<void> {
  await stopLiveServer();
}
