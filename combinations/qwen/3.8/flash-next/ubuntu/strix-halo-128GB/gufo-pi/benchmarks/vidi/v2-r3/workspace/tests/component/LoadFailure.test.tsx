import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import {
  connectBoard,
  canEdit,
  type ConnectionState,
  type ProviderLike,
} from '../../src/client/sync/connectBoard';
import { createSticky, snapshot } from '../../src/shared/board-model';

// ---------------------------------------------------------------------------
// TC-22: load_failed renders the red message with role=status.
// ---------------------------------------------------------------------------
describe('ConnectionStatus load_failed (TC-22)', () => {
  it('TC-22: shows red "This board couldn\u2019t be loaded. Retrying\u2026"', () => {
    render(<ConnectionStatus state="load_failed" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('This board couldn\u2019t be loaded. Retrying\u2026');
    // Red background.
    expect(badge.style.backgroundColor).toBe('rgb(229, 57, 53)');
  });
});

// ---------------------------------------------------------------------------
// TC-23: in load_failed (readOnly harness) no interaction mutates the board.
// ---------------------------------------------------------------------------
describe('Board edit lock in load_failed (TC-23)', () => {
  it('TC-23: dblclick, create button, Delete, drag and typing cause no mutation', () => {
    const handleRef: { current: HarnessHandle | null } = { current: null };
    const { container } = render(
      <BoardHarness handleRef={handleRef as React.MutableRefObject<HarnessHandle | null>} readOnly />,
    );

    const doc = handleRef.current!.doc;

    // --- double-click empty board creates nothing ---
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    expect(snapshot(doc).length).toBe(0);

    // --- create-sticky button is present but disabled; clicking does nothing ---
    const button = screen.getByTestId('create-sticky-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(snapshot(doc).length).toBe(0);

    // --- add a note programmatically so we can attempt to mutate it ---
    let created = '';
    act(() => {
      created = createSticky(doc, { x: 100, y: 100 });
      // Set some text.
      const t = (doc.getMap('objects').get(created) as Y.Map<unknown>).get('text') as Y.Text;
      t.insert(0, 'immutable');
    });
    expect(snapshot(doc).length).toBe(1);
    const before = snapshot(doc)[0];

    // --- Delete key on a (selected) note does nothing ---
    // Select the note by dispatching key events the way a keyboard would.
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(snapshot(doc).length).toBe(1);

    // --- drag the note: position unchanged ---
    const note = screen.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { pointerId: 1, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 320, clientY: 320 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const afterDrag = snapshot(doc)[0];
    expect(afterDrag.x).toBe(before.x);
    expect(afterDrag.y).toBe(before.y);

    // --- double-click the note to edit, then type: text unchanged ---
    fireEvent.doubleClick(note, { clientX: 200, clientY: 200 });
    const editor = container.querySelector('[data-testid="sticky-note-editor"]');
    expect(editor).toBeNull(); // no editor opened → no text mutation possible
    expect(snapshot(doc)[0].text).toBe('immutable');
  });
});

// ---------------------------------------------------------------------------
// TC-28: close-code mapping and recovery via a fake provider.
// ---------------------------------------------------------------------------
class FakeProvider implements ProviderLike {
  private handlers = new Map<string, Array<(arg?: any) => void>>();
  wsconnected = false;
  synced = false;
  on(event: string, cb: (arg?: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(cb);
  }
  emit(event: string, arg?: any): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }
  destroy(): void {
    this.handlers.clear();
  }
}

function withFakeProvider(): {
  states: ConnectionState[];
  provider: FakeProvider;
  handle: { destroy(): void };
} {
  const states: ConnectionState[] = [];
  const provider = new FakeProvider();
  const doc = new Y.Doc();
  const handle = connectBoard(doc, 'board', (s) => states.push(s), {
    providerFactory: () => provider,
  });
  return { states, provider, handle };
}

describe('connectBoard close-code mapping (TC-28)', () => {
  it('TC-28: 4500 → load_failed; 1011/1003 → reconnecting (editing on); sync recovers', () => {
    // 4500 → load_failed (editing disabled)
    {
      const { states, provider, handle } = withFakeProvider();
      act(() => provider.emit('connection-close', { code: 4500 }));
      expect(states).toContain('load_failed');
      expect(canEdit('load_failed')).toBe(false);
      handle.destroy();
    }

    // 1011 → reconnecting (editing still enabled). Needs a prior sync to count
    // as "had been synced" so a transient drop maps to reconnecting.
    {
      const { states, provider, handle } = withFakeProvider();
      act(() => provider.emit('sync', true)); // becomes connected
      act(() => provider.emit('connection-close', { code: 1011 }));
      expect(states).toContain('reconnecting');
      expect(states).not.toContain('load_failed');
      expect(canEdit('reconnecting')).toBe(true);
      handle.destroy();
    }

    // 1003 → reconnecting
    {
      const { states, provider, handle } = withFakeProvider();
      act(() => provider.emit('sync', true));
      act(() => provider.emit('connection-close', { code: 1003 }));
      expect(states).toContain('reconnecting');
      expect(canEdit('reconnecting')).toBe(true);
      handle.destroy();
    }

    // Recovery: after load_failed, a subsequent sync → connected and editable.
    {
      const { states, provider, handle } = withFakeProvider();
      act(() => provider.emit('connection-close', { code: 4500 }));
      expect(states[states.length - 1]).toBe('load_failed');
      // The provider keeps retrying; a later sync succeeds.
      act(() => provider.emit('sync', true));
      expect(states[states.length - 1]).toBe('connected');
      expect(canEdit('connected')).toBe(true);
      handle.destroy();
    }
  });

  it('status events are ignored while load_failed until a sync recovers', () => {
    const { states, provider, handle } = withFakeProvider();
    act(() => provider.emit('connection-close', { code: 4500 }));
    expect(states[states.length - 1]).toBe('load_failed');
    // A reconnect "connecting" status must NOT downgrade load_failed.
    act(() => provider.emit('status', { status: 'connecting' }));
    expect(states[states.length - 1]).toBe('load_failed');
    handle.destroy();
  });
});

void cleanup;
void vi;
