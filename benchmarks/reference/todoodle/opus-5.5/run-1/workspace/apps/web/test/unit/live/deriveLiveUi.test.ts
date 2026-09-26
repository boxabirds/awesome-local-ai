import { describe, expect, it } from 'vitest';
import { deriveLiveUi } from '@/features/live/deriveLiveUi';
import type { NetworkStatus, SocketStatus } from '@/features/live/LiveConnection';

type Row = [ref: string, socket: SocketStatus, pausedLong: boolean, network: NetworkStatus, pill: boolean, banner: boolean, canEdit: boolean];

// D4 x D5: {connecting-short, open, reconnecting-short, paused-long, not_found} x {online, offline}.
const MATRIX: Row[] = [
  ['TC-M01 connecting-short, online', 'connecting', false, 'online', false, false, true],
  ['TC-M02 open, online', 'open', false, 'online', false, false, true],
  ['TC-M03 reconnecting-short, online', 'reconnecting', false, 'online', false, false, true],
  ['TC-M04 paused-long, online', 'reconnecting', true, 'online', true, false, true],
  ['TC-M05 not_found, online', 'not_found', false, 'online', false, false, false],
  ['TC-M06 connecting-short, offline', 'connecting', false, 'offline', false, true, false],
  ['TC-M07 open, offline', 'open', false, 'offline', false, true, false],
  ['TC-M08 reconnecting-short, offline', 'reconnecting', false, 'offline', false, true, false],
  ['TC-M09 paused-long, offline (banner takes precedence)', 'reconnecting', true, 'offline', false, true, false],
  ['TC-M10 not_found, offline', 'not_found', false, 'offline', false, true, false],
];

describe('live.connection_status: deriveLiveUi', () => {
  it.each(MATRIX)('%s', (_ref, socket, pausedLong, network, pill, banner, canEdit) => {
    expect(deriveLiveUi(socket, pausedLong, network)).toEqual({ pill, banner, canEdit });
  });

  it('paused-long while still connecting (never opened) also shows the pill', () => {
    expect(deriveLiveUi('connecting', true, 'online')).toEqual({ pill: true, banner: false, canEdit: true });
  });
});
