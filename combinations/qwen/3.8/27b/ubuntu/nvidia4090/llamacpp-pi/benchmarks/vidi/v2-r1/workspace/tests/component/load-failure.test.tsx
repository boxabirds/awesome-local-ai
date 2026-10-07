// TC-22, TC-23, TC-28 (story 4): the client load-failure state.
//
// The y-websocket provider is mocked so tests can drive 'connection-close'
// and 'sync' events deterministically. TC-23 mounts the real <App /> to prove
// every edit path is a no-op while the board cannot be loaded.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { App, canEdit } from '../../src/client/App';
import {
  click,
  dragTo,
  flushRaf,
  hooks,
  note,
  noteText,
  pointerUp,
  addNote,
} from './helpers';

/**
 * A stand-in for WebsocketProvider: records `on()` handlers so tests can
 * emit 'connection-close', 'status' and 'sync' events on demand.
 */
const hoisted = vi.hoisted(() => {
  const instances: Array<{
    emitClose(code: number | null): void;
    emitStatus(status: string): void;
    emitSync(synced: boolean): void;
  }> = [];
  class FakeProvider {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    wsconnected = false;
    constructor(_url: string, _room: string, _doc: unknown, _opts: unknown) {
      instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    destroy() {}
    emitClose(code: number | null) {
      (this.handlers['connection-close'] ?? []).forEach((cb) =>
        cb(code === null ? null : { code, reason: '' }, this),
      );
    }
    emitStatus(status: string) {
      (this.handlers['status'] ?? []).forEach((cb) => cb({ status }, this));
    }
    emitSync(synced: boolean) {
      this.wsconnected = true;
      (this.handlers['sync'] ?? []).forEach((cb) => cb(synced, this));
    }
  }
  return { instances, FakeProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: hoisted.FakeProvider }));

function lastProvider() {
  return hoisted.instances[hoisted.instances.length - 1];
}

describe('story 4: client load-failure state', () => {
  it('TC-22: load_failed renders the red banner with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");
    expect(badge.className).toContain('load-failed');
    expect(badge).toHaveAttribute('aria-label', 'Board load failed');
  });

  it('TC-28: close-code mapping and recovery re-enable editing', () => {
    const doc = new Y.Doc();
    const states: ConnectionState[] = [];
    const handle = connectBoard(doc, 'board123', (s) => states.push(s));
    const provider = lastProvider();

    // 4500: the board cannot be loaded → load_failed, editing locked.
    act(() => provider.emitClose(4500));
    expect(states.at(-1)).toBe('load_failed');
    expect(canEdit('load_failed')).toBe(false);

    // Retry status events must not flicker the badge out of load_failed.
    act(() => provider.emitStatus('connecting'));
    act(() => provider.emitStatus('disconnected'));
    expect(states.at(-1)).toBe('load_failed');

    // 1011 (storage failure): the board is readable → reconnecting, editing
    // stays enabled.
    act(() => provider.emitClose(1011));
    expect(states.at(-1)).toBe('reconnecting');
    expect(canEdit('reconnecting')).toBe(true);

    // 1003 (unsupported data): also reconnecting, not load_failed.
    act(() => provider.emitClose(4500));
    expect(states.at(-1)).toBe('load_failed');
    act(() => provider.emitClose(1003));
    expect(states.at(-1)).toBe('reconnecting');

    // Recovery: the retry succeeds and syncs → connected, editing back on.
    act(() => provider.emitClose(4500));
    expect(states.at(-1)).toBe('load_failed');
    act(() => provider.emitSync(true));
    expect(states.at(-1)).toBe('connected');
    expect(canEdit('connected')).toBe(true);

    handle.destroy();
  });

  it('TC-23: load_failed blocks every edit path with zero model mutations', async () => {
    render(<App />);
    const provider = lastProvider();
    act(() => provider.emitClose(4500));

    // The red banner is visible.
    const badge = screen.getByRole('status', { name: 'Board load failed' });
    expect(badge).toHaveTextContent("This board couldn't be loaded. Retrying…");

    // A note that existed before the failure (synced state from the room).
    const id = addNote(0, 0);
    const before = note(id);
    expect(before).toBeTruthy();

    // 1. The Sticky note button is disabled.
    expect(screen.getByRole('button', { name: 'Sticky note' })).toBeDisabled();

    // 2. Double-click on empty board space creates nothing.
    fireEvent.doubleClick(screen.getByTestId('board-viewport'), {
      clientX: 300,
      clientY: 200,
    });

    // 3. Delete on the selected note deletes nothing.
    const noteEl = screen.getByTestId('sticky-note');
    click(noteEl);
    fireEvent.keyDown(window, { key: 'Delete' });

    // 4. Drag moves nothing (selection still works — the note is selected).
    dragTo(noteEl, 120, 80);
    await flushRaf();
    pointerUp(noteEl, 120, 80);

    // 5. Colour changes nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Blue colour' }));

    // 6. Text editing never starts (no editor appears, text unchanged).
    fireEvent.doubleClick(noteEl);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();

    // Zero model mutations: the note is exactly as it was.
    const after = note(id);
    expect(after).toEqual(before);
    expect(noteText(id)).toBe(before!.text);
    expect(hooks().getNotes()).toHaveLength(1);
  });
});
