import type { NetworkStatus, SocketStatus } from './LiveConnection';

export type LiveUi = {
  /** "You're offline — changes can't be saved right now" */
  banner: boolean;
  /** "Reconnecting…" (never together with the banner) */
  pill: boolean;
  canEdit: boolean;
};

/**
 * The two independent states, combined. Losing only the live socket never disables editing
 * (prd.live_paused); editing stops only when saves can't reach Todoodle, or the workspace is gone.
 */
export function deriveLiveUi(socket: SocketStatus, pausedLong: boolean, network: NetworkStatus): LiveUi {
  const banner = network === 'offline';
  return {
    banner,
    pill: !banner && pausedLong,
    canEdit: network === 'online' && socket !== 'not_found',
  };
}
