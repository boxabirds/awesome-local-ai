// persist.client_status: the load-failure badge, the edit lock and the close-code mapping.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App, canEdit } from '../../src/client/App';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import {
  type ConnectionState,
  type ProviderEvents,
  trackConnectionState,
} from '../../src/client/sync/connectBoard';
import { newBoardId } from '../../src/shared/board-id';
import * as model from '../../src/shared/board-model';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { FakeWebSocket } from './fakeWebSocket';

// Every board-model mutation, spied (the real implementations still run).
vi.mock('../../src/shared/board-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/board-model')>();
  return {
    ...actual,
    createSticky: vi.fn(actual.createSticky),
    moveObject: vi.fn(actual.moveObject),
    bringToFront: vi.fn(actual.bringToFront),
    setStickyColor: vi.fn(actual.setStickyColor),
    deleteObject: vi.fn(actual.deleteObject),
    getStickyText: vi.fn(actual.getStickyText),
    moveObjects: vi.fn(actual.moveObjects),
    resizeObjects: vi.fn(actual.resizeObjects),
    bringObjectsToFront: vi.fn(actual.bringObjectsToFront),
    deleteObjects: vi.fn(actual.deleteObjects),
  };
});

const MUTATIONS = [
  'createSticky',
  'moveObject',
  'bringToFront',
  'setStickyColor',
  'deleteObject',
  'getStickyText',
  'moveObjects',
  'resizeObjects',
  'bringObjectsToFront',
  'deleteObjects',
] as const;

function mutationCalls(): number {
  return MUTATIONS.reduce((n, name) => n + vi.mocked(model[name]).mock.calls.length, 0);
}

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";

// The zoom label (<output>) also has the status role, so find the badge by its class.
const badge = () => document.querySelector<HTMLElement>('.connection-status');
const stickyButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Sticky note' });
const noteEl = () => screen.getByRole('group', { name: 'Sticky note' });

/** Stands in for WebsocketProvider's `status`, `sync` and `connection-close` events. */
class FakeProvider implements ProviderEvents {
  private listeners = new Map<string, Set<(arg: never) => void>>();
  on(event: string, listener: (arg: never) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  off(event: string, listener: (arg: never) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  private emit(event: string, arg: unknown) {
    act(() => {
      for (const l of this.listeners.get(event) ?? []) (l as (a: unknown) => void)(arg);
    });
  }
  connectAndSync() {
    this.emit('status', { status: 'connecting' });
    this.emit('status', { status: 'connected' });
    this.emit('sync', true);
  }
  /** The socket opened and was then closed by the server with `code` (provider event order). */
  closedWith(code: number) {
    this.emit('status', { status: 'connected' });
    this.emit('connection-close', { code, reason: '' });
    this.emit('sync', false);
    this.emit('status', { status: 'disconnected' });
    this.emit('status', { status: 'connecting' });
  }
}

function Harness(props: { provider: FakeProvider; states: ConnectionState[] }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(
    () =>
      trackConnectionState(props.provider, (s) => {
        props.states.push(s);
        setState(s);
      }),
    [props.provider, props.states],
  );
  return (
    <>
      <ConnectionStatus state={state} />
      <output data-testid="can-edit">{String(canEdit(state))}</output>
    </>
  );
}

afterEach(cleanup);

describe('persist.client_status badge', () => {
  it('TC-22 load_failed shows the red "couldn\'t be loaded" message with role status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = badge()!;
    expect(el.textContent).toBe(LOAD_FAILED_TEXT);
    expect(el.getAttribute('role')).toBe('status');
    expect(el.dataset.state).toBe('load_failed');
  });

  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(states.map(canEdit)).toEqual([true, true, true, true, false]);
  });
});

describe('persist.client_status close-code mapping (TC-28)', () => {
  const canEditShown = () => screen.getByTestId('can-edit').textContent;

  it('4500 on first load → load_failed; retries closed 4500 stay load_failed; a sync recovers', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} states={states} />);
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    expect(canEditShown()).toBe('false');
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    // Another failed attempt with a different code does not pretend the board is loading.
    provider.closedWith(1006);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);

    provider.connectAndSync();
    expect(badge()).toBeNull();
    expect(canEditShown()).toBe('true');
    expect(states).toEqual(['connecting', 'load_failed', 'connected']);
  });

  it('4500 after having been connected → load_failed, then connected on sync', () => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} states={states} />);
    provider.connectAndSync();
    provider.closedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    provider.connectAndSync();
    expect(badge()).toBeNull();
    expect(states).toEqual(['connecting', 'connected', 'load_failed', 'connected']);
  });

  it.each([
    ['1011 storage failure', CLOSE_STORAGE_FAILURE],
    ['1003 unsupported data', CLOSE_UNSUPPORTED_DATA],
  ])('%s → reconnecting, editing stays enabled', (_label, code) => {
    const provider = new FakeProvider();
    const states: ConnectionState[] = [];
    render(<Harness provider={provider} states={states} />);
    provider.connectAndSync();
    provider.closedWith(code);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(canEditShown()).toBe('true');
    expect(states).not.toContain('load_failed');
  });
});

describe('persist.client_status in the app', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    for (const name of MUTATIONS) vi.mocked(model[name]).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  /** App on a board that already has one note, whose room then closes with `code`. */
  function renderClosedWith(code: number) {
    const doc = new Y.Doc();
    model.initDoc(doc);
    model.createSticky(doc, { x: 0, y: 0 });
    for (const name of MUTATIONS) vi.mocked(model[name]).mockClear();
    const result = render(<App boardId={newBoardId()} doc={doc} />);
    const ws = FakeWebSocket.latest();
    act(() => {
      ws.readyState = 1;
      ws.onopen?.();
    });
    ws.serverClose(code);
    return { ...result, doc, viewport: screen.getByTestId('board-viewport') };
  }

  it('TC-23 a load_failed board cannot be changed in any way', async () => {
    const { doc, viewport, unmount } = renderClosedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.textContent).toBe(LOAD_FAILED_TEXT);
    const updates: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => updates.push(u));

    // Create: double-click the board, Sticky note button (disabled).
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    expect(stickyButton().disabled).toBe(true);
    fireEvent.click(stickyButton());
    // Select + Delete.
    const note = noteEl();
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.click(note);
    note.focus();
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(note, { key: 'Backspace' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.queryByRole('toolbar', { name: 'Note toolbar' })).toBeNull();
    // Story 7: the note can be selected for viewing, but not resized.
    expect(screen.queryByRole('button', { name: 'Resize bottom-right' })).toBeNull();
    // Drag.
    fireEvent.pointerDown(note, { clientX: 100, clientY: 100, button: 0, pointerId: 2 });
    fireEvent.pointerMove(note, { clientX: 180, clientY: 160, pointerId: 2 });
    fireEvent.pointerMove(note, { clientX: 260, clientY: 220, pointerId: 2 });
    await new Promise((r) => requestAnimationFrame(r));
    fireEvent.pointerUp(note, { clientX: 260, clientY: 220, pointerId: 2 });
    // Text editing: double-click and Enter open no editor.
    fireEvent.doubleClick(note, { clientX: 100, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByRole('textbox', { name: 'Note text' })).toBeNull();

    expect(mutationCalls()).toBe(0);
    expect(updates).toHaveLength(0);
    expect(model.snapshot(doc)).toHaveLength(1);
    unmount();
  });

  it('TC-28 the board is editable again once a retry syncs, without a reload', async () => {
    const { doc, unmount } = renderClosedWith(CLOSE_BOARD_LOAD_FAILED);
    expect(stickyButton().disabled).toBe(true);
    // The provider retries on its own (backoff); that attempt succeeds.
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(1), { timeout: 3000 });
    FakeWebSocket.latest().openAndSync();
    expect(badge()).toBeNull();
    expect(stickyButton().disabled).toBe(false);
    fireEvent.click(stickyButton());
    expect(model.snapshot(doc)).toHaveLength(2);
    unmount();
  });

  it.each([
    ['1011', CLOSE_STORAGE_FAILURE],
    ['1003', CLOSE_UNSUPPORTED_DATA],
  ])('TC-28 after close %s the board shows "Reconnecting…" and stays editable', (_c, code) => {
    const doc = new Y.Doc();
    const { unmount } = render(<App boardId={newBoardId()} doc={doc} />);
    FakeWebSocket.latest().openAndSync();
    FakeWebSocket.latest().serverClose(code);
    expect(badge()?.textContent).toBe('Reconnecting…');
    expect(stickyButton().disabled).toBe(false);
    fireEvent.click(stickyButton());
    expect(model.snapshot(doc)).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeTruthy();
    unmount();
  });
});
