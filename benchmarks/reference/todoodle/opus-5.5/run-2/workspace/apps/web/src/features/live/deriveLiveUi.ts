import type { SocketStatus } from './LiveConnection';
import type { NetworkStatus } from './network';

export type LiveUi = { pill: boolean; banner: boolean; canEdit: boolean };

/**
 * What the live state means on screen. Offline (saves can't reach Todoodle) shows the banner and
 * turns editing off; a socket that has been down for a while only shows the Reconnecting pill.
 * Losing only the socket never disables editing.
 */
export function deriveLiveUi(socket: SocketStatus, pausedLong: boolean, network: NetworkStatus): LiveUi {
  const banner = network === 'offline';
  return {
    banner,
    pill: !banner && pausedLong && (socket === 'connecting' || socket === 'reconnecting'),
    canEdit: network === 'online' && socket !== 'not_found',
  };
}
