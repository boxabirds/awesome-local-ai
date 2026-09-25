/** Fake y-websocket provider for component tests: the test emits the events a real one would. */
import { act } from '@testing-library/react';
import type { ProviderFactory, SyncProvider } from '../../src/client/sync/connectBoard';

type Status = 'connected' | 'disconnected' | 'connecting';
type CloseEvent = { code: number } | null;

export class FakeProvider implements SyncProvider {
  private readonly handlers = {
    status: [] as ((e: { status: Status }) => void)[],
    sync: [] as ((s: boolean) => void)[],
    'connection-close': [] as ((e: CloseEvent) => void)[],
  };
  destroyed = false;
  constructor(
    readonly url: string,
    readonly boardId: string,
  ) {}
  on(event: 'status' | 'sync' | 'connection-close', handler: never): void {
    (this.handlers[event] as unknown[]).push(handler);
  }
  status(status: Status): void {
    act(() => this.handlers.status.forEach((h) => h({ status })));
  }
  sync(synced: boolean): void {
    act(() => this.handlers.sync.forEach((h) => h(synced)));
  }
  /** What y-websocket emits when a socket opens and completes the sync handshake. */
  open(): void {
    this.status('connecting');
    this.status('connected');
    this.sync(true);
  }
  /** What y-websocket emits when an open socket closes (optionally with a server close code). */
  drop(code?: number): void {
    if (code !== undefined) act(() => this.handlers['connection-close'].forEach((h) => h({ code })));
    this.status('disconnected');
    this.sync(false);
  }
  /** The server accepts the socket and closes it straight away with `code`. */
  refuse(code: number): void {
    this.status('connecting');
    this.status('connected');
    this.drop(code);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

/** A provider factory that records every provider it creates. */
export function fakeProviders(): { createProvider: ProviderFactory; provider(): FakeProvider; reset(): void } {
  let providers: FakeProvider[] = [];
  return {
    createProvider: (url, boardId) => {
      const p = new FakeProvider(url, boardId);
      providers.push(p);
      return p;
    },
    provider() {
      const p = providers.filter((x) => !x.destroyed).at(-1);
      if (p === undefined) throw new Error('no live provider');
      return p;
    },
    reset() {
      providers = [];
    },
  };
}
