// Task 8 (story 4): the load-failure client state — TC-22 (red badge),
// TC-23 (every editing path is a no-op while load_failed) and TC-28 (close
// code mapping through the real connectBoard wiring, with recovery that
// needs no page reload). The y-websocket provider is mocked so tests deliver
// exactly the events a real socket would.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { snapshot } from '../../src/shared/board-model';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  createConnectionStateMapper,
  type ConnectionState,
} from '../../src/client/sync/connectBoard';
import {
  App,
  board,
  createNote,
  flush,
  keyDown,
  notes,
  noteEl,
  pressAndRelease,
} from './stickyHelpers';

vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    static instances: MockWebsocketProvider[] = [];
    private handlers = new Map<string, Set<(arg?: unknown) => void>>();
    awareness = { setLocalState: (_state: unknown) => undefined };

    constructor(_server: string, _room: string, _doc: unknown, _opts?: unknown) {
      MockWebsocketProvider.instances.push(this);
    }
    on(event: string, cb: (arg?: unknown) => void): void {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(cb);
    }
    off(event: string, cb: (arg?: unknown) => void): void {
      this.handlers.get(event)?.delete(cb);
    }
    emit(event: string, arg?: unknown): void {
      this.handlers.get(event)?.forEach((cb) => cb(arg));
    }
    destroy(): void {
      /* no-op */
    }
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

type MockProvider = { emit(event: string, arg?: unknown): void };

function lastProvider(): MockProvider {
  const instances = (WebsocketProvider as unknown as { instances: MockProvider[] }).instances;
  const provider = instances[instances.length - 1];
  if (!provider) throw new Error('no provider constructed');
  return provider;
}

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

// The zoom control also uses role=status; the connection badge is the one
// with the connection-status class.
function connectionBadge(): HTMLElement | null {
  return (
    screen
      .getAllByRole('status')
      .find((el) => el.className.startsWith('connection-status')) ?? null
  );
}

describe('Load-failure client state', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-22: load_failed renders a red role=status message', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent(LOAD_FAILED_TEXT);
    expect(badge.className).toContain('connection-status--load_failed');
    // The class must map to a red colour in the stylesheet.
    const css = readFileSync('src/client/styles.css', 'utf8');
    expect(css).toMatch(/\.connection-status--load_failed\s*\{[^}]*background:\s*#[cC]/);
  });

  it('TC-23: while load_failed, every editing path mutates nothing', () => {
    render(<App />);
    const provider = lastProvider();
    act(() => provider.emit('sync', true)); // reach connected
    const id = createNote(100, 100);
    pressAndRelease(noteEl(id)); // select the note (selection is not a mutation)
    const doc = board().doc;
    const before = JSON.stringify(snapshot(doc));

    let localMutations = 0;
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      void origin;
      localMutations += 1;
    });

    act(() => provider.emit('connection-close', { code: 4500 }));
    expect(connectionBadge()).not.toBeNull();
    expect(connectionBadge()!.textContent).toBe(LOAD_FAILED_TEXT);

    // 1. Sticky note button is disabled.
    const button = screen.getByTestId('create-sticky');
    expect(button).toBeDisabled();
    fireEvent.click(button);

    // 2. Double-click on the board creates nothing.
    fireEvent.dblClick(screen.getByTestId('board-grid'), { clientX: 400, clientY: 300 });

    // 3. Delete on the selected note is ignored.
    keyDown(window, 'Delete');

    // 4. Dragging the note moves nothing.
    const el = noteEl(id);
    fireEvent.pointerDown(el, { pointerId: 7, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(el, { pointerId: 7, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 7, clientX: 300, clientY: 300 });

    // 5. Double-clicking the note opens no editor and typing writes nothing.
    fireEvent.dblClick(el, { clientX: 150, clientY: 150 });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();

    flush();
    expect(localMutations).toBe(0);
    expect(JSON.stringify(notes())).toBe(before);
  });

  it('TC-28: close codes map through connectBoard; sync after load_failed recovers without reload', () => {
    render(<App />);
    const provider = lastProvider();
    act(() => provider.emit('sync', true)); // initial sync -> connected
    expect(connectionBadge()).toBeNull();

    // Storage failure (1011): readable board, keep editing, show reconnecting.
    act(() => provider.emit('connection-close', { code: 1011 }));
    expect(connectionBadge()?.textContent).toBe('Reconnecting…');
    expect(screen.getByTestId('create-sticky')).toBeEnabled();

    // Protocol failure (1003): same recoverable treatment.
    act(() => provider.emit('connection-close', { code: 1003 }));
    expect(connectionBadge()?.textContent).toBe('Reconnecting…');

    // Load failure (4500): red badge, editing locked.
    act(() => provider.emit('connection-close', { code: 4500 }));
    expect(connectionBadge()?.textContent).toBe(LOAD_FAILED_TEXT);
    expect(screen.getByTestId('create-sticky')).toBeDisabled();

    // A later retry that keeps being refused does not downgrade the badge.
    act(() => provider.emit('connection-close', { code: 1006 }));
    expect(connectionBadge()?.textContent).toBe(LOAD_FAILED_TEXT);

    // Recovery: the provider's next successful sync re-enables editing
    // in-place, no page reload.
    act(() => provider.emit('sync', true));
    expect(connectionBadge()).toBeNull();
    expect(screen.getByTestId('create-sticky')).toBeEnabled();
  });

  it('mapper stays load_failed across status noise and recovers on first sync', () => {
    const seen: ConnectionState[] = [];
    const mapper = createConnectionStateMapper((s) => seen.push(s));
    mapper.onSync(true);
    mapper.onClose(4500);
    mapper.onStatus('disconnected');
    mapper.onClose(1006);
    mapper.onSync(true);
    mapper.dispose();
    expect(seen).toEqual(['connected', 'load_failed', 'connected']);
  });
});
