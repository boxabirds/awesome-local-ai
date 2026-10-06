/**
 * A provider that emits what a network would, when the test says so.
 *
 * The events a real `WebsocketProvider` emits come from a socket, at the pace of a network:
 * a test that wants "the room closed us with 4500", or "the line came back for half a second
 * and went again", has to be the one making those things happen. This is that fake — story 3
 * used it for the confirmation window, story 4 for the close codes.
 *
 * It is deliberately a *recorder* as well as a source: `listening` and `statusRegistrations`
 * are how the tests say a connection was registered once and unregistered on the way out,
 * which is the kind of thing that leaks a socket per keystroke.
 */

import type { BoardProvider, ProviderStatus } from '../../../src/client/board/connection';

/** A close code, or null for a connection we closed ourselves and that never reported one. */
export type CloseCode = number | null;

export class FakeProvider implements BoardProvider {
  private statuses: Array<(status: ProviderStatus) => void> = [];
  private syncs: Array<(synced: boolean) => void> = [];
  private closes: Array<(code: CloseCode) => void> = [];
  /** Every field the board published on awareness, in order. */
  readonly published: Array<{ field: string; value: unknown }> = [];
  /** How many times a status listener was registered — once, or something is wrong. */
  statusRegistrations = 0;
  /** Every close code the board was told about, in order. */
  readonly closesSeen: CloseCode[] = [];
  destroyed = false;

  readonly awareness = {
    setLocalStateField: (field: string, value: unknown): void => {
      this.published.push({ field, value });
    },
  };

  onStatus(handler: (status: ProviderStatus) => void): void {
    this.statusRegistrations += 1;
    this.statuses.push(handler);
  }

  offStatus(handler: (status: ProviderStatus) => void): void {
    this.statuses = this.statuses.filter((registered) => registered !== handler);
  }

  onSync(handler: (synced: boolean) => void): void {
    this.syncs.push(handler);
  }

  offSync(handler: (synced: boolean) => void): void {
    this.syncs = this.syncs.filter((registered) => registered !== handler);
  }

  onClose(handler: (code: CloseCode) => void): void {
    this.closes.push(handler);
  }

  offClose(handler: (code: CloseCode) => void): void {
    this.closes = this.closes.filter((registered) => registered !== handler);
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitStatus(status: ProviderStatus): void {
    for (const handler of [...this.statuses]) handler(status);
  }

  emitSync(synced: boolean): void {
    for (const handler of [...this.syncs]) handler(synced);
  }

  /**
   * The socket closed, with the code the room chose. `isError` is what y-websocket calls a
   * close that came from the network rather than from us; it is the badge's business only
   * through the code, so it is not modelled here.
   */
  emitClose(code: CloseCode): void {
    this.closesSeen.push(code);
    for (const handler of [...this.closes]) handler(code);
  }

  /**
   * A connection that worked: the room was reached and the board came across. This is the
   * order the real provider emits in, and the order the badge's memory of it depends on.
   */
  async connect(): Promise<void> {
    this.emitStatus('connected');
    this.emitSync(true);
  }

  /** Still listening? A torn-down connection must not be left holding anything. */
  get listening(): boolean {
    return this.statuses.length > 0 || this.syncs.length > 0 || this.closes.length > 0;
  }
}
