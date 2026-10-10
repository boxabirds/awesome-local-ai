import type { BoardProvider, ProviderStatus } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';

/**
 * A room connection a test controls completely.
 *
 * `refuseToLoad()` puts the board in `load_failed` (story 4, and story 7's
 * TC-25: a board nobody was given cannot be transformed); `serves()` brings the
 * same page back to life. Nothing is contacted, so a component run never opens a
 * socket.
 */
export class FakeBoardProvider implements BoardProvider {
  private statusHandlers: ((event: { status: ProviderStatus }) => void)[] = [];
  private syncHandlers: ((synced: boolean) => void)[] = [];
  private closeHandlers: ((event: { code: number } | null) => void)[] = [];

  on(name: 'status', handler: (event: { status: ProviderStatus }) => void): void;
  on(name: 'sync', handler: (synced: boolean) => void): void;
  on(name: 'connection-close', handler: (event: { code: number } | null) => void): void;
  on(
    name: 'status' | 'sync' | 'connection-close',
    handler:
      | ((event: { status: ProviderStatus }) => void)
      | ((synced: boolean) => void)
      | ((event: { code: number } | null) => void),
  ): void {
    if (name === 'status') {
      this.statusHandlers.push(handler as (event: { status: ProviderStatus }) => void);
    } else if (name === 'sync') {
      this.syncHandlers.push(handler as (synced: boolean) => void);
    } else {
      this.closeHandlers.push(handler as (event: { code: number } | null) => void);
    }
  }

  /** The room refused to load this board. */
  refuseToLoad(): void {
    for (const handler of this.statusHandlers) {
      handler({ status: 'connecting' });
    }
    for (const handler of this.closeHandlers) {
      handler({ code: CLOSE_BOARD_LOAD_FAILED });
    }
  }

  /** The room answered and synced. */
  serves(): void {
    for (const handler of this.statusHandlers) {
      handler({ status: 'connecting' });
      handler({ status: 'connected' });
    }
    for (const handler of this.syncHandlers) {
      handler(true);
    }
  }

  destroy(): void {}

  /**
   * The link that once answered is down. `connectBoard` turns this into
   * `reconnecting`: the board stays open and editable, and the provider is already
   * retrying with exponential backoff (story 3, TC-20).
   */
  drops(): void {
    for (const handler of this.statusHandlers) {
      handler({ status: 'disconnected' });
    }
  }
}
