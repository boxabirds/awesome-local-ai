import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App, canEdit } from '../../src/client/App';
import { connectBoard, type ConnectionState, type ProviderLike } from '../../src/client/sync/connectBoard';
import { ConnectionStatus } from '../../src/client/sync/ConnectionStatus';
import { createSticky } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { click, notes, pointer, viewport } from './helpers';

// A provider whose handlers the tests drive by hand; it exposes the doc App created.
const providers = vi.hoisted(() => [] as {
  doc: Y.Doc;
  handlers: Record<string, ((arg: unknown) => void)[]>;
}[]);

vi.mock('y-websocket', () => ({
  WebsocketProvider: class {
    entry: (typeof providers)[number];
    constructor(_url: string, _room: string, doc: Y.Doc) {
      this.entry = { doc, handlers: {} };
      providers.push(this.entry);
    }
    on(event: string, cb: (arg: unknown) => void) {
      (this.entry.handlers[event] ??= []).push(cb);
    }
    destroy() {}
  },
}));

const emit = (p: (typeof providers)[number], event: string, arg: unknown) =>
  act(() => { (p.handlers[event] ?? []).forEach((h) => h(arg)); });

beforeEach(() => { providers.length = 0; });
afterEach(() => { vi.useRealTimers(); });

function Harness({ onProvider }: { onProvider(p: ReturnType<typeof fake>): void }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  useEffect(() => {
    const f = fake();
    onProvider(f);
    const conn = connectBoard(new Y.Doc(), 'b', (s) => { setState(s); f.states.push(s); }, () => f.provider);
    return () => conn.destroy();
  }, [onProvider]);
  return <><ConnectionStatus state={state} /><output data-testid="can-edit">{String(canEdit(state))}</output></>;
}

function fake() {
  const handlers: Record<string, ((arg: never) => void)[]> = {};
  const states: ConnectionState[] = [];
  const provider = {
    on(event: string, cb: never) { (handlers[event] ??= []).push(cb); },
    destroy() {},
  } as unknown as ProviderLike;
  const fire = (event: string, arg: unknown) => act(() => { (handlers[event] ?? []).forEach((h) => (h as (a: unknown) => void)(arg)); });
  return { provider, states, fire };
}

const badge = () => screen.getByTestId('can-edit').parentElement!.querySelector('div[role=status]');

describe('load-failure badge (TC-22)', () => {
  it('renders the red message with role=status', () => {
    render(<ConnectionStatus state="load_failed" />);
    const el = screen.getByRole('status');
    expect(el.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(getComputedStyle(el).background).toContain('rgb(198, 40, 40)');
  });

  it('canEdit is false only for load_failed', () => {
    const states: ConnectionState[] = ['connecting', 'connected', 'reconnecting', 'confirmed', 'load_failed'];
    expect(states.filter((s) => !canEdit(s))).toEqual(['load_failed']);
  });
});

describe('close-code mapping (TC-28)', () => {
  function setup() {
    vi.useFakeTimers();
    let f!: ReturnType<typeof fake>;
    render(<Harness onProvider={(p) => { f = p; }} />);
    return f;
  }

  it('4500 -> load_failed with editing disabled; first sync afterwards -> connected and editable', () => {
    const f = setup();
    f.fire('connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    f.fire('status', { status: 'disconnected' });
    expect(badge()!.textContent).toBe("This board couldn't be loaded. Retrying…");
    expect(screen.getByTestId('can-edit').textContent).toBe('false');
    // Retry closes again with 4500: still failed.
    f.fire('status', { status: 'connecting' });
    f.fire('connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    expect(f.states.at(-1)).toBe('load_failed');
    f.fire('status', { status: 'connected' });
    f.fire('sync', true);
    expect(f.states.at(-1)).toBe('connected');
    expect(badge()).toBeNull();
    expect(screen.getByTestId('can-edit').textContent).toBe('true');
  });

  for (const code of [CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA]) {
    it(`${code} after connecting -> reconnecting, editing stays enabled`, () => {
      const f = setup();
      f.fire('status', { status: 'connected' });
      f.fire('sync', true);
      f.fire('connection-close', { code });
      f.fire('status', { status: 'disconnected' });
      expect(f.states.at(-1)).toBe('reconnecting');
      expect(badge()!.textContent).toBe('Reconnecting…');
      expect(f.states).not.toContain('load_failed');
      expect(screen.getByTestId('can-edit').textContent).toBe('true');
    });
  }
});

describe('edit lock (TC-23)', () => {
  function renderLocked() {
    window.history.replaceState({}, '', `/b/${'A'.repeat(22)}`);
    render(<App />);
    const p = providers.at(-1)!;
    // Notes the page already holds (e.g. from an earlier session) when the load failure arrives.
    createSticky(p.doc, { x: 0, y: 0 });
    const updates: Uint8Array[] = [];
    emit(p, 'connection-close', { code: CLOSE_BOARD_LOAD_FAILED });
    p.doc.on('update', (u: Uint8Array) => updates.push(u));
    return { p, updates };
  }

  it('shows the message and ignores every editing gesture', () => {
    const { p, updates } = renderLocked();
    expect(screen.getByText("This board couldn't be loaded. Retrying…")).toBeTruthy();

    const button = screen.getByRole('button', { name: 'Sticky note' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);

    fireEvent.doubleClick(viewport(), { clientX: 700, clientY: 300 });
    pointer('dblclick', viewport(), 700, 300);

    const note = notes()[0];
    click(note, 640, 400);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(note, { key: 'Delete' });
    fireEvent.doubleClick(note);
    expect(screen.queryByRole('textbox')).toBeNull();
    pointer('pointerdown', note, 640, 400);
    pointer('pointermove', note, 700, 460);
    pointer('pointerup', note, 700, 460);

    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
    expect(updates).toHaveLength(0);
    expect(p.doc.getMap('objects').size).toBe(1);
  });

  it('editing is available again after a successful sync', () => {
    const { p } = renderLocked();
    emit(p, 'sync', true);
    expect(screen.queryByText("This board couldn't be loaded. Retrying…")).toBeNull();
    expect((screen.getByRole('button', { name: 'Sticky note' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    expect(p.doc.getMap('objects').size).toBe(2);
  });
});

