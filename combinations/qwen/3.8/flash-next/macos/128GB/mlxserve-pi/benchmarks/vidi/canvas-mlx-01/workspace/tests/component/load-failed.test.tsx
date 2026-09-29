/**
 * Component tests for the client load-failure state (`persist.client_status`, TC-22, TC-23).
 *
 * TC-22 renders the badge directly in `load_failed`. TC-23 mounts the whole `App` on a
 * board route with a controllable stand-in for `y-websocket`'s `WebsocketProvider`, drives
 * a real `CLOSE_BOARD_LOAD_FAILED` close through the connection layer, and asserts the
 * board is not editable: a double-click, the (disabled) Sticky note button, and Delete on a
 * selected note all leave the model untouched. Only the transport is mocked — the status
 * machine, `canEdit`, the toolbar, and the model are the real code under test.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { App } from '../../src/client/App.js';
import { ConnectionStatus } from '../../src/client/board/ConnectionStatus.js';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol.js';
import { canEdit } from '../../src/client/App.js';
import {
  boardDoc,
  clickCreateButton,
  clickNoteDelete,
  clickSwatch,
  dblClick,
  dblClickNote,
  editorIn,
  modelNote,
  modelNotes,
  noteDown,
  noteMove,
  noteUp,
  seedNote,
} from './stickyHarness.js';
import { boardElement, flush, isDisabled, key } from './harness.js';

// A controllable stand-in for y-websocket's provider: the test drives `status`,
// `connection-close`, and `sync` events; `connectBoard`'s real state machine reacts.
vi.mock('y-websocket', () => {
  class FakeAwareness {
    private readonly states = new Map<number, Record<string, unknown>>();
    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    getStates(): Map<number, Record<string, unknown>> {
      return this.states;
    }
    setLocalStateField(key: string, value: unknown): void {
      const cur = this.states.get(1) ?? {};
      this.states.set(1, { ...cur, [key]: value });
    }
    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    }
    off(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
    }
  }
  class FakeProvider {
    readonly awareness = new FakeAwareness();
    private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor() {
      (globalThis as unknown as { __fakeProvider: FakeProvider }).__fakeProvider = this;
    }
    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    }
    off(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
    }
    disconnect(): void {}
    destroy(): void {}
    // Test-only drivers.
    fireStatus(status: 'connected' | 'disconnected' | 'connecting'): void {
      for (const h of [...(this.handlers.get('status') ?? [])]) h({ status });
    }
    fireClose(code: number): void {
      for (const h of [...(this.handlers.get('connection-close') ?? [])]) h({ code }, this);
    }
    fireSync(state: boolean): void {
      for (const h of [...(this.handlers.get('sync') ?? [])]) h(state);
    }
  }
  return { WebsocketProvider: FakeProvider };
});

/** A valid 22-character board id so App treats the route as a live board. */
const BOARD_ID = 'boardtestboardtest0000';
const fakeProvider = (): {
  fireStatus: (s: 'connected' | 'disconnected' | 'connecting') => void;
  fireClose: (c: number) => void;
  fireSync: (s: boolean) => void;
} => (globalThis as unknown as { __fakeProvider: never }).__fakeProvider;

const renderAtBoard = async (): Promise<void> => {
  window.history.pushState({}, '', `/b/${BOARD_ID}`);
  render(<App />);
  await flush();
};

describe('connection load-failure badge (TC-22)', () => {
  it("TC-22 renders the red could-not-be-loaded label with role status", () => {
    render(<ConnectionStatus status="load_failed" />);
    const badge = document.querySelector('.test-connection-status');
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute('data-status')).toBe('load_failed');
    expect(badge!.getAttribute('role')).toBe('status');
    expect(badge!.textContent).toContain("This board couldn't be loaded. Retrying…");
    expect((badge as HTMLElement).style.color).toBe('rgb(198, 40, 40)');
  });

  it('canEdit is false only for load_failed', () => {
    expect(canEdit('load_failed')).toBe(false);
    expect(canEdit('connecting')).toBe(true);
    expect(canEdit('online')).toBe(true);
    expect(canEdit('offline')).toBe(true);
    expect(canEdit(null)).toBe(true);
  });
});

describe('load-failure blocks editing (TC-23)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('TC-23 a load_failed board ignores create, toolbar, and delete', async () => {
    await renderAtBoard();
    const id = await seedNote(0, 0, 'yellow');

    // The room refuses the board with the load-failure code.
    act(() => {
      fakeProvider().fireClose(CLOSE_BOARD_LOAD_FAILED);
    });
    await flush();
    expect(document.querySelector('.test-connection-status')!.getAttribute('data-status')).toBe(
      'load_failed',
    );

    const before = modelNotes().length;
    expect(before).toBe(1);

    // The Sticky note button is disabled.
    expect(isDisabled('create-sticky')).toBe(true);

    // Double-clicking the board creates nothing.
    await dblClick(boardElement(), 640, 400);
    // The disabled toolbar button creates nothing.
    await clickCreateButton();

    // Selecting the existing note and pressing Delete removes nothing.
    await noteDown(id, 640, 400);
    await key({ key: 'Delete' });
    expect(modelNotes().length).toBe(before);

    const pos0 = modelNote(id)!;

    // Dragging the note moves nothing: the drag never becomes a move while read-only.
    await noteDown(id, 640, 400);
    await noteMove(id, 900, 600);
    await noteUp(id, 900, 600);
    expect(modelNote(id)!.x).toBe(pos0.x);
    expect(modelNote(id)!.y).toBe(pos0.y);

    // Double-clicking the note never opens the text editor.
    await dblClickNote(id);
    expect(editorIn(id)).toBeNull();

    // A colour swatch never recolours and the note's own delete button removes nothing.
    await clickSwatch(id, 'blue');
    expect(modelNote(id)!.color).toBe(pos0.color);
    await clickNoteDelete(id);
    expect(modelNote(id)).toBeDefined();

    // Nothing at all changed the model across every gesture.
    expect(modelNotes().length).toBe(before);
    expect(boardDoc()).toBeDefined();
  });

  it('a repaired board re-enables editing on the first sync without a reload', async () => {
    await renderAtBoard();
    act(() => {
      fakeProvider().fireClose(CLOSE_BOARD_LOAD_FAILED);
    });
    await flush();
    expect(document.querySelector('.test-connection-status')!.getAttribute('data-status')).toBe(
      'load_failed',
    );
    // The board loads and syncs: editing returns with no reload.
    act(() => {
      fakeProvider().fireStatus('connected');
      fakeProvider().fireSync(true);
    });
    await flush();
    expect(isDisabled('create-sticky')).toBe(false);
    const before = modelNotes().length;
    await clickCreateButton();
    expect(modelNotes().length).toBe(before + 1);
  });
});
