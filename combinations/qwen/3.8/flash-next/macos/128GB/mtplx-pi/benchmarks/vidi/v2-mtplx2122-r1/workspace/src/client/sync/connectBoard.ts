/**
 * Client connection to a board room (capability `sync.client`).
 *
 * The provider is a plain `ProviderLike` from the outside: `connectBoard` only
 * listens to `status` / `sync` / `connection-error` events and maps them onto
 * the four `ConnectionState` values the badge renders.  Component tests inject a
 * fake emitter instead of a real `WebsocketProvider`, and drive the confirmation
 * window with fake timers.
 */

import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { CONNECTED_CONFIRMATION_MS, RECONNECT_MAX_BACKOFF_MS } from '../../shared/config'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed'

/** The parts of `WebsocketProvider` that `connectBoard` relies on. */
export interface ProviderLike {
  synced?: boolean
  on(event: string, handler: (...args: any[]) => void): void
  off?(event: string, handler: (...args: any[]) => void): void
  disconnect?(): void
  destroy?(): void
}

export interface BoardConnection {
  /** Current state; changes are also reported through `onState`. */
  getState(): ConnectionState
  destroy(): void
}

export interface ConnectBoardOptions {
  /** Test seam: pass a fake provider emitting `status` / `sync` events. */
  provider?: ProviderLike
  /** `scheme://host/api/rooms`; defaults to the page's own origin. */
  serverUri?: string
}

export const ROOM_PATH = '/api/rooms'

/** WebSocket endpoint base for a page: `wss://host/api/rooms`. */
export function roomServerUri(locationLike: { protocol: string; host: string } = window.location): string {
  const scheme = locationLike.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${locationLike.host}${ROOM_PATH}`
}

/**
 * Attach `doc` to the room named `boardId`.
 *
 * State mapping (design `sync.client`):
 * - before the first sync: `connecting` (badge: "Connecting…");
 * - first sync: `connected` (badge hidden);
 * - `disconnected` / `sync(false)` after having synced: `reconnecting`
 *   (badge: amber "Reconnecting…");
 * - a re-sync after `reconnecting`: `confirmed` for
 *   {@link CONNECTED_CONFIRMATION_MS} (badge: green "Connected"), then
 *   `connected` so the badge disappears.
 */
export function connectBoard(
  doc: Y.Doc,
  boardId: string,
  onState: (state: ConnectionState) => void,
  options: ConnectBoardOptions = {},
): BoardConnection {
  const provider =
    options.provider ??
    new WebsocketProvider(options.serverUri ?? roomServerUri(), boardId, doc, {
      maxBackoffTime: RECONNECT_MAX_BACKOFF_MS,
      disableBc: true,
    })

  let state: ConnectionState = 'connecting'
  let synced = provider.synced === true
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const set = (next: ConnectionState) => {
    if (state === next) return
    if (next === 'reconnecting') clearTimer()
    state = next
    onState(next)
  }

  const handleSync = (isSynced: boolean) => {
    if (isSynced) {
      const hadSyncedBefore = synced
      synced = true
      if (hadSyncedBefore) {
        // Re-sync after an outage: show the confirmation badge for a moment.
        set('confirmed')
        clearTimer()
        timer = setTimeout(() => set('connected'), CONNECTED_CONFIRMATION_MS)
      } else {
        set('connected')
      }
    } else if (synced) {
      set('reconnecting')
    }
  }

  const handleStatus = (event: unknown) => {
    const status = (event as { status?: string })?.status ?? event
    if (status === 'disconnected' || status === 'connectionError' || status === 'connection-error') {
      if (synced) set('reconnecting')
    }
  }

  provider.on('sync', handleSync)
  provider.on('status', handleStatus)
  provider.on('connection-error', handleStatus)

  return {
    getState: () => state,
    destroy: () => {
      clearTimer()
      provider.off?.('sync', handleSync)
      provider.off?.('status', handleStatus)
      provider.off?.('connection-error', handleStatus)
      provider.destroy?.()
    },
  }
}