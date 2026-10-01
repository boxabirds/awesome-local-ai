import { describe, it, expect, vi, beforeEach } from 'vitest';

// We use vi.hoisted to make the provider class and ref available after hoisting
const { MockProvider, getProvider } = vi.hoisted(() => {
  let lastProvider: any = null;

  class MockProviderImpl {
    wsconnected = false;
    synced = false;
    private listeners: Map<string, Function[]> = new Map();

    constructor(_url: string, _room: string, _doc: unknown, _opts?: unknown) {
      lastProvider = this;
    }

    destroy() {}

    on(event: string, fn: Function) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(fn);
    }

    off(event: string, fn: Function) {
      const arr = this.listeners.get(event);
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }

    emit(event: string, ...args: unknown[]) {
      const arr = this.listeners.get(event) ?? [];
      for (const fn of [...arr]) fn(...args);
    }

    // Test helpers
    simulateStatus(status: 'connecting' | 'connected' | 'disconnected') {
      this.wsconnected = status === 'connected';
      this.emit('status', { status });
    }

    simulateSync(synced: boolean) {
      this.synced = synced;
      this.emit('sync', synced);
    }

    simulateConnectionClose(code: number) {
      this.emit('connection-close', { code }, this);
    }
  }

  return {
    MockProvider: MockProviderImpl,
    getProvider: () => lastProvider,
  };
});

vi.mock('y-websocket', () => ({
  WebsocketProvider: MockProvider,
}));

// Mock location
Object.defineProperty(globalThis, 'location', {
  value: { protocol: 'http:', host: 'localhost:8787' },
  writable: true,
});

import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';

describe('TC-28: Close-code mapping via fake provider', () => {
  let states: ConnectionState[];

  beforeEach(() => {
    states = [];
  });

  it('close code 4500 → load_failed', () => {
    const handle = connectBoard({} as any, 'test-board', (s) => states.push(s));
    const provider = getProvider();
    expect(provider).not.toBeNull();

    // Simulate connected, then close with 4500
    provider.simulateStatus('connected');
    provider.simulateSync(true);
    states = []; // Reset

    provider.simulateConnectionClose(CLOSE_BOARD_LOAD_FAILED);
    expect(states).toContain('load_failed');
    handle.destroy();
  });

  it('close code 1011 (CLOSE_STORAGE_FAILURE) → reconnecting (not load_failed)', () => {
    const handle = connectBoard({} as any, 'test-board-2', (s) => states.push(s));
    const provider = getProvider();

    // Simulate connected then disconnected with 1011
    provider.simulateStatus('connected');
    provider.simulateSync(true);
    states = [];

    provider.simulateConnectionClose(CLOSE_STORAGE_FAILURE);
    provider.simulateStatus('disconnected');
    expect(states).toContain('reconnecting');
    expect(states).not.toContain('load_failed');
    handle.destroy();
  });

  it('close code 1003 (CLOSE_UNSUPPORTED_DATA) → reconnecting', () => {
    const handle = connectBoard({} as any, 'test-board-3', (s) => states.push(s));
    const provider = getProvider();

    provider.simulateStatus('connected');
    provider.simulateSync(true);
    states = [];

    provider.simulateConnectionClose(CLOSE_UNSUPPORTED_DATA);
    provider.simulateStatus('disconnected');
    expect(states).toContain('reconnecting');
    expect(states).not.toContain('load_failed');
    handle.destroy();
  });

  it('sync after load_failed → connected (recovery)', () => {
    const handle = connectBoard({} as any, 'test-board-4', (s) => states.push(s));
    const provider = getProvider();

    // Enter load_failed
    provider.simulateStatus('connected');
    provider.simulateSync(true);
    states = [];

    provider.simulateConnectionClose(CLOSE_BOARD_LOAD_FAILED);
    expect(states).toContain('load_failed');

    // Now simulate reconnection and sync (recovery)
    states = [];
    provider.simulateStatus('connected');
    provider.simulateSync(true);
    expect(states).toContain('connected');
    expect(states).not.toContain('load_failed');
    handle.destroy();
  });

  it('first sync transitions to connected', () => {
    const handle = connectBoard({} as any, 'test-board-5', (s) => states.push(s));
    const provider = getProvider();

    // Provider emits connecting
    provider.simulateStatus('connecting');
    provider.simulateStatus('connected');
    provider.simulateSync(true);

    expect(states).toContain('connected');
    handle.destroy();
  });
});
