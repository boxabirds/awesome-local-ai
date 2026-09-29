import { act } from '@testing-library/react';
import type { SyncProviderEvents } from '../../src/client/sync/connectBoard';

export type Status = 'connected' | 'disconnected' | 'connecting';
type CloseEvent = { code: number } | null;

/** Stands in for WebsocketProvider: emits the same `status`, `sync` and `connection-close` events. */
export class FakeProvider implements SyncProviderEvents {
  private statusFns: Array<(e: { status: Status }) => void> = [];
  private syncFns: Array<(s: boolean) => void> = [];
  private closeFns: Array<(e: CloseEvent) => void> = [];
  on(event: 'status', fn: (e: { status: Status }) => void): void;
  on(event: 'sync', fn: (s: boolean) => void): void;
  on(event: 'connection-close', fn: (e: CloseEvent) => void): void;
  on(event: 'status' | 'sync' | 'connection-close', fn: (arg: never) => void) {
    if (event === 'status') this.statusFns.push(fn as (e: { status: Status }) => void);
    else if (event === 'sync') this.syncFns.push(fn as (s: boolean) => void);
    else this.closeFns.push(fn as (e: CloseEvent) => void);
  }
  status(status: Status) {
    act(() => this.statusFns.forEach((f) => f({ status })));
  }
  sync(synced: boolean) {
    act(() => this.syncFns.forEach((f) => f(synced)));
  }
  /** What y-websocket does on a successful (re)connection. */
  connect() {
    this.status('connected');
    this.sync(true);
  }
  drop() {
    this.sync(false);
    this.status('disconnected');
    this.status('connecting');
  }
  /** The server accepts the socket, then closes it with `code` (y-websocket's event order). */
  closedByServer(code: number) {
    this.status('connected');
    act(() => this.closeFns.forEach((f) => f({ code })));
    this.sync(false);
    this.status('disconnected');
    this.status('connecting');
  }
}
