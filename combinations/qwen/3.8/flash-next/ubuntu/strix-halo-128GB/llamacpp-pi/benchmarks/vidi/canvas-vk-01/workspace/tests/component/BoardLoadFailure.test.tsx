import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo, useState, type JSX } from 'react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { ConnectionStatus, canEdit } from '../../src/client/sync/ConnectionStatus';
import { connectBoard, type ConnectionState } from '../../src/client/sync/connectBoard';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../src/shared/protocol';
import { fireKey, firePointer } from './helpers';

/**
 * TC-22, TC-23 — the load-failure state of the client (persist.client_status):
 * the red message, and the board being locked while it shows. Driven through the
 * real `connectBoard` with a fake `WebsocketProvider`, because the observable
 * that matters is a close code from the room.
 */

interface FakeProviderInstance {
  emit(event: string, arg: unknown): void;
}

const fake = vi.hoisted(() => {
  const instances: unknown[] = [];
  class FakeWebsocketProvider {
    handlers = new Map<string, Set<(arg: never) => void>>();
    constructor(
      readonly serverUrl: string,
      readonly roomname: string,
      readonly doc: unknown,
      readonly options: unknown,
    ) {
      instances.push(this);
    }
    on(event: string, handler: (arg: never) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: (arg: never) => void): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, arg: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        (handler as (a: unknown) => void)(arg);
      }
    }
    disconnect(): void {}
    destroy(): void {}
  }
  return { instances, provider: FakeWebsocketProvider };
});

vi.mock('y-websocket', () => ({ WebsocketProvider: fake.provider }));

const VALID_ID = 'V1a2b3c4D5e6F7g8h9i0j-';
const MESSAGE = "This board couldn't be loaded. Retrying…";

const provider = (): FakeProviderInstance =>
  fake.instances[fake.instances.length - 1] as FakeProviderInstance;

const goOnline = (): void => {
  act(() => provider().emit('status', { status: 'connected' }));
  act(() => provider().emit('sync', true));
};

/**
 * The room closed the socket with `code`. `y-websocket` reports the close and
 * then the disconnection, in that order — which is why `connectBoard` can read
 * the close code before the status handler reacts to the drop.
 */
const closeWith = (code: number): void => {
  act(() => provider().emit('connection-close', { code, reason: '', wasClean: true }));
  act(() => provider().emit('status', { status: 'disconnected' }));
};

const badge = (): HTMLElement | null => screen.queryByTestId('connection-status');
const badgeText = (): string => badge()?.textContent ?? '';
const createButton = (): HTMLButtonElement =>
  screen.getByTestId('create-sticky') as HTMLButtonElement;

beforeEach(() => {
  fake.instances.length = 0;
});

afterEach(cleanup);

describe('TC-22: the load-failure badge', () => {
  it('says the board could not be loaded, with role="status"', () => {
    render(<ConnectionStatus state="load_failed" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(MESSAGE);
    expect(status.getAttribute('data-state')).toBe('load_failed');
  });

  it('is red — the stylesheet colours exactly this state as an error', () => {
    render(<ConnectionStatus state="load_failed" />);
    const className = (badge() as HTMLElement).className;
    expect(className).toContain('connection-status--load_failed');

    // jsdom applies no stylesheets, so the colour is checked where it is
    // defined rather than on the element.
    // (Resolved from the repo root: `new URL(literal, import.meta.url)` gets
    // rewritten to a served asset URL by the bundler in a jsdom environment,
    // which is not a file: URL.)
    const css = readFileSync(
      path.resolve(process.cwd(), 'src/client/styles.css'),
      'utf8',
    );
    const rule = /\.connection-status--load_failed\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(isRed(/color:\s*(#[0-9a-f]{6})/.exec(rule)?.[1] ?? '')).toBe(true);
  });

  it('states exactly one label per connection state', () => {
    expect(renderLabel('connecting')).toBe('Connecting…');
    expect(renderLabel('connected')).toBe('');
    expect(renderLabel('reconnecting')).toBe('Reconnecting…');
    expect(renderLabel('confirmed')).toBe('Connected');
    expect(renderLabel('load_failed')).toBe(MESSAGE);
  });
});

describe('TC-23: a board that could not be loaded is not editable', () => {
  it('rejects create, drag, colour, delete and typing without touching the model', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const kept = createSticky(doc, { x: 100, y: 100 });
    const untouched = JSON.stringify(snapshot(doc));

    // Count every Y.Doc change: a no-op handler leaves the model alone.
    let mutations = 0;
    doc.on('update', () => {
      mutations += 1;
    });

    render(<BoardApp doc={doc} boardId={VALID_ID} />);
    goOnline();

    // Select the note while the board still works, so the locked board is
    // tested with a live selection and toolbar rather than none.
    const note = screen.getByTestId(`sticky-note-${kept}`);
    firePointer(note, 'pointerdown', 20, 20);
    firePointer(note, 'pointerup', 20, 20);
    expect(screen.getByTestId('note-toolbar')).toBeDefined();
    expect(mutations).toBe(0);

    // The room refuses the board.
    closeWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badgeText()).toBe(MESSAGE);
    expect(canEdit(state())).toBe(false);

    // 1. Sticky note button: disabled, and clicking it does nothing.
    expect(createButton().disabled).toBe(true);
    act(() => {
      fireEvent.click(createButton());
    });

    // 2. Double-click the board.
    act(() => {
      fireEvent.doubleClick(screen.getByTestId('board-viewport'));
    });

    // 3. Drag the note.
    firePointer(note, 'pointerdown', 20, 20);
    firePointer(note, 'pointermove', 240, 220);
    firePointer(note, 'pointerup', 240, 220);

    // 4. Colour and delete from the toolbar that is still on screen.
    act(() => {
      fireEvent.click(screen.getByTestId('color-green'));
    });
    act(() => {
      fireEvent.click(screen.getByTestId('delete-note'));
    });

    // 5. The Delete key, and typing into a note.
    fireKey({ key: 'Delete' });
    act(() => {
      fireEvent.doubleClick(note);
    });
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();

    expect(mutations).toBe(0);
    expect(JSON.stringify(snapshot(doc))).toBe(untouched);
  });

  it('leaves the board editable in every other state', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let mutations = 0;
    doc.on('update', () => {
      mutations += 1;
    });

    render(<BoardApp doc={doc} boardId={VALID_ID} />);
    goOnline();
    act(() => {
      fireEvent.click(createButton());
    });
    expect(mutations).toBe(1);

    // A storage failure at the room is a dropped connection, not a lock.
    closeWith(CLOSE_STORAGE_FAILURE);
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
    expect(createButton().disabled).toBe(false);
    act(() => {
      fireEvent.click(createButton());
    });
    expect(mutations).toBe(2);
  });
});

describe('close code mapping and recovery', () => {
  it('maps 4500 to load_failed, and stays there through retries that fail for other reasons', () => {
    render(<Harness />);
    expect(badgeText()).toBe('Connecting…');

    closeWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');

    // The provider keeps retrying (4500 is not terminal for it); a failed retry
    // must not rewrite the message or unlock the board.
    closeWith(1006);
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');
  });

  it('maps every other close code to a reconnecting board that stays editable', () => {
    render(<Harness />);
    goOnline();
    closeWith(CLOSE_STORAGE_FAILURE);
    expect(badge()?.getAttribute('data-state')).toBe('reconnecting');
    expect(canEdit(state())).toBe(true);
  });

  it('returns to connected, and editing, as soon as a retry syncs', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let mutations = 0;
    doc.on('update', () => {
      mutations += 1;
    });
    render(<BoardApp doc={doc} boardId={VALID_ID} />);

    closeWith(CLOSE_BOARD_LOAD_FAILED);
    expect(badge()?.getAttribute('data-state')).toBe('load_failed');
    expect(createButton().disabled).toBe(true);

    // The room loaded the board on a later attempt. Nobody reloads the page.
    goOnline();
    expect(badge()).toBeNull();
    expect(createButton().disabled).toBe(false);
    act(() => {
      fireEvent.click(createButton());
    });
    expect(mutations).toBe(1);
  });
});

/** Production wiring on its own: `connectBoard` driving `ConnectionStatus`. */
function Harness(): JSX.Element {
  const doc = useMemo(() => {
    const fresh = new Y.Doc();
    initDoc(fresh);
    return fresh;
  }, []);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const handle = connectBoard(doc, VALID_ID, setConnection);
    return () => handle.destroy();
  }, [doc]);
  return <ConnectionStatus state={connection} />;
}

/** The connection state the mounted app is reporting, read from the badge. */
function state(): ConnectionState {
  return (badge()?.getAttribute('data-state') ?? 'connected') as ConnectionState;
}

function renderLabel(state: ConnectionState): string {
  const view = render(<ConnectionStatus state={state} />);
  const label = view.container.textContent ?? '';
  view.unmount();
  return label;
}

/** A `#rrggbb` where red clearly dominates. */
function isRed(hex: string): boolean {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) return false;
  const [, r, g, b] = match;
  const [red, green, blue] = [r, g, b].map((part) => Number.parseInt(part ?? '0', 16));
  return (red ?? 0) > (green ?? 0) + 0x40 && (red ?? 0) > (blue ?? 0) + 0x40;
}
