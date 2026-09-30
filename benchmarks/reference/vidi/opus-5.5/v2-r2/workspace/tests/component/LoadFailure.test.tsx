import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  type ConnectionState,
  type ProviderEvents,
  trackConnectionState,
} from '../../src/client/sync/connectBoard';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { SHORT_PHRASE } from '../fixtures/texts';
import { flushFrame, noteToolbar, pointer, stickyNotes } from './helpers';

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

// Captures connectBoard's state callback so App tests can drive the connection state.
const connectCalls = vi.hoisted(() => [] as ((s: string) => void)[]);
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
      connectCalls.push(onState);
      onState('connecting');
      return { destroy() {} };
    },
  };
});

const { App } = await import('../../src/client/App');

type Status = 'connecting' | 'connected' | 'disconnected';

/** Stands in for the y-websocket provider: `status`, `sync` and `connection-close` events. */
class FakeProvider implements ProviderEvents {
  private handlers = new Map<string, Set<(arg: never) => void>>();
  on(event: string, handler: (arg: never) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (arg: never) => void): void {
    this.handlers.get(event)?.delete(handler);
  }
  private emit(event: string, arg: unknown) {
    act(() => {
      for (const h of this.handlers.get(event) ?? []) (h as (a: unknown) => void)(arg);
    });
  }
  /** Socket opened and synced. */
  connect() {
    this.emit('status', { status: 'connected' });
    this.emit('sync', true);
  }
  /** Socket opened, then closed by the server with `code` (y-websocket's event order). */
  closedWith(code: number) {
    this.emit('status', { status: 'connected' });
    this.emit('connection-close', { code });
    this.emit('status', { status: 'disconnected' as Status });
    this.emit('sync', false);
    this.emit('status', { status: 'connecting' as Status });
  }
}

function Harness(props: { provider: FakeProvider; onState?: (s: ConnectionState) => void }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      trackConnectionState(props.provider, (s) => {
        setState(s);
        props.onState?.(s);
      }).destroy,
    [props.provider, props.onState],
  );
  return <ConnectionStatus state={state} />;
}

const badge = () => screen.queryByRole('status');

afterEach(() => {
  vi.useRealTimers();
});

describe('load-failure badge (TC-22)', () => {
  it('renders load_failed as a red status reading the load-failure message', () => {
    render(<ConnectionStatus state="load_failed" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(LOAD_FAILED_TEXT);
    expect(status.getAttribute('data-state')).toBe('load_failed');
    expect(status.className).toContain('connection-status--load_failed');
  });

  it('canEdit is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    for (const s of ['connecting', 'connected', 'reconnecting', 'confirmed'] as const) expect(canEdit(s)).toBe(true);
  });
});

describe('close-code mapping (TC-28)', () => {
  function setup() {
    vi.useFakeTimers();
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} onState={(s) => states.push(s)} />);
    return { provider, states };
  }

  it(`close ${CLOSE_BOARD_LOAD_FAILED} → load_failed, kept through retries, until a sync succeeds → connected`, () => {
    const { provider } = setup();
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    // Retried and refused again: still the red message, never "Reconnecting…".
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    // A network failure while retrying does not pretend the board is readable.
    provider.closedWith(1006);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    provider.connect();
    expect(badge()).toBeNull();
  });

  it(`close ${CLOSE_STORAGE_FAILURE} (storage failure) → reconnecting, not load_failed`, () => {
    const { provider, states } = setup();
    provider.connect();
    provider.closedWith(CLOSE_STORAGE_FAILURE);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(states).not.toContain('load_failed');
    provider.connect();
    expect(badge()?.textContent).toBe('Connected');
  });

  it(`close ${CLOSE_UNSUPPORTED_DATA} → reconnecting, not load_failed`, () => {
    const { provider, states } = setup();
    provider.connect();
    provider.closedWith(CLOSE_UNSUPPORTED_DATA);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(states).not.toContain('load_failed');
  });

  it('a later 4500 after being connected also shows the load-failure message', () => {
    const { provider } = setup();
    provider.connect();
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
  });
});

describe('edit lock while the board cannot be loaded (TC-23, TC-28)', () => {
  const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const appBadge = () => document.querySelector<HTMLElement>('.connection-status');

  function setup() {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    connectCalls.length = 0;
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    if (id === false) throw new Error('create rejected');
    getStickyText(doc, id)?.insert(0, SHORT_PHRASE);
    render(<App doc={doc} boardId="AAAAAAAAAAAAAAAAAAAAAA" />);
    const onState = connectCalls.at(-1)!;
    const note = () => stickyNotes()[0]!;
    const stickyButton = () => screen.getByRole('button', { name: 'Sticky note (N)' }) as HTMLButtonElement;
    return { doc, id, onState, note, stickyButton };
  }

  function countUpdates(doc: Y.Doc) {
    const counter = { count: 0 };
    doc.on('update', () => counter.count++);
    return counter;
  }

  it('TC-23: double-click, Sticky note button, Delete, Enter, drag and typing change nothing', () => {
    const { doc, id, onState, note, stickyButton } = setup();
    act(() => onState('connected'));
    // Select the note while the board is still editable.
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'up', CENTRE.x, CENTRE.y);
    flushFrame();
    expect(noteToolbar()).not.toBeNull();

    act(() => onState('load_failed'));
    const updates = countUpdates(doc);
    const before = snapshot(doc);

    expect(appBadge()?.textContent).toBe(LOAD_FAILED_TEXT);
    expect(appBadge()?.getAttribute('role')).toBe('status');
    expect(noteToolbar()).toBeNull();
    // Create: double-click on empty board, and the (disabled) Sticky note button.
    fireEvent.doubleClick(screen.getByTestId('board-viewport'), { clientX: CENTRE.x + 300, clientY: CENTRE.y + 200 });
    expect(stickyButton().disabled).toBe(true);
    fireEvent.click(stickyButton());
    // Delete and Enter on the selected note.
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // Drag.
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'move', CENTRE.x + 80, CENTRE.y + 40);
    flushFrame();
    pointer(note(), 'up', CENTRE.x + 80, CENTRE.y + 40);
    flushFrame();
    // Type: double-click the note (no editor opens), Enter on the focused note.
    fireEvent.doubleClick(note());
    note().focus();
    fireEvent.keyDown(note(), { key: 'Enter' });
    expect(screen.queryByRole('textbox')).toBeNull();

    expect(updates.count).toBe(0);
    expect(snapshot(doc)).toEqual(before);
    expect(stickyNotes()).toHaveLength(1);
    expect(stickyNotes()[0]!.dataset.id).toBe(id);
  });

  it('an open text editor closes when the board becomes unloadable', () => {
    const { onState, note } = setup();
    act(() => onState('connected'));
    fireEvent.doubleClick(note());
    expect(screen.queryByRole('textbox')).not.toBeNull();
    act(() => onState('load_failed'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-28: editing stays enabled on reconnecting (storage failure) and returns after a load failure recovers', () => {
    const { doc, onState, stickyButton } = setup();
    act(() => onState('reconnecting'));
    expect(stickyButton().disabled).toBe(false);
    fireEvent.click(stickyButton());
    expect(snapshot(doc)).toHaveLength(2);
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });

    act(() => onState('load_failed'));
    expect(stickyButton().disabled).toBe(true);
    act(() => onState('connected'));
    expect(stickyButton().disabled).toBe(false);
    expect(appBadge()).toBeNull();
    fireEvent.click(stickyButton());
    expect(snapshot(doc)).toHaveLength(3);
  });
});
