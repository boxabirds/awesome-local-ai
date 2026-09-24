import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { canEdit } from '../../src/client/board/Board';
import * as model from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import {
  board,
  createSelectedNote,
  doc,
  doubleClickBoard,
  editor,
  flushFrame,
  move,
  noteEls,
  notes,
  noteToolbar,
  press,
  release,
  renderBoard,
} from './stickyHelpers';

vi.mock('../../src/shared/board-model', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/shared/board-model')>();
  return {
    ...real,
    createSticky: vi.fn(real.createSticky),
    moveObject: vi.fn(real.moveObject),
    bringToFront: vi.fn(real.bringToFront),
    setStickyColor: vi.fn(real.setStickyColor),
    deleteObject: vi.fn(real.deleteObject),
  };
});

const LOAD_FAILED_TEXT = "This board couldn't be loaded. Retrying…";
const MUTATIONS = ['createSticky', 'moveObject', 'bringToFront', 'setStickyColor', 'deleteObject'] as const;

/**
 * Stands in for the browser WebSocket so the real y-websocket provider can be driven: tests
 * open a socket and close it with a server close code.
 */
class ControlledWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControlledWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = ControlledWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {
    super();
    ControlledWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = ControlledWebSocket.CLOSED;
  }
  /** The server accepts the connection, then closes it with `code`. */
  acceptThenClose(code: number): void {
    act(() => {
      this.readyState = ControlledWebSocket.OPEN;
      this.onopen?.();
      this.readyState = ControlledWebSocket.CLOSED;
      this.onclose?.({ code, reason: '' });
    });
  }
}

function latestSocket(): ControlledWebSocket {
  const ws = ControlledWebSocket.instances.at(-1);
  if (!ws) throw new Error('no socket opened');
  return ws;
}

function badgeText(): string | null {
  return screen.queryByRole('status', { name: 'Connection status' })?.textContent ?? null;
}

function stickyButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Sticky note' });
}

let docUpdates: number;
function countDocUpdates(): void {
  docUpdates = 0;
  doc().on('update', () => {
    docUpdates += 1;
  });
}

function expectNoMutations(): void {
  for (const name of MUTATIONS) expect(vi.mocked(model[name]), name).not.toHaveBeenCalled();
  expect(docUpdates).toBe(0);
}

beforeEach(() => {
  ControlledWebSocket.instances = [];
  vi.stubGlobal('WebSocket', ControlledWebSocket);
});

afterEach(() => {
  for (const name of MUTATIONS) vi.mocked(model[name]).mockClear();
});

describe('persist.client_status: canEdit', () => {
  it('is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    for (const s of ['connecting', 'connected', 'reconnecting', 'confirmed'] as const) expect(canEdit(s)).toBe(true);
  });
});

describe('persist.client_status: App while the board cannot be loaded (TC-23)', () => {
  it('shows the red message; double-click and the (disabled) Sticky note button create nothing', () => {
    renderBoard();
    latestSocket().acceptThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    countDocUpdates();

    doubleClickBoard(400, 300);
    expect(stickyButton().disabled).toBe(true);
    fireEvent.click(stickyButton());

    expect(noteEls()).toHaveLength(0);
    expect(editor()).toBeNull();
    expectNoMutations();
  });

  it('a note already on the page cannot be dragged, edited, recoloured or deleted', () => {
    renderBoard();
    const el = createSelectedNote(400, 300);
    const before = notes();
    vi.mocked(model.createSticky).mockClear();
    latestSocket().acceptThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(badgeText()).toBe(LOAD_FAILED_TEXT);
    countDocUpdates();

    // Delete key on the selected note.
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    // Colour and delete buttons are not offered.
    expect(noteToolbar()).toBeNull();
    // Drag.
    press(el, 400, 300);
    move(el, 450, 340);
    flushFrame();
    move(el, 500, 380);
    flushFrame();
    release(el, 500, 380);
    flushFrame();
    // Edit: double-click and Enter open no editor, so nothing can be typed.
    fireEvent.doubleClick(el);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(editor()).toBeNull();

    expect(notes()).toEqual(before);
    expectNoMutations();
  });

  it('an open editor closes when the board becomes unloadable', () => {
    renderBoard();
    doubleClickBoard(400, 300);
    expect(editor()).not.toBeNull();
    latestSocket().acceptThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(editor()).toBeNull();
  });

  it('recovery: a successful sync re-enables editing without a reload', () => {
    renderBoard();
    latestSocket().acceptThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(stickyButton().disabled).toBe(true);

    // The provider retries on its own (backoff); this attempt syncs.
    return vi.waitFor(
      () => {
        const ws = latestSocket();
        expect(ControlledWebSocket.instances.length).toBeGreaterThan(1);
        act(() => {
          ws.readyState = ControlledWebSocket.OPEN;
          ws.onopen?.();
          // Server's SyncStep2 (an empty board): [messageSync, syncStep2, update].
          const update = Y.encodeStateAsUpdate(new Y.Doc());
          const frame = new Uint8Array([0, 1, update.length, ...update]);
          ws.onmessage?.({ data: frame.buffer });
        });
        expect(badgeText()).toBeNull();
        expect(stickyButton().disabled).toBe(false);
        doubleClickBoard(400, 300);
        expect(noteEls()).toHaveLength(1);
        void board();
      },
      { timeout: 3000, interval: 50 },
    );
  });
});
